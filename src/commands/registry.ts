/**
 * Command registry for Vault Exporter.
 * Single source of truth powering Command Palette and UI.
 */

import { App, Notice } from 'obsidian';
import { ExporterSettings } from '../core/types';
import { ObsidianVaultGateway } from '../obsidian/vaultGateway';
import { runExports, ExportTarget } from '../features/exportOrchestrator';
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
	{
		id: 'export-all',
		name: 'Run All Exports (NotebookLM, HTML, Markdown, Split)',
		icon: 'play',
		target: 'all',
	},
	{
		id: 'export-notebooklm',
		name: 'Export for NotebookLM (Consolidated text)',
		icon: 'file-text',
		target: 'notebooklm',
	},
	{
		id: 'export-markdown',
		name: 'Export as Consolidated Markdown (.md)',
		icon: 'file-code',
		target: 'markdown',
	},
	{
		id: 'export-html',
		name: 'Export as HTML Document',
		icon: 'globe',
		target: 'html',
	},
	{
		id: 'export-split',
		name: 'Export Split Files',
		icon: 'folder-output',
		target: 'split',
	},
];

export async function executeExportCommand(
	ctx: CommandContext,
	cmd: ExporterCommand
): Promise<void> {
	const panel = new ProgressPanel({
		title: cmd.name,
		autoCloseMs: 8000,
	});

	try {
		panel.log('Starting: ' + cmd.name);
		await runExports(ctx.gateway, ctx.settings, cmd.target, (progress) => {
			panel.update(progress.current, progress.total, progress.stage);
			panel.log(progress.log);
		});

		panel.finish(true, 'Export completed successfully.');
		new Notice('\u2713 ' + cmd.name + ' finished.');
	} catch (err: any) {
		const msg = err?.message || String(err);
		panel.log(msg, true);
		panel.finish(false, 'Export failed: ' + msg);
		new Notice('\u2715 Export failed: ' + msg, 6000);
	}
}