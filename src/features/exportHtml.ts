/**
 * Export HTML engine.
 */

import { ExporterSettings, ProgressCallback, VaultFile } from '../core/types';
import { formatForHtml } from '../core/htmlFormatter';
import { ObsidianVaultGateway } from '../obsidian/vaultGateway';

export async function runHtmlExport(
	gateway: ObsidianVaultGateway,
	settings: ExporterSettings,
	files: VaultFile[],
	onProgress: ProgressCallback
): Promise<string> {
	onProgress({
		stage: 'HTML',
		current: 0,
		total: files.length,
		log: 'Building HTML compilation for ' + files.length + ' documents...',
	});

	const html = formatForHtml(files, settings);

	onProgress({
		stage: 'HTML',
		current: files.length,
		total: files.length,
		log: 'Writing HTML file to ' + settings.htmlOutputPath + '...',
	});

	await gateway.writeFile(settings.htmlOutputPath, html);

	return settings.htmlOutputPath;
}