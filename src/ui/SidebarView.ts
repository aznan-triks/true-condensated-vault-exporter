/**
 * Dedicated Sidebar View for Vault Exporter.
 * Live scope stats, multi-target export selection, run history and
 * quick access to settings.
 */

import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import { EXPORT_COMMANDS, TARGET_LABELS, UiContext, executeTargets, isExportRunning } from '../commands/registry';
import { ExportTarget } from '../features/exportOrchestrator';
import { ExportHistoryEntry, formatBytes, formatDuration, relativeTime, totalBytes } from '../features/exportHistory';
import { isFileIncluded, reservedOutputPaths } from '../core/filter';
import { usesExternalOutputFolder } from '../core/outputTarget';

export const VIEW_TYPE_EXPORTER_SIDEBAR = 'vault-exporter-sidebar';

interface ScopeStats {
	noteCount: number;
	canvasCount: number;
	bytes: number;
	tagActive: boolean;
}

export class ExporterSidebarView extends ItemView {
	private selected: Set<ExportTarget> = new Set(['all']);
	private rememberedTargetPreference: boolean | null = null;
	private stats: ScopeStats | null = null;
	/**
	 * Deliberately not named `open`: Obsidian's internal `View.open()` runs the
	 * view lifecycle when the workspace applies a view state, and a class field
	 * would shadow it ("Failed to open view: e.open is not a function").
	 */
	private isViewOpen = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly getContext: () => UiContext
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
		this.isViewOpen = true;
		this.syncTargetSelection(true);
		await this.computeStats();
		this.render();
	}

	override async onClose(): Promise<void> {
		this.isViewOpen = false;
	}

	/** Re-render with fresh stats (called on settings change). */
	async refresh(): Promise<void> {
		if (!this.isViewOpen) return;
		this.syncTargetSelection();
		await this.computeStats();
		this.render();
	}

	private syncTargetSelection(force = false): void {
		const settings = this.getContext().settings;
		if (!force && this.rememberedTargetPreference === settings.rememberTargetSelection) return;
		this.rememberedTargetPreference = settings.rememberTargetSelection;
		if (!settings.rememberTargetSelection) {
			this.selected = new Set(['all']);
			return;
		}
		const targets = Array.isArray(settings.lastSelectedTargets) ? settings.lastSelectedTargets : [];
		const restored = targets.length > 0 ? new Set<ExportTarget>(targets) : new Set<ExportTarget>(['all']);
		this.selected = restored.has('all') ? new Set(['all']) : restored;
	}

	private rememberTargetSelection(): void {
		const context = this.getContext();
		if (!context.settings.rememberTargetSelection) return;
		context.settings.lastSelectedTargets = [...this.selected];
		if (context.persistSettings) {
			void context.persistSettings().catch((error: unknown) => {
				console.error('[vault-exporter] Could not save sidebar target selection:', error);
				new Notice('Could not save the selected export targets.');
			});
		}
	}

	private async computeStats(): Promise<void> {
		const ctx = this.getContext();
		try {
			const info = ctx.gateway.getVaultFilesInfo?.();
			if (!info) {
				this.stats = null;
				return;
			}
			const reserved = reservedOutputPaths(ctx.settings, { vaultBasePath: ctx.gateway.getVaultBasePath() });
			let noteCount = 0;
			let canvasCount = 0;
			let bytes = 0;
			for (const f of info) {
				if (!isFileIncluded(f.path, {
					scopeRoot: ctx.settings.scopeRoot,
					excludedFolders: ctx.settings.excludedFolders,
					excludedFiles: ctx.settings.excludedFiles,
					excludedPrefixes: ctx.settings.excludedPrefixes,
					includeCanvas: ctx.settings.includeCanvas,
					reservedPaths: reserved,
				})) {
					continue;
				}
				if (f.path.endsWith('.canvas')) {
					canvasCount++;
				} else {
					noteCount++;
				}
				bytes += f.size;
			}
			this.stats = {
				noteCount,
				canvasCount,
				bytes,
				tagActive: ctx.settings.scopeTag.replace(/^#+/, '').trim().length > 0,
			};
		} catch {
			this.stats = null;
		}
	}

	render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('ve-sidebar');

		const ctx = this.getContext();

		// Header
		const header = container.createDiv({ cls: 've-sidebar__header' });
		header.createEl('h4', { text: 'Vault Exporter' });
		const vaultName = this.app.vault.getName();
		if (vaultName) {
			header.createDiv({ cls: 've-sidebar__vault', text: vaultName });
		}

		// Stats card
		const statsCard = container.createDiv({ cls: 've-card' });
		statsCard.createDiv({ cls: 've-card__title', text: 'Scope preview' });
		if (this.stats) {
			const s = this.stats;
			let line = s.noteCount + ' notes';
			if (s.canvasCount > 0) line += ' · ' + s.canvasCount + ' canvases';
			line += ' · ' + formatBytes(s.bytes);
			statsCard.createDiv({ cls: 've-card__value', text: line });
			if (s.tagActive) {
				statsCard.createDiv({ cls: 've-card__hint', text: '⚠ Tag filter active — the count above is path-based only.' });
			} else if (usesExternalOutputFolder(ctx.settings)) {
				const folder = ctx.settings.externalOutputFolder.trim();
				const shortFolder = folder.length > 48 ? '…' + folder.slice(-47) : folder;
				statsCard.createDiv({ cls: 've-card__hint', text: '📁 Outputs are written to ' + shortFolder + ' (outside the vault).' });
			} else {
				statsCard.createDiv({ cls: 've-card__hint', text: 'Previous export outputs are protected from re-export.' });
			}
		} else {
			statsCard.createDiv({ cls: 've-card__value', text: '—' });
		}

		// Targets card
		const targetsCard = container.createDiv({ cls: 've-card' });
		targetsCard.createDiv({ cls: 've-card__title', text: 'Export targets' });
		const list = targetsCard.createDiv({ cls: 've-target-list' });

		let selectionSummaryEl: HTMLElement | null = null;
		let runBtn: HTMLButtonElement | null = null;
		const describeSelection = (): string => this.selected.has('all')
			? 'All 4 non-ZIP targets selected: NotebookLM, HTML, Markdown, and Split. ZIP bundle is separate.'
			: `${this.selected.size} target${this.selected.size === 1 ? '' : 's'} selected: ${[...this.selected].map((target) => TARGET_LABELS[target]).join(', ')}.`;
		const updateSelectionUi = (): void => {
			for (const row of Array.from(list.querySelectorAll<HTMLButtonElement>('.ve-target'))) {
				const target = row.getAttribute('data-target') as ExportTarget | null;
				if (!target) continue;
				const selected = this.selected.has(target);
				row.classList.toggle('ve-target--active', selected);
				row.setAttribute('aria-pressed', String(selected));
				row.querySelector('.ve-target__box')?.setText(selected ? '✓' : '');
			}
			const description = describeSelection();
			selectionSummaryEl?.setText(description);
			runBtn?.setAttribute('aria-label', isExportRunning() ? 'Export is running' : 'Run export. ' + description);
		};
		const toggleTarget = (target: ExportTarget): void => {
			if (target === 'all') {
				this.selected = new Set(['all']);
			} else {
				const next = new Set<ExportTarget>(this.selected);
				next.delete('all');
				if (next.has(target)) {
					next.delete(target);
					if (next.size === 0) next.add('all');
				} else {
					next.add(target);
				}
				this.selected = next;
			}
			this.rememberTargetSelection();
			updateSelectionUi();
		};

		const allRow = this.renderTargetRow(list, 'all', 'All (consolidated + split)', isExportRunning());
		allRow.addEventListener('click', () => toggleTarget('all'));

		for (const cmd of EXPORT_COMMANDS) {
			if (cmd.target === 'all') continue;
			const row = this.renderTargetRow(list, cmd.target, cmd.name.replace(/ \(.*\)$/, ''), isExportRunning(), cmd.icon);
			row.addEventListener('click', () => toggleTarget(cmd.target));
		}

		const selectionDescription = describeSelection();
		selectionSummaryEl = targetsCard.createDiv({
			cls: 've-sidebar__selection-summary',
			text: selectionDescription,
			attr: { role: 'status', 'aria-live': 'polite' },
		});

		const runButton = targetsCard.createEl('button', {
			cls: 'mod-cta ve-sidebar__run',
			text: isExportRunning() ? 'Running…' : 'Run export',
			attr: { 'aria-label': isExportRunning() ? 'Export is running' : 'Run export. ' + selectionDescription },
		});
		runBtn = runButton;
		updateSelectionUi();
		if (!isExportRunning()) {
			runButton.addEventListener('click', async () => {
				const targets = [...this.selected];
				if (targets.length === 0) {
					new Notice('Select at least one export target.');
					return;
				}
				await executeTargets(this.getContext(), targets);
				await this.refresh();
			});
		}

		// History card
		const historyCard = container.createDiv({ cls: 've-card' });
		const historyHeader = historyCard.createDiv({ cls: 've-card__header' });
		historyHeader.createDiv({ cls: 've-card__title', text: 'Recent exports' });
		if (ctx.history.length > 0) {
			const clearHistory = historyHeader.createEl('button', {
				cls: 've-history__clear',
				text: 'Clear',
				attr: {
					type: 'button',
					title: 'Clear history only; exported files will be kept',
					'aria-label': 'Clear recent export history',
				},
			});
			clearHistory.addEventListener('click', (event) => {
				event.stopPropagation();
				ctx.onHistoryChange([]);
				new Notice('Export history cleared. Exported files were kept.');
			});
		}
		if (ctx.history.length === 0) {
			historyCard.createDiv({ cls: 've-card__hint', text: 'No exports yet.' });
		} else {
			const histList = historyCard.createDiv({ cls: 've-history' });
			for (const entry of ctx.history) {
				this.renderHistoryRow(histList, entry);
			}
		}

		// Footer
		const footer = container.createDiv({ cls: 've-sidebar__footer' });
		const settingsBtn = footer.createEl('button', { cls: 've-sidebar__settings', text: '⚙ Settings' });
		settingsBtn.addEventListener('click', () => {
			this.getContext().openSettings();
		});
	}

	private renderTargetRow(
		parent: HTMLElement,
		target: ExportTarget,
		label: string,
		disabled: boolean,
		icon = ''
	): HTMLButtonElement {
		const selected = this.selected.has(target);
		const row = parent.createEl('button', {
			cls: 've-target' + (selected ? ' ve-target--active' : '') + (disabled ? ' ve-target--disabled' : ''),
			attr: { type: 'button', 'aria-pressed': String(selected), 'data-target': target },
		});
		row.disabled = disabled;
		row.setAttribute('aria-label', label);
		row.createSpan({ cls: 've-target__box', text: selected ? '✓' : '', attr: { 'aria-hidden': 'true' } });
		if (icon) {
			const iconEl = row.createSpan({ cls: 've-target__icon', attr: { 'aria-hidden': 'true' } });
			setIcon(iconEl, icon);
		}
		row.createSpan({ cls: 've-target__label', text: label });
		return row;
	}

	private renderHistoryRow(parent: HTMLElement, entry: ExportHistoryEntry): void {
		const row = parent.createDiv({
			cls: 've-history__row ve-history__row--' + entry.outcome,
			title: entry.label + '\n' + new Date(entry.startedAt).toLocaleString(),
		});
		const icon = entry.outcome === 'success' ? '✓' : entry.outcome === 'cancelled' ? '✕' : '!';
		row.createSpan({ cls: 've-history__icon', text: icon, attr: { 'aria-hidden': 'true' } });
		const main = row.createSpan({ cls: 've-history__main' });
		main.createSpan({ cls: 've-history__label', text: entry.label });
		main.createSpan({
			cls: 've-history__meta',
			text: relativeTime(entry.startedAt) + ' · ' + formatDuration(entry.durationMs) + ' · ' + entry.files.length + ' files · ' + formatBytes(totalBytes(entry.files)),
		});
		const firstOutput = entry.files[0];
		if (firstOutput) {
			const reveal = row.createEl('button', {
				cls: 've-history__reveal',
				attr: { type: 'button', title: firstOutput.path, 'aria-label': 'Reveal output folder for ' + entry.label },
			});
			setIcon(reveal, 'folder-open');
			reveal.addEventListener('click', (event) => {
				event.stopPropagation();
				if (!this.getContext().gateway.revealInFileManager(firstOutput.path)) {
					new Notice('Could not reveal the output folder on this device.');
				}
			});
		}
	}
}
