/**
 * Settings Tab for Vault Exporter.
 * Searchable settings with grouped controls and HTML export personalization.
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type VaultExporterPlugin from '../main';
import { PROGRESS_PANEL_AUTO_CLOSE_OPTIONS } from '../core/types';
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
		containerEl.createEl('p', {
			cls: 've-settings__intro',
			text: 'Choose what to export, where it goes, and how the standalone HTML document looks.',
		});

		const searchWrap = containerEl.createDiv({ cls: 've-settings__search-wrap' });
		const search = new Setting(searchWrap)
			.setName('Find a setting')
			.setDesc('Search by name or description. Press Escape to clear.')
			.setClass('ve-settings__search');
		const sections = containerEl.createDiv({ cls: 've-settings__sections' });
		const noResults = sections.createDiv({ cls: 've-settings__empty', text: 'No settings match your search.' });
		noResults.hidden = true;

		search.addText((text) => {
			text.setPlaceholder('Try “accent”, “folder”, or “frontmatter”…');
			text.inputEl.setAttribute('aria-label', 'Search Vault Exporter settings');
			text.inputEl.addEventListener('input', () => this.filterSettings(sections, noResults, text.inputEl.value));
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key === 'Escape') {
					text.inputEl.value = '';
					this.filterSettings(sections, noResults, '');
				}
			});
		});

		const generalSection = this.createSection(sections, 'General');
		this.createSetting(generalSection, 'Document Title', 'Title written at the top of consolidated exports.')
			.addText((text) => {
				text.setValue(this.plugin.settings.documentTitle);
				text.onChange(async (val) => {
					this.plugin.settings.documentTitle = val.trim();
					await this.plugin.saveSettings();
				});
			});
		this.renderToggleSetting(
			generalSection,
			'Remember Sidebar Targets',
			'Restore the last selected export targets when you reopen Vault Exporter.',
			'rememberTargetSelection'
		);

		// SECTION: EXPORT FEEDBACK & BEHAVIOR
		const behaviorSection = this.createSection(sections, 'Export Feedback & Behavior');
		this.renderToggleSetting(
			behaviorSection,
			'Reveal Output After Success',
			'Automatically open the first exported file’s folder in the desktop file manager when an export succeeds.',
			'autoRevealOutput'
		);
		this.createSetting(behaviorSection, 'Progress Panel Auto-Close', 'Choose how long the panel stays open after a successful export. Cancelled and failed panels remain visible for review. Select Never to keep successful results open until you close them.')
			.addDropdown((drop) => {
				for (const seconds of PROGRESS_PANEL_AUTO_CLOSE_OPTIONS) {
					drop.addOption(String(seconds), seconds === 0 ? 'Never (keep open)' : seconds + ' seconds');
				}
				drop.setValue(String(this.plugin.settings.progressPanelAutoCloseSeconds));
				drop.onChange(async (value) => {
					const seconds = Number(value);
					if (PROGRESS_PANEL_AUTO_CLOSE_OPTIONS.some((option) => option === seconds)) {
						this.plugin.settings.progressPanelAutoCloseSeconds = seconds;
						await this.plugin.saveSettings();
					}
				});
			});

		// SECTION: SCOPE & EXCLUSIONS
		const scopeSection = this.createSection(sections, 'Scope & Exclusions');
		this.createSetting(scopeSection, 'Scope Root', 'Vault-relative root folder to scan. Leave empty to scan the entire vault.')
			.addText((text) => {
				text.setValue(this.plugin.settings.scopeRoot);
				text.setPlaceholder('e.g. Notes or leave blank');
				text.onChange(async (val) => {
					this.plugin.settings.scopeRoot = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
			});

		this.createSetting(scopeSection, 'Scope Tag', 'When set, only notes carrying this tag (body or frontmatter) are exported. Canvas files are excluded while a tag is active.')
			.addText((text) => {
				text.setValue(this.plugin.settings.scopeTag);
				text.setPlaceholder('e.g. #research or research');
				text.onChange(async (val) => {
					this.plugin.settings.scopeTag = val.trim();
					await this.plugin.saveSettings();
				});
			});

		this.renderStringListSetting(
			scopeSection,
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
			scopeSection,
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
			scopeSection,
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
		const outputSection = this.createSection(sections, 'Output Paths & Split Options');
		this.createSetting(outputSection, 'NotebookLM Consolidated Output', 'Vault-relative path, or an absolute file path on desktop, for the NotebookLM text file.')
			.addText((text) => {
				text.setValue(this.plugin.settings.notebooklmOutputPath);
				text.onChange(async (val) => {
					this.plugin.settings.notebooklmOutputPath = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFiles());
			});

		this.createSetting(outputSection, 'HTML Consolidated Output', 'Vault-relative path, or an absolute file path on desktop, for the HTML document.')
			.addText((text) => {
				text.setValue(this.plugin.settings.htmlOutputPath);
				text.onChange(async (val) => {
					this.plugin.settings.htmlOutputPath = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFiles());
			});

		this.createSetting(outputSection, 'Markdown Consolidated Output', 'Vault-relative path, or an absolute file path on desktop, for the consolidated Markdown document.')
			.addText((text) => {
				text.setValue(this.plugin.settings.markdownOutputPath);
				text.onChange(async (val) => {
					this.plugin.settings.markdownOutputPath = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFiles());
			});

		this.createSetting(outputSection, 'ZIP Bundle Output', 'Where the ZIP bundle (all consolidated formats + split files) is written. Vault-relative or absolute path.')
			.addText((text) => {
				text.setValue(this.plugin.settings.zipOutputPath);
				text.onChange(async (val) => {
					this.plugin.settings.zipOutputPath = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFiles());
			});

		this.createSetting(outputSection, 'Split Export Mode', 'Choose one text file per top-level folder, or one cleaned Markdown file for each note.')
			.addDropdown((drop) => {
				drop.addOption('folder-grouped', 'Folder-grouped (1 .txt per category folder)');
				drop.addOption('individual-files', 'Individual notes (1-to-1 markdown files)');
				drop.setValue(this.plugin.settings.splitMode);
				drop.onChange(async (val) => {
					if (val === 'folder-grouped' || val === 'individual-files') {
						this.plugin.settings.splitMode = val;
						await this.plugin.saveSettings();
					}
				});
			});

		this.createSetting(outputSection, 'Split Group Folder', 'Folder-grouped mode: each direct subfolder of this folder becomes one file. Empty = scope root.')
			.addText((text) => {
				text.setValue(this.plugin.settings.splitGroupFolder);
				text.onChange(async (val) => {
					this.plugin.settings.splitGroupFolder = val.trim();
					await this.plugin.saveSettings();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
			});

		this.createSetting(outputSection, 'Split Files Destination Folder', 'Vault-relative folder or absolute disk path (desktop only) for split files.')
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
		const processingSection = this.createSection(sections, 'Markdown Processing');
		this.createSetting(processingSection, 'Include Obsidian .canvas Files', 'Extract text nodes and note links from .canvas files into clean text (visual reading order, groups as sections).')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.includeCanvas);
				toggle.onChange(async (val) => {
					this.plugin.settings.includeCanvas = val;
					await this.plugin.saveSettings();
				});
			});

		this.createSetting(processingSection, 'Strip Frontmatter', 'Remove YAML frontmatter block from exported document bodies.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.stripFrontmatter);
				toggle.onChange(async (val) => {
					this.plugin.settings.stripFrontmatter = val;
					await this.plugin.saveSettings();
				});
			});

		this.createSetting(processingSection, 'Render In-Memory Dataview Queries', 'Evaluate ```dataview blocks into static markdown tables during export. Supports and/or, comparisons (=, !=, >, <, >=, <=), in (…), like "wild*card", contains/startswith/endswith.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.renderDataview);
				toggle.onChange(async (val) => {
					this.plugin.settings.renderDataview = val;
					await this.plugin.saveSettings();
				});
			});

		this.createSetting(processingSection, 'Wikilink Handling', 'Format for converting [[wikilinks]]. Canonical-alias shows the note title and alias as Title (Alias). Markdown links resolve to real vault paths.')
			.addDropdown((drop) => {
				drop.addOption('canonical-alias', 'Note title and alias: Title (Alias)');
				drop.addOption('clean-text', 'Clean text (Display alias or note title)');
				drop.addOption('keep-wikilink', 'Keep raw [[wikilinks]]');
				drop.addOption('markdown', 'Standard [Markdown](links) — resolved to real paths');
				drop.setValue(this.plugin.settings.wikilinkFormat);
				drop.onChange(async (val) => {
					if (val === 'canonical-alias' || val === 'clean-text' || val === 'keep-wikilink' || val === 'markdown') {
						this.plugin.settings.wikilinkFormat = val;
						await this.plugin.saveSettings();
					}
				});
			});

		this.renderStringListSetting(
			processingSection,
			'Ignored Frontmatter Properties',
			'YAML properties omitted from exported metadata (e.g. canvas, icon, trello keys). Autocomplete detects all properties present in your vault notes.',
			this.plugin.settings.ignoredProperties,
			() => this.plugin.gateway.getAllFrontmatterKeys(),
			async (newList) => {
				this.plugin.settings.ignoredProperties = newList;
				await this.plugin.saveSettings();
			},
			true
		);

		// SECTION: HTML PERSONALIZATION
		const htmlSection = this.createSection(sections, 'HTML Personalization');
		this.createSetting(htmlSection, 'HTML Color Theme', 'Choose whether the standalone HTML export follows the viewer or always uses a light or dark palette.')
			.addDropdown((drop) => {
				drop.addOption('system', 'Follow system preference');
				drop.addOption('light', 'Light');
				drop.addOption('dark', 'Dark');
				drop.setValue(this.plugin.settings.htmlTheme);
				drop.onChange(async (val) => {
					if (val === 'system' || val === 'light' || val === 'dark') {
						this.plugin.settings.htmlTheme = val;
						this.updateHtmlPreview();
						await this.plugin.saveSettings();
					}
				});
			});

		this.createSetting(htmlSection, 'HTML Accent Color', 'Personalize links, callouts, and focused controls. Custom CSS can still override --ve-accent.')
			.addColorPicker((picker) => {
				picker.setValue(this.plugin.settings.htmlAccentColor);
				picker.onChange(async (value) => {
					if (/^#[0-9a-f]{6}$/i.test(value)) {
						this.plugin.settings.htmlAccentColor = value.toLowerCase();
						this.updateHtmlPreview();
						await this.plugin.saveSettings();
					}
				});
			});

		this.createSetting(htmlSection, 'HTML Typography', 'Choose a comfortable system sans-serif, book-style serif, or monospace look for the exported document.')
			.addDropdown((drop) => {
				drop.addOption('system', 'System sans-serif');
				drop.addOption('serif', 'Serif');
				drop.addOption('monospace', 'Monospace');
				drop.setValue(this.plugin.settings.htmlFont);
				drop.onChange(async (val) => {
					if (val === 'system' || val === 'serif' || val === 'monospace') {
						this.plugin.settings.htmlFont = val;
						this.updateHtmlPreview();
						await this.plugin.saveSettings();
					}
				});
			});

		const widthDescription = 'Maximum reading width for the document column. Current: ';
		const widthSetting = this.createSetting(htmlSection, 'HTML Reading Width', widthDescription + this.plugin.settings.htmlContentWidth + ' px.');
		widthSetting.addSlider((slider) => {
			slider.setLimits(680, 1400, 20);
			slider.setValue(this.plugin.settings.htmlContentWidth);
			slider.setDynamicTooltip();
			slider.sliderEl.setAttribute('aria-label', 'HTML reading width');
			slider.onChange(async (value) => {
				const width = Math.round(Math.min(1400, Math.max(680, value)) / 20) * 20;
				this.plugin.settings.htmlContentWidth = width;
				widthSetting.setDesc(widthDescription + width + ' px.');
				this.updateHtmlPreview();
				await this.plugin.saveSettings();
			});
		});

		this.renderToggleSetting(htmlSection, 'HTML Table of Contents', 'Include a searchable navigation panel linking to each note and its headings.', 'htmlShowToc');
		this.renderToggleSetting(htmlSection, 'HTML Document Search', 'Show the document filter in the table of contents.', 'htmlShowSearch');
		this.renderToggleSetting(htmlSection, 'HTML Source Paths', 'Show each note’s vault path in the navigation and document header.', 'htmlShowPaths');
		this.renderToggleSetting(htmlSection, 'HTML Frontmatter Metadata', 'Show included frontmatter values as badges beneath each note title.', 'htmlShowMetadata');
		this.renderToggleSetting(htmlSection, 'HTML Export Footer', 'Show the export time, document count, and optional attribution at the bottom.', 'htmlShowFooter');
		this.createSetting(htmlSection, 'HTML Footer Attribution', 'Optional name or short note shown in the HTML footer. Leave blank for no attribution.')
			.addText((text) => {
				text.setValue(this.plugin.settings.htmlFooterText);
				text.setPlaceholder('e.g. Research team');
				text.onChange(async (value) => {
					this.plugin.settings.htmlFooterText = value.slice(0, 200);
					await this.plugin.saveSettings();
				});
			});

		const previewRow = htmlSection.createDiv({ cls: 've-settings-row ve-settings-row--preview' });
		previewRow.createDiv({ cls: 've-html-preview__label', text: 'Live preview · theme, accent, typography, and width' });
		const preview = previewRow.createDiv({ cls: 've-html-preview' });
		preview.setAttribute('aria-label', 'Preview of the standalone HTML appearance');
		const previewNav = preview.createDiv({ cls: 've-html-preview__nav' });
		previewNav.createSpan({ text: 'Table of contents' });
		previewNav.createSpan({ text: 'Sample note', cls: 've-html-preview__nav-item' });
		const previewDoc = preview.createDiv({ cls: 've-html-preview__document' });
		previewDoc.createEl('h4', { text: 'A note worth reading' });
		previewDoc.createDiv({ cls: 've-html-preview__meta', text: 'Projects / Sample.md  ·  status: draft' });
		previewDoc.createEl('p', { text: 'A quick preview of your chosen typography, reading width, and accent color.' });
		previewDoc.createSpan({ cls: 've-html-preview__link', text: 'Sample link' });
		previewDoc.createEl('blockquote', { text: 'Callouts use the selected accent color.' });
		this.updateHtmlPreview();

		// SECTION: ADVANCED
		const advancedSection = this.createSection(sections, 'Advanced');
		this.createSetting(advancedSection, 'Custom HTML CSS', 'Extra CSS appended to the HTML export. Use to override the built-in theme (custom properties: --ve-bg, --ve-panel, --ve-text, --ve-accent…).')
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

		this.createSetting(advancedSection, 'Yield Every N Notes', 'Notes processed between two UI yields. Lower = more responsive UI and snappier cancel, slightly slower overall.')
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

	private createSection(parent: HTMLElement, title: string): HTMLElement {
		const section = parent.createDiv({ cls: 've-settings-section' });
		section.createEl('h3', { text: title });
		return section;
	}

	private createSetting(containerEl: HTMLElement, title: string, desc: string): Setting {
		const row = containerEl.createDiv({ cls: 've-settings-row' });
		return new Setting(row).setName(title).setDesc(desc);
	}

	private renderToggleSetting(
		containerEl: HTMLElement,
		title: string,
		desc: string,
		key: 'rememberTargetSelection' | 'autoRevealOutput' | 'htmlShowToc' | 'htmlShowSearch' | 'htmlShowPaths' | 'htmlShowMetadata' | 'htmlShowFooter'
	): void {
		this.createSetting(containerEl, title, desc).addToggle((toggle) => {
			toggle.setValue(this.plugin.settings[key]);
			toggle.onChange(async (value) => {
				this.plugin.settings[key] = value;
				await this.plugin.saveSettings();
			});
		});
	}

	private updateHtmlPreview(): void {
		const preview = this.containerEl.querySelector<HTMLElement>('.ve-html-preview');
		if (!preview) return;
		const settings = this.plugin.settings;
		const theme = settings.htmlTheme === 'light' || settings.htmlTheme === 'dark' ? settings.htmlTheme : 'system';
		const accent = /^#[0-9a-f]{6}$/i.test(settings.htmlAccentColor) ? settings.htmlAccentColor : '#8b72d9';
		const width = Number.isFinite(settings.htmlContentWidth)
			? Math.round(Math.min(1400, Math.max(680, settings.htmlContentWidth)) / 20) * 20
			: 920;
		const font = settings.htmlFont === 'serif'
			? "Georgia, 'Times New Roman', serif"
			: settings.htmlFont === 'monospace'
				? 'ui-monospace, SFMono-Regular, Consolas, monospace'
				: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
		preview.dataset.theme = theme;
		preview.style.setProperty('--ve-preview-accent', accent);
		preview.style.maxWidth = width + 'px';
		preview.style.fontFamily = font;
	}

	private filterSettings(containerEl: HTMLElement, noResults: HTMLElement, value: string): void {
		const query = value.trim().toLocaleLowerCase();
		let visibleRows = 0;
		for (const row of Array.from(containerEl.querySelectorAll<HTMLElement>('.ve-settings-row'))) {
			const matches = !query || (row.textContent ?? '').toLocaleLowerCase().includes(query);
			row.hidden = !matches;
			if (matches) visibleRows++;
		}
		for (const section of Array.from(containerEl.querySelectorAll<HTMLElement>('.ve-settings-section'))) {
			section.hidden = !section.querySelector('.ve-settings-row:not([hidden])');
		}
		noResults.hidden = query.length === 0 || visibleRows > 0;
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
		const row = containerEl.createDiv({ cls: 've-settings-row ve-settings-row--list' });
		const setting = new Setting(row).setName(title).setDesc(desc);
		const listDiv = row.createDiv({ cls: 've-list-setting' });

		items.forEach((item, index) => {
			const itemRow = listDiv.createDiv({ cls: 've-list-item' });
			itemRow.createSpan({ text: item, cls: 've-list-item__text' });

			const delBtn = itemRow.createEl('button', { text: '✕', cls: 've-list-item__del' });
			delBtn.title = 'Remove';
			delBtn.setAttribute('aria-label', 'Remove ' + item);
			delBtn.addEventListener('click', async () => {
				const updated = items.filter((_, i) => i !== index);
				if (onSave) await onSave(updated);
				this.display();
			});
		});

		// Quick-add pills for candidates not yet added.
		if (showQuickPills && getCandidates) {
			const candidates = getCandidates().filter((candidate) => !items.includes(candidate));
			if (candidates.length > 0) {
				const pillsContainer = row.createDiv({ cls: 've-quick-tags' });
				pillsContainer.createSpan({ text: 'Quick add:', cls: 've-quick-tags__label' });
				candidates.slice(0, 15).forEach((candidate) => {
					const pill = pillsContainer.createEl('button', { text: '+ ' + candidate, cls: 've-tag-pill', attr: { type: 'button' } });
					pill.title = 'Click to ignore property: ' + candidate;
					pill.addEventListener('click', async () => {
						const updated = [...items, candidate];
						if (onSave) await onSave(updated);
						this.display();
					});
				});
			}
		}

		let newText = '';
		setting.addText((text) => {
			text.setPlaceholder('Add or search property...');
			text.inputEl.setAttribute('aria-label', 'Add to ' + title);
			text.onChange((value) => {
				newText = value.trim();
			});
			text.inputEl.addEventListener('keydown', async (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					if (newText && !items.includes(newText)) {
						const updated = [...items, newText];
						if (onSave) await onSave(updated);
						this.display();
					}
				}
			});
			if (getCandidates) new VaultPathSuggest(this.app, text.inputEl, getCandidates);
		});

		setting.addButton((button) => {
			button.setButtonText('Add');
			button.setCta();
			button.onClick(async () => {
				if (newText && !items.includes(newText)) {
					const updated = [...items, newText];
					if (onSave) await onSave(updated);
					this.display();
				}
			});
		});
	}
}
