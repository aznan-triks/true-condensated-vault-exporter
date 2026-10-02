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

import { ExportGateway, ExporterSettings, ProgressCallback, VaultFile } from '../core/types';
import { CleanedNote, cleanNote, createExportContext } from '../core/pipeline';
import { CONSOLIDATED_FORMATS, ConsolidatedFormatId } from './formats';
import { OutputFile, buildSplitFiles } from './exportSplit';
import { buildZip, zipEntryName, ZipEntry } from '../core/zip';

export type ExportTarget = 'all' | ConsolidatedFormatId | 'split' | 'zip';

export class ExportCancelledError extends Error {
	constructor() {
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

function checkCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new ExportCancelledError();
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
	exportedAt: string
): Map<ConsolidatedFormatId, OutputFile> {
	const map = new Map<ConsolidatedFormatId, OutputFile>();
	for (const [id, format] of Object.entries(CONSOLIDATED_FORMATS) as [ConsolidatedFormatId, (typeof CONSOLIDATED_FORMATS)[ConsolidatedFormatId]][]) {
		map.set(id, { path: format.outputPath(settings), content: format.render(notes, settings, exportedAt) });
	}
	return map;
}

interface LabeledOutput {
	out: OutputFile;
	stage: string;
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
	// Dedupe by path (first label wins)
	const seen = new Set<string>();
	return selected.filter((item) => {
		if (seen.has(item.out.path)) return false;
		seen.add(item.out.path);
		return true;
	});
}

/** Builds the zip entry list: every consolidated format + split files. */
function zipEntries(
	consolidated: Map<ConsolidatedFormatId, OutputFile>,
	split: OutputFile[]
): ZipEntry[] {
	const encoder = new TextEncoder();
	const all = [...consolidated.values(), ...split];
	const seen = new Set<string>();
	const entries: ZipEntry[] = [];
	for (const out of all) {
		const name = zipEntryName(out.path);
		if (seen.has(name)) continue;
		seen.add(name);
		entries.push({ name, data: encoder.encode(out.content) });
	}
	return entries;
}

export async function runExports(
	gateway: ExportGateway,
	settings: ExporterSettings,
	targets: ExportTarget[],
	onProgress: ProgressCallback,
	signal?: AbortSignal,
	loadedFiles?: VaultFile[]
): Promise<ExportResult> {
	const startedAt = Date.now();
	onProgress({ stage: 'Scanning vault', current: 0, total: 1, log: 'Indexing vault notes...' });
	const files = loadedFiles ?? (await gateway.loadVaultFiles(settings));
	if (files.length === 0) {
		throw new Error('No files matched the inclusion criteria.');
	}

	const ctx = createExportContext(files, settings);

	const notes: CleanedNote[] = [];
	const skippedFiles: string[] = [];
	const every = Math.max(1, settings.yieldEvery);
	for (const [i, file] of files.entries()) {
		checkCancelled(signal);
		try {
			notes.push(cleanNote(file, ctx));
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			skippedFiles.push(file.path);
			console.warn('[vault-exporter] Skipped ' + file.path + ' : ' + msg);
		}
		if ((i + 1) % every === 0) {
			onProgress({ stage: 'Cleaning notes', current: i + 1, total: files.length, currentFile: file.path, log: 'Cleaned ' + (i + 1) + ' notes' });
			await yieldToUi();
		}
	}
	if (notes.length === 0) {
		throw new Error('No note could be read (all ' + files.length + ' files failed to load).');
	}
	onProgress({ stage: 'Cleaning notes', current: files.length, total: files.length, log: 'Cleaned ' + notes.length + ' notes.' });

	const exportedAt = new Date().toISOString();
	const consolidated = consolidatedOutputs(notes, settings, exportedAt);
	const split = buildSplitFiles(notes, settings);

	const written: { path: string; bytes: number }[] = [];

	if (targets.includes('zip')) {
		checkCancelled(signal);
		onProgress({ stage: 'ZIP bundle', current: 0, total: 1, log: 'Building archive (all formats + split)...' });
		await yieldToUi();
		const entries = zipEntries(consolidated, split);
		const zipData = buildZip(entries);
		const zipPath = settings.zipOutputPath;
		onProgress({ stage: 'ZIP bundle', current: 1, total: 1, currentFile: zipPath, log: 'Writing ' + zipPath });
		await gateway.writeBinary(zipPath, zipData);
		written.push({ path: zipPath, bytes: zipData.length });
	}

	const plainTargets = targets.filter((t) => t !== 'zip');
	const plainOutputs = selectOutputs(plainTargets, consolidated, split);
	for (const [i, item] of plainOutputs.entries()) {
		checkCancelled(signal);
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
	}

	const result: ExportResult = {
		written,
		skippedFiles,
		totalBytes: written.reduce((sum, w) => sum + w.bytes, 0),
		durationMs: Date.now() - startedAt,
	};
	onProgress({ stage: 'Completed', current: 1, total: 1, log: 'Export finished: ' + written.length + ' files.' });
	return result;
}
