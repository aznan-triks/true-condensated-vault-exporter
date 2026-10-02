/**
 * Master export orchestrator: load once, clean once, render each requested target.
 * Cancellable through an AbortSignal checked between every note and every written file.
 */

import { ExportGateway, ExporterSettings, ProgressCallback } from '../core/types';
import { CleanedNote, cleanNote } from '../core/pipeline';
import { CONSOLIDATED_FORMATS, ConsolidatedFormatId } from './formats';
import { buildSplitFiles } from './exportSplit';

export type ExportTarget = 'all' | ConsolidatedFormatId | 'split';

export class ExportCancelledError extends Error {
	constructor() {
		super('Export cancelled.');
		this.name = 'ExportCancelledError';
	}
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

export async function runExports(
	gateway: ExportGateway,
	settings: ExporterSettings,
	target: ExportTarget,
	onProgress: ProgressCallback,
	signal?: AbortSignal
): Promise<void> {
	onProgress({ stage: 'Scanning vault', current: 0, total: 1, log: 'Indexing vault notes...' });
	const files = await gateway.loadVaultFiles(settings);
	if (files.length === 0) {
		throw new Error('No files matched the inclusion criteria.');
	}

	const notes: CleanedNote[] = [];
	const every = Math.max(1, settings.yieldEvery);
	for (const [i, file] of files.entries()) {
		checkCancelled(signal);
		notes.push(cleanNote(file, files, settings));
		if ((i + 1) % every === 0) {
			onProgress({ stage: 'Cleaning notes', current: i + 1, total: files.length, currentFile: file.path, log: 'Cleaned ' + (i + 1) + ' notes' });
			await yieldToUi();
		}
	}
	onProgress({ stage: 'Cleaning notes', current: files.length, total: files.length, log: 'Cleaned ' + files.length + ' notes.' });

	const exportedAt = new Date().toISOString();
	const formatIds = (Object.keys(CONSOLIDATED_FORMATS) as ConsolidatedFormatId[])
		.filter((id) => target === 'all' || target === id);

	for (const [i, id] of formatIds.entries()) {
		checkCancelled(signal);
		const format = CONSOLIDATED_FORMATS[id];
		const outPath = format.outputPath(settings);
		onProgress({ stage: format.label, current: i, total: formatIds.length, log: 'Writing ' + outPath });
		await gateway.writeFile(outPath, format.render(notes, settings, exportedAt));
		await yieldToUi();
	}

	if (target === 'all' || target === 'split') {
		const outputs = buildSplitFiles(notes, settings);
		for (const [i, out] of outputs.entries()) {
			checkCancelled(signal);
			onProgress({ stage: 'Split', current: i + 1, total: outputs.length, currentFile: out.path, log: 'Writing ' + out.path });
			await gateway.writeFile(out.path, out.content);
		}
	}

	onProgress({ stage: 'Completed', current: 1, total: 1, log: 'Export finished.' });
}
