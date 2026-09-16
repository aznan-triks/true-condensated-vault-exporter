/**
 * Main plugin entrypoint for Vault Exporter.
 */

import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, ExporterSettings } from './core/types';
import { ObsidianVaultGateway } from './obsidian/vaultGateway';
import { EXPORT_COMMANDS, executeExportCommand, CommandContext } from './commands/registry';
import { ExporterSidebarView, VIEW_TYPE_EXPORTER_SIDEBAR } from './ui/SidebarView';
import { VaultExporterSettingsTab } from './settings/SettingsTab';

export default class VaultExporterPlugin extends Plugin {
	override settings: ExporterSettings = { ...DEFAULT_SETTINGS };
	gateway!: ObsidianVaultGateway;

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.gateway = new ObsidianVaultGateway(this.app);

		// Settings Tab
		this.addSettingTab(new VaultExporterSettingsTab(this.app, this));

		// Sidebar View
		this.registerView(
			VIEW_TYPE_EXPORTER_SIDEBAR,
			(leaf: WorkspaceLeaf) => new ExporterSidebarView(leaf, () => this.getCommandContext())
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
					await executeExportCommand(this.getCommandContext(), cmd);
				},
			});
		}
	}

	override onunload(): void {}

	async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	getCommandContext(): CommandContext {
		return {
			app: this.app,
			settings: this.settings,
			gateway: this.gateway,
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