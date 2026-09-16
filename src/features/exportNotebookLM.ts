/**
 * Export NotebookLM engine.
 */

import { ExporterSettings, ProgressCallback, VaultFile } from '../core/types';
import { formatForNotebookLM } from '../core/notebooklmFormatter';
import { ObsidianVaultGateway } from '../obsidian/vaultGateway';

export async function runNotebookLMExport(
	gateway: ObsidianVaultGateway,
	settings: ExporterSettings,
	files: VaultFile[],
	onProgress: ProgressCallback
): Promise<string> {
	onProgress({
		stage: 'NotebookLM',
		current: 0,
		total: files.length,
		log: 'Formatting ' + files.length + ' documents for NotebookLM...',
	});

	const formatted = formatForNotebookLM(files, settings);

	onProgress({
		stage: 'NotebookLM',
		current: files.length,
		total: files.length,
		log: 'Writing consolidated file to ' + settings.notebooklmOutputPath + '...',
	});

	await gateway.writeFile(settings.notebooklmOutputPath, formatted);

	return settings.notebooklmOutputPath;
}