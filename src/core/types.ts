/**
 * Core domain types for vault-exporter.
 * Pure TypeScript — no Obsidian imports allowed.
 */

export interface VaultFile {
	/** Relative path from vault root, e.g. 'Notes/Topic/Doc.md' or 'index.md' */
	path: string;
	/** File basename without path, e.g. 'Chronologie.md' */
	name: string;
	/** Raw markdown content */
	content: string;
	/** Last modified timestamp in ms */
	mtime?: number;
}

export type WikilinkFormat = 'clean-text' | 'keep-wikilink' | 'markdown' | 'canonical-alias';

export interface ExporterSettings {
	/** Title written at the top of consolidated exports */
	documentTitle: string;
	/** Folder from which relative scanning occurs, empty string means vault root */
	scopeRoot: string;
	/** Folders to strictly exclude (exact relative paths or prefix match) */
	excludedFolders: string[];
	/** Exact filenames (with or without path) to exclude */
	excludedFiles: string[];
	/** Path prefix substrings that cause exclusion if found anywhere in folder path (e.g. '00_') */
	excludedPrefixes: string[];
	/** Output path for NotebookLM consolidated file (vault-relative or absolute) */
	notebooklmOutputPath: string;
	/** Output path for HTML consolidated file */
	htmlOutputPath: string;
	/** Output path for Markdown consolidated file */
	markdownOutputPath: string;
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
	/** Number of notes processed between two UI yields (keeps Obsidian responsive, allows cancel) */
	yieldEvery: number;
}

export const DEFAULT_SETTINGS: ExporterSettings = {
	documentTitle: 'Vault export',
	scopeRoot: '',
	excludedFolders: ['.obsidian', '.trash', '.git'],
	excludedFiles: [],
	excludedPrefixes: [],
	notebooklmOutputPath: 'Vault export - NotebookLM.txt',
	htmlOutputPath: 'Vault export.html',
	markdownOutputPath: 'Vault export.md',
	splitMode: 'folder-grouped',
	splitGroupFolder: '',
	splitOutputFolder: 'Vault export - split',
	stripFrontmatter: true,
	renderDataview: true,
	wikilinkFormat: 'clean-text',
	ignoredProperties: ['cssclasses'],
	includeCanvas: true,
	customCss: '',
	yieldEvery: 25,
};

/** Keeps only known keys, so obsolete saved settings are dropped on load. */
export function mergeSettings(loaded: unknown): ExporterSettings {
	const result: ExporterSettings = { ...DEFAULT_SETTINGS };
	if (loaded && typeof loaded === 'object') {
		for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ExporterSettings)[]) {
			const value = (loaded as Record<string, unknown>)[key];
			if (value !== undefined) {
				(result as unknown as Record<string, unknown>)[key] = value;
			}
		}
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

/** What the export features need from the host (implemented by the Obsidian gateway, faked in tests). */
export interface ExportGateway {
	loadVaultFiles(settings: ExporterSettings): Promise<VaultFile[]>;
	/** Writes a text file to a vault-relative or absolute path, creating parent folders. */
	writeFile(targetPath: string, content: string): Promise<void>;
}
