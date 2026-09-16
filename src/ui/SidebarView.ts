/**
 * Dedicated Sidebar View for Vault Exporter.
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { CommandContext, EXPORT_COMMANDS, executeExportCommand } from '../commands/registry';

export const VIEW_TYPE_EXPORTER_SIDEBAR = 'vault-exporter-sidebar';

export class ExporterSidebarView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly getContext: () => CommandContext
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_EXPORTER_SIDEBAR;
	}

	override getDisplayText(): string {
		return 'Vault Exporter';
	}

	override getIcon(): string {
		return 'file-up';
	}

	override async onOpen(): Promise<void> {
		this.render();
	}

	render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('ve-sidebar');

		const header = container.createDiv({ cls: 've-sidebar__header' });
		header.createEl('h4', { text: 'Vault Exporter Actions' });

		const buttonGroup = container.createDiv({ cls: 've-sidebar__actions' });

		for (const cmd of EXPORT_COMMANDS) {
			const btn = buttonGroup.createEl('button', {
				cls: 'mod-cta ve-sidebar__btn',
				text: cmd.name,
			});
			btn.addEventListener('click', async () => {
				const ctx = this.getContext();
				await executeExportCommand(ctx, cmd);
			});
		}
	}
}