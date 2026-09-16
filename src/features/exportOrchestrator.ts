/**
 * Master export orchestrator.
 */

import { ExporterSettings, ProgressCallback } from '../core/types';
import { ObsidianVaultGateway } from '../obsidian/vaultGateway';
import { runNotebookLMExport } from './exportNotebookLM';
import { runHtmlExport } from './exportHtml';
import { runMarkdownExport } from './exportMarkdown';
import { runSplitFilesExport } from './exportSplit';
import { executePythonScript } from './pythonRunner';

export type ExportTarget = 'all' | 'notebooklm' | 'html' | 'markdown' | 'split';

export async function runExports(
	gateway: ObsidianVaultGateway,
	settings: ExporterSettings,
	target: ExportTarget,
	onProgress: ProgressCallback
): Promise<void> {
	if (settings.executionEngine === 'external-python') {
		const vaultRoot = gateway.getBasePath();
		if (!vaultRoot) {
			throw new Error('Vault root path not accessible for external python runner.');
		}

		if (target === 'all' || target === 'notebooklm') {
			onProgress({
				stage: 'Python: NotebookLM',
				current: 1,
				total: 2,
				log: 'Launching ' + settings.pythonNotebooklmScript + '...',
			});
			const res = await executePythonScript(settings.pythonNotebooklmScript, vaultRoot, (l) => {
				onProgress({ stage: 'Python: NotebookLM', current: 1, total: 2, log: l });
			});
			if (!res.success) {
				throw new Error('Python NotebookLM script failed:\n' + res.output);
			}
		}

		if (target === 'all' || target === 'html' || target === 'split') {
			onProgress({
				stage: 'Python: HTML/Trello',
				current: 2,
				total: 2,
				log: 'Launching ' + settings.pythonTrelloScript + '...',
			});
			const res = await executePythonScript(settings.pythonTrelloScript, vaultRoot, (l) => {
				onProgress({ stage: 'Python: HTML/Trello', current: 2, total: 2, log: l });
			});
			if (!res.success) {
				throw new Error('Python HTML/Trello script failed:\n' + res.output);
			}
		}

		onProgress({
			stage: 'Finished',
			current: 2,
			total: 2,
			log: 'All Python exports completed successfully.',
		});
		return;
	}

	// Native TypeScript Engine
	onProgress({
		stage: 'Scanning Vault',
		current: 0,
		total: 100,
		log: 'Indexing vault notes and evaluating filters...',
	});

	const files = await gateway.loadVaultFiles(settings);

	if (files.length === 0) {
		throw new Error('No files matched the inclusion criteria.');
	}

	onProgress({
		stage: 'Vault Indexed',
		current: files.length,
		total: files.length,
		log: 'Found ' + files.length + ' matching documents in scope.',
	});

	if (target === 'all' || target === 'notebooklm') {
		await runNotebookLMExport(gateway, settings, files, onProgress);
	}

	if (target === 'all' || target === 'html') {
		await runHtmlExport(gateway, settings, files, onProgress);
	}

	if (target === 'all' || target === 'markdown') {
		await runMarkdownExport(gateway, settings, files, onProgress);
	}

	if (target === 'all' || target === 'split') {
		await runSplitFilesExport(settings, files, onProgress);
	}

	onProgress({
		stage: 'Completed',
		current: files.length,
		total: files.length,
		log: 'Export workflow finished successfully.',
	});
}