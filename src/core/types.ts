/**
 * Core domain types for vault-exporter.
 * Pure TypeScript — no Obsidian imports allowed.
 */

export interface VaultFile {
	/** Relative path from vault root, e.g. 'Notes/Topic/Doc.md' or 'index.md' */
	path: string;
	/** File basename without path, e.g. 'Timeline.md' */
	name: string;
	/** Raw markdown content */
	content: string;
	/** Last modified timestamp in ms */
	mtime?: number;
	/** Creation timestamp in ms */
	ctime?: number;
}

/**
 * A vault file whose frontmatter was parsed once per export run.
 * The parsed body and metadata are shared by the cleaner and Dataview engine.
 */
export interface ParsedFile {
	/** Vault-relative path, normalized to forward slashes */
	path: string;
	/** Basename without extension */
	name: string;
	/** Parent folder (normalized, '' for vault root) */
	folder: string;
	metadata: FileMetadata;
	/** Markdown body without the frontmatter block */
	body?: string;
	/** Raw YAML frontmatter without delimiters */
	rawFrontmatter?: string;
	/** Last modified timestamp in ms */
	mtime?: number;
	/** Creation timestamp in ms */
	ctime?: number;
}

export type WikilinkFormat = 'clean-text' | 'keep-wikilink' | 'markdown' | 'canonical-alias';
export type HtmlTheme = 'system' | 'light' | 'dark';
export type HtmlFont = 'system' | 'serif' | 'monospace';
export type RememberedExportTarget = 'all' | 'notebooklm' | 'html' | 'markdown' | 'split' | 'zip';
/** Supported successful-panel auto-close delays in seconds; zero keeps it open. */
export const PROGRESS_PANEL_AUTO_CLOSE_OPTIONS = [0, 5, 8, 15, 30, 60] as const;

export interface ExporterSettings {
	/** Title written at the top of consolidated exports */
	documentTitle: string;
	/** Whether the sidebar restores its previous target selection between sessions */
	rememberTargetSelection: boolean;
	/** Whether every output is written into `externalOutputFolder` instead of the vault */
	useExternalOutputFolder: boolean;
	/** Absolute OS folder that receives exports while external output is enabled */
	externalOutputFolder: string;
	/** Persisted sidebar targets; in-memory command overrides never alter this */
	lastSelectedTargets: RememberedExportTarget[];
	/** Seconds before a successful progress panel auto-closes; zero disables auto-close */
	progressPanelAutoCloseSeconds: number;
	/** Automatically reveal the first output in the desktop file manager on success */
	autoRevealOutput: boolean;
	/** Folder from which relative scanning occurs, empty string means vault root */
	scopeRoot: string;
	/** Folders to strictly exclude (exact relative paths or prefix match) */
	excludedFolders: string[];
	/** Exact filenames (with or without path) to exclude */
	excludedFiles: string[];
	/** Path prefix substrings that cause exclusion if found anywhere in folder path (e.g. '00_') */
	excludedPrefixes: string[];
	/** When non-empty, only notes carrying this tag are exported (canvas files excluded) */
	scopeTag: string;
	/** Output path for NotebookLM consolidated file (vault-relative or absolute) */
	notebooklmOutputPath: string;
	/** Output path for HTML consolidated file */
	htmlOutputPath: string;
	/** Output path for Markdown consolidated file */
	markdownOutputPath: string;
	/** Output path for the ZIP bundle of all formats (vault-relative or absolute) */
	zipOutputPath: string;
	/** Split mode: 'folder-grouped' (.txt per top folder under scope) or 'individual-files' (1-to-1 .md) */
	splitMode: 'folder-grouped' | 'individual-files';
	/** Folder whose direct subfolders become split groups (empty = scope root) */
	splitGroupFolder: string;
	/** Destination folder for split files (vault-relative or absolute) */
	splitOutputFolder: string;
	/** Whether to remove YAML frontmatter during export */
	stripFrontmatter: boolean;
	/** Whether to evaluate in-memory Dataview queries */
	renderDataview: boolean;
	/** Target format for wikilinks */
	wikilinkFormat: WikilinkFormat;
	/** Frontmatter property keys to ignore/strip during export */
	ignoredProperties: string[];
	/** Whether to include Obsidian .canvas files in exports */
	includeCanvas: boolean;
	/** Additional custom CSS to inject into HTML export */
	customCss: string;
	/** Color theme for the standalone HTML export */
	htmlTheme: HtmlTheme;
	/** Accent color for links, callouts, and focused controls in HTML */
	htmlAccentColor: string;
	/** Typography preset for the standalone HTML export */
	htmlFont: HtmlFont;
	/** Maximum reading width in pixels for the standalone HTML export */
	htmlContentWidth: number;
	/** Whether the HTML export includes its table of contents */
	htmlShowToc: boolean;
	/** Whether the HTML table of contents includes its search field */
	htmlShowSearch: boolean;
	/** Whether source paths are displayed in the HTML export */
	htmlShowPaths: boolean;
	/** Whether frontmatter metadata badges are displayed in HTML */
	htmlShowMetadata: boolean;
	/** Whether the HTML export displays an export footer */
	htmlShowFooter: boolean;
	/** Optional attribution or organization name shown in the HTML footer */
	htmlFooterText: string;
	/** Number of notes processed between two UI yields (keeps Obsidian responsive, allows cancel) */
	yieldEvery: number;
	/**
	 * When set (in-memory only, never persisted by default), restrict the
	 * export to this exact vault-relative path. Used by context commands
	 * such as "Export current note".
	 */
	onlyFile?: string;
}

export const DEFAULT_SETTINGS: ExporterSettings = {
	documentTitle: 'Vault export',
	rememberTargetSelection: true,
	useExternalOutputFolder: false,
	externalOutputFolder: '',
	lastSelectedTargets: ['all'],
	progressPanelAutoCloseSeconds: 8,
	autoRevealOutput: false,
	scopeRoot: '',
	excludedFolders: ['.obsidian', '.trash', '.git'],
	excludedFiles: [],
	excludedPrefixes: [],
	scopeTag: '',
	notebooklmOutputPath: 'Vault export - NotebookLM.txt',
	htmlOutputPath: 'Vault export.html',
	markdownOutputPath: 'Vault export.md',
	zipOutputPath: 'Vault export.zip',
	splitMode: 'folder-grouped',
	splitGroupFolder: '',
	splitOutputFolder: 'Vault export - split',
	stripFrontmatter: true,
	renderDataview: true,
	wikilinkFormat: 'clean-text',
	ignoredProperties: ['cssclasses'],
	includeCanvas: true,
	customCss: '',
	htmlTheme: 'system',
	htmlAccentColor: '#8b72d9',
	htmlFont: 'system',
	htmlContentWidth: 920,
	htmlShowToc: true,
	htmlShowSearch: true,
	htmlShowPaths: true,
	htmlShowMetadata: true,
	htmlShowFooter: true,
	htmlFooterText: 'Vault Exporter',
	yieldEvery: 25,
};

const STRING_SETTING_KEYS = [
	'documentTitle',
	'externalOutputFolder',
	'scopeRoot',
	'scopeTag',
	'notebooklmOutputPath',
	'htmlOutputPath',
	'markdownOutputPath',
	'zipOutputPath',
	'splitGroupFolder',
	'splitOutputFolder',
	'customCss',
	'htmlAccentColor',
	'htmlFooterText',
] as const satisfies readonly (keyof ExporterSettings)[];

const ARRAY_SETTING_KEYS = ['excludedFolders', 'excludedFiles', 'excludedPrefixes', 'ignoredProperties'] as const;
const REMEMBERED_EXPORT_TARGETS: readonly RememberedExportTarget[] = ['all', 'notebooklm', 'html', 'markdown', 'split', 'zip'];

/** Validates saved data and drops unknown or malformed settings. */
export function mergeSettings(loaded: unknown): ExporterSettings {
	const result: ExporterSettings = {
		...DEFAULT_SETTINGS,
		excludedFolders: [...DEFAULT_SETTINGS.excludedFolders],
		excludedFiles: [...DEFAULT_SETTINGS.excludedFiles],
		excludedPrefixes: [...DEFAULT_SETTINGS.excludedPrefixes],
		ignoredProperties: [...DEFAULT_SETTINGS.ignoredProperties],
	};
	if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
		return result;
	}

	const source = loaded as Record<string, unknown>;
	for (const key of STRING_SETTING_KEYS) {
		if (typeof source[key] === 'string') {
			Object.assign(result, { [key]: source[key] });
		}
	}
	for (const key of ARRAY_SETTING_KEYS) {
		const value = source[key];
		if (Array.isArray(value)) {
			result[key] = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
		}
	}

	if (!/^#[0-9a-f]{6}$/i.test(result.htmlAccentColor)) {
		result.htmlAccentColor = DEFAULT_SETTINGS.htmlAccentColor;
	}
	result.htmlFooterText = result.htmlFooterText.slice(0, 200);
	result.externalOutputFolder = result.externalOutputFolder.trim().slice(0, 400);

	for (const key of [
		'rememberTargetSelection', 'useExternalOutputFolder', 'autoRevealOutput', 'stripFrontmatter', 'renderDataview', 'includeCanvas', 'htmlShowToc', 'htmlShowSearch',
		'htmlShowPaths', 'htmlShowMetadata', 'htmlShowFooter',
	] as const) {
		if (typeof source[key] === 'boolean') {
			result[key] = source[key];
		}
	}
	if (Array.isArray(source.lastSelectedTargets)) {
		const targets = [...new Set(source.lastSelectedTargets.filter(
			(target): target is RememberedExportTarget =>
				typeof target === 'string' && REMEMBERED_EXPORT_TARGETS.includes(target as RememberedExportTarget)
		))];
		result.lastSelectedTargets = targets.includes('all') ? ['all'] : targets.length > 0 ? targets : ['all'];
	}
	if (
		typeof source.progressPanelAutoCloseSeconds === 'number' &&
		PROGRESS_PANEL_AUTO_CLOSE_OPTIONS.some((seconds) => seconds === source.progressPanelAutoCloseSeconds)
	) {
		result.progressPanelAutoCloseSeconds = source.progressPanelAutoCloseSeconds;
	}
	if (source.htmlTheme === 'system' || source.htmlTheme === 'light' || source.htmlTheme === 'dark') {
		result.htmlTheme = source.htmlTheme;
	}
	if (source.htmlFont === 'system' || source.htmlFont === 'serif' || source.htmlFont === 'monospace') {
		result.htmlFont = source.htmlFont;
	}
	if (typeof source.htmlContentWidth === 'number' && Number.isFinite(source.htmlContentWidth)) {
		const width = Math.min(1400, Math.max(680, source.htmlContentWidth));
		result.htmlContentWidth = Math.round(width / 20) * 20;
	}
	if (source.splitMode === 'folder-grouped' || source.splitMode === 'individual-files') {
		result.splitMode = source.splitMode;
	}
	if (
		source.wikilinkFormat === 'clean-text' ||
		source.wikilinkFormat === 'keep-wikilink' ||
		source.wikilinkFormat === 'markdown' ||
		source.wikilinkFormat === 'canonical-alias'
	) {
		result.wikilinkFormat = source.wikilinkFormat;
	}
	if (typeof source.yieldEvery === 'number' && Number.isFinite(source.yieldEvery)) {
		result.yieldEvery = Math.min(1000, Math.max(1, Math.floor(source.yieldEvery)));
	}

	return result;
}

export interface FileMetadata {
	title: string;
	category: string;
	order: string;
	tags: string[];
	trelloUrl?: string;
	dateCreation?: string;
	dateRevision?: string;
	status?: string;
	custom: Record<string, unknown>;
}

export interface ExportProgress {
	stage: string;
	current: number;
	total: number;
	currentFile?: string;
	log: string;
}

export type ProgressCallback = (progress: ExportProgress) => void;

/** What the export features need from the host (implemented by the Obsidian gateway, faked in tests). */
export interface ExportGateway {
	loadVaultFiles(
		settings: ExporterSettings,
		signal?: AbortSignal,
		onProgress?: (current: number, total: number, currentFile?: string) => void,
		onSkipped?: (path: string, message: string) => void
	): Promise<VaultFile[]>;
	/** Writes a text file to a vault-relative or absolute path, creating parent folders. */
	writeFile(targetPath: string, content: string): Promise<void>;
	/** Writes binary data (e.g. a ZIP archive) to a vault-relative or absolute path. */
	writeBinary(targetPath: string, data: Uint8Array): Promise<void>;
	/** Light-weight listing (path + size, no content read) for stats/preview UIs. */
	getVaultFilesInfo?(): { path: string; size: number }[];
	/** OS path for a vault-relative or absolute output, when revealable on this platform. */
	revealOutput?(targetPath: string): string | null;
}
