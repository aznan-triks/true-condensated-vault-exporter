/**
 * Settings Tab for Vault Exporter.
 * Tabbed and searchable settings with status badges, changed-from-default
 * tracking & per-setting reset, custom export extensions, live HTML & Split
 * previews, and an interactive Changelog & Version History viewer.
 */

import { App, Notice, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import type VaultExporterPlugin from '../main';
import {
	DEFAULT_SETTINGS,
	ExporterSettings,
	PROGRESS_PANEL_AUTO_CLOSE_OPTIONS,
	SplitPresetId,
} from '../core/types';
import {
	COMMON_EXPORT_EXTENSIONS,
	effectiveSplitExtension,
	normalizeExtension,
	replaceFileExtension,
} from '../core/extension';
import {
	isAbsoluteOutputPath,
	resolveConsolidatedExtensionPaths,
	usesExternalOutputFolder,
} from '../core/outputTarget';
import { sameSettingValue, setSettingAt, settingAt } from '../core/settingValue';
import {
	KNOWN_CHANGELOG_CATEGORIES,
	buildChangelogVersionCard,
	filterAndGroupChangelog,
	parseRawChangelogMarkdown,
	type ChangelogViewMode,
	type RawChangelogItem,
} from '../core/changelog';
import { BUNDLED_CHANGELOG } from '../core/bundledChangelog';
import {
	SPLIT_PRESETS,
	applySplitPreset,
	detectSplitPreset,
	isCandidateSplitFolder,
	previewSplitFiles,
} from '../features/exportSplit';
import { VaultPathSuggest } from '../ui/VaultPathSuggest';

const CHANGELOG_RAW_URL = 'https://raw.githubusercontent.com/aznan-triks/true-condensated-vault-exporter/main/CHANGELOG.md';
const CHANGELOG_REPO_URL = 'https://github.com/aznan-triks/true-condensated-vault-exporter/blob/main/CHANGELOG.md';

type SettingsSectionId =
	| 'general'
	| 'feedback'
	| 'scope'
	| 'destination'
	| 'output'
	| 'processing'
	| 'html'
	| 'advanced'
	| 'changelog';

interface SettingsSectionDefinition {
	id: SettingsSectionId;
	title: string;
	intro?: string;
}

const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
	{
		id: 'general',
		title: 'General',
		intro: 'Choose the title written at the top of consolidated documents and whether the sidebar remembers your last selected targets.',
	},
	{
		id: 'feedback',
		title: 'Export Feedback & Behavior',
		intro: 'Control what happens right after an export completes: progress panel visibility and automatic folder reveal.',
	},
	{
		id: 'scope',
		title: 'Scope & Exclusions',
		intro: 'Choose which part of the vault is exported and which folders, files, or prefixes are always left untouched.',
	},
	{
		id: 'destination',
		title: 'External Output Folder',
		intro: 'Redirect every exported file into an OS folder outside the vault while keeping relative subfolders intact.',
	},
	{
		id: 'output',
		title: 'Output Paths & Split Options',
		intro: 'Customize file extensions across exports, configure consolidated output paths, and fine-tune how split exports group and name files.',
	},
	{
		id: 'processing',
		title: 'Markdown Processing',
		intro: 'Configure how Canvas boards, YAML frontmatter, Dataview queries, and wikilinks are transformed during cleaning.',
	},
	{
		id: 'html',
		title: 'HTML Personalization',
		intro: 'Customize the standalone HTML export palette, typography, reading width, navigation, and metadata with a live preview.',
	},
	{
		id: 'advanced',
		title: 'Advanced',
		intro: 'Inject custom CSS rules into standalone HTML exports and tune UI yield frequency for large vaults.',
	},
	{
		id: 'changelog',
		title: 'Changelog',
	},
];

const TRACKED_SETTING_KEYS: readonly (keyof ExporterSettings)[] = [
	'documentTitle',
	'rememberTargetSelection',
	'autoRevealOutput',
	'progressPanelAutoCloseSeconds',
	'scopeRoot',
	'scopeTag',
	'excludedFolders',
	'excludedFiles',
	'excludedPrefixes',
	'useExternalOutputFolder',
	'externalOutputFolder',
	'outputExtension',
	'notebooklmOutputPath',
	'htmlOutputPath',
	'markdownOutputPath',
	'zipOutputPath',
	'splitMode',
	'splitFileExtension',
	'splitGroupFolder',
	'splitSubfolderNaming' as never,
].filter((k): k is keyof ExporterSettings => k in DEFAULT_SETTINGS);

const RESETTABLE_KEYS: readonly (keyof ExporterSettings)[] = [
	'documentTitle',
	'rememberTargetSelection',
	'useExternalOutputFolder',
	'externalOutputFolder',
	'progressPanelAutoCloseSeconds',
	'autoRevealOutput',
	'scopeRoot',
	'excludedFolders',
	'excludedFiles',
	'excludedPrefixes',
	'scopeTag',
	'outputExtension',
	'notebooklmOutputPath',
	'htmlOutputPath',
	'markdownOutputPath',
	'zipOutputPath',
	'splitMode',
	'splitFileExtension',
	'splitGroupFolder',
	'splitSubfolders',
	'splitSubfolderDepth',
	'splitSubfolderStyle',
	'splitOutputFolder',
	'stripFrontmatter',
	'renderDataview',
	'wikilinkFormat',
	'ignoredProperties',
	'includeCanvas',
	'customCss',
	'htmlTheme',
	'htmlAccentColor',
	'htmlFont',
	'htmlContentWidth',
	'htmlShowToc',
	'htmlShowSearch',
	'htmlShowPaths',
	'htmlShowMetadata',
	'htmlShowFooter',
	'htmlFooterText',
	'yieldEvery',
];

export class VaultExporterSettingsTab extends PluginSettingTab {
	private saveTimer: number | null = null;
	private activeSectionId: SettingsSectionId = SETTINGS_SECTIONS[0]?.id ?? 'general';
	private searchQuery = '';
	private onlyChanged = false;
	private settingRowIndex = 0;

	private headerBadgesEl: HTMLElement | null = null;
	private summaryEl: HTMLElement | null = null;
	private sectionsEl: HTMLElement | null = null;
	private searchResultsEl: HTMLElement | null = null;
	private noResultsEl: HTMLElement | null = null;
	private extPreviewEl: HTMLElement | null = null;

	// Changelog viewer state
	private changelogRawMarkdown: string = BUNDLED_CHANGELOG;
	private changelogLoading = false;
	private changelogFetchedAt: Date | null = null;
	private clSearchQuery = '';
	private clSortOrder: 'desc' | 'asc' = 'desc';
	private clViewMode: ChangelogViewMode = 'all';
	private clActiveCats = new Set<string>(KNOWN_CHANGELOG_CATEGORIES);
	private clVersionFrom = 'all';
	private clVersionTo = 'all';
	private clContentContainer: HTMLElement | null = null;
	private clCounterEl: HTMLElement | null = null;
	private clTimeEl: HTMLElement | null = null;
	private clVersionFromSelect: HTMLSelectElement | null = null;
	private clVersionToSelect: HTMLSelectElement | null = null;

	constructor(app: App, private readonly plugin: VaultExporterPlugin) {
		super(app, plugin);
		void TRACKED_SETTING_KEYS;
	}

	private saveNow(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		return this.plugin.saveSettings();
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => this.flushPendingSave(), 300);
	}

	/** Best-effort flush for tab close/plugin unload; live settings already changed. */
	flushPendingSave(): void {
		if (this.saveTimer === null) return;
		void this.saveNow().catch((error: unknown) => {
			console.error('[vault-exporter] Could not save settings:', error);
			new Notice('Could not save Vault Exporter settings. Your edits remain in memory; try saving again.');
		});
	}

	override hide(): void {
		this.flushPendingSave();
	}

	override display(): void {
		const { containerEl } = this;
		const scrollTop = containerEl.scrollTop;
		containerEl.empty();
		this.settingRowIndex = 0;
		containerEl.addClass('ve-settings');

		this.renderHeader(containerEl);

		const searchWrap = containerEl.createDiv({ cls: 've-settings__search-wrap' });
		const search = new Setting(searchWrap)
			.setName('Find a setting')
			.setDesc('Search every category by name or description. Click a result to jump to it. Press Escape to clear.')
			.setClass('ve-settings__search');

		this.renderSummaryBar(containerEl);

		const searchResults = containerEl.createDiv({ cls: 've-settings__search-results' });
		searchResults.setAttribute('aria-live', 'polite');
		searchResults.hidden = true;
		this.searchResultsEl = searchResults;

		const tabBar = containerEl.createDiv({
			cls: 've-settings__tabs',
			attr: { role: 'tablist', 'aria-label': 'Settings categories' },
		});
		const sections = containerEl.createDiv({ cls: 've-settings__sections' });
		this.sectionsEl = sections;

		const noResults = sections.createDiv({ cls: 've-settings__empty', text: 'No settings match your current filter.' });
		noResults.hidden = true;
		this.noResultsEl = noResults;

		search.addText((text) => {
			text.setValue(this.searchQuery);
			text.setPlaceholder('Try “extension”, “folder”, or “frontmatter”…');
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

		const sectionElements = new Map<SettingsSectionId, HTMLElement>();
		for (const sectionDefinition of SETTINGS_SECTIONS) {
			const section = this.createSection(sections, sectionDefinition);
			sectionElements.set(sectionDefinition.id, section);
			this.createSectionTab(tabBar, sectionDefinition);
		}

		const getSection = (id: SettingsSectionId): HTMLElement => sectionElements.get(id)!;

		// SECTION 1: GENERAL
		const generalSection = getSection('general');
		const docTitle = this.createSetting(generalSection, 'Document Title', 'Title written at the top of consolidated exports.');
		docTitle.setting.addText((text) => {
			text.setValue(this.plugin.settings.documentTitle);
			text.onChange((val) => {
				this.plugin.settings.documentTitle = val.trim();
				this.scheduleSave();
			});
		});
		this.track(docTitle.row, docTitle.setting, 'documentTitle');

		this.renderToggleSetting(
			generalSection,
			'Remember Sidebar Targets',
			'Restore the last selected export targets when you reopen Vault Exporter.',
			'rememberTargetSelection'
		);

		// SECTION 2: EXPORT FEEDBACK & BEHAVIOR
		const behaviorSection = getSection('feedback');
		this.renderToggleSetting(
			behaviorSection,
			'Reveal Output After Success',
			'Automatically reveal the first exported file in the desktop file manager when an export succeeds.',
			'autoRevealOutput'
		);
		const autoClose = this.createSetting(
			behaviorSection,
			'Progress Panel Auto-Close',
			'Choose how long the panel stays visible after a successful export. Cancelled and failed panels remain visible for review. Select Never to keep successful results until closed.'
		);
		autoClose.setting.addDropdown((drop) => {
			for (const seconds of PROGRESS_PANEL_AUTO_CLOSE_OPTIONS) {
				drop.addOption(String(seconds), seconds === 0 ? 'Never (keep open)' : seconds + ' seconds');
			}
			drop.setValue(String(this.plugin.settings.progressPanelAutoCloseSeconds));
			drop.onChange(async (value) => {
				const seconds = Number(value);
				if (PROGRESS_PANEL_AUTO_CLOSE_OPTIONS.some((option) => option === seconds)) {
					this.plugin.settings.progressPanelAutoCloseSeconds = seconds;
					await this.saveNow();
					this.refreshLiveIndicators();
				}
			});
		});
		this.track(autoClose.row, autoClose.setting, 'progressPanelAutoCloseSeconds');

		// SECTION 3: SCOPE & EXCLUSIONS
		const scopeSection = getSection('scope');
		const scopeRoot = this.createSetting(scopeSection, 'Scope Root', 'Vault-relative root folder to scan. Leave empty to scan the entire vault.');
		scopeRoot.setting.addText((text) => {
			text.setValue(this.plugin.settings.scopeRoot);
			text.setPlaceholder('e.g. Notes or leave blank');
			text.onChange((val) => {
				this.plugin.settings.scopeRoot = val.trim();
				this.scheduleSave();
				this.updateHeaderBadges();
			});
			new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
		});
		this.track(scopeRoot.row, scopeRoot.setting, 'scopeRoot');

		const scopeTag = this.createSetting(scopeSection, 'Scope Tag', 'When set, only notes carrying this tag (body or frontmatter) are exported. Canvas files are excluded while a tag is active.');
		scopeTag.setting.addText((text) => {
			text.setValue(this.plugin.settings.scopeTag);
			text.setPlaceholder('e.g. #research or research');
			text.onChange((val) => {
				this.plugin.settings.scopeTag = val.trim();
				this.scheduleSave();
				this.updateHeaderBadges();
			});
		});
		this.track(scopeTag.row, scopeTag.setting, 'scopeTag');

		this.renderStringListSetting(
			scopeSection,
			'Excluded Folders',
			'Folders completely excluded from exports (with interactive autocomplete).',
			this.plugin.settings.excludedFolders,
			'excludedFolders',
			() => this.plugin.gateway.getAllFolders(),
			async (newList) => {
				this.plugin.settings.excludedFolders = newList;
				await this.saveNow();
			}
		);

		this.renderStringListSetting(
			scopeSection,
			'Excluded Files',
			'Exact filenames or paths to exclude (with interactive autocomplete).',
			this.plugin.settings.excludedFiles,
			'excludedFiles',
			() => this.plugin.gateway.getAllFiles(),
			async (newList) => {
				this.plugin.settings.excludedFiles = newList;
				await this.saveNow();
			}
		);

		this.renderStringListSetting(
			scopeSection,
			'Excluded Folder Prefixes',
			'Prefixes that trigger exclusion on any subfolder (e.g. 00_).',
			this.plugin.settings.excludedPrefixes,
			'excludedPrefixes',
			undefined,
			async (newList) => {
				this.plugin.settings.excludedPrefixes = newList;
				await this.saveNow();
			}
		);

		// SECTION 4: EXTERNAL OUTPUT FOLDER
		const destinationSection = getSection('destination');
		const extToggle = this.createSetting(
			destinationSection,
			'Export to an External Folder',
			'Write every output into a folder outside the vault instead of writing the configured output paths inside it. Relative paths keep their subfolders; absolute paths keep only their file or folder name. Requires an absolute folder path, for example C:\\Exports or /Users/you/Exports.'
		);
		extToggle.setting.addToggle((toggle) => {
			toggle.setValue(this.plugin.settings.useExternalOutputFolder);
			toggle.onChange(async (value) => {
				this.plugin.settings.useExternalOutputFolder = value;
				await this.saveNow();
				if (value && !isAbsoluteOutputPath(this.plugin.settings.externalOutputFolder)) {
					const picked = await this.pickExternalOutputFolder();
					if (!picked) {
						new Notice('No external folder selected — exports keep going into the vault.');
					}
				}
				this.refreshExternalFolderDescription(externalFolder.setting);
				this.updateHeaderBadges();
			});
		});
		this.track(extToggle.row, extToggle.setting, 'useExternalOutputFolder');

		const externalFolder = this.createSetting(
			destinationSection,
			'External Folder',
			this.describeExternalFolder()
		);
		externalFolder.setting.addText((text) => {
			text.setValue(this.plugin.settings.externalOutputFolder);
			text.setPlaceholder('C:\\Exports or /Users/you/Exports');
			text.inputEl.style.width = '100%';
			text.onChange((value) => {
				this.plugin.settings.externalOutputFolder = value.trim();
				this.scheduleSave();
				this.refreshExternalFolderDescription(externalFolder.setting);
				this.updateHeaderBadges();
			});
		});
		externalFolder.setting.addButton((button) => {
			button.setButtonText('Choose folder…');
			button.setTooltip('Open the system folder picker');
			button.onClick(async () => {
				await this.pickExternalOutputFolder();
			});
		});
		externalFolder.setting.addExtraButton((button) => {
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
		this.track(externalFolder.row, externalFolder.setting, 'externalOutputFolder');
		this.refreshExternalFolderDescription(externalFolder.setting);

		// SECTION 5: OUTPUT PATHS & SPLIT MODE
		const outputSection = getSection('output');
		new Setting(outputSection).setName('Custom File Extensions & Consolidated Outputs').setHeading();
		this.renderGlobalExtensionSetting(outputSection);

		this.renderConsolidatedPathSetting(
			outputSection,
			'NotebookLM Consolidated Output',
			'Vault-relative path, or an absolute file path on desktop, for the NotebookLM text file.',
			'notebooklmOutputPath'
		);
		this.renderConsolidatedPathSetting(
			outputSection,
			'HTML Consolidated Output',
			'Vault-relative path, or an absolute file path on desktop, for the HTML document.',
			'htmlOutputPath'
		);
		this.renderConsolidatedPathSetting(
			outputSection,
			'Markdown Consolidated Output',
			'Vault-relative path, or an absolute file path on desktop, for the consolidated Markdown document.',
			'markdownOutputPath'
		);

		const zipOut = this.createSetting(outputSection, 'ZIP Bundle Output', 'Where the ZIP bundle (all consolidated formats + split files) is written. Vault-relative or absolute path.');
		zipOut.setting.addText((text) => {
			text.setValue(this.plugin.settings.zipOutputPath);
			text.onChange((val) => {
				this.plugin.settings.zipOutputPath = val.trim();
				this.scheduleSave();
			});
			new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFiles());
		});
		this.track(zipOut.row, zipOut.setting, 'zipOutputPath');

		new Setting(outputSection).setName('Split Exports').setHeading();
		this.renderSplitPresetsSetting(outputSection);

		const splitModeSetting = this.createSetting(outputSection, 'Split Export Mode', 'Choose one text file per folder group, or one cleaned Markdown file for each note.');
		splitModeSetting.setting.addDropdown((drop) => {
			drop.addOption('folder-grouped', 'Folder-grouped (1 file per folder group)');
			drop.addOption('individual-files', 'Individual notes (1-to-1 per note)');
			drop.setValue(this.plugin.settings.splitMode);
			drop.onChange(async (val) => {
				if (val === 'folder-grouped' || val === 'individual-files') {
					this.plugin.settings.splitMode = val;
					await this.saveNow();
					this.display();
				}
			});
		});
		this.track(splitModeSetting.row, splitModeSetting.setting, 'splitMode');

		this.renderSplitExtensionSetting(outputSection);

		const folderGroupedGroup = this.group(outputSection, this.plugin.settings.splitMode === 'folder-grouped');

		const splitGroup = this.createSetting(folderGroupedGroup, 'Split Group Folder', 'Folder-grouped mode: each direct subfolder of this folder becomes one file. Empty = scope root.');
		splitGroup.setting.addText((text) => {
			text.setValue(this.plugin.settings.splitGroupFolder);
			text.onChange((val) => {
				this.plugin.settings.splitGroupFolder = val.trim();
				this.scheduleSave();
				this.updateSplitPreview();
			});
			new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
		});
		this.track(splitGroup.row, splitGroup.setting, 'splitGroupFolder');

		const splitNaming = this.createSetting(
			folderGroupedGroup,
			'Split Subfolder Naming',
			'Folder-grouped mode: choose how subfolder split files are named and organized inside the split destination folder.'
		);
		splitNaming.setting.addDropdown((drop) => {
			drop.addOption('flat-prefixed', 'Flat with parent prefix — Parent - Subfolder.txt (recommended for NotebookLM)');
			drop.addOption('flat-leaf', 'Flat with subfolder name only — Subfolder.txt (auto-disambiguates on collision)');
			drop.addOption('flat-underscored', 'Flat with underscore path — Parent_Subfolder.txt');
			drop.addOption('nested', 'Mirrored subfolder tree — Parent/Subfolder.txt');
			drop.setValue(this.plugin.settings.splitSubfolderStyle);
			drop.onChange(async (val) => {
				if (val === 'flat-prefixed' || val === 'flat-leaf' || val === 'flat-underscored' || val === 'nested') {
					this.plugin.settings.splitSubfolderStyle = val;
					await this.saveNow();
					this.display();
				}
			});
		});
		this.track(splitNaming.row, splitNaming.setting, 'splitSubfolderStyle');

		const splitDepth = this.createSetting(
			folderGroupedGroup,
			'Split Subfolder Depth',
			'Folder-grouped mode: choose whether subfolder splitting applies to selected folders (1 level or recursive) or automatically across the entire scope.'
		);
		splitDepth.setting.addDropdown((drop) => {
			drop.addOption('direct', 'Selected folders — direct subfolders (1 level per selected folder)');
			drop.addOption('recursive', 'Selected folders — all nested subfolders (recursive)');
			drop.addOption('all-two-levels', 'Entire scope — main folders & direct subfolders (2 levels everywhere)');
			drop.addOption('all-recursive', 'Entire scope — every folder & nested subfolder recursively');
			drop.setValue(this.plugin.settings.splitSubfolderDepth);
			drop.onChange(async (val) => {
				if (val === 'direct' || val === 'recursive' || val === 'all-two-levels' || val === 'all-recursive') {
					this.plugin.settings.splitSubfolderDepth = val;
					await this.saveNow();
					this.display();
				}
			});
		});
		this.track(splitDepth.row, splitDepth.setting, 'splitSubfolderDepth');

		this.renderSplitSubfoldersSetting(folderGroupedGroup);
		this.groupHint(outputSection, folderGroupedGroup, 'when Folder-grouped split mode is selected');

		const splitDest = this.createSetting(outputSection, 'Split Files Destination Folder', 'Vault-relative folder or absolute disk path (desktop only) for split files.');
		splitDest.setting.addText((text) => {
			text.setValue(this.plugin.settings.splitOutputFolder);
			text.inputEl.style.width = '100%';
			text.onChange((val) => {
				this.plugin.settings.splitOutputFolder = val.trim();
				this.scheduleSave();
				this.updateSplitPreview();
			});
			new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFolders());
		});
		this.track(splitDest.row, splitDest.setting, 'splitOutputFolder');

		this.renderSplitPreview(outputSection);

		// SECTION 6: MARKDOWN PROCESSING
		const processingSection = getSection('processing');
		this.renderToggleSetting(
			processingSection,
			'Include Obsidian .canvas Files',
			'Extract text nodes and note links from .canvas files into clean text (visual reading order, groups as sections).',
			'includeCanvas'
		);
		this.renderToggleSetting(
			processingSection,
			'Strip Frontmatter',
			'Remove YAML frontmatter block from exported document bodies.',
			'stripFrontmatter'
		);
		this.renderToggleSetting(
			processingSection,
			'Render In-Memory Dataview Queries',
			'Evaluate ```dataview blocks into static markdown tables during export. Supports and/or, comparisons (=, !=, >, <, >=, <=), in (…), like "wild*card", contains/startswith/endswith.',
			'renderDataview'
		);

		const wikilink = this.createSetting(processingSection, 'Wikilink Handling', 'Format for converting [[wikilinks]]. Canonical-alias shows the note title and alias as Title (Alias). Markdown links resolve to real vault paths.');
		wikilink.setting.addDropdown((drop) => {
			drop.addOption('canonical-alias', 'Note title and alias: Title (Alias)');
			drop.addOption('clean-text', 'Clean text (Display alias or note title)');
			drop.addOption('keep-wikilink', 'Keep raw [[wikilinks]]');
			drop.addOption('markdown', 'Standard [Markdown](links) — resolved to real paths');
			drop.setValue(this.plugin.settings.wikilinkFormat);
			drop.onChange(async (val) => {
				if (val === 'canonical-alias' || val === 'clean-text' || val === 'keep-wikilink' || val === 'markdown') {
					this.plugin.settings.wikilinkFormat = val;
					await this.saveNow();
					this.refreshLiveIndicators();
				}
			});
		});
		this.track(wikilink.row, wikilink.setting, 'wikilinkFormat');

		this.renderStringListSetting(
			processingSection,
			'Ignored Frontmatter Properties',
			'YAML properties omitted from consolidated export metadata, including category, order, status and tags. Individual split files keep the original frontmatter unless Strip Frontmatter is enabled. Autocomplete detects properties in your vault notes.',
			this.plugin.settings.ignoredProperties,
			'ignoredProperties',
			() => this.plugin.gateway.getAllFrontmatterKeys(),
			async (newList) => {
				this.plugin.settings.ignoredProperties = newList;
				await this.saveNow();
			},
			true
		);

		// SECTION 7: HTML PERSONALIZATION
		const htmlSection = getSection('html');
		const htmlTheme = this.createSetting(htmlSection, 'HTML Color Theme', 'Choose whether the standalone HTML export follows the viewer or always uses a light or dark palette.');
		htmlTheme.setting.addDropdown((drop) => {
			drop.addOption('system', 'Follow system preference');
			drop.addOption('light', 'Light');
			drop.addOption('dark', 'Dark');
			drop.setValue(this.plugin.settings.htmlTheme);
			drop.onChange(async (val) => {
				if (val === 'system' || val === 'light' || val === 'dark') {
					this.plugin.settings.htmlTheme = val;
					this.updateHtmlPreview();
					await this.saveNow();
					this.refreshLiveIndicators();
				}
			});
		});
		this.track(htmlTheme.row, htmlTheme.setting, 'htmlTheme');

		const htmlAccent = this.createSetting(htmlSection, 'HTML Accent Color', 'Personalize links, callouts, and focused controls. Custom CSS can still override --ve-accent.');
		htmlAccent.setting.addColorPicker((picker) => {
			picker.setValue(this.plugin.settings.htmlAccentColor);
			picker.onChange(async (value) => {
				if (/^#[0-9a-f]{6}$/i.test(value)) {
					this.plugin.settings.htmlAccentColor = value.toLowerCase();
					this.updateHtmlPreview();
					await this.saveNow();
					this.refreshLiveIndicators();
				}
			});
		});
		this.track(htmlAccent.row, htmlAccent.setting, 'htmlAccentColor');

		const htmlFont = this.createSetting(htmlSection, 'HTML Typography', 'Choose a comfortable system sans-serif, book-style serif, or monospace look for the exported document.');
		htmlFont.setting.addDropdown((drop) => {
			drop.addOption('system', 'System sans-serif');
			drop.addOption('serif', 'Serif');
			drop.addOption('monospace', 'Monospace');
			drop.setValue(this.plugin.settings.htmlFont);
			drop.onChange(async (val) => {
				if (val === 'system' || val === 'serif' || val === 'monospace') {
					this.plugin.settings.htmlFont = val;
					this.updateHtmlPreview();
					await this.saveNow();
					this.refreshLiveIndicators();
				}
			});
		});
		this.track(htmlFont.row, htmlFont.setting, 'htmlFont');

		const widthDescription = 'Maximum reading width for the document column. Current: ';
		const widthEntry = this.createSetting(htmlSection, 'HTML Reading Width', widthDescription + this.plugin.settings.htmlContentWidth + ' px.');
		widthEntry.setting.addSlider((slider) => {
			slider.setLimits(680, 1400, 20);
			slider.setValue(this.plugin.settings.htmlContentWidth);
			slider.setDynamicTooltip();
			slider.sliderEl.setAttribute('aria-label', 'HTML reading width');
			slider.onChange(async (value) => {
				const width = Math.round(Math.min(1400, Math.max(680, value)) / 20) * 20;
				this.plugin.settings.htmlContentWidth = width;
				widthEntry.setting.descEl.firstChild && (widthEntry.setting.descEl.firstChild.nodeValue = widthDescription + width + ' px.');
				this.updateHtmlPreview();
				await this.saveNow();
				this.refreshLiveIndicators();
			});
		});
		this.track(widthEntry.row, widthEntry.setting, 'htmlContentWidth');

		this.renderToggleSetting(htmlSection, 'HTML Table of Contents', 'Include a searchable navigation panel linking to each note and its headings.', 'htmlShowToc', true);
		const tocGroup = this.group(htmlSection, this.plugin.settings.htmlShowToc);
		this.renderToggleSetting(tocGroup, 'HTML Document Search', 'Show the document filter in the table of contents.', 'htmlShowSearch');
		this.groupHint(htmlSection, tocGroup, 'when HTML Table of Contents is enabled');

		this.renderToggleSetting(htmlSection, 'HTML Source Paths', 'Show each note’s vault path in the navigation and document header.', 'htmlShowPaths');
		this.renderToggleSetting(htmlSection, 'HTML Frontmatter Metadata', 'Show included frontmatter values as badges beneath each note title.', 'htmlShowMetadata');

		this.renderToggleSetting(htmlSection, 'HTML Export Footer', 'Show the export time, document count, and optional attribution at the bottom.', 'htmlShowFooter', true);
		const footerGroup = this.group(htmlSection, this.plugin.settings.htmlShowFooter);
		const footerAttr = this.createSetting(footerGroup, 'HTML Footer Attribution', 'Optional name or short note shown in the HTML footer. Leave blank for no attribution.');
		footerAttr.setting.addText((text) => {
			text.setValue(this.plugin.settings.htmlFooterText);
			text.setPlaceholder('e.g. Research team');
			text.onChange((value) => {
				this.plugin.settings.htmlFooterText = value.slice(0, 200);
				this.scheduleSave();
			});
		});
		this.track(footerAttr.row, footerAttr.setting, 'htmlFooterText');
		this.groupHint(htmlSection, footerGroup, 'when HTML Export Footer is enabled');

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

		// SECTION 8: ADVANCED
		const advancedSection = getSection('advanced');
		const cssEntry = this.createSetting(advancedSection, 'Custom HTML CSS', 'Extra CSS appended to the HTML export. Use to override the built-in theme (custom properties: --ve-bg, --ve-panel, --ve-text, --ve-accent…).');
		cssEntry.setting.addTextArea((area) => {
			area.setValue(this.plugin.settings.customCss);
			area.setPlaceholder(':root { --ve-accent: #c0392b; }');
			area.inputEl.rows = 6;
			area.inputEl.style.width = '100%';
			area.onChange((val) => {
				this.plugin.settings.customCss = val;
				this.scheduleSave();
			});
		});
		this.track(cssEntry.row, cssEntry.setting, 'customCss');

		const expertDetails = advancedSection.createEl('details', { cls: 've-settings__expert' });
		expertDetails.open = true;
		expertDetails.createEl('summary', { text: 'Expert tuning — responsiveness and batching' });

		const yieldEntry = this.createSetting(expertDetails, 'Yield Every N Notes', 'Notes processed between two UI yields. Lower = more responsive UI and snappier cancel, slightly slower overall.');
		yieldEntry.setting.addText((text) => {
			text.setValue(String(this.plugin.settings.yieldEvery));
			text.setPlaceholder('25');
			text.onChange((val) => {
				const n = parseInt(val, 10);
				this.plugin.settings.yieldEvery = Number.isFinite(n) && n > 0 ? n : 25;
				this.scheduleSave();
			});
		});
		this.track(yieldEntry.row, yieldEntry.setting, 'yieldEvery');

		// SECTION 9: CHANGELOG
		const changelogSection = getSection('changelog');
		this.renderChangelog(changelogSection);

		this.filterSettings(sections, searchResults, noResults, this.searchQuery);
		this.refreshLiveIndicators();
		containerEl.scrollTop = scrollTop;
	}

	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: 've-settings__header' });
		const left = header.createDiv({ cls: 've-settings__header-main' });
		const titleRow = left.createDiv({ cls: 've-settings__header-title' });
		titleRow.createEl('h2', { text: 'Vault Exporter' });
		const ver = this.plugin.manifest?.version;
		if (ver) {
			titleRow.createSpan({ cls: 've-badge ve-badge--version', text: 'v' + ver });
		}
		left.createEl('p', {
			cls: 've-settings__intro',
			text: 'Choose what to export, which file extensions to produce, where files land, and how HTML documents look.',
		});

		this.headerBadgesEl = header.createDiv({ cls: 've-settings__badges' });
		this.updateHeaderBadges();
	}

	private updateHeaderBadges(): void {
		const badges = this.headerBadgesEl;
		if (!badges) return;
		badges.empty();
		const s = this.plugin.settings;

		// 1. Destination status badge
		if (usesExternalOutputFolder(s)) {
			badges.createSpan({ cls: 've-badge ve-badge--ok', text: 'Output: OS folder' });
		} else if (s.useExternalOutputFolder) {
			badges.createSpan({ cls: 've-badge ve-badge--warn', text: 'Output folder incomplete' });
		} else {
			badges.createSpan({ cls: 've-badge', text: 'Output: Vault' });
		}

		// 2. Scope status badge
		const scopeParts: string[] = [];
		if (s.scopeRoot.trim()) scopeParts.push(s.scopeRoot.trim());
		if (s.scopeTag.trim()) scopeParts.push('#' + s.scopeTag.trim().replace(/^#+/, ''));
		if (scopeParts.length > 0) {
			badges.createSpan({ cls: 've-badge ve-badge--accent', text: 'Scope: ' + scopeParts.join(' · ') });
		} else {
			badges.createSpan({ cls: 've-badge', text: 'Scope: Whole vault' });
		}

		// 3. Extension badge
		const globalExt = normalizeExtension(s.outputExtension);
		const splitExt = normalizeExtension(s.splitFileExtension);
		if (globalExt) {
			badges.createSpan({ cls: 've-badge ve-badge--accent', text: 'Extension: ' + globalExt });
		} else if (splitExt) {
			badges.createSpan({ cls: 've-badge ve-badge--accent', text: 'Split ext: ' + splitExt });
		} else {
			badges.createSpan({ cls: 've-badge', text: 'Extensions: Default' });
		}

		// 4. Split preset badge
		const activePreset = detectSplitPreset(s);
		const presetDef = SPLIT_PRESETS.find((preset) => preset.id === activePreset);
		badges.createSpan({
			cls: 've-badge',
			text: 'Split: ' + (presetDef ? presetDef.shortLabel : 'Custom'),
		});
	}

	private renderSummaryBar(root: HTMLElement): void {
		this.summaryEl = root.createDiv({ cls: 've-settings__summary' });
	}

	private updateSummaryBar(): void {
		const bar = this.summaryEl;
		if (!bar) return;
		const count = this.containerEl.querySelectorAll('.ve-setting--modified').length;
		bar.empty();
		bar.createSpan({
			cls: 've-settings__summary-text',
			text: count === 0
				? 'Every setting has its default value.'
				: `${count} setting${count === 1 ? '' : 's'} changed from default.`,
		});

		const actions = bar.createDiv({ cls: 've-settings__summary-actions' });
		if (count > 0 || this.onlyChanged) {
			const filterBtn = actions.createEl('button', {
				cls: 've-settings__only-changed-btn' + (this.onlyChanged ? ' is-active' : ''),
				text: this.onlyChanged ? 'Show all settings' : 'Show only changed',
				attr: { type: 'button', 'aria-pressed': String(this.onlyChanged) },
			});
			filterBtn.addEventListener('click', () => {
				this.onlyChanged = !this.onlyChanged;
				if (this.sectionsEl && this.searchResultsEl && this.noResultsEl) {
					this.filterSettings(this.sectionsEl, this.searchResultsEl, this.noResultsEl, this.searchQuery);
				}
				this.updateSummaryBar();
			});
		}

		if (count > 0) {
			const resetAllBtn = actions.createEl('button', {
				cls: 've-settings__reset-all-btn',
				text: 'Reset all to defaults',
				attr: { type: 'button' },
			});
			resetAllBtn.addEventListener('click', async () => {
				const target = this.plugin.settings as unknown as Record<string, unknown>;
				for (const key of RESETTABLE_KEYS) {
					setSettingAt(target, key, structuredClone(DEFAULT_SETTINGS[key]));
				}
				this.onlyChanged = false;
				await this.saveNow();
				this.display();
			});
		}
	}

	private updateTabModifiedCounts(): void {
		for (const tab of Array.from(this.containerEl.querySelectorAll<HTMLButtonElement>('.ve-settings__tab'))) {
			const id = tab.dataset.sectionId;
			if (!id || id === 'changelog') continue;
			const section = this.containerEl.querySelector<HTMLElement>('#ve-settings-section-' + id);
			const modCount = section?.querySelectorAll('.ve-setting--modified').length ?? 0;
			let badge = tab.querySelector<HTMLElement>('.ve-settings__tab-count');
			if (modCount > 0) {
				if (!badge) badge = tab.createSpan({ cls: 've-settings__tab-count' });
				badge.setText(String(modCount));
			} else if (badge) {
				badge.remove();
			}
		}
	}

	private refreshLiveIndicators(): void {
		this.updateHeaderBadges();
		this.updateSummaryBar();
		this.updateTabModifiedCounts();
	}

	private track(row: HTMLElement, setting: Setting, key: keyof ExporterSettings): Setting {
		const settingsObj = this.plugin.settings as unknown as Record<string, unknown>;
		const initial = settingAt(DEFAULT_SETTINGS, key);
		const select = setting.controlEl.querySelector('select');
		const matchedOption = select
			? Array.from(select.options).find((candidate) => candidate.value === String(initial))
			: undefined;
		const formattedDefault = matchedOption?.text
			?? (typeof initial === 'boolean'
				? (initial ? 'on' : 'off')
				: Array.isArray(initial)
					? (initial.length === 0 ? 'empty' : initial.join(', '))
					: initial === ''
						? 'empty'
						: String(initial));
		setting.descEl.createDiv({ cls: 've-setting__default', text: 'Default: ' + formattedDefault });

		let resetEl: HTMLElement | null = null;
		setting.addExtraButton((button) => {
			button
				.setIcon('rotate-ccw')
				.setTooltip('Reset to default')
				.onClick(async () => {
					setSettingAt(settingsObj, key, structuredClone(initial));
					await this.saveNow();
					this.display();
				});
			resetEl = button.extraSettingsEl;
		});

		const refresh = (notify = true): void => {
			const modified = !sameSettingValue(settingAt(settingsObj, key), initial);
			row.toggleClass('ve-setting--modified', modified);
			resetEl?.toggleClass('is-hidden', !modified);
			if (notify) this.refreshLiveIndicators();
		};
		for (const evt of ['click', 'input', 'change']) {
			setting.controlEl.addEventListener(evt, () => refresh());
		}
		refresh(false);
		return setting;
	}

	private group(root: HTMLElement, active: boolean): HTMLElement {
		return root.createDiv({ cls: active ? 've-settings__dependent' : 've-settings__dependent is-off' });
	}

	private groupHint(root: HTMLElement, holder: HTMLElement, conditionText: string): void {
		if (!holder.hasClass('is-off')) return;
		const count = holder.querySelectorAll('.ve-settings-row').length;
		if (count > 0) {
			root.createDiv({
				cls: 've-settings__more',
				text: `${count} more setting${count === 1 ? '' : 's'} ${conditionText}.`,
			});
		}
	}

	private renderGlobalExtensionSetting(containerEl: HTMLElement): void {
		const entry = this.createSetting(
			containerEl,
			'Export File Extension',
			'Choose any file extension for exported documents and split files (e.g. .md, .txt, .mdx, .org, .llm.txt). Leave empty to keep each format’s own default extension.'
		);
		let inputRef: HTMLInputElement | null = null;

		entry.setting.addText((text) => {
			inputRef = text.inputEl;
			text.setValue(this.plugin.settings.outputExtension);
			text.setPlaceholder('Default per format (or type e.g. .md, .txt, .mdx, .ctx)');
			text.onChange((val) => {
				this.plugin.settings.outputExtension = normalizeExtension(val);
				this.scheduleSave();
				this.updateExtensionPreview();
				this.updateSplitPreview();
				this.refreshExtensionPills(pillsRow, this.plugin.settings.outputExtension);
				this.updateHeaderBadges();
			});
		});
		this.track(entry.row, entry.setting, 'outputExtension');

		const pillsRow = entry.row.createDiv({ cls: 've-ext-pills' });
		pillsRow.createSpan({ cls: 've-quick-tags__label', text: 'Quick extension:' });
		const allChoices = ['', ...COMMON_EXPORT_EXTENSIONS];
		for (const extChoice of allChoices) {
			const label = extChoice === '' ? 'Auto (default)' : extChoice;
			const pill = pillsRow.createEl('button', {
				text: label,
				cls: 've-ext-pill',
				attr: {
					type: 'button',
					'data-ext': extChoice,
					'aria-pressed': String(normalizeExtension(this.plugin.settings.outputExtension) === extChoice),
				},
			});
			pill.addEventListener('click', async () => {
				this.plugin.settings.outputExtension = extChoice;
				if (inputRef) inputRef.value = extChoice;
				await this.saveNow();
				this.display();
			});
		}
		this.refreshExtensionPills(pillsRow, this.plugin.settings.outputExtension);

		this.extPreviewEl = entry.row.createDiv({ cls: 've-ext-preview' });
		this.updateExtensionPreview();
	}

	private updateExtensionPreview(): void {
		const el = this.extPreviewEl;
		if (!el) return;
		el.empty();
		const s = this.plugin.settings;
		const resolved = resolveConsolidatedExtensionPaths(s);
		const splitExt = effectiveSplitExtension(s);
		const cleanExt = normalizeExtension(s.outputExtension) || '.md';
		el.createSpan({ cls: 've-ext-preview__label', text: 'Effective filenames:' });
		for (const sample of [
			resolved.notebooklmOutputPath,
			resolved.htmlOutputPath,
			resolved.markdownOutputPath,
			'Split/*' + splitExt,
			'Note (clean export)' + cleanExt,
		]) {
			el.createEl('code', { cls: 've-ext-preview__chip', text: sample });
		}
	}

	private renderSplitExtensionSetting(containerEl: HTMLElement): void {
		const entry = this.createSetting(
			containerEl,
			'Split File Extension',
			'Custom extension specifically for split exports (both folder-grouped and individual notes). Leave empty to follow Export File Extension or the mode default (.txt / .md).'
		);
		let inputRef: HTMLInputElement | null = null;

		entry.setting.addText((text) => {
			inputRef = text.inputEl;
			text.setValue(this.plugin.settings.splitFileExtension);
			text.setPlaceholder('Auto (.txt for folder groups, .md for notes) — or any .ext');
			text.onChange((val) => {
				this.plugin.settings.splitFileExtension = normalizeExtension(val);
				this.scheduleSave();
				this.updateExtensionPreview();
				this.updateSplitPreview();
				this.refreshExtensionPills(pillsRow, this.plugin.settings.splitFileExtension);
				this.updateHeaderBadges();
			});
		});
		this.track(entry.row, entry.setting, 'splitFileExtension');

		const pillsRow = entry.row.createDiv({ cls: 've-ext-pills' });
		pillsRow.createSpan({ cls: 've-quick-tags__label', text: 'Quick split extension:' });
		for (const extChoice of ['', '.txt', '.md', '.markdown', '.mdx', '.org', '.rst', '.adoc', '.html', '.json']) {
			const pill = pillsRow.createEl('button', {
				text: extChoice === '' ? 'Auto' : extChoice,
				cls: 've-ext-pill',
				attr: {
					type: 'button',
					'data-split-ext': extChoice,
					'aria-pressed': String(normalizeExtension(this.plugin.settings.splitFileExtension) === extChoice),
				},
			});
			pill.addEventListener('click', async () => {
				this.plugin.settings.splitFileExtension = extChoice;
				if (inputRef) inputRef.value = extChoice;
				await this.saveNow();
				this.display();
			});
		}
		this.refreshExtensionPills(pillsRow, this.plugin.settings.splitFileExtension);
	}

	private refreshExtensionPills(container: HTMLElement, activeValue: string): void {
		const norm = normalizeExtension(activeValue);
		for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>('.ve-ext-pill'))) {
			const val = btn.dataset.ext ?? btn.dataset.splitExt ?? '';
			const isActive = val === norm;
			btn.toggleClass('is-active', isActive);
			btn.setAttribute('aria-pressed', String(isActive));
		}
	}

	private renderConsolidatedPathSetting(
		containerEl: HTMLElement,
		title: string,
		desc: string,
		key: 'notebooklmOutputPath' | 'htmlOutputPath' | 'markdownOutputPath'
	): void {
		const entry = this.createSetting(containerEl, title, desc);
		let inputRef: HTMLInputElement | null = null;

		entry.setting.addText((text) => {
			inputRef = text.inputEl;
			text.setValue(this.plugin.settings[key]);
			text.onChange((val) => {
				this.plugin.settings[key] = val.trim();
				this.scheduleSave();
				this.updateExtensionPreview();
			});
			new VaultPathSuggest(this.app, text.inputEl, () => this.plugin.gateway.getAllFiles());
		});
		this.track(entry.row, entry.setting, key);

		const quickRow = entry.row.createDiv({ cls: 've-ext-pills ve-ext-pills--compact' });
		quickRow.createSpan({ cls: 've-quick-tags__label', text: 'Set path extension:' });
		for (const ext of ['.txt', '.md', '.markdown', '.mdx', '.html', '.org']) {
			const btn = quickRow.createEl('button', {
				text: ext,
				cls: 've-ext-pill ve-ext-pill--sm',
				attr: { type: 'button' },
			});
			btn.title = 'Switch ' + title + ' to ' + ext;
			btn.addEventListener('click', async () => {
				const updated = replaceFileExtension(this.plugin.settings[key], ext);
				this.plugin.settings[key] = updated;
				if (inputRef) inputRef.value = updated;
				await this.saveNow();
				this.display();
			});
		}
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
		const firstText = setting.descEl.childNodes[0];
		if (firstText && firstText.nodeType === 3) {
			firstText.nodeValue = this.describeExternalFolder();
		} else {
			setting.descEl.prepend(document.createTextNode(this.describeExternalFolder()));
		}
		setting.settingEl.toggleClass('ve-settings__invalid', invalid);
	}

	/** Opens the native folder picker and stores the selection. */
	private async pickExternalOutputFolder(): Promise<string | null> {
		const picked = await this.plugin.gateway.pickOutputFolder(this.plugin.settings.externalOutputFolder);
		if (!picked) {
			return null;
		}
		this.plugin.settings.externalOutputFolder = picked;
		await this.saveNow();
		this.display();
		new Notice('External export folder: ' + picked);
		return picked;
	}

	private createSection(parent: HTMLElement, definition: SettingsSectionDefinition): HTMLElement {
		const sectionId = 've-settings-section-' + definition.id;
		const section = parent.createDiv({
			cls: 've-settings-section',
			attr: {
				'id': sectionId,
				'role': 'tabpanel',
				'aria-labelledby': 've-settings-tab-' + definition.id,
				'data-section-id': definition.id,
			},
		});

		const jumpBtn = section.createEl('button', {
			cls: 've-settings__search-jump is-hidden',
			text: `In tab: ${definition.title} — go there →`,
			attr: { type: 'button' },
		});
		jumpBtn.addEventListener('click', () => {
			this.searchQuery = '';
			this.onlyChanged = false;
			this.activeSectionId = definition.id;
			const searchInput = this.containerEl.querySelector<HTMLInputElement>('.ve-settings__search input');
			if (searchInput) searchInput.value = '';
			if (this.sectionsEl && this.searchResultsEl && this.noResultsEl) {
				this.filterSettings(this.sectionsEl, this.searchResultsEl, this.noResultsEl, '');
			}
			this.updateSummaryBar();
			section.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
		});

		section.createEl('h3', { text: definition.title });
		if (definition.intro) {
			section.createEl('p', { cls: 've-settings__section-intro', text: definition.intro });
		}
		return section;
	}

	private createSectionTab(tabBar: HTMLElement, definition: SettingsSectionDefinition): void {
		const tab = tabBar.createEl('button', {
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
		tab.createSpan({ cls: 've-settings__tab-label', text: definition.title });
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

	private activateSection(sectionId: SettingsSectionId): void {
		if (!SETTINGS_SECTIONS.some((section) => section.id === sectionId)) return;
		this.activeSectionId = sectionId;
		this.updateSectionVisibility();
	}

	private updateSectionVisibility(): void {
		const isFiltering = this.searchQuery.length > 0 || this.onlyChanged;
		this.containerEl.toggleClass('ve-settings--searching', isFiltering);

		for (const section of Array.from(this.containerEl.querySelectorAll<HTMLElement>('.ve-settings-section'))) {
			const id = section.dataset.sectionId;
			let hasVisible = Boolean(section.querySelector('.ve-settings-row:not([hidden])'));
			if (
				isFiltering &&
				id === 'changelog' &&
				!this.onlyChanged &&
				'changelog version history release notes'.includes(this.searchQuery)
			) {
				hasVisible = true;
			}
			section.hidden = isFiltering ? !hasVisible : id !== this.activeSectionId;
			section.querySelector('.ve-settings__search-jump')?.toggleClass('is-hidden', !isFiltering || !hasVisible);
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

	private createSetting(containerEl: HTMLElement, title: string, desc: string): { row: HTMLElement; setting: Setting } {
		const row = containerEl.createDiv({ cls: 've-settings-row' });
		this.decorateSettingRow(row, title, desc);
		const setting = new Setting(row).setName(title).setDesc(desc);
		return { row, setting };
	}

	private renderToggleSetting(
		containerEl: HTMLElement,
		title: string,
		desc: string,
		key:
			| 'rememberTargetSelection'
			| 'autoRevealOutput'
			| 'includeCanvas'
			| 'stripFrontmatter'
			| 'renderDataview'
			| 'htmlShowToc'
			| 'htmlShowSearch'
			| 'htmlShowPaths'
			| 'htmlShowMetadata'
			| 'htmlShowFooter',
		redrawOnChange = false
	): void {
		const entry = this.createSetting(containerEl, title, desc);
		entry.setting.addToggle((toggle) => {
			toggle.setValue(this.plugin.settings[key]);
			toggle.onChange(async (value) => {
				this.plugin.settings[key] = value;
				await this.saveNow();
				if (redrawOnChange) this.display();
				else this.refreshLiveIndicators();
			});
		});
		this.track(entry.row, entry.setting, key);
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
		const isFiltering = query.length > 0 || this.onlyChanged;
		const matchingRows: HTMLElement[] = [];

		for (const row of Array.from(sections.querySelectorAll<HTMLElement>('.ve-settings-row'))) {
			const listValues = Array.from(row.querySelectorAll('.ve-list-item__text')).map((el) => el.textContent ?? '');
			const searchableText = [
				row.dataset.settingTitle,
				row.dataset.settingDescription,
				...listValues,
			].filter(Boolean).join(' ').toLocaleLowerCase();
			const matchesQuery = !query || searchableText.includes(query);
			const matchesChanged = !this.onlyChanged || row.classList.contains('ve-setting--modified');
			const matches = matchesQuery && matchesChanged;
			row.hidden = !matches;
			if (matches && row.dataset.settingTitle) {
				matchingRows.push(row);
				const details = row.closest('details');
				if (details && isFiltering) details.open = true;
			}
		}

		this.renderSearchResults(searchResults, matchingRows, query);
		const changelogMatched =
			isFiltering &&
			!this.onlyChanged &&
			'changelog version history release notes'.includes(query);
		noResults.hidden = !isFiltering || matchingRows.length > 0 || changelogMatched;
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
		const sectionId = row.dataset.sectionId as SettingsSectionId | undefined;
		if (sectionId && SETTINGS_SECTIONS.some((s) => s.id === sectionId)) {
			this.activeSectionId = sectionId;
		}
		this.searchQuery = '';
		this.onlyChanged = false;
		const searchInput = this.containerEl.querySelector<HTMLInputElement>('.ve-settings__search input');
		if (searchInput) searchInput.value = '';
		const details = row.closest('details');
		if (details) details.open = true;
		for (const candidate of Array.from(this.containerEl.querySelectorAll<HTMLElement>('.ve-settings-row'))) {
			candidate.hidden = false;
		}
		const searchResults = this.containerEl.querySelector<HTMLElement>('.ve-settings__search-results');
		const noResults = this.containerEl.querySelector<HTMLElement>('.ve-settings__empty');
		if (searchResults && noResults) {
			this.filterSettings(this.containerEl.querySelector<HTMLElement>('.ve-settings__sections')!, searchResults, noResults, '');
		}
		this.updateSummaryBar();
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
					await this.saveNow();
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
				await this.saveNow();
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
		header.createSpan({
			cls: 've-badge',
			text: 'Extension: ' + effectiveSplitExtension(this.plugin.settings),
		});
		const samplePaths = previewSplitFiles(this.plugin.settings, this.plugin.gateway.getAllFolders());
		const list = preview.createDiv({ cls: 've-split-preview__list' });
		for (const samplePath of samplePaths) {
			list.createEl('code', { cls: 've-split-preview__item', text: samplePath });
		}
	}

	private renderSplitSubfoldersSetting(containerEl: HTMLElement): void {
		const title = 'Split Subfolders';
		const desc = 'Folder-grouped mode: subfolders that also create one file per subfolder. Click an item’s depth button to override 1-level (/*) vs recursive (/**) for that folder.';
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
				await this.saveNow();
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
				await this.saveNow();
				this.display();
			});
		});

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
						await this.saveNow();
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
						await this.saveNow();
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
					await this.saveNow();
					this.display();
				});
			}
		}

		let newText = '';
		const addFolder = async (): Promise<void> => {
			const cleaned = newText.trim().replace(/\\/g, '/').replace(/\/+(?!\*)/g, '/').replace(/\/+$/, '');
			if (cleaned && !items.includes(cleaned)) {
				this.plugin.settings.splitSubfolders = [...items, cleaned];
				await this.saveNow();
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

		this.track(row, setting, 'splitSubfolders');
	}

	private renderStringListSetting(
		containerEl: HTMLElement,
		title: string,
		desc: string,
		items: string[],
		settingKey: 'excludedFolders' | 'excludedFiles' | 'excludedPrefixes' | 'ignoredProperties',
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

			const delBtn = itemRow.createEl('button', { text: '✕', cls: 've-list-item__del', attr: { type: 'button' } });
			delBtn.title = 'Remove';
			delBtn.setAttribute('aria-label', 'Remove ' + item);
			delBtn.addEventListener('click', async () => {
				const updated = items.filter((_, i) => i !== index);
				if (onSave) await onSave(updated);
				this.display();
			});
		});

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
			text.setPlaceholder('Add or search...');
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

		this.track(row, setting, settingKey);
	}

	private renderChangelog(root: HTMLElement): void {
		const container = root.createDiv({ cls: 've-cl' });

		// 1) Header card
		const headerCard = container.createDiv({ cls: 've-cl-header-card' });
		const info = headerCard.createDiv({ cls: 've-cl-header-card__info' });
		info.createEl('h4', { text: 'Changelog & Version History' });
		const subtitle = info.createEl('p');
		subtitle.createSpan({ text: 'Synced from GitHub repository (' });
		subtitle.createEl('a', {
			text: 'aznan-triks/true-condensated-vault-exporter',
			href: CHANGELOG_REPO_URL,
			cls: 've-cl-repo-link',
			attr: { target: '_blank', rel: 'noopener noreferrer' },
		});
		subtitle.createSpan({ text: ')' });

		const actions = headerCard.createDiv({ cls: 've-cl-header-card__actions' });
		this.clTimeEl = actions.createSpan({
			cls: 've-cl-time',
			text: this.changelogFetchedAt
				? `Last Git sync: ${this.changelogFetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
				: 'Bundled release notes',
		});

		const refreshBtn = actions.createEl('button', {
			cls: 'mod-cta',
			text: '🔄 Refresh',
			attr: { type: 'button' },
		});
		refreshBtn.addEventListener('click', () => {
			void this.refreshChangelogFromGitHub(true);
		});

		// 2) Filter card
		const filterCard = container.createDiv({ cls: 've-cl-filter-card' });

		const row1 = filterCard.createDiv({ cls: 've-cl-filter-row' });
		const searchWrap = row1.createDiv({ cls: 've-cl-search-wrap' });
		const searchInput = searchWrap.createEl('input', {
			type: 'text',
			cls: 've-cl-search-input',
			placeholder: '🔍 Search version, keyword, fix...',
			value: this.clSearchQuery,
			attr: { 'aria-label': 'Filter changelog entries' },
		});
		searchInput.addEventListener('input', (e) => {
			this.clSearchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
			this.renderChangelogView();
		});
		this.clCounterEl = searchWrap.createSpan({ cls: 've-cl-counter' });

		const controlGroup = row1.createDiv({ cls: 've-cl-control-group' });
		const segmented = controlGroup.createDiv({ cls: 've-cl-segmented' });
		const viewModes: Array<{ mode: ChangelogViewMode; label: string }> = [
			{ mode: 'all', label: '👁️ All' },
			{ mode: 'plain', label: '👤 Plain' },
			{ mode: 'tech', label: '💻 Technical' },
		];
		for (const vm of viewModes) {
			const btn = segmented.createEl('button', {
				cls: `ve-cl-view-btn ${this.clViewMode === vm.mode ? 'is-active' : ''}`,
				text: vm.label,
				attr: { type: 'button' },
			});
			btn.addEventListener('click', () => {
				segmented.querySelectorAll('.ve-cl-view-btn').forEach((b) => b.removeClass('is-active'));
				btn.addClass('is-active');
				this.clViewMode = vm.mode;
				this.renderChangelogView();
			});
		}

		const sortSelect = controlGroup.createEl('select', {
			cls: 've-cl-select',
			attr: { 'aria-label': 'Changelog sort order' },
		});
		const optDesc = sortSelect.createEl('option', { value: 'desc', text: '🔽 Newest first' });
		const optAsc = sortSelect.createEl('option', { value: 'asc', text: '🔼 Oldest first' });
		if (this.clSortOrder === 'asc') optAsc.selected = true;
		else optDesc.selected = true;
		sortSelect.addEventListener('change', (e) => {
			this.clSortOrder = (e.target as HTMLSelectElement).value as 'desc' | 'asc';
			this.renderChangelogView();
		});

		const row2 = filterCard.createDiv({ cls: 've-cl-filter-row ve-cl-filter-row--border' });
		const catGroup = row2.createDiv({ cls: 've-cl-cat-group' });
		catGroup.createSpan({ cls: 've-cl-cat-label', text: 'Categories:' });
		const categories = [
			{ catName: 'Added', icon: '✨' },
			{ catName: 'Improved', icon: '🚀' },
			{ catName: 'Changed', icon: '⚡' },
			{ catName: 'Fixed', icon: '🐛' },
			{ catName: 'Removed', icon: '🗑️' },
			{ catName: 'Security', icon: '🛡️' },
		];
		for (const cat of categories) {
			const chip = catGroup.createEl('button', {
				cls: `ve-cl-cat-chip ${this.clActiveCats.has(cat.catName) ? 'is-active' : ''}`,
				text: `${cat.icon} ${cat.catName}`,
				attr: { type: 'button', 'data-cat': cat.catName },
			});
			chip.addEventListener('click', () => {
				if (this.clActiveCats.has(cat.catName)) {
					if (this.clActiveCats.size > 1) {
						this.clActiveCats.delete(cat.catName);
						chip.removeClass('is-active');
					}
				} else {
					this.clActiveCats.add(cat.catName);
					chip.addClass('is-active');
				}
				this.renderChangelogView();
			});
		}

		const rangeGroup = row2.createDiv({ cls: 've-cl-control-group' });
		rangeGroup.createSpan({ cls: 've-cl-cat-label', text: 'Range:' });
		this.clVersionFromSelect = rangeGroup.createEl('select', {
			cls: 've-cl-select',
			attr: { 'aria-label': 'Changelog start version' },
		});
		rangeGroup.createSpan({ text: 'to', cls: 've-cl-range-to' });
		this.clVersionToSelect = rangeGroup.createEl('select', {
			cls: 've-cl-select',
			attr: { 'aria-label': 'Changelog end version' },
		});

		this.clVersionFromSelect.addEventListener('change', (e) => {
			this.clVersionFrom = (e.target as HTMLSelectElement).value;
			this.renderChangelogView();
		});
		this.clVersionToSelect.addEventListener('change', (e) => {
			this.clVersionTo = (e.target as HTMLSelectElement).value;
			this.renderChangelogView();
		});

		this.clContentContainer = container.createDiv({ cls: 've-cl-content' });
		this.renderChangelogView();
	}

	private appendSafeHtml(container: HTMLElement, html: string): void {
		const parsed = new window.DOMParser().parseFromString(html, 'text/html');
		container.append(...Array.from(parsed.body.childNodes));
	}

	private renderChangelogView(): void {
		if (!this.clContentContainer) return;
		const container = this.clContentContainer;
		container.empty();

		const { introHtml, rawItems } = parseRawChangelogMarkdown(this.changelogRawMarkdown);
		this.populateVersionSelects(rawItems);

		const result = filterAndGroupChangelog(rawItems, {
			searchQuery: this.clSearchQuery,
			viewMode: this.clViewMode,
			activeCats: this.clActiveCats,
			sortOrder: this.clSortOrder,
			versionFrom: this.clVersionFrom,
			versionTo: this.clVersionTo,
		});

		if (this.clCounterEl) {
			this.clCounterEl.setText(
				`${result.processedItems.length} / ${rawItems.length} version${rawItems.length === 1 ? '' : 's'}`
			);
		}

		if (result.processedItems.length === 0) {
			const empty = container.createDiv({ cls: 've-cl-empty' });
			empty.createDiv({ cls: 've-cl-empty__icon', text: '🔍' });
			empty.createDiv({ cls: 've-cl-empty__title', text: 'No matching release notes' });
			empty.createDiv({ cls: 've-cl-empty__desc', text: 'No versions match your active changelog filters.' });
			const resetBtn = empty.createEl('button', {
				cls: 'mod-cta',
				text: '🔄 Reset filters',
				attr: { type: 'button' },
			});
			resetBtn.addEventListener('click', () => {
				this.clSearchQuery = '';
				this.clSortOrder = 'desc';
				this.clViewMode = 'all';
				this.clActiveCats = new Set(KNOWN_CHANGELOG_CATEGORIES);
				this.clVersionFrom = 'all';
				this.clVersionTo = 'all';
				this.display();
			});
			return;
		}

		if (introHtml) {
			const introEl = container.createDiv();
			this.appendSafeHtml(introEl, introHtml);
		}

		for (const group of result.dateGroups) {
			const groupEl = container.createDiv({ cls: 've-cl-date-group' });
			const headerEl = groupEl.createDiv({ cls: 've-cl-date-header' });
			headerEl.createSpan({
				cls: 've-cl-date-header__title',
				text: '📅 ' + group.date,
			});
			headerEl.createSpan({
				cls: 've-cl-counter',
				text: `${group.versions.length} version${group.versions.length === 1 ? '' : 's'}`,
			});

			const listEl = groupEl.createDiv({ cls: 've-cl-versions-list' });
			for (const item of group.versions) {
				const cardWrapper = listEl.createDiv();
				this.appendSafeHtml(cardWrapper, buildChangelogVersionCard(item));
			}
		}
	}

	private populateVersionSelects(rawItems: RawChangelogItem[]): void {
		if (!this.clVersionFromSelect || !this.clVersionToSelect) return;
		const uniqueVers = rawItems.map((i) => i.ver).filter((v, idx, a) => Boolean(v) && a.indexOf(v) === idx);
		const currentFrom = this.clVersionFrom;
		const currentTo = this.clVersionTo;

		this.clVersionFromSelect.empty();
		this.clVersionToSelect.empty();

		this.clVersionFromSelect.createEl('option', { value: 'all', text: 'All versions' });
		this.clVersionToSelect.createEl('option', { value: 'all', text: 'Latest version' });

		for (const ver of uniqueVers) {
			this.clVersionFromSelect.createEl('option', { value: ver, text: ver });
			this.clVersionToSelect.createEl('option', { value: ver, text: ver });
		}

		this.clVersionFromSelect.value = currentFrom;
		this.clVersionToSelect.value = currentTo;
	}

	private async refreshChangelogFromGitHub(forceRefresh = false): Promise<void> {
		if (this.changelogLoading) return;
		this.changelogLoading = true;
		this.clTimeEl?.setText('Fetching changelog from GitHub...');

		try {
			const headers = forceRefresh ? { 'Cache-Control': 'no-cache' } : undefined;
			const res = await requestUrl({
				url: CHANGELOG_RAW_URL,
				method: 'GET',
				headers,
				throw: false,
			});
			this.changelogLoading = false;
			if (res.status >= 200 && res.status < 300 && res.text) {
				this.changelogRawMarkdown = res.text;
				this.changelogFetchedAt = new Date();
				this.clTimeEl?.setText(
					`Last Git sync: ${this.changelogFetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
				);
				new Notice('Changelog updated from GitHub.');
				this.renderChangelogView();
			} else {
				this.clTimeEl?.setText('Git sync failed (using bundled changelog)');
				new Notice(`Could not fetch changelog from GitHub (HTTP ${res.status}).`);
			}
		} catch (err: unknown) {
			this.changelogLoading = false;
			const msg = err instanceof Error ? err.message : String(err);
			this.clTimeEl?.setText('Git sync error (using bundled changelog)');
			new Notice(`Could not fetch changelog from GitHub: ${msg}`);
		}
	}
}
