/**
 * Core domain types for vault-exporter.
 * Pure TypeScript — no Obsidian imports allowed.
 */

export interface VaultFile {
	/** Relative path from vault root, e.g. 'WoT/01_Univers/Chronologie.md' or 'index.md' */
	path: string;
	/** File basename without path, e.g. 'Chronologie.md' */
	name: string;
	/** Raw markdown content */
	content: string;
	/** Last modified timestamp in ms */
	mtime?: number;
}

export interface ExporterSettings {
	/** Folder from which relative scanning occurs, empty string means vault root */
	scopeRoot: string;
	/** Folders to strictly exclude (exact relative paths or prefix match) */
	excludedFolders: string[];
	/** Exact filenames (with or without path) to exclude */
	excludedFiles: string[];
	/** Path prefix substrings that cause exclusion if found anywhere in folder path (e.g. '00_') */
	excludedPrefixes: string[];
	/** Output path for NotebookLM consolidated file (relative to vault or absolute) */
	notebooklmOutputPath: string;
	/** Output path for HTML consolidated file */
	htmlOutputPath: string;
	/** Output path for Markdown consolidated file */
	markdownOutputPath: string;
	/** Output path for PDF file */
	pdfOutputPath: string;
	/** Whether to also export individual split files */
	exportSplitFiles: boolean;
	/** Split files export mode: 'folder-grouped' (.txt per folder) or 'individual-files' (1-to-1 .md) */
	splitMode: 'folder-grouped' | 'individual-files';
	/** Destination folder for split files */
	splitOutputFolder: string;
	/** Whether to remove YAML frontmatter during export */
	stripFrontmatter: boolean;
	/** Whether to evaluate in-memory Dataview queries */
	renderDataview: boolean;
	/** Target format for wikilinks: 'clean-text', 'keep-wikilink', 'markdown', or 'canonical-alias' */
	wikilinkFormat: 'clean-text' | 'keep-wikilink' | 'markdown' | 'canonical-alias';
	/** Frontmatter property keys to ignore/strip during export */
	ignoredProperties: string[];
	/** Whether to include Obsidian .canvas files in exports */
	includeCanvas: boolean;
	/** Additional custom CSS to inject into HTML/PDF export */
	customCss: string;
	/** External python script path for NotebookLM export fallback (optional) */
	pythonNotebooklmScript: string;
	/** External python script path for Trello/split export fallback (optional) */
	pythonTrelloScript: string;
	/** Preferred execution engine: 'native' | 'external-python' */
	executionEngine: 'native' | 'external-python';
}

export const DEFAULT_SETTINGS: ExporterSettings = {
	scopeRoot: '',
	excludedFolders: [
		'WoT/00_Metatrois (Gestion)',
		'00_Metatrois (Gestion)',
		'.obsidian',
		'.trash',
		'sessions',
		'.git',
	],
	excludedFiles: [
		'INSTRUCTIONS.md',
		'CLAUDE.md',
		'World of Trois _ NotebookLM.txt',
	],
	excludedPrefixes: ['00_'],
	notebooklmOutputPath: 'World of Trois _ NotebookLM.txt',
	htmlOutputPath: 'World of Trois _ Obsidian.html',
	markdownOutputPath: 'World of Trois _ Consolidated.md',
	pdfOutputPath: 'World of Trois _ Obsidian.pdf',
	exportSplitFiles: true,
	splitMode: 'folder-grouped',
	splitOutputFolder: 'G:\\.shortcut-targets-by-id\\1CYFRRCV46sPfjqWbqKB7hj7O2rznEzBT\\Histoire des Trois Trois\\Wiki Trois',
	stripFrontmatter: true,
	renderDataview: true,
	wikilinkFormat: 'canonical-alias',
	ignoredProperties: [
		'canvas',
		'icon',
		'trello_board_card_id',
		'trello_plugin_note_id',
		'cssclasses',
	],
	includeCanvas: true,
	customCss: '',
	pythonNotebooklmScript: 'export_obsidian_notebooklm.py',
	pythonTrelloScript: 'export_obsidian_trello.py',
	executionEngine: 'native',
};

export interface FileMetadata {
	title: string;
	category: string;
	order: string;
	tags: string[];
	trelloUrl?: string;
	dateCreation?: string;
	dateRevision?: string;
	statut?: string;
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
