/**
 * Settings Tab for Vault Exporter.
 * Tabbed and searchable settings with HTML export personalization.
 */

import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type VaultExporterPlugin from '../main';
import { PROGRESS_PANEL_AUTO_CLOSE_OPTIONS, SplitPresetId } from '../core/types';
import { isAbsoluteOutputPath } from '../core/outputTarget';
import {
	SPLIT_PRESETS,
	applySplitPreset,
	detectSplitPreset,
	isCandidateSplitFolder,
	previewSplitFiles,
} from '../features/exportSplit';
import { VaultPathSuggest } from '../ui/VaultPathSuggest';

interface SettingsSectionDefinition {
	id: string;
	title: string;
}

const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
	{ id: 'general', title: 'General' },
	{ id: 'feedback', title: 'Export Feedback & Behavior' },
	{ id: 'scope', title: 'Scope & Exclusions' },
	{ id: 'destination', title: 'External Output Folder' },
	{ id: 'output', title: 'Output Paths & Split Options' },
	{ id: 'processing', title: 'Markdown Processing' },
	{ id: 'html', title: 'HTML Personalization' },
	{ id: 'advanced', title: 'Advanced' },
];

export class VaultExporterSettingsTab extends PluginSettingTab {
	private activeSectionId = SETTINGS_SECTIONS[0]?.id ?? 'general';
	private searchQuery = '';
	private settingRowIndex = 0;

	constructor(app: App, private readonly plugin: VaultExporterPlugin) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.settingRowIndex = 0;
		containerEl.addClass('ve-settings');

		containerEl.createEl('h2', { text: 'Vault Exporter Settings' });
		containerEl.createEl('p', {
			cls: 've-settings__intro',
			text: 'Choose what to export, where it goes, and how the standalone HTML document looks.',
		});

		const searchWrap = containerEl.createDiv({ cls: 've-settings__search-wrap' });
		const search = new Setting(searchWrap)
			.setName('Find a setting')
			.setDesc('Search every category by name or description. Click a result to jump to it. Press Escape to clear.')
			.setClass('ve-settings__search');
		const searchResults = containerEl.createDiv({ cls: 've-settings__search-results' });
		searchResults.setAttribute('aria-live', 'polite');
		searchResults.hidden = true;
		const tabBar = containerEl.createDiv({
			cls: 've-settings__tabs',
			attr: { role: 'tablist', 'aria-label': 'Settings categories' },
		});
		const sections = containerEl.createDiv({ cls: 've-settings__sections' });
		const noResults = sections.createDiv({ cls: 've-settings__empty', text: 'No settings match your search.' });
		noResults.hidden = true;

		search.addText((text) => {
			text.setValue(this.searchQuery);
			text.setPlaceholder('Try “accent”, “folder”, or “frontmatter”…');
			text.inputEl.setAttribute('aria-label', 'Search Vault Exporter settings');
			text.inputEl.setAttribute('autocomplete', 'off');
			text.inputEl.addEventListener('input', () => {
				this.filterSettings(sections, searchResults, noResults, text.inputEl.value);
			});
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key === 'Escape') {
					text.inputEl.value = '';
					this.filterSettings(sections, searchResults, noResults, '');
				}
			});
		});

		const sectionElements = new Map<string, HTMLElement>();
		for (const sectionDefinition of SETTINGS_SECTIONS) {
			const section = this.createSection(sections, sectionDefinition.id, sectionDefinition.title);
			sectionElements.set(sectionDefinition.id, section);
			this.createSectionTab(tabBar, sectionDefinition);
		}

		const getSection = (id: string): HTMLElement => sectionElements.get(id)!;
		const generalSection = getSection('general');
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
		const behaviorSection = getSection('feedback');
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
		const scopeSection = getSection('scope');
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

		// SECTION: EXTERNAL OUTPUT FOLDER
		const destinationSection = getSection('destination');
		this.createSetting(
			destinationSection,
			'Export to an External Folder',
			'Write every output into a folder outside the vault instead of writing the configured output paths inside it. Relative paths keep their subfolders; absolute paths keep only their file or folder name. Requires an absolute folder path, for example C:\\Exports or /Users/you/Exports.'
		)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.useExternalOutputFolder);
				toggle.onChange(async (value) => {
					this.plugin.settings.useExternalOutputFolder = value;
					await this.plugin.saveSettings();
					if (value && !isAbsoluteOutputPath(this.plugin.settings.externalOutputFolder)) {
						const picked = await this.pickExternalOutputFolder();
						if (!picked) {
							new Notice('No external folder selected — exports keep going into the vault.');
						}
					}
					this.refreshExternalFolderDescription(externalFolderSetting);
				});
			});

		const externalFolderSetting = this.createSetting(
			destinationSection,
			'External Folder',
			this.describeExternalFolder()
		);
		externalFolderSetting.addText((text) => {
			text.setValue(this.plugin.settings.externalOutputFolder);
			text.setPlaceholder('C:\\Exports or /Users/you/Exports');
			text.inputEl.style.width = '100%';
			text.onChange(async (value) => {
				this.plugin.settings.externalOutputFolder = value.trim();
				await this.plugin.saveSettings();
				this.refreshExternalFolderDescription(externalFolderSetting);
			});
		});
		externalFolderSetting.addButton((button) => {
			button.setButtonText('Choose folder…');
			button.setTooltip('Open the system folder picker');
			button.onClick(async () => {
				await this.pickExternalOutputFolder();
			});
		});
		externalFolderSetting.addExtraButton((button) => {
			button.setIcon('folder-open');
			button.setTooltip('Open the external folder in the file manager');
			button.onClick(async () => {
				const folder = this.plugin.settings.externalOutputFolder.trim();
				if (!isAbsoluteOutputPath(folder)) {
					new Notice('Choose an absolute external folder first.');
					return;
				}
				if (!(await this.plugin.gateway.openOutputFolder(folder))) {
					new Notice('Could not open the external folder on this device.');
				}
			});
		});
		this.refreshExternalFolderDescription(externalFolderSetting);

		// SECTION: OUTPUT PATHS & SPLIT MODE
		const outputSection = getSection('output');
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

		this.renderSplitPresetsSetting(outputSection);

		this.createSetting(outputSection, 'Split Export Mode', 'Choose one text file per folder group, or one cleaned Markdown file for each note.')
			.addDropdown((drop) => {
				drop.addOption('folder-grouped', 'Folder-grouped (1 .txt per folder group)');
				drop.addOption('individual-files', 'Individual notes (1-to-1 markdown files)');
				drop.setValue(this.plugin.settings.splitMode);
				drop.onChange(async (val) => {
					if (val === 'folder-grouped' || val === 'individual-files') {
						this.plugin.settings.splitMode = val;
						await this.plugin.saveSettings();
						this.display();
					}
				});
			});

		this.createSetting(outputSection, 'Split Group Folder', 'Folder-grouped mode: each direct subfolder of this folder becomes one file. Empty = scope root.')
			.addText((text) => {
				text.setValue(this.plugin.settings.splitGroupFolder);
				text.onChange(async (val) => {
					this.plugin.settings.splitGroupFolder = val.trim();
					await this.plugin.saveSettings();
					this.updateSplitPreview();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
			});

		this.createSetting(
			outputSection,
			'Split Subfolder Naming',
			'Folder-grouped mode: choose how subfolder split files are named and organized inside the split destination folder.'
		)
			.addDropdown((drop) => {
				drop.addOption('flat-prefixed', 'Flat with parent prefix — Parent - Subfolder.txt (recommended for NotebookLM)');
				drop.addOption('flat-leaf', 'Flat with subfolder name only — Subfolder.txt (auto-disambiguates on collision)');
				drop.addOption('flat-underscored', 'Flat with underscore path — Parent_Subfolder.txt');
				drop.addOption('nested', 'Mirrored subfolder tree — Parent/Subfolder.txt');
				drop.setValue(this.plugin.settings.splitSubfolderStyle);
				drop.onChange(async (val) => {
					if (val === 'flat-prefixed' || val === 'flat-leaf' || val === 'flat-underscored' || val === 'nested') {
						this.plugin.settings.splitSubfolderStyle = val;
						await this.plugin.saveSettings();
						this.display();
					}
				});
			});

		this.createSetting(
			outputSection,
			'Split Subfolder Depth',
			'Folder-grouped mode: choose whether subfolder splitting applies to selected folders (1 level or recursive) or automatically across the entire scope.'
		)
			.addDropdown((drop) => {
				drop.addOption('direct', 'Selected folders — direct subfolders (1 level per selected folder)');
				drop.addOption('recursive', 'Selected folders — all nested subfolders (recursive)');
				drop.addOption('all-two-levels', 'Entire scope — main folders & direct subfolders (2 levels everywhere)');
				drop.addOption('all-recursive', 'Entire scope — every folder & nested subfolder recursively');
				drop.setValue(this.plugin.settings.splitSubfolderDepth);
				drop.onChange(async (val) => {
					if (val === 'direct' || val === 'recursive' || val === 'all-two-levels' || val === 'all-recursive') {
						this.plugin.settings.splitSubfolderDepth = val;
						await this.plugin.saveSettings();
						this.display();
					}
				});
			});

		this.renderSplitSubfoldersSetting(outputSection);

		this.createSetting(outputSection, 'Split Files Destination Folder', 'Vault-relative folder or absolute disk path (desktop only) for split files.')
			.addText((text) => {
				text.setValue(this.plugin.settings.splitOutputFolder);
				text.inputEl.style.width = '100%';
				text.onChange(async (val) => {
					this.plugin.settings.splitOutputFolder = val.trim();
					await this.plugin.saveSettings();
					this.updateSplitPreview();
				});
				new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
			});

		this.renderSplitPreview(outputSection);

		// SECTION: MARKDOWN PROCESSING
		const processingSection = getSection('processing');
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
		const htmlSection = getSection('html');
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
		this.decorateSettingRow(previewRow, 'HTML Live Preview', 'Live preview of theme, accent, typography, and reading width.');
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
		const advancedSection = getSection('advanced');
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

		this.filterSettings(sections, searchResults, noResults, this.searchQuery);
	}

	/** Description for the external-folder setting, including its current state. */
	private describeExternalFolder(): string {
		const folder = this.plugin.settings.externalOutputFolder.trim();
		if (!this.plugin.settings.useExternalOutputFolder) {
			return 'Absolute folder that receives exports while the option above is on. Leave both off to keep writing into the vault.';
		}
		if (!folder) {
			return '⚠ No folder selected yet — exports still go into the vault. Use “Choose folder…” or type an absolute path.';
		}
		if (!isAbsoluteOutputPath(folder)) {
			return '⚠ “' + folder + '” is not an absolute path — exports still go into the vault. Use C:\\Exports or /Users/you/Exports.';
		}
		return 'Every output path above is re-created inside ' + folder + '.';
	}

	private refreshExternalFolderDescription(setting: Setting): void {
		const invalid = this.plugin.settings.useExternalOutputFolder
			&& !isAbsoluteOutputPath(this.plugin.settings.externalOutputFolder);
		setting.setDesc(this.describeExternalFolder());
		setting.settingEl.toggleClass('ve-settings__invalid', invalid);
	}

	/** Opens the native folder picker and stores the selection. */
	private async pickExternalOutputFolder(): Promise<string | null> {
		const picked = await this.plugin.gateway.pickOutputFolder(this.plugin.settings.externalOutputFolder);
		if (!picked) {
			return null;
		}
		this.plugin.settings.externalOutputFolder = picked;
		await this.plugin.saveSettings();
		this.display();
		new Notice('External export folder: ' + picked);
		return picked;
	}

	private createSection(parent: HTMLElement, id: string, title: string): HTMLElement {
		const sectionId = 've-settings-section-' + id;
		const section = parent.createDiv({
			cls: 've-settings-section',
			attr: {
				'id': sectionId,
				'role': 'tabpanel',
				'aria-labelledby': 've-settings-tab-' + id,
				'data-section-id': id,
			},
		});
		section.createEl('h3', { text: title });
		return section;
	}

	private createSectionTab(tabBar: HTMLElement, definition: SettingsSectionDefinition): void {
		const tab = tabBar.createEl('button', {
			text: definition.title,
			cls: 've-settings__tab',
			attr: {
				'id': 've-settings-tab-' + definition.id,
				'type': 'button',
				'role': 'tab',
				'aria-controls': 've-settings-section-' + definition.id,
				'aria-selected': 'false',
				'data-section-id': definition.id,
			},
		});
		tab.addEventListener('click', () => this.activateSection(definition.id));
		tab.addEventListener('keydown', (event) => {
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
			event.preventDefault();
			const index = SETTINGS_SECTIONS.findIndex((section) => section.id === definition.id);
			const nextIndex = event.key === 'Home'
				? 0
				: event.key === 'End'
					? SETTINGS_SECTIONS.length - 1
					: (index + (event.key === 'ArrowRight' ? 1 : -1) + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
			const next = SETTINGS_SECTIONS[nextIndex];
			if (next) {
				this.activateSection(next.id);
				this.containerEl.querySelector<HTMLButtonElement>('#ve-settings-tab-' + next.id)?.focus();
			}
		});
	}

	private activateSection(sectionId: string): void {
		if (!SETTINGS_SECTIONS.some((section) => section.id === sectionId)) return;
		this.activeSectionId = sectionId;
		this.updateSectionVisibility();
	}

	private updateSectionVisibility(): void {
		const hasSearch = this.searchQuery.length > 0;
		for (const section of Array.from(this.containerEl.querySelectorAll<HTMLElement>('.ve-settings-section'))) {
			const hasVisibleSetting = Boolean(section.querySelector('.ve-settings-row:not([hidden])'));
			section.hidden = hasSearch ? !hasVisibleSetting : section.dataset.sectionId !== this.activeSectionId;
		}
		for (const tab of Array.from(this.containerEl.querySelectorAll<HTMLButtonElement>('.ve-settings__tab'))) {
			const selected = tab.dataset.sectionId === this.activeSectionId;
			tab.toggleClass('is-active', selected);
			tab.setAttribute('aria-selected', String(selected));
			tab.tabIndex = selected ? 0 : -1;
		}
	}

	private decorateSettingRow(row: HTMLElement, title: string, desc: string): void {
		const section = row.closest<HTMLElement>('.ve-settings-section');
		const sectionId = section?.dataset.sectionId ?? '';
		const sectionTitle = section?.querySelector('h3')?.textContent ?? '';
		const slug = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'setting';
		row.id = 've-setting-' + slug + '-' + (++this.settingRowIndex);
		row.dataset.settingTitle = title;
		row.dataset.settingDescription = desc;
		row.dataset.sectionId = sectionId;
		row.dataset.sectionTitle = sectionTitle;
	}

	private createSetting(containerEl: HTMLElement, title: string, desc: string): Setting {
		const row = containerEl.createDiv({ cls: 've-settings-row' });
		this.decorateSettingRow(row, title, desc);
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

	private filterSettings(sections: HTMLElement, searchResults: HTMLElement, noResults: HTMLElement, value: string): void {
		this.searchQuery = value.trim().toLocaleLowerCase();
		const query = this.searchQuery;
		const matchingRows: HTMLElement[] = [];
		for (const row of Array.from(sections.querySelectorAll<HTMLElement>('.ve-settings-row'))) {
			const searchableText = [
				row.dataset.settingTitle,
				row.dataset.settingDescription,
				row.textContent,
			].filter(Boolean).join(' ').toLocaleLowerCase();
			const matches = !query || searchableText.includes(query);
			row.hidden = !matches;
			if (matches && row.dataset.settingTitle) matchingRows.push(row);
		}

		this.renderSearchResults(searchResults, matchingRows, query);
		noResults.hidden = query.length === 0 || matchingRows.length > 0;
		this.updateSectionVisibility();
	}

	private renderSearchResults(containerEl: HTMLElement, rows: HTMLElement[], query: string): void {
		containerEl.empty();
		if (!query) {
			containerEl.hidden = true;
			return;
		}
		containerEl.hidden = rows.length === 0;
		if (rows.length === 0) return;

		containerEl.createDiv({
			cls: 've-settings__search-results-heading',
			text: rows.length === 1 ? '1 matching setting' : rows.length + ' matching settings',
		});
		const resultList = containerEl.createDiv({ cls: 've-settings__search-result-list' });
		for (const row of rows) {
			const result = resultList.createEl('button', {
				cls: 've-settings__search-result',
				attr: { type: 'button' },
			});
			result.createSpan({ cls: 've-settings__search-result-title', text: row.dataset.settingTitle ?? 'Setting' });
			result.createSpan({ cls: 've-settings__search-result-category', text: row.dataset.sectionTitle ?? '' });
			result.setAttribute('aria-label', 'Jump to ' + (row.dataset.settingTitle ?? 'setting'));
			result.addEventListener('click', () => this.focusSetting(row));
		}
	}

	private focusSetting(row: HTMLElement): void {
		const sectionId = row.dataset.sectionId;
		if (sectionId) this.activeSectionId = sectionId;
		this.searchQuery = '';
		const searchInput = this.containerEl.querySelector<HTMLInputElement>('.ve-settings__search input');
		if (searchInput) searchInput.value = '';
		for (const candidate of Array.from(this.containerEl.querySelectorAll<HTMLElement>('.ve-settings-row'))) {
			candidate.hidden = false;
		}
		const searchResults = this.containerEl.querySelector<HTMLElement>('.ve-settings__search-results');
		const noResults = this.containerEl.querySelector<HTMLElement>('.ve-settings__empty');
		if (searchResults && noResults) this.filterSettings(this.containerEl.querySelector<HTMLElement>('.ve-settings__sections')!, searchResults, noResults, '');
		this.updateSectionVisibility();
		if (typeof row.scrollIntoView === 'function') {
			row.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
		row.addClass('ve-settings-row--targeted');
		window.setTimeout(() => row.removeClass('ve-settings-row--targeted'), 1400);
		row.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true });
	}

	private renderSplitPresetsSetting(containerEl: HTMLElement): void {
		const title = 'Split Preset';
		const activePreset = detectSplitPreset(this.plugin.settings);
		const activeDef = SPLIT_PRESETS.find((preset) => preset.id === activePreset);
		const desc = activeDef
			? activeDef.description
			: 'Choose a ready-made split configuration for NotebookLM, subfolder trees, or individual Markdown files, or customize the options below.';
		const row = containerEl.createDiv({ cls: 've-settings-row ve-settings-row--list' });
		this.decorateSettingRow(row, title, desc);
		const setting = new Setting(row).setName(title).setDesc(desc);

		setting.addDropdown((drop) => {
			for (const preset of SPLIT_PRESETS) {
				drop.addOption(preset.id, preset.label);
			}
			drop.addOption('custom', 'Custom split configuration');
			drop.setValue(activePreset);
			drop.onChange(async (val) => {
				if (SPLIT_PRESETS.some((preset) => preset.id === val)) {
					applySplitPreset(this.plugin.settings, val as SplitPresetId);
					await this.plugin.saveSettings();
					this.display();
				}
			});
		});

		const pillsContainer = row.createDiv({ cls: 've-preset-pills' });
		pillsContainer.createSpan({ text: 'Quick presets:', cls: 've-quick-tags__label' });
		for (const preset of SPLIT_PRESETS) {
			const isActive = activePreset === preset.id;
			const btn = pillsContainer.createEl('button', {
				text: preset.shortLabel,
				cls: 've-preset-pill' + (isActive ? ' is-active' : ''),
				attr: {
					type: 'button',
					'aria-pressed': String(isActive),
					'data-preset-id': preset.id,
				},
			});
			btn.title = preset.description;
			btn.addEventListener('click', async () => {
				applySplitPreset(this.plugin.settings, preset.id);
				await this.plugin.saveSettings();
				this.display();
			});
		}
	}

	private renderSplitPreview(containerEl: HTMLElement): void {
		const row = containerEl.createDiv({ cls: 've-settings-row ve-settings-row--preview' });
		this.decorateSettingRow(row, 'Split Output Preview', 'Live preview of the file paths produced by your current split settings.');
		row.createDiv({ cls: 've-html-preview__label', text: 'Live preview · split output file paths' });
		const preview = row.createDiv({
			cls: 've-split-preview',
			attr: { 'aria-label': 'Preview of split output file paths' },
		});
		this.populateSplitPreview(preview);
	}

	private updateSplitPreview(): void {
		const preview = this.containerEl.querySelector<HTMLElement>('.ve-split-preview');
		if (!preview) return;
		this.populateSplitPreview(preview);
	}

	private populateSplitPreview(preview: HTMLElement): void {
		preview.empty();
		const activePreset = detectSplitPreset(this.plugin.settings);
		const presetDef = SPLIT_PRESETS.find((preset) => preset.id === activePreset);
		const header = preview.createDiv({ cls: 've-split-preview__header' });
		header.createSpan({
			cls: 've-split-preview__badge',
			text: presetDef ? 'Preset: ' + presetDef.shortLabel : 'Custom configuration',
		});
		const samplePaths = previewSplitFiles(this.plugin.settings, this.plugin.gateway.getAllFolders());
		const list = preview.createDiv({ cls: 've-split-preview__list' });
		for (const samplePath of samplePaths) {
			list.createEl('code', { cls: 've-split-preview__item', text: samplePath });
		}
	}

	private renderSplitSubfoldersSetting(containerEl: HTMLElement): void {
		const title = 'Split Subfolders';
		const desc = 'Folder-grouped mode: subfolders that also create one .txt file per subfolder. Click an item’s depth button to override 1-level (/*) vs recursive (/**) for that folder.';
		const items = this.plugin.settings.splitSubfolders;
		const row = containerEl.createDiv({ cls: 've-settings-row ve-settings-row--list' });
		this.decorateSettingRow(row, title, desc);
		const setting = new Setting(row).setName(title).setDesc(desc);
		const listDiv = row.createDiv({ cls: 've-list-setting' });

		items.forEach((item, index) => {
			const itemRow = listDiv.createDiv({ cls: 've-list-item' });
			itemRow.createSpan({ text: item, cls: 've-list-item__text' });

			const actions = itemRow.createDiv({ cls: 've-list-item__actions' });
			const isExplicitRecursive = item.endsWith('/**') || item === '**';
			const isExplicitDirect = !isExplicitRecursive && (item.endsWith('/*') || item === '*');
			const defaultIsRecursive =
				this.plugin.settings.splitSubfolderDepth === 'recursive' ||
				this.plugin.settings.splitSubfolderDepth === 'all-recursive';
			const modeLabel = isExplicitRecursive
				? 'Recursive (/**)'
				: isExplicitDirect
					? '1 level (/*)'
					: defaultIsRecursive
						? 'Default (recursive)'
						: 'Default (1 level)';

			const modeBtn = actions.createEl('button', {
				text: modeLabel,
				cls: 've-list-item__mode',
				attr: { type: 'button' },
			});
			modeBtn.title = 'Cycle subfolder split depth (Default → 1 level → Recursive)';
			modeBtn.setAttribute('aria-label', 'Cycle depth mode for ' + item);
			modeBtn.addEventListener('click', async () => {
				const base = item.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
				const nextItem = isExplicitRecursive
					? base
					: isExplicitDirect
						? (base ? base + '/**' : '/**')
						: (base ? base + '/*' : '/*');
				const updated = items.map((existing, i) => (i === index ? nextItem : existing));
				this.plugin.settings.splitSubfolders = [...new Set(updated.filter(Boolean))];
				await this.plugin.saveSettings();
				this.display();
			});

			const delBtn = actions.createEl('button', {
				text: '✕',
				cls: 've-list-item__del',
				attr: { type: 'button' },
			});
			delBtn.title = 'Remove';
			delBtn.setAttribute('aria-label', 'Remove ' + item);
			delBtn.addEventListener('click', async () => {
				this.plugin.settings.splitSubfolders = items.filter((_, i) => i !== index);
				await this.plugin.saveSettings();
				this.display();
			});
		});

		// Quick-add folder suggestions (prioritizing folders that contain subfolders)
		const allFolders = this.plugin.gateway
			.getAllFolders()
			.filter((folder) => isCandidateSplitFolder(folder, this.plugin.settings));
		const normalizedItems = new Set(
			items.map((item) => item.replace(/\/\*\*$/, '').replace(/\/\*$/, '').toLowerCase())
		);
		const foldersWithChildren = allFolders.filter((folder) =>
			allFolders.some((other) => other.toLowerCase().startsWith(folder.toLowerCase() + '/'))
		);
		const suggestedFolders = [
			...foldersWithChildren,
			...allFolders.filter((folder) => !foldersWithChildren.includes(folder)),
		].filter((folder) => !normalizedItems.has(folder.toLowerCase()));

		if (suggestedFolders.length > 0 || items.length > 0) {
			const quickRow = row.createDiv({ cls: 've-quick-tags' });
			if (suggestedFolders.length > 0) {
				quickRow.createSpan({ text: 'Quick add folder:', cls: 've-quick-tags__label' });
				const unaddedParentFolders = foldersWithChildren.filter(
					(folder) => !normalizedItems.has(folder.toLowerCase())
				);
				if (unaddedParentFolders.length > 1) {
					const addAllParentsBtn = quickRow.createEl('button', {
						text: '+ All parent folders (' + unaddedParentFolders.length + ')',
						cls: 've-subfolder-pill ve-subfolder-pill--all',
						attr: { type: 'button' },
					});
					addAllParentsBtn.title = 'Add every folder that contains subfolders';
					addAllParentsBtn.addEventListener('click', async () => {
						this.plugin.settings.splitSubfolders = [...new Set([...items, ...unaddedParentFolders])];
						await this.plugin.saveSettings();
						this.display();
					});
				}
				suggestedFolders.slice(0, 10).forEach((folder) => {
					const pill = quickRow.createEl('button', {
						text: '+ ' + folder,
						cls: 've-subfolder-pill',
						attr: { type: 'button' },
					});
					pill.title = 'Split subfolders inside ' + folder;
					pill.addEventListener('click', async () => {
						this.plugin.settings.splitSubfolders = [...items, folder];
						await this.plugin.saveSettings();
						this.display();
					});
				});
			}
			if (items.length > 0) {
				const clearBtn = quickRow.createEl('button', {
					text: 'Clear list',
					cls: 've-subfolder-clear',
					attr: { type: 'button' },
				});
				clearBtn.title = 'Remove all selected subfolders from the list';
				clearBtn.addEventListener('click', async () => {
					this.plugin.settings.splitSubfolders = [];
					await this.plugin.saveSettings();
					this.display();
				});
			}
		}

		let newText = '';
		const addFolder = async (): Promise<void> => {
			const cleaned = newText.trim().replace(/\\/g, '/').replace(/\/+(?!\*)/g, '/').replace(/\/+$/, '');
			if (cleaned && !items.includes(cleaned)) {
				this.plugin.settings.splitSubfolders = [...items, cleaned];
				await this.plugin.saveSettings();
				this.display();
			}
		};

		setting.addText((text) => {
			text.setPlaceholder('Add or search subfolder...');
			text.inputEl.setAttribute('aria-label', 'Add to ' + title);
			text.onChange((value) => {
				newText = value.trim();
			});
			text.inputEl.addEventListener('keydown', async (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					await addFolder();
				}
			});
			new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
		});

		setting.addButton((button) => {
			button.setButtonText('Add');
			button.setCta();
			button.onClick(async () => {
				await addFolder();
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
		const row = containerEl.createDiv({ cls: 've-settings-row ve-settings-row--list' });
		this.decorateSettingRow(row, title, desc);
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
