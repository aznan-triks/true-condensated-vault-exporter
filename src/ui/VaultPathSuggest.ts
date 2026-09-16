/**
 * Vault path autocomplete suggest.
 * Enables interactive autocomplete for folders and files.
 */

import { AbstractInputSuggest, App } from 'obsidian';

export class VaultPathSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		private readonly getCandidates: () => string[]
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): string[] {
		const needle = query.toLowerCase();
		return this.getCandidates().filter((candidate) => candidate.toLowerCase().includes(needle));
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