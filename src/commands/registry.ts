/**
 * Command registry for Vault Exporter.
 * Single source of truth powering Command Palette and UI.
 */

import { App, Notice } from 'obsidian';
import { ExporterSettings } from '../core/types';
import { ObsidianVaultGateway } from '../obsidian/vaultGateway';
import { runExports, ExportTarget, ExportCancelledError } from '../features/exportOrchestrator';
import { ProgressPanel } from '../ui/ProgressPanel';

export interface CommandContext {
	app: App;
	settings: ExporterSettings;
	gateway: ObsidianVaultGateway;
}

export interface ExporterCommand {
	id: string;
	name: string;
	icon: string;
	target: ExportTarget;
}

export const EXPORT_COMMANDS: ExporterCommand[] = [
	{ id: 'export-all', name: 'Run all exports', icon: 'play', target: 'all' },
	{ id: 'export-notebooklm', name: 'Export for NotebookLM (consolidated text)', icon: 'file-text', target: 'notebooklm' },
	{ id: 'export-markdown', name: 'Export as consolidated Markdown', icon: 'file-code', target: 'markdown' },
	{ id: 'export-html', name: 'Export as HTML document', icon: 'globe', target: 'html' },
	{ id: 'export-split', name: 'Export split files', icon: 'folder-output', target: 'split' },
];

let running: AbortController | null = null;

export function cancelRunningExport(): boolean {
	if (!running) {
		return false;
	}
	running.abort();
	return true;
}

export async function executeExportCommand(ctx: CommandContext, cmd: ExporterCommand): Promise<void> {
	if (running) {
		new Notice('An export is already running.');
		return;
	}
	const controller = new AbortController();
	running = controller;

	const panel = new ProgressPanel({
		title: cmd.name,
		autoCloseMs: 8000,
		onCancel: () => controller.abort(),
	});

	try {
		panel.log('Starting: ' + cmd.name);
		await runExports(ctx.gateway, ctx.settings, cmd.target, (progress) => {
			panel.update(progress.current, progress.total, progress.stage);
			panel.log(progress.log);
		}, controller.signal);

		panel.finish('success', 'Export completed successfully.');
		new Notice('✓ ' + cmd.name + ' finished.');
	} catch (err: unknown) {
		if (err instanceof ExportCancelledError) {
			panel.log('Export cancelled by user.');
			panel.finish('cancelled', 'Export cancelled. Files already written were kept.');
			new Notice('Export cancelled.');
			return;
		}
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[vault-exporter]', err);
		panel.log(msg, true);
		panel.finish('error', 'Export failed: ' + msg);
		new Notice('✕ Export failed: ' + msg, 6000);
	} finally {
		running = null;
	}
}
