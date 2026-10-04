/**
 * Vault file filtering logic.
 * Enforces dynamic blacklist rules for folders, files, and prefixes,
 * plus protection against re-exporting previous export outputs.
 */

export interface FilterOptions {
	scopeRoot: string;
	excludedFolders: string[];
	excludedFiles: string[];
	excludedPrefixes: string[];
	includeCanvas?: boolean;
	/** When set, only this exact vault-relative path is included. */
	onlyPath?: string;
	/**
	 * Configured output locations (consolidated files, ZIP, split folder)
	 * expressed as vault-relative paths. Any file equal to, or inside, one
	 * of these paths is never exported — this prevents previous exports
	 * from being re-ingested on the next run (feedback loop).
	 */
	reservedPaths?: string[];
}

/**
 * Normalizes a path to forward slashes without leading/trailing slashes.
 */
export function normalizePath(p: string): string {
	const parts: string[] = [];
	for (const part of p.trim().replace(/\\/g, '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
			else parts.push(part);
			continue;
		}
		parts.push(part);
	}
	return parts.join('/');
}

/** Matches a selected tag against Obsidian tags, including nested tags. */
export function matchesTag(tags: readonly string[], selectedTag: string): boolean {
	const normalizeTag = (tag: string): string =>
		tag.trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, '').toLowerCase();
	const selected = normalizeTag(selectedTag);
	if (!selected) return false;
	return tags.some((tag) => {
		const value = normalizeTag(tag);
		return value === selected || value.startsWith(selected + '/');
	});
}

/** Tag filters apply to Markdown notes only; Canvas files have no tag scope. */
export function isTagScopeMatch(filePath: string, tags: readonly string[], selectedTag: string): boolean {
	if (!selectedTag.trim()) return true;
	if (filePath.toLowerCase().endsWith('.canvas')) return false;
	return matchesTag(tags, selectedTag);
}

/** Suffix of the files produced by "Export current note as clean Markdown". */
export const CLEAN_EXPORT_SUFFIX = ' (clean export).md';

/** True when the file is one of our own clean-export artifacts (never re-exported). */
export function isCleanExportArtifact(fileName: string): boolean {
	return fileName.toLowerCase().endsWith(CLEAN_EXPORT_SUFFIX);
}

/**
 * Checks if a file path is included according to blacklist criteria.
 * @param relativePath Vault-relative path, e.g. 'Notes/Topic/Doc.md' or 'index.md'
 * @param options Filter options
 */
export function isFileIncluded(relativePath: string, options: FilterOptions): boolean {
	const normPath = normalizePath(relativePath);
	if (!normPath) {
		return false;
	}

	const lowerPath = normPath.toLowerCase();
	const isMd = lowerPath.endsWith('.md');
	const isCanvas = lowerPath.endsWith('.canvas');
	if (!isMd && !(isCanvas && options.includeCanvas)) {
		return false;
	}

	// Our own clean-export artifacts are never re-ingested (prevents a second
	// feedback loop for the "Export current note" command).
	const base = normPath.split('/').pop() ?? '';
	if (isCleanExportArtifact(base)) {
		return false;
	}

	const parts = normPath.split('/');
	const fileName = parts[parts.length - 1] ?? '';
	const parentFolder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

	// 0. Only-path override (context commands) wins over everything else
	const normOnly = options.onlyPath ? normalizePath(options.onlyPath) : '';
	if (normOnly && normPath !== normOnly) {
		return false;
	}

	// 1. Check scope root if specified
	const normScope = normalizePath(options.scopeRoot);
	if (normScope && normScope.length > 0) {
		if (!normPath.startsWith(normScope + '/') && normPath !== normScope) {
			return false;
		}
	}

	// 2. Reserved output paths (previous export results) are never exported again
	for (const reserved of options.reservedPaths ?? []) {
		const normReserved = normalizePath(reserved);
		if (!normReserved) continue;
		if (normPath === normReserved || normPath.startsWith(normReserved + '/')) {
			return false;
		}
	}

	// 3. Check excluded files (match against full path or just filename)
	for (const excludedFile of options.excludedFiles) {
		const normExcluded = normalizePath(excludedFile);
		if (!normExcluded) continue;
		if (fileName.toLowerCase() === normExcluded.toLowerCase() ||
			normPath.toLowerCase() === normExcluded.toLowerCase() ||
			normPath.toLowerCase().endsWith('/' + normExcluded.toLowerCase())) {
			return false;
		}
	}

	// 4. Check hidden folders or system directories
	for (const part of parts.slice(0, -1)) {
		if (part.startsWith('.')) {
			return false;
		}
	}

	// 5. Check excluded folders (exact match or path contains folder)
	for (const excludedFolder of options.excludedFolders) {
		const normExcluded = normalizePath(excludedFolder);
		if (!normExcluded) continue;

		// Full parent folder match
		if (parentFolder.toLowerCase() === normExcluded.toLowerCase()) {
			return false;
		}
		// Subfolder of excluded folder
		if (parentFolder.toLowerCase().startsWith(normExcluded.toLowerCase() + '/')) {
			return false;
		}
		// Any folder segment match
		for (const part of parts.slice(0, -1)) {
			if (part.toLowerCase() === normExcluded.toLowerCase()) {
				return false;
			}
		}
	}

	// 6. Check excluded prefixes on any folder part
	for (const prefix of options.excludedPrefixes) {
		if (!prefix) continue;
		const lowPrefix = prefix.toLowerCase();
		for (const part of parts.slice(0, -1)) {
			if (part.toLowerCase().startsWith(lowPrefix)) {
				return false;
			}
		}
	}

	return true;
}

/**
 * Builds the list of output locations that must be protected from export,
 * from the current settings.
 */
function isAbsoluteOutputPath(value: string): boolean {
	return /^(?:[a-z]:[\\/]|[\\/]{1,2})/i.test(value.trim());
}

export function reservedOutputPaths(settings: {
	notebooklmOutputPath: string;
	htmlOutputPath: string;
	markdownOutputPath: string;
	zipOutputPath: string;
	splitOutputFolder: string;
}): string[] {
	return [
		settings.notebooklmOutputPath,
		settings.htmlOutputPath,
		settings.markdownOutputPath,
		settings.zipOutputPath,
		settings.splitOutputFolder,
	].filter((p) => p && p.trim().length > 0 && !isAbsoluteOutputPath(p));
}
