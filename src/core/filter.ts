/**
 * Vault file filtering logic.
 * Enforces dynamic blacklist rules for folders, files, and prefixes.
 */

export interface FilterOptions {
	scopeRoot: string;
	excludedFolders: string[];
	excludedFiles: string[];
	excludedPrefixes: string[];
	includeCanvas?: boolean;
}

/**
 * Normalizes a path to forward slashes without leading/trailing slashes.
 */
export function normalizePath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
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

	const isMd = normPath.endsWith('.md');
	const isCanvas = normPath.endsWith('.canvas');
	if (!isMd && !(isCanvas && options.includeCanvas)) {
		return false;
	}

	const parts = normPath.split('/');
	const fileName = parts[parts.length - 1] ?? '';
	const parentFolder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

	// 1. Check scope root if specified
	const normScope = normalizePath(options.scopeRoot);
	if (normScope && normScope.length > 0) {
		if (!normPath.startsWith(normScope + '/') && normPath !== normScope) {
			return false;
		}
	}

	// 2. Check excluded files (match against full path or just filename)
	for (const excludedFile of options.excludedFiles) {
		const normExcluded = normalizePath(excludedFile);
		if (!normExcluded) continue;
		if (fileName.toLowerCase() === normExcluded.toLowerCase() ||
			normPath.toLowerCase() === normExcluded.toLowerCase() ||
			normPath.toLowerCase().endsWith('/' + normExcluded.toLowerCase())) {
			return false;
		}
	}

	// 3. Check hidden folders or system directories
	for (const part of parts.slice(0, -1)) {
		if (part.startsWith('.')) {
			return false;
		}
	}

	// 4. Check excluded folders (exact match or path contains folder)
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

	// 5. Check excluded prefixes on any folder part
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
