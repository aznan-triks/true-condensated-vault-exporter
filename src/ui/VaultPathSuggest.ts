/**
 * Vault path autocomplete suggest.
 * Enables interactive autocomplete for folders and files with candidate caching.
 */

import { AbstractInputSuggest, App } from 'obsidian';

export class VaultPathSuggest extends AbstractInputSuggest<string> {
	private cachedCandidates: string[] | null = null;
	private lastCacheTime = 0;

	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		private readonly getCandidates: () => string[]
	) {
		super(app, inputEl);
	}

	private getLoadedCandidates(): string[] {
		const now = Date.now();
		// Cache candidates for 2.5s during typing bursts to prevent freezing the UI on each keystroke
		if (!this.cachedCandidates || now - this.lastCacheTime > 2500) {
			this.cachedCandidates = this.getCandidates();
			this.lastCacheTime = now;
		}
		return this.cachedCandidates;
	}

	protected getSuggestions(query: string): string[] {
		const needle = query.toLowerCase();
		return this.getLoadedCandidates().filter((candidate) => candidate.toLowerCase().includes(needle));
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	override selectSuggestion(value: string): void {
		this.setValue(value);
		this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		this.inputEl.dispatchEvent(new Event('change', { bubbles: true }));
		this.close();
	}
}
