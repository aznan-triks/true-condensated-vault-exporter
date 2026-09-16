/**
 * Export Consolidated Markdown engine.
 */

import { ExporterSettings, ProgressCallback, VaultFile } from '../core/types';
import { formatForMarkdown } from '../core/markdownFormatter';
import { ObsidianVaultGateway } from '../obsidian/vaultGateway';

export async function runMarkdownExport(
	gateway: ObsidianVaultGateway,
	settings: ExporterSettings,
	files: VaultFile[],
	onProgress: ProgressCallback
): Promise<string> {
	onProgress({
		stage: 'Markdown',
		current: 0,
		total: files.length,
		log: 'Formatting ' + files.length + ' documents as consolidated Markdown...',
	});

	const formatted = formatForMarkdown(files, settings);

	onProgress({
		stage: 'Markdown',
		current: files.length,
		total: files.length,
		log: 'Writing consolidated Markdown to ' + settings.markdownOutputPath + '...',
	});

	await gateway.writeFile(settings.markdownOutputPath, formatted);

	return settings.markdownOutputPath;
}
