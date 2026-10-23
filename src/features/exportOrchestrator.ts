/**
 * Master export orchestrator: load once, clean once, render each requested target.
 * Cancellable through an AbortSignal checked between every note and every written file.
 *
 * Targets:
 *  - consolidated format ids ('notebooklm' | 'html' | 'markdown')
 *  - 'split' : split files
 *  - 'all'   : every consolidated format + split
 *  - 'zip'   : every consolidated format + split, bundled into one .zip archive
 */

import { ExportGateway, ExporterSettings, ProgressCallback, RememberedExportTarget, VaultFile } from '../core/types';
import { CleanedNote, cleanNote, createExportContext } from '../core/pipeline';
import { CONSOLIDATED_FORMATS, ConsolidatedFormatId } from './formats';
import { OutputPlan, planSplitFiles } from './exportSplit';
import { buildPreparedZip, prepareZipEntry, PreparedZipEntry, zipEntryName, validateZipEntryNames } from '../core/zip';
import { canonicalOutputPath, externalFolderBase, resolveOutputSettings, usesExternalOutputFolder, vaultRelativeOutputPath } from '../core/outputTarget';

export type ExportTarget = RememberedExportTarget;

export class ExportCancelledError extends Error {
	constructor(readonly partialResult?: ExportResult) {
		super('Export cancelled.');
		this.name = 'ExportCancelledError';
	}
}

/** A write failure keeps successful outputs intact and reports their exact partial result. */
export class ExportFailedError extends Error {
	constructor(message: string, readonly partialResult: ExportResult, readonly failedPath?: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'ExportFailedError';
	}
}

export interface ExportResult {
	written: { path: string; bytes: number }[];
	/** Notes skipped because their content could not be read */
	skippedFiles: string[];
	totalBytes: number;
	durationMs: number;
}

function checkCancelled(signal?: AbortSignal, partialResult?: () => ExportResult): void {
	if (signal?.aborted) {
		throw new ExportCancelledError(partialResult?.());
	}
}

/** Lets Obsidian repaint and process clicks (e.g. Cancel) during long loops. */
function yieldToUi(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

export function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, 'utf8');
}

function consolidatedPlans(
	notes: CleanedNote[],
	settings: ExporterSettings,
	exportedAt: string,
	requested: Set<ConsolidatedFormatId>
): Map<ConsolidatedFormatId, OutputPlan> {
	const map = new Map<ConsolidatedFormatId, OutputPlan>();
	for (const [id, format] of Object.entries(CONSOLIDATED_FORMATS) as [ConsolidatedFormatId, (typeof CONSOLIDATED_FORMATS)[ConsolidatedFormatId]][]) {
		if (requested.has(id)) {
			map.set(id, { path: format.outputPath(settings), render: () => format.render(notes, settings, exportedAt) });
		}
	}
	return map;
}

interface LabeledOutput {
	out: OutputPlan;
	stage: string;
}

function validateOutputPath(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(label + ' output path cannot be empty.');
	const portable = trimmed.replace(/\\/g, '/');
	const normalized = canonicalOutputPath(trimmed);
	const absolute = /^(?:[a-z]:\/|\/)/i.test(portable);
	if (!absolute && portable.split('/').includes('..')) {
		throw new Error(label + ' output path must stay inside the vault or use an absolute path.');
	}
	const isDriveRoot = /^[a-z]:\/?$/i.test(normalized);
	const isUncRoot = normalized.startsWith('//') && normalized.slice(2).split('/').length <= 2;
	if (!normalized || normalized === '/' || normalized === '//' || isDriveRoot || isUncRoot || portable.endsWith('/')) {
		throw new Error(label + ' output path must name a file, not a folder.');
	}
	return trimmed;
}

function pathsOverlap(left: string, right: string): boolean {
	const a = canonicalOutputPath(left);
	const b = canonicalOutputPath(right);
	return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

/** Portable comparison key; absolute outputs inside the vault refer to the same sources. */
function sourceKey(path: string, vaultBasePath: string): string {
	return (vaultRelativeOutputPath(path, vaultBasePath) ?? canonicalOutputPath(path)).toLowerCase();
}

/** Selects the individual files to write for the requested targets (no zip). */
function selectOutputs(
	targets: ExportTarget[],
	consolidated: Map<ConsolidatedFormatId, OutputPlan>,
	split: OutputPlan[]
): LabeledOutput[] {
	const selected: LabeledOutput[] = [];
	for (const t of targets) {
		if (t === 'all') {
			for (const [id, out] of consolidated) {
				selected.push({ out, stage: CONSOLIDATED_FORMATS[id].label });
			}
			selected.push(...split.map((out) => ({ out, stage: 'Split' })));
		} else if (t === 'split') {
			selected.push(...split.map((out) => ({ out, stage: 'Split' })));
		} else if (t !== 'zip' && consolidated.has(t)) {
			selected.push({ out: consolidated.get(t)!, stage: CONSOLIDATED_FORMATS[t].label });
		}
	}
	// Repeated targets are harmless; different outputs sharing a path are not.
	const seen = new Map<string, LabeledOutput>();
	// First descendant for each directory prefix, retaining the original conflict message.
	const ancestors = new Map<string, LabeledOutput>();
	const deduped: LabeledOutput[] = [];
	for (const item of selected) {
		validateOutputPath(item.out.path, item.stage);
		const key = canonicalOutputPath(item.out.path);
		const previous = seen.get(key);
		if (previous) {
			if (previous.out === item.out || previous.out.render() === item.out.render()) continue;
			throw new Error('Output path conflict: ' + previous.out.path + ' is used by more than one export.');
		}
		const descendant = ancestors.get(key);
		if (descendant) {
			throw new Error('Output paths overlap: ' + descendant.out.path + ' and ' + item.out.path + '.');
		}
		for (let slash = key.indexOf('/'); slash !== -1; slash = key.indexOf('/', slash + 1)) {
			const prefix = key.slice(0, slash);
			const other = seen.get(prefix);
			if (other) {
				throw new Error('Output paths overlap: ' + other.out.path + ' and ' + item.out.path + '.');
			}
			if (!ancestors.has(prefix)) ancestors.set(prefix, item);
		}
		seen.set(key, item);
		deduped.push(item);
	}
	return deduped;
}

interface NamedOutput {
	name: string;
	out: OutputPlan;
}

/** Preflight names/deduplication without retaining rendered strings. */
function zipOutputs(consolidated: Map<ConsolidatedFormatId, OutputPlan>, split: OutputPlan[], externalBase: string): NamedOutput[] {
	const seen = new Map<string, OutputPlan>();
	const outputs: NamedOutput[] = [];
	for (const out of [...consolidated.values(), ...split]) {
		const name = zipEntryName(out.path, externalBase);
		const previous = seen.get(name);
		if (previous) {
			if (previous !== out && previous.render() !== out.render()) throw new Error('ZIP entry name conflict: ' + name + '.');
			continue;
		}
		seen.set(name, out);
		outputs.push({ name, out });
	}
	validateZipEntryNames(outputs.map((out) => out.name));
	return outputs;
}

/** Reuse prepared records and render only ZIP-only outputs, in canonical order. */
function* zipRecords(outputs: NamedOutput[], prepared: Map<OutputPlan, PreparedZipEntry>, modifiedAt: Date): Generator<PreparedZipEntry> {
	const encoder = new TextEncoder();
	for (const { name, out } of outputs) {
		const record = prepared.get(out) ?? prepareZipEntry({ name, data: encoder.encode(out.render()) }, modifiedAt);
		prepared.delete(out);
		yield record;
	}
}

/** Written files are never rolled back: cancellation and write failures report what was kept. */
export async function runExports(
	gateway: ExportGateway,
	rawSettings: ExporterSettings,
	targets: ExportTarget[],
	onProgress: ProgressCallback,
	signal?: AbortSignal,
	loadedFiles?: VaultFile[]
): Promise<ExportResult> {
	// External output folder: every configured destination is re-rooted once,
	// before validation and before the ZIP/plain outputs are compared.
	const settings: ExporterSettings = structuredClone(resolveOutputSettings(rawSettings));
	const startedAt = Date.now();
	const uniqueTargets = [...new Set(targets)];
	if (uniqueTargets.length === 0) throw new Error('Select at least one export target.');
	for (const target of uniqueTargets) {
		if (target !== 'all' && target !== 'split' && target !== 'zip' && !Object.hasOwn(CONSOLIDATED_FORMATS, target)) {
			throw new Error('Unknown export target: ' + target);
		}
	}

	const written: { path: string; bytes: number }[] = [];
	const skippedFiles: string[] = [];
	const skippedSet = new Set<string>();
	let firstReadFailure = '';
	let loadProgress = { current: 0, total: 0 };
	const addSkipped = (filePath: string, message?: string): void => {
		if (!skippedSet.has(filePath)) {
			skippedSet.add(filePath);
			skippedFiles.push(filePath);
		}
		if (message) {
			firstReadFailure ||= filePath + ': ' + message;
			onProgress({
				stage: 'Loading notes',
				current: loadProgress.current,
				total: loadProgress.total,
				currentFile: filePath,
				log: 'Could not read ' + filePath + ': ' + message,
			});
		}
	};
	const snapshot = (): ExportResult => ({
		written: [...written],
		skippedFiles: [...skippedFiles],
		totalBytes: written.reduce((sum, file) => sum + file.bytes, 0),
		durationMs: Date.now() - startedAt,
	});

	onProgress({ stage: 'Scanning vault', current: 0, total: 1, log: 'Indexing vault notes...' });
	const files = loadedFiles ?? (await gateway.loadVaultFiles(
		settings,
		signal,
		(current, total, currentFile) => {
			loadProgress = { current, total };
			onProgress({
				stage: 'Loading notes',
				current,
				total,
				currentFile,
				log: 'Loaded ' + current + ' of ' + total + ' notes',
			});
		},
		(filePath, message) => addSkipped(filePath, message)
	));
	checkCancelled(signal, snapshot);
	if (files.length === 0) {
		if (skippedFiles.length > 0) {
			throw new Error('Could not read any of the ' + skippedFiles.length + ' matching files. ' + firstReadFailure);
		}
		throw new Error('No files matched the inclusion criteria.');
	}

	const ctx = createExportContext(files, settings);
	const notes: CleanedNote[] = [];
	const requestedYield = Number.isFinite(settings.yieldEvery) ? Math.floor(settings.yieldEvery) : 25;
	const every = Math.max(1, Math.min(1000, requestedYield));
	for (const [i, file] of files.entries()) {
		checkCancelled(signal, snapshot);
		try {
			notes.push(cleanNote(file, ctx));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			addSkipped(file.path);
			console.warn('[vault-exporter] Skipped ' + file.path + ': ' + message);
			onProgress({
				stage: 'Cleaning notes',
				current: i + 1,
				total: files.length,
				currentFile: file.path,
				log: 'Skipped ' + file.path + ': ' + message,
			});
		}
		if ((i + 1) % every === 0) {
			onProgress({ stage: 'Cleaning notes', current: i + 1, total: files.length, currentFile: file.path, log: 'Processed ' + (i + 1) + ' of ' + files.length + ' notes' });
			await yieldToUi();
		}
	}
	if (notes.length === 0) {
		throw new Error('No note could be processed (' + files.length + ' files were skipped).');
	}
	checkCancelled(signal, snapshot);
	onProgress({ stage: 'Cleaning notes', current: files.length, total: files.length, log: 'Processed ' + notes.length + ' notes.' });

	const zipRequested = uniqueTargets.includes('zip');
	const requestedFormats = new Set<ConsolidatedFormatId>();
	const formatIds = Object.keys(CONSOLIDATED_FORMATS) as ConsolidatedFormatId[];
	for (const target of uniqueTargets) {
		if (target === 'all' || zipRequested) {
			for (const id of formatIds) requestedFormats.add(id);
		} else if (target !== 'split' && target !== 'zip') {
			requestedFormats.add(target);
		}
	}

	const exportedAt = new Date().toISOString();
	const consolidated = consolidatedPlans(notes, settings, exportedAt, requestedFormats);
	const splitRequested = zipRequested || uniqueTargets.some((target) => target === 'all' || target === 'split');
	const split = splitRequested ? planSplitFiles(notes, settings) : [];
	const externalBase = usesExternalOutputFolder(settings) ? externalFolderBase(settings.externalOutputFolder) : '';
	const plainTargets = uniqueTargets.filter((target) => target !== 'zip');
	const plainOutputs = selectOutputs(plainTargets, consolidated, split);
	const zipPath = zipRequested ? validateOutputPath(settings.zipOutputPath, 'ZIP bundle') : '';
	const archiveOutputs = zipRequested ? zipOutputs(consolidated, split, externalBase) : [];

	if (zipRequested) {
		for (const item of plainOutputs) {
			if (pathsOverlap(zipPath, item.out.path)) {
				throw new Error('ZIP bundle path overlaps another selected output: ' + item.out.path + '.');
			}
		}
	}

	onProgress({ stage: 'Validating outputs', current: 0, total: 1, log: 'Checking outputs against source notes...' });
	const vaultBasePath = gateway.getVaultBasePath?.() ?? '';
	const sources = new Map(files.map((file) => [sourceKey(file.path, vaultBasePath), file.path]));
	const outputPaths = plainOutputs.map((item) => item.out.path);
	if (zipRequested) outputPaths.push(zipPath);
	for (const path of outputPaths) {
		const source = sources.get(sourceKey(path, vaultBasePath));
		if (source !== undefined) {
			throw new Error('Output "' + path + '" would overwrite the note "' + source + '". Choose another output folder or name.');
		}
	}

	checkCancelled(signal, snapshot);
	const failure = (path: string, error: unknown): ExportFailedError => {
		const message = error instanceof Error ? error.message : String(error);
		return new ExportFailedError('Export failed after writing ' + written.length + ' file(s) at "' + path + '": ' + message, snapshot(), path, error);
	};
	const writeOutput = async (path: string, write: () => Promise<void>): Promise<void> => {
		try {
			await write();
		} catch (error: unknown) {
			if (error instanceof ExportCancelledError) throw error;
			throw failure(path, error);
		}
	};

	const prepared = new Map<OutputPlan, PreparedZipEntry>();
	const archiveNames = new Map(archiveOutputs.map(({ name, out }) => [out, name]));
	const zipModifiedAt = new Date();
	const encoder = new TextEncoder();

	for (const [i, item] of plainOutputs.entries()) {
		checkCancelled(signal, snapshot);
		onProgress({
			stage: item.stage,
			current: i + 1,
			total: plainOutputs.length,
			currentFile: item.out.path,
			log: 'Writing ' + item.out.path,
		});
		let content: string;
		try {
			content = item.out.render();
		} catch (error: unknown) {
			if (error instanceof ExportCancelledError || written.length === 0) throw error;
			throw failure(item.out.path, error);
		}
		await writeOutput(item.out.path, () => gateway.writeFile(item.out.path, content));
		written.push({ path: item.out.path, bytes: utf8ByteLength(content) });
		const archiveName = archiveNames.get(item.out);
		if (archiveName !== undefined) {
			checkCancelled(signal, snapshot);
			try {
				prepared.set(item.out, prepareZipEntry({ name: archiveName, data: encoder.encode(content) }, zipModifiedAt));
			} catch (error: unknown) {
				if (error instanceof ExportCancelledError) throw error;
				throw failure(zipPath, error);
			}
		}
		content = ''; // Do not retain a large string across the UI yield/next render.
		if ((i + 1) % every === 0 || i + 1 === plainOutputs.length) await yieldToUi();
		checkCancelled(signal, snapshot);
	}

	// The gateway requires a complete archive: compression is incremental in
	// memory, not disk streaming. Only compressed records survive each entry.
	if (zipRequested) {
		checkCancelled(signal, snapshot);
		onProgress({ stage: 'ZIP bundle', current: 0, total: 1, log: 'Building archive (all formats + split)...' });
		await yieldToUi();
		let archive: Uint8Array;
		try {
			archive = buildPreparedZip(zipRecords(archiveOutputs, prepared, zipModifiedAt));
		} catch (error: unknown) {
			if (error instanceof ExportCancelledError || written.length === 0) throw error;
			throw failure(zipPath, error);
		}
		checkCancelled(signal, snapshot);
		onProgress({ stage: 'ZIP bundle', current: 1, total: 1, currentFile: zipPath, log: 'Writing ' + zipPath });
		await writeOutput(zipPath, () => gateway.writeBinary(zipPath, archive));
		written.push({ path: zipPath, bytes: archive.length });
		await yieldToUi();
		checkCancelled(signal, snapshot);
	}

	const result = snapshot();
	onProgress({ stage: 'Completed', current: 1, total: 1, log: 'Export finished: ' + written.length + ' files.' });
	return result;
}
