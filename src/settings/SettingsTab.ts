/**
 * Settings Tab for Vault Exporter.
 * Ergonomic settings management with dynamic blacklist editors.
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type VaultExporterPlugin from '../main';
import { VaultPathSuggest } from '../ui/VaultPathSuggest';

export class VaultExporterSettingsTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: VaultExporterPlugin) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('ve-settings');

		containerEl.createEl('h2', { text: 'Vault Exporter Settings' });

		new Setting(containerEl)
			.setName('Document Title')
			.setDesc('Title written at the top of consolidated exports.')
			.addText((text) => {
				text.setValue(this.plugin.settings.documentTitle);
				text.onChange(async (val) => {
					this.plugin.settings.documentTitle = val.trim();
					await this.plugin.saveSettings();
				});
			});

		// SECTION: SCOPE & EXCLUSIONS
		containerEl.createEl('h3', { text: 'Scope & Exclusions' });

		new Setting(containerEl)
			.setName('Scope Root')
			.setDesc('Vault-relative root folder to scan. Leave empty to scan the entire vault.')
			.addText((text) => {
				text.setValue(this.plugin.settings.scopeRoot);
				text.setPlaceholder('e.g. Notes or leave blank');
				text.onChange(async (val) => {
					this.plugin.settings.scopeRoot = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
			});

		new Setting(containerEl)
			.setName('Scope Tag')
			.setDesc('When set, only notes carrying this tag (body or frontmatter) are exported. Canvas files are excluded while a tag is active.')
			.addText((text) => {
				text.setValue(this.plugin.settings.scopeTag);
				text.setPlaceholder('e.g. #chronologie or chronologie');
				text.onChange(async (val) => {
					this.plugin.settings.scopeTag = val.trim();
					await this.plugin.saveSettings();
				});
			});

		this.renderStringListSetting(
			containerEl,
			'Excluded Folders',
			'Folders completely excluded from exports (with interactive autocomplete).',
			this.plugin.settings.excludedFolders,
			() => this.plugin.gateway.getAllFolders(),
			async (newList) => {
				this.plugin.settings.excludedFolders = newList;
				await this.plugin.saveSettings();
			}
		);

		this.renderStringListSetting(
			containerEl,
			'Excluded Files',
			'Exact filenames or paths to exclude (with interactive autocomplete).',
			this.plugin.settings.excludedFiles,
			() => this.plugin.gateway.getAllFiles(),
			async (newList) => {
				this.plugin.settings.excludedFiles = newList;
				await this.plugin.saveSettings();
			}
		);

		this.renderStringListSetting(
			containerEl,
			'Excluded Folder Prefixes',
			'Prefixes that trigger exclusion on any subfolder (e.g. 00_).',
			this.plugin.settings.excludedPrefixes,
			undefined,
			async (newList) => {
				this.plugin.settings.excludedPrefixes = newList;
				await this.plugin.saveSettings();
			}
		);

		// SECTION: OUTPUT PATHS & SPLIT MODE
		containerEl.createEl('h3', { text: 'Output Paths & Split Options' });

		new Setting(containerEl)
			.setName('NotebookLM Consolidated Output')
			.setDesc('Relative path from vault root for the NotebookLM text file.')
			.addText((text) => {
				text.setValue(this.plugin.settings.notebooklmOutputPath);
				text.onChange(async (val) => {
					this.plugin.settings.notebooklmOutputPath = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFiles());
			});

		new Setting(containerEl)
			.setName('HTML Consolidated Output')
			.setDesc('Relative path from vault root for the HTML document.')
			.addText((text) => {
				text.setValue(this.plugin.settings.htmlOutputPath);
				text.onChange(async (val) => {
					this.plugin.settings.htmlOutputPath = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFiles());
			});

		new Setting(containerEl)
			.setName('Markdown Consolidated Output')
			.setDesc('Relative path from vault root for the single unified Markdown (.md) document.')
			.addText((text) => {
				text.setValue(this.plugin.settings.markdownOutputPath);
				text.onChange(async (val) => {
					this.plugin.settings.markdownOutputPath = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFiles());
			});

		new Setting(containerEl)
			.setName('ZIP Bundle Output')
			.setDesc('Where the ZIP bundle (all consolidated formats + split files) is written. Vault-relative or absolute path.')
			.addText((text) => {
				text.setValue(this.plugin.settings.zipOutputPath);
				text.onChange(async (val) => {
					this.plugin.settings.zipOutputPath = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFiles());
			});

		new Setting(containerEl)
			.setName('Split Export Mode')
			.setDesc('Folder-grouped: one consolidated .txt per category . Individual: 1-to-1 markdown notes.')
			.addDropdown((drop) => {
				drop.addOption('folder-grouped', 'Folder-grouped (1 .txt per category folder)');
				drop.addOption('individual-files', 'Individual notes (1-to-1 markdown files)');
				drop.setValue(this.plugin.settings.splitMode);
				drop.onChange(async (val) => {
					this.plugin.settings.splitMode = val as any;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Split Group Folder')
			.setDesc('Folder-grouped mode: each direct subfolder of this folder becomes one file. Empty = scope root.')
			.addText((text) => {
				text.setValue(this.plugin.settings.splitGroupFolder);
				text.onChange(async (val) => {
					this.plugin.settings.splitGroupFolder = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
			});

		new Setting(containerEl)
			.setName('Split Files Destination Folder')
			.setDesc('Vault-relative folder or absolute disk path (desktop only) for split files.')
			.addText((text) => {
				text.setValue(this.plugin.settings.splitOutputFolder);
				text.inputEl.style.width = '100%';
				text.onChange(async (val) => {
					this.plugin.settings.splitOutputFolder = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
			});

		// SECTION: MARKDOWN PROCESSING
		containerEl.createEl('h3', { text: 'Markdown Processing' });

		new Setting(containerEl)
			.setName('Include Obsidian .canvas Files')
			.setDesc('Extract text nodes and note links from .canvas files into clean text (visual reading order, groups as sections).')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.includeCanvas);
				toggle.onChange(async (val) => {
					this.plugin.settings.includeCanvas = val;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Strip Frontmatter')
			.setDesc('Remove YAML frontmatter block from exported document bodies.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.stripFrontmatter);
				toggle.onChange(async (val) => {
					this.plugin.settings.stripFrontmatter = val;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Render In-Memory Dataview Queries')
			.setDesc('Evaluate ```dataview blocks into static markdown tables during export. Supports and/or, comparisons (=, !=, >, <, >=, <=), in (…), like "wild*card", contains/startswith/endswith.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.renderDataview);
				toggle.onChange(async (val) => {
					this.plugin.settings.renderDataview = val;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Wikilink Handling')
			.setDesc('Format for converting [[wikilinks]]. Canonical-alias preserves target: Lien (Alias). Markdown links resolve to real vault paths.')
			.addDropdown((drop) => {
				drop.addOption('canonical-alias', 'Canonical & Alias: Lien (Alias) [Legacy Parity]');
				drop.addOption('clean-text', 'Clean text (Display alias or note title)');
				drop.addOption('keep-wikilink', 'Keep raw [[wikilinks]]');
				drop.addOption('markdown', 'Standard [Markdown](links) — resolved to real paths');
				drop.setValue(this.plugin.settings.wikilinkFormat);
				drop.onChange(async (val) => {
					this.plugin.settings.wikilinkFormat = val as any;
					await this.plugin.saveSettings();
				});
			});

		this.renderStringListSetting(
			containerEl,
			'Ignored Frontmatter Properties',
			'YAML properties omitted from exported metadata (e.g. canvas, icon, trello keys). Autocomplete detects all properties present in your vault notes.',
			this.plugin.settings.ignoredProperties,
			() => this.plugin.gateway.getAllFrontmatterKeys(),
			async (newList) => {
				this.plugin.settings.ignoredProperties = newList;
				await this.plugin.saveSettings();
			},
			true // Enable quick-add pills for detected frontmatter properties
		);

		// SECTION: ADVANCED
		containerEl.createEl('h3', { text: 'Advanced' });

		new Setting(containerEl)
			.setName('Custom HTML CSS')
			.setDesc('Extra CSS appended to the HTML export. Use to override the built-in theme (custom properties: --ve-bg, --ve-panel, --ve-text, --ve-accent…).')
			.addTextArea((area) => {
				area.setValue(this.plugin.settings.customCss);
				area.setPlaceholder(':root { --ve-accent: #c0392b; }');
				area.inputEl.rows = 6;
				area.inputEl.style.width = '100%';
				area.onChange(async (val) => {
					this.plugin.settings.customCss = val;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Yield Every N Notes')
			.setDesc('Notes processed between two UI yields. Lower = more responsive UI and snappier cancel, slightly slower overall.')
			.addText((text) => {
				text.setValue(String(this.plugin.settings.yieldEvery));
				text.setPlaceholder('25');
				text.onChange(async (val) => {
					const n = parseInt(val, 10);
					this.plugin.settings.yieldEvery = Number.isFinite(n) && n > 0 ? n : 25;
					await this.plugin.saveSettings();
				});
			});
	}

	private renderStringListSetting(
		containerEl: HTMLElement,
		title: string,
		desc: string,
		items: string[],
		getCandidates?: () => string[],
		onSave?: (items: string[]) => Promise<void>,
		showQuickPills: boolean = false
	): void {
		const s = new Setting(containerEl).setName(title).setDesc(desc);

		const listDiv = containerEl.createDiv({ cls: 've-list-setting' });

		items.forEach((item, index) => {
			const row = listDiv.createDiv({ cls: 've-list-item' });
			row.createSpan({ text: item, cls: 've-list-item__text' });
			const delBtn = row.createEl('button', { text: '\u2715', cls: 've-list-item__del' });
			delBtn.title = 'Remove';
			delBtn.addEventListener('click', async () => {
				const updated = items.filter((_, i) => i !== index);
				if (onSave) {
					await onSave(updated);
				}
				this.display();
			});
		});

		// Quick-add pills for candidates not yet added
		if (showQuickPills && getCandidates) {
			const candidates = getCandidates().filter((c) => !items.includes(c));
			if (candidates.length > 0) {
				const pillsContainer = containerEl.createDiv({ cls: 've-quick-tags' });
				pillsContainer.createSpan({ text: 'Quick add:', cls: 've-quick-tags__label' });
				// Display top 15 most relevant properties to avoid overwhelming UI
				candidates.slice(0, 15).forEach((cand) => {
					const pill = pillsContainer.createSpan({ text: '+ ' + cand, cls: 've-tag-pill' });
					pill.title = 'Click to ignore property: ' + cand;
					pill.addEventListener('click', async () => {
						const updated = [...items, cand];
						if (onSave) {
							await onSave(updated);
						}
						this.display();
					});
				});
			}
		}

		let newText = '';
		s.addText((text) => {
			text.setPlaceholder('Add or search property...');
			text.onChange((val) => {
				newText = val.trim();
			});
			text.inputEl.addEventListener('keydown', async (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					if (newText && !items.includes(newText)) {
						const updated = [...items, newText];
						if (onSave) {
							await onSave(updated);
						}
						this.display();
					}
				}
			});
			if (getCandidates) {
				new VaultPathSuggest(this.app, text.inputEl, getCandidates);
			}
		});

		s.addButton((btn) => {
			btn.setButtonText('Add');
			btn.setCta();
			btn.onClick(async () => {
				if (newText && !items.includes(newText)) {
					const updated = [...items, newText];
					if (onSave) {
						await onSave(updated);
					}
					this.display();
				}
			});
		});
	}
}
