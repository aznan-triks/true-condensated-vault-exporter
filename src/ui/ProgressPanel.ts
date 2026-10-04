/**
 * Visual floating progress panel with live logs, elapsed time, cancel support,
 * and a completion summary (file count, size, duration, "Open folder" shortcut).
 * Styled in matching Obsidian look & feel.
 */

import { formatBytes, formatDuration } from '../features/exportHistory';

export interface PanelOptions {
	title: string;
	autoCloseMs?: number;
	onCancel?: () => void;
}

export interface FinishInfo {
	fileCount?: number;
	bytes?: number;
	skipped?: number;
	durationMs?: number;
	onReveal?: () => void;
}

export class ProgressPanel {
	private readonly root: HTMLElement;
	private readonly statusEl: HTMLElement;
	private readonly barEl: HTMLElement;
	private readonly progressEl: HTMLElement;
	private readonly elapsedEl: HTMLElement;
	private readonly logEl: HTMLElement;
	private readonly currentEl: HTMLElement;
	private readonly closeBtn: HTMLElement;
	private readonly cancelBtn: HTMLElement;
	private timer: number | null = null;
	private elapsedTimer: number | null = null;
	private readonly startedAt = Date.now();
	private finished = false;

	constructor(private readonly options: PanelOptions) {
		document.querySelectorAll('.ve-panel').forEach((el) => el.remove());

		this.root = document.body.createDiv({ cls: 've-panel' });

		const header = this.root.createDiv({ cls: 've-panel__header' });
		header.createSpan({ cls: 've-panel__title', text: options.title });
		this.statusEl = header.createSpan({ cls: 've-panel__status', text: 'Running...', attr: { role: 'status', 'aria-live': 'polite' } });

		this.closeBtn = header.createEl('button', {
			cls: 've-panel__close',
			text: '\u00d7',
			attr: { 'aria-label': 'Close export panel', title: 'Close' },
		});
		this.closeBtn.addEventListener('click', () => {
			if (!this.finished && this.options.onCancel) {
				this.options.onCancel();
			}
			this.destroy();
		});

		this.cancelBtn = header.createEl('button', { cls: 've-panel__cancel', text: 'Cancel' });
		this.cancelBtn.addEventListener('click', () => {
			if (!this.finished) {
				this.options.onCancel?.();
			}
		});
		if (!options.onCancel) {
			this.cancelBtn.hide();
		}

		const progress = this.root.createDiv({ cls: 've-panel__progress' });
		const progressMeta = progress.createDiv({ cls: 've-panel__progress-meta' });
		this.progressEl = progressMeta.createSpan({ cls: 've-panel__progress-label', text: '0 / 0' });
		this.elapsedEl = progressMeta.createSpan({ cls: 've-panel__elapsed', text: 'Elapsed 0s', attr: { 'aria-live': 'off' } });
		const track = progress.createDiv({ cls: 've-panel__track' });
		this.barEl = track.createDiv({ cls: 've-panel__bar' });

		this.logEl = this.root.createDiv({ cls: 've-panel__log' });
		this.currentEl = this.root.createDiv({ cls: 've-panel__current', text: 'Initializing...' });
		this.elapsedTimer = window.setInterval(() => this.updateElapsed(), 1000);
	}

	update(current: number, total: number, label?: string, file?: string): void {
		const ratio = total > 0 ? Math.min(1, current / total) : 0;
		this.barEl.style.width = (ratio * 100) + '%';
		this.progressEl.setText(current + ' / ' + total + (label ? ' · ' + label : ''));
		this.currentEl.setText(file || label || 'Working...');
		this.updateElapsed();
	}

	private updateElapsed(durationMs = Date.now() - this.startedAt): void {
		this.elapsedEl.setText('Elapsed ' + formatDuration(durationMs));
	}

	log(message: string, isError = false): void {
		const row = document.createElement('div');
		row.className = 've-panel__row' + (isError ? ' ve-panel__row--error' : '');
		const icon = document.createElement('span');
		icon.className = 've-panel__icon';
		icon.textContent = isError ? '\u2715' : '\u2139';
		const text = document.createElement('span');
		text.className = 've-panel__text';
		text.textContent = message;
		row.appendChild(icon);
		row.appendChild(text);

		this.logEl.appendChild(row);
		while (this.logEl.children.length > 80) {
			this.logEl.firstElementChild?.remove();
		}
		this.logEl.scrollTop = this.logEl.scrollHeight;
	}

	finish(outcome: 'success' | 'cancelled' | 'error', summary: string, info?: FinishInfo): void {
		this.finished = true;
		this.cancelBtn.hide();
		const durationMs = info?.durationMs ?? Date.now() - this.startedAt;
		this.updateElapsed(durationMs);
		if (this.elapsedTimer !== null) {
			window.clearInterval(this.elapsedTimer);
			this.elapsedTimer = null;
		}
		this.statusEl.setText(outcome === 'success' ? 'Done' : outcome === 'cancelled' ? 'Cancelled' : 'Failed');
		this.statusEl.className = 've-panel__status ve-panel__status--' + outcome;
		if (outcome === 'success') this.barEl.style.width = '100%';

		const parts: string[] = [summary, 'in ' + formatDuration(durationMs)];
		if (info?.fileCount !== undefined) {
			parts.push(info.fileCount + ' files');
		}
		if (info?.bytes !== undefined) {
			parts.push(formatBytes(info.bytes));
		}
		if (info && info.skipped && info.skipped > 0) {
			parts.push(info.skipped + ' skipped');
		}
		this.currentEl.setText(parts.join(' · '));

		if (info?.onReveal) {
			const footer = this.root.createDiv({ cls: 've-panel__footer' });
			const revealBtn = footer.createEl('button', { cls: 've-panel__reveal', text: 'Open folder' });
			revealBtn.addEventListener('click', () => {
				info.onReveal?.();
				this.destroy();
			});
		}

		if (outcome === 'success' && this.options.autoCloseMs && this.options.autoCloseMs > 0) {
			this.timer = window.setTimeout(() => this.destroy(), this.options.autoCloseMs);
		}
	}

	destroy(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.elapsedTimer !== null) {
			window.clearInterval(this.elapsedTimer);
			this.elapsedTimer = null;
		}
		this.root.remove();
	}
}
