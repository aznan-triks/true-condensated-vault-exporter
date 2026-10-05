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
import { OutputFile, buildSplitFiles } from './exportSplit';
import { buildZip, zipEntryName, ZipEntry } from '../core/zip';
import { canonicalOutputPath, externalFolderBase, resolveOutputSettings, usesExternalOutputFolder } from '../core/outputTarget';

export type ExportTarget = RememberedExportTarget;

export class ExportCancelledError extends Error {
	constructor(readonly partialResult?: ExportResult) {
		super('Export cancelled.');
		this.name = 'ExportCancelledError';
	}
}

export interface ExportResult {
	written: { path: string; bytes: number }[];
	/** Notes skipped because their content could not be read */
	skippedFiles: string[];
	totalBytes: number;
	durationMs: number;
}

function checkCancelled(signal?: AbortSignal, partialResult?: ExportResult): void {
	if (signal?.aborted) {
		throw new ExportCancelledError(partialResult);
	}
}

/** Lets Obsidian repaint and process clicks (e.g. Cancel) during long loops. */
function yieldToUi(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

const textEncoder = new TextEncoder();
export function utf8ByteLength(text: string): number {
	return textEncoder.encode(text).length;
}

function consolidatedOutputs(
	notes: CleanedNote[],
	settings: ExporterSettings,
	exportedAt: string,
	requested: Set<ConsolidatedFormatId>
): Map<ConsolidatedFormatId, OutputFile> {
	const map = new Map<ConsolidatedFormatId, OutputFile>();
	for (const [id, format] of Object.entries(CONSOLIDATED_FORMATS) as [ConsolidatedFormatId, (typeof CONSOLIDATED_FORMATS)[ConsolidatedFormatId]][]) {
		if (requested.has(id)) {
			map.set(id, { path: format.outputPath(settings), content: format.render(notes, settings, exportedAt) });
		}
	}
	return map;
}

interface LabeledOutput {
	out: OutputFile;
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

/** Selects the individual files to write for the requested targets (no zip). */
function selectOutputs(
	targets: ExportTarget[],
	consolidated: Map<ConsolidatedFormatId, OutputFile>,
	split: OutputFile[]
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
	const deduped: LabeledOutput[] = [];
	for (const item of selected) {
		validateOutputPath(item.out.path, item.stage);
		const key = canonicalOutputPath(item.out.path);
		const previous = seen.get(key);
		if (previous) {
			if (previous.out.content === item.out.content) continue;
			throw new Error('Output path conflict: ' + previous.out.path + ' is used by more than one export.');
		}
		for (const [otherPath, other] of seen) {
			if (pathsOverlap(otherPath, key)) {
				throw new Error('Output paths overlap: ' + other.out.path + ' and ' + item.out.path + '.');
			}
		}
		seen.set(key, item);
		deduped.push(item);
	}
	return deduped;
}

/** Builds the zip entry list: every consolidated format + split files. */
function zipEntries(
	consolidated: Map<ConsolidatedFormatId, OutputFile>,
	split: OutputFile[],
	externalBase: string
): ZipEntry[] {
	const encoder = new TextEncoder();
	const all = [...consolidated.values(), ...split];
	const seen = new Map<string, string>();
	const entries: ZipEntry[] = [];
	for (const out of all) {
		const name = zipEntryName(out.path, externalBase);
		const previous = seen.get(name);
		if (previous !== undefined) {
			if (previous !== out.content) throw new Error('ZIP entry name conflict: ' + name + '.');
			continue;
		}
		seen.set(name, out.content);
		entries.push({ name, data: encoder.encode(out.content) });
	}
	return entries;
}

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
	const settings = resolveOutputSettings(rawSettings);
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
	checkCancelled(signal, snapshot());
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
		checkCancelled(signal, snapshot());
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
	checkCancelled(signal, snapshot());
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
	const consolidated = consolidatedOutputs(notes, settings, exportedAt, requestedFormats);
	const splitRequested = zipRequested || uniqueTargets.some((target) => target === 'all' || target === 'split');
	const split = splitRequested ? buildSplitFiles(notes, settings) : [];
	const externalBase = usesExternalOutputFolder(settings) ? externalFolderBase(settings.externalOutputFolder) : '';
	const plainTargets = uniqueTargets.filter((target) => target !== 'zip');
	const plainOutputs = selectOutputs(plainTargets, consolidated, split);
	const zipPath = zipRequested ? validateOutputPath(settings.zipOutputPath, 'ZIP bundle') : '';

	if (zipRequested) {
		for (const item of plainOutputs) {
			if (pathsOverlap(zipPath, item.out.path)) {
				throw new Error('ZIP bundle path overlaps another selected output: ' + item.out.path + '.');
			}
		}
	}

	checkCancelled(signal, snapshot());
	let zipData: Uint8Array | null = null;
	if (zipRequested) {
		onProgress({ stage: 'ZIP bundle', current: 0, total: 1, log: 'Building archive (all formats + split)...' });
		await yieldToUi();
		zipData = buildZip(zipEntries(consolidated, split, externalBase));
	}

	if (zipRequested && zipData) {
		checkCancelled(signal, snapshot());
		onProgress({ stage: 'ZIP bundle', current: 1, total: 1, currentFile: zipPath, log: 'Writing ' + zipPath });
		await gateway.writeBinary(zipPath, zipData);
		written.push({ path: zipPath, bytes: zipData.length });
		await yieldToUi();
		checkCancelled(signal, snapshot());
	}

	for (const [i, item] of plainOutputs.entries()) {
		checkCancelled(signal, snapshot());
		onProgress({
			stage: item.stage,
			current: i + 1,
			total: plainOutputs.length,
			currentFile: item.out.path,
			log: 'Writing ' + item.out.path,
		});
		await gateway.writeFile(item.out.path, item.out.content);
		written.push({ path: item.out.path, bytes: utf8ByteLength(item.out.content) });
		await yieldToUi();
		checkCancelled(signal, snapshot());
	}

	const result = snapshot();
	onProgress({ stage: 'Completed', current: 1, total: 1, log: 'Export finished: ' + written.length + ' files.' });
	return result;
}
