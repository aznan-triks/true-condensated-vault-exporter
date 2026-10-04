/**
 * Command registry for Vault Exporter.
 * Single source of truth powering Command Palette and UI.
 */

import { App, Notice } from 'obsidian';
import { ExporterSettings } from '../core/types';
import { ObsidianVaultGateway } from '../obsidian/vaultGateway';
import { runExports, ExportTarget, ExportCancelledError, ExportResult } from '../features/exportOrchestrator';
import { ExportHistoryEntry, pushHistory, formatBytes } from '../features/exportHistory';
import { ProgressPanel } from '../ui/ProgressPanel';

export interface CommandContext {
	app: App;
	settings: ExporterSettings;
	gateway: ObsidianVaultGateway;
}

/** Superset of CommandContext used by the sidebar/history UI. */
export interface UiContext extends CommandContext {
	history: ExportHistoryEntry[];
	onHistoryChange: (history: ExportHistoryEntry[]) => void;
	openSettings: () => void;
}

export interface ExporterCommand {
	id: string;
	name: string;
	icon: string;
	target: ExportTarget;
}

export const EXPORT_COMMANDS: ExporterCommand[] = [
	{ id: 'export-all', name: 'Run all non-ZIP exports', icon: 'play', target: 'all' },
	{ id: 'export-notebooklm', name: 'Export for NotebookLM (consolidated text)', icon: 'file-text', target: 'notebooklm' },
	{ id: 'export-markdown', name: 'Export as consolidated Markdown', icon: 'file-code', target: 'markdown' },
	{ id: 'export-html', name: 'Export as HTML document', icon: 'globe', target: 'html' },
	{ id: 'export-split', name: 'Export split files', icon: 'folder-output', target: 'split' },
	{ id: 'export-zip', name: 'Export everything as ZIP bundle', icon: 'package', target: 'zip' },
];

export const TARGET_LABELS: Record<ExportTarget, string> = {
	all: 'All non-ZIP exports',
	notebooklm: 'NotebookLM',
	html: 'HTML',
	markdown: 'Markdown',
	split: 'Split',
	zip: 'ZIP bundle',
};

let running: AbortController | null = null;

export function isExportRunning(): boolean {
	return running !== null;
}

export function cancelRunningExport(): boolean {
	if (!running) {
		return false;
	}
	running.abort();
	return true;
}

function describeTargets(targets: ExportTarget[]): string {
	if (targets.length === 1) {
		return TARGET_LABELS[targets[0]!];
	}
	return targets.map((t) => TARGET_LABELS[t]).join(' + ');
}

export interface ExecuteOptions {
	/** In-memory settings overrides for this run only (never persisted). */
	settingsOverride?: Partial<ExporterSettings>;
	/** Overrides the panel/history label. */
	label?: string;
}

/** Runs one or more export targets with progress panel, history and cancel support. */
export async function executeTargets(ctx: UiContext, targets: ExportTarget[], options?: ExecuteOptions): Promise<void> {
	if (running) {
		new Notice('An export is already running.');
		return;
	}
	const label = options?.label ?? describeTargets(targets);
	// Context commands may narrow the run (scope folder, single note, custom
	// output path) without touching the persisted settings.
	const effectiveSettings: ExporterSettings = options?.settingsOverride
		? { ...ctx.settings, ...options.settingsOverride }
		: ctx.settings;
	const controller = new AbortController();
	running = controller;
	const startedAt = Date.now();

	const panel = new ProgressPanel({
		title: label,
		autoCloseMs: 8000,
		onCancel: () => controller.abort(),
	});

	let outcome: 'success' | 'cancelled' | 'error' = 'error';
	let result: ExportResult | null = null;

	try {
		panel.log('Starting: ' + label);
		result = await runExports(ctx.gateway, effectiveSettings, targets, (progress) => {
			panel.update(progress.current, progress.total, progress.stage, progress.currentFile);
			panel.log(progress.log);
		}, controller.signal);

		outcome = 'success';
		panel.finish('success', 'Export completed successfully.', {
			fileCount: result.written.length,
			bytes: result.totalBytes,
			skipped: result.skippedFiles.length,
			onReveal: result.written.length > 0
				? () => ctx.gateway.revealInFileManager(result!.written[0]!.path)
				: undefined,
		});
		const summary = result.written.length + ' files · ' + formatBytes(result.totalBytes)
			+ (result.skippedFiles.length > 0 ? ' · ' + result.skippedFiles.length + ' skipped' : '');
		new Notice('✓ ' + label + ' finished (' + summary + ').');
	} catch (err: unknown) {
		if (err instanceof ExportCancelledError) {
			outcome = 'cancelled';
			result = err.partialResult ?? null;
			panel.log('Export cancelled by user.');
			panel.finish('cancelled', 'Export cancelled. Files already written were kept.', result ? {
				fileCount: result.written.length,
				bytes: result.totalBytes,
				skipped: result.skippedFiles.length,
			} : undefined);
			new Notice('Export cancelled.');
		} else {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('[vault-exporter]', err);
			panel.log(msg, true);
			panel.finish('error', 'Export failed: ' + msg);
			new Notice('✕ Export failed: ' + msg, 6000);
		}
	} finally {
		running = null;
	}

	const entry: ExportHistoryEntry = {
		id: String(startedAt),
		label,
		startedAt,
		durationMs: Date.now() - startedAt,
		outcome,
		files: result?.written ?? [],
	};
	ctx.onHistoryChange(pushHistory(ctx.history, entry));
}

export async function executeExportCommand(ctx: UiContext, cmd: ExporterCommand): Promise<void> {
	await executeTargets(ctx, [cmd.target]);
}
