/**
 * Vault file filtering logic.
 * Enforces dynamic blacklist rules for folders, files, and prefixes,
 * plus protection against re-exporting previous export outputs.
 */

import { isAbsoluteOutputPath, resolveConsolidatedExtensionPaths, resolveOutputPath, vaultRelativeOutputPath } from './outputTarget';

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

export interface CompiledFilter {
	scopeRootNorm: string;
	includeCanvas: boolean;
	onlyPathNorm: string;
	reservedPathsNorm: string[];
	excludedFilesNorm: string[];
	excludedFoldersNorm: string[];
	excludedPrefixesNorm: string[];
}

export function compileFilter(options: FilterOptions): CompiledFilter {
	return {
		scopeRootNorm: options.scopeRoot ? pathKey(options.scopeRoot) : '',
		includeCanvas: Boolean(options.includeCanvas),
		onlyPathNorm: options.onlyPath ? pathKey(options.onlyPath) : '',
		reservedPathsNorm: (options.reservedPaths ?? []).map((p) => pathKey(p)).filter(Boolean),
		excludedFilesNorm: options.excludedFiles.map((f) => pathKey(f).toLowerCase()).filter(Boolean),
		excludedFoldersNorm: options.excludedFolders.map((f) => pathKey(f).toLowerCase()).filter(Boolean),
		excludedPrefixesNorm: options.excludedPrefixes.map((p) => pathKey(p).toLowerCase()).filter(Boolean),
	};
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

/**
 * Comparison-only key: NFC text matches NFD disk names without renaming either.
 * Canonically equivalent Linux names intentionally share a key for portable exports.
 */
export function pathKey(value: string): string {
	return normalizePath(value).normalize('NFC');
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

/** True when the file is one of our own clean-export artifacts (never re-exported, regardless of extension). */
export function isCleanExportArtifact(fileName: string): boolean {
	return / \(clean export\)\.[^/\\]+$/i.test(fileName);
}

/**
 * Checks if a file path is included according to blacklist criteria.
 * Supports passing a pre-compiled filter for high-throughput scanning.
 * @param relativePath Vault-relative path, e.g. 'Notes/Topic/Doc.md' or 'index.md'
 * @param options Filter options or pre-compiled filter
 */
export function isFileIncluded(relativePath: string, options: FilterOptions | CompiledFilter): boolean {
	const lower = relativePath.toLowerCase();
	const isMd = lower.endsWith('.md');
	const isCanvas = lower.endsWith('.canvas');
	const includeCanvas = 'includeCanvas' in options ? Boolean(options.includeCanvas) : false;
	if (!isMd && !(isCanvas && includeCanvas)) {
		return false;
	}

	const normPath = pathKey(relativePath);
	if (!normPath) {
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
	const lowerNormPath = normPath.toLowerCase();
	const lowerFileName = fileName.toLowerCase();
	const lowerParentFolder = parentFolder.toLowerCase();

	const compiled: CompiledFilter = 'scopeRootNorm' in options
		? (options as CompiledFilter)
		: compileFilter(options as FilterOptions);

	// 0. Only-path override (context commands) wins over everything else
	if (compiled.onlyPathNorm && normPath !== compiled.onlyPathNorm) {
		return false;
	}

	// 1. Check scope root if specified
	if (compiled.scopeRootNorm && compiled.scopeRootNorm.length > 0) {
		if (!normPath.startsWith(compiled.scopeRootNorm + '/') && normPath !== compiled.scopeRootNorm) {
			return false;
		}
	}

	// 2. Reserved output paths (previous export results) are never exported again
	for (const normReserved of compiled.reservedPathsNorm) {
		if (normPath === normReserved || normPath.startsWith(normReserved + '/')) {
			return false;
		}
	}

	// 3. Check excluded files (match against full path or just filename)
	for (const normExcluded of compiled.excludedFilesNorm) {
		if (lowerFileName === normExcluded ||
			lowerNormPath === normExcluded ||
			lowerNormPath.endsWith('/' + normExcluded)) {
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
	for (const normExcluded of compiled.excludedFoldersNorm) {
		// Full parent folder match
		if (lowerParentFolder === normExcluded) {
			return false;
		}
		// Subfolder of excluded folder
		if (lowerParentFolder.startsWith(normExcluded + '/')) {
			return false;
		}
		// Any folder segment match
		for (const part of parts.slice(0, -1)) {
			if (part.toLowerCase() === normExcluded) {
				return false;
			}
		}
	}

	// 6. Check excluded prefixes on any folder part
	for (const lowPrefix of compiled.excludedPrefixesNorm) {
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
 *
 * Absolute locations (external output folder, absolute per-format paths) are
 * mapped back to a vault-relative path when they live inside the vault and a
 * `vaultBasePath` is provided; locations outside the vault need no protection.
 * Set `alreadyResolved` for per-run paths from `resolveOutputSettings` to avoid
 * re-rooting absolute split folders. The default accepts raw saved settings.
 */
export function reservedOutputPaths(settings: {
	notebooklmOutputPath: string;
	htmlOutputPath: string;
	markdownOutputPath: string;
	zipOutputPath: string;
	splitOutputFolder: string;
	outputExtension?: string;
	useExternalOutputFolder?: boolean;
	externalOutputFolder?: string;
}, options?: { vaultBasePath?: string | null; alreadyResolved?: boolean }): string[] {
	const external = {
		useExternalOutputFolder: settings.useExternalOutputFolder === true,
		externalOutputFolder: settings.externalOutputFolder ?? '',
	};
	const consolidated = options?.alreadyResolved
		? {
			notebooklmOutputPath: settings.notebooklmOutputPath,
			htmlOutputPath: settings.htmlOutputPath,
			markdownOutputPath: settings.markdownOutputPath,
		}
		: resolveConsolidatedExtensionPaths(settings);
	const vaultBasePath = options?.vaultBasePath?.trim() ?? '';
	const reserved: string[] = [];
	for (const candidate of [
		consolidated.notebooklmOutputPath,
		consolidated.htmlOutputPath,
		consolidated.markdownOutputPath,
		settings.zipOutputPath,
		settings.splitOutputFolder,
	]) {
		if (!candidate || candidate.trim().length === 0) continue;
		const resolved = options?.alreadyResolved ? candidate : resolveOutputPath(external, candidate);
		if (!isAbsoluteOutputPath(resolved)) {
			reserved.push(resolved);
			continue;
		}
		if (!vaultBasePath) continue;
		const relative = vaultRelativeOutputPath(resolved, vaultBasePath);
		if (relative) reserved.push(relative);
	}
	return reserved;
}
