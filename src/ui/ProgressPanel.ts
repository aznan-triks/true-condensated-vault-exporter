/**
 * Visual floating progress panel with live logs and cancel support.
 * Styled in matching Obsidian look & feel.
 */

export interface PanelOptions {
	title: string;
	autoCloseMs?: number;
	onCancel?: () => void;
}

export class ProgressPanel {
	private readonly root: HTMLElement;
	private readonly statusEl: HTMLElement;
	private readonly barEl: HTMLElement;
	private readonly progressEl: HTMLElement;
	private readonly logEl: HTMLElement;
	private readonly currentEl: HTMLElement;
	private readonly closeBtn: HTMLElement;
	private timer: number | null = null;
	private finished = false;

	constructor(private readonly options: PanelOptions) {
		document.querySelectorAll('.ve-panel').forEach((el) => el.remove());

		this.root = document.body.createDiv({ cls: 've-panel' });

		const header = this.root.createDiv({ cls: 've-panel__header' });
		header.createSpan({ cls: 've-panel__title', text: options.title });
		this.statusEl = header.createSpan({ cls: 've-panel__status', text: 'Running...' });

		this.closeBtn = header.createEl('button', {
			cls: 've-panel__close',
			text: '\u00d7',
		});
		this.closeBtn.addEventListener('click', () => {
			if (!this.finished && this.options.onCancel) {
				this.options.onCancel();
			}
			this.destroy();
		});

		const progress = this.root.createDiv({ cls: 've-panel__progress' });
		this.progressEl = progress.createSpan({ cls: 've-panel__progress-label', text: '0 / 0' });
		const track = progress.createDiv({ cls: 've-panel__track' });
		this.barEl = track.createDiv({ cls: 've-panel__bar' });

		this.logEl = this.root.createDiv({ cls: 've-panel__log' });
		this.currentEl = this.root.createDiv({ cls: 've-panel__current', text: 'Initializing...' });
	}

	update(current: number, total: number, label?: string): void {
		const ratio = total > 0 ? Math.min(1, current / total) : 0;
		this.barEl.style.width = (ratio * 100) + '%';
		this.progressEl.setText(current + ' / ' + total);
		if (label) {
			this.currentEl.setText(label);
		}
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

		this.logEl.prepend(row);
		while (this.logEl.children.length > 80) {
			this.logEl.lastElementChild?.remove();
		}
	}

	finish(success: boolean, summary: string): void {
		this.finished = true;
		this.statusEl.setText(success ? 'Done' : 'Failed');
		this.statusEl.className = 've-panel__status ' + (success ? 've-panel__status--success' : 've-panel__status--error');
		this.barEl.style.width = '100%';
		this.currentEl.setText(summary);

		if (success && this.options.autoCloseMs && this.options.autoCloseMs > 0) {
			this.timer = window.setTimeout(() => this.destroy(), this.options.autoCloseMs);
		}
	}

	destroy(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
		}
		this.root.remove();
	}
}