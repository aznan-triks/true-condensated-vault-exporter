/**
 * Main plugin entrypoint for Vault Exporter.
 */

import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { ExporterSettings, mergeSettings } from './core/types';
import { ObsidianVaultGateway } from './obsidian/vaultGateway';
import {
	EXPORT_COMMANDS,
	executeExportCommand,
	executeTargets,
	cancelRunningExport,
	UiContext,
} from './commands/registry';
import { ExportHistoryEntry, sanitizeHistory } from './features/exportHistory';
import { openSettingsTab } from './obsidian/appSetting';
import { ExporterSidebarView, VIEW_TYPE_EXPORTER_SIDEBAR } from './ui/SidebarView';
import { VaultExporterSettingsTab } from './settings/SettingsTab';

/** Persisted plugin data: settings + recent export history (legacy data = settings only). */
interface PluginData {
	settings: ExporterSettings;
	history: ExportHistoryEntry[];
}

export default class VaultExporterPlugin extends Plugin {
	// Not declared in the Obsidian typings for the minimum supported app
	// version (1.7.2), so it must not use the `override` modifier.
	settings: ExporterSettings = mergeSettings(undefined);
	history: ExportHistoryEntry[] = [];
	gateway!: ObsidianVaultGateway;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.gateway = new ObsidianVaultGateway(this.app);

		// Settings Tab
		this.addSettingTab(new VaultExporterSettingsTab(this.app, this));

		// Sidebar View
		this.registerView(
			VIEW_TYPE_EXPORTER_SIDEBAR,
			(leaf: WorkspaceLeaf) => new ExporterSidebarView(leaf, this.manifest.id, () => this.getUiContext())
		);

		// Ribbon Icon
		this.addRibbonIcon('file-up', 'Vault Exporter', () => {
			this.activateSidebarView();
		});

		// Commands Palette
		for (const cmd of EXPORT_COMMANDS) {
			this.addCommand({
				id: cmd.id,
				name: cmd.name,
				icon: cmd.icon,
				callback: async () => {
					await executeExportCommand(this.getUiContext(), cmd);
				},
			});
		}

		this.addCommand({
			id: 'export-active-folder',
			name: 'Export current note\'s folder (all non-ZIP formats)',
			icon: 'folder',
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice('Open a note first.');
					return;
				}
				const folder = file.parent?.path ?? '';
				await executeTargets(this.getUiContext(), ['all'], {
					settingsOverride: { scopeRoot: folder, scopeTag: '' },
					label: 'Export folder: ' + (folder || '(root)'),
				});
			},
		});

		this.addCommand({
			id: 'export-active-note',
			name: 'Export current note as clean Markdown',
			icon: 'file-plus',
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !file.path.toLowerCase().endsWith('.md')) {
					new Notice('Open a markdown note first.');
					return;
				}
				const dir = file.parent?.path ?? '';
				const outPath = (dir ? dir + '/' : '') + file.name.replace(/\.md$/i, '') + ' (clean export).md';
				await executeTargets(this.getUiContext(), ['markdown'], {
					settingsOverride: {
						scopeRoot: '',
						scopeTag: '',
						onlyFile: file.path,
						markdownOutputPath: outPath,
					},
					label: 'Clean export: ' + file.name,
				});
			},
		});

		this.addCommand({
			id: 'cancel-export',
			name: 'Cancel running export',
			icon: 'square',
			callback: () => {
				if (!cancelRunningExport()) {
					new Notice('No export is running.');
				}
			},
		});
	}

	override onunload(): void {
		cancelRunningExport();
	}

	async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		// New format: { settings, history }. Legacy format: the settings object itself.
		let settingsRaw: unknown = loaded;
		let historyRaw: unknown = undefined;
		if (loaded && typeof loaded === 'object' && !Array.isArray(loaded) && 'settings' in (loaded as Record<string, unknown>)) {
			const wrapped = loaded as Partial<PluginData>;
			settingsRaw = wrapped.settings;
			historyRaw = wrapped.history;
		}
		this.settings = mergeSettings(settingsRaw);
		this.history = sanitizeHistory(historyRaw);
	}

	private async persistSettingsData(): Promise<void> {
		const data: PluginData = { settings: this.settings, history: this.history };
		await this.saveData(data);
	}

	async saveSettings(): Promise<void> {
		await this.persistSettingsData();
		// Keep the sidebar's scope preview in sync
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_EXPORTER_SIDEBAR)) {
			const view = leaf.view as ExporterSidebarView | null;
			if (view) {
				void view.refresh();
			}
		}
	}

	setHistory(history: ExportHistoryEntry[]): void {
		this.history = history;
		void this.saveData({ settings: this.settings, history: this.history } as PluginData).catch((error: unknown) => {
			console.error('[vault-exporter] Could not save export history:', error);
		});
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_EXPORTER_SIDEBAR)) {
			const view = leaf.view as ExporterSidebarView | null;
			view?.render();
		}
	}

	getUiContext(): UiContext {
		return {
			app: this.app,
			settings: this.settings,
			gateway: this.gateway,
			history: this.history,
			onHistoryChange: (h) => this.setHistory(h),
			persistSettings: () => this.persistSettingsData(),
			openSettings: () => openSettingsTab(this.app, this.manifest.id),
		};
	}

	async activateSidebarView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EXPORTER_SIDEBAR);
		if (leaves.length > 0) {
			const leaf = leaves[0];
			if (leaf) {
				this.app.workspace.revealLeaf(leaf);
			}
			return;
		}

		const rightLeaf = this.app.workspace.getRightLeaf(false);
		if (rightLeaf) {
			await rightLeaf.setViewState({
				type: VIEW_TYPE_EXPORTER_SIDEBAR,
				active: true,
			});
			this.app.workspace.revealLeaf(rightLeaf);
		}
	}
}
