/**
 * Custom file extension normalization and path helpers.
 * Pure TypeScript — no Obsidian imports allowed.
 */

export const COMMON_EXPORT_EXTENSIONS = [
	'.md',
	'.txt',
	'.markdown',
	'.mdx',
	'.html',
	'.org',
	'.rst',
	'.adoc',
	'.tex',
	'.json',
	'.xml',
] as const;

export const MAX_EXTENSION_LENGTH = 32;

/**
 * Normalizes a user-supplied file extension:
 * - Empty or whitespace-only values return `''` (keep each target's default extension).
 * - Strips leading dots, trailing dots/spaces, path separators, and unsafe filename characters.
 * - Collapses consecutive dots (supports multi-part extensions like `.llm.txt` while blocking `..`).
 * - Always returns a leading dot when non-empty (e.g. `'txt'` -> `'.txt'`, `'.mdx'` -> `'.mdx'`).
 */
export function normalizeExtension(raw: string): string {
	if (typeof raw !== 'string') return '';
	const trimmed = raw.trim().replace(/^\*+/, '').trim();
	if (!trimmed || /[<>:"/\\|?*\u0000-\u001f]/.test(trimmed)) return '';
	const cleaned = trimmed
		.replace(/^\.+/, '')
		.replace(/[.\s]+$/, '')
		.replace(/\.{2,}/g, '.')
		.slice(0, MAX_EXTENSION_LENGTH)
		.replace(/[.\s]+$/, '')
		.toLowerCase();
	return cleaned ? '.' + cleaned : '';
}

/**
 * Replaces (or appends) the file extension on the final segment of `filePath`
 * without altering parent folder names that contain dots (e.g. `Out/v2.0/notes`).
 * Empty paths and trailing-slash directory paths are returned unchanged so normal
 * output path validation continues to catch them.
 */
export function replaceFileExtension(filePath: string, extension: string): string {
	const ext = normalizeExtension(extension);
	if (!ext) return filePath;
	const trimmed = filePath.trim();
	if (!trimmed || /[\\/]$/.test(trimmed)) return filePath;

	const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	const dirPrefix = lastSep >= 0 ? trimmed.slice(0, lastSep + 1) : '';
	const leaf = lastSep >= 0 ? trimmed.slice(lastSep + 1) : trimmed;
	if (!leaf || leaf === '.' || leaf === '..') return filePath;

	const dotIndex = leaf.lastIndexOf('.');
	const stem = dotIndex > 0 ? leaf.slice(0, dotIndex) : leaf;
	return dirPrefix + stem + ext;
}

/**
 * Appends `suffix` before the extension of the final filename segment
 * (e.g. `appendFileStemSuffix('Vault export.txt', ' - HTML')` -> `'Vault export - HTML.txt'`).
 */
export function appendFileStemSuffix(filePath: string, suffix: string): string {
	const trimmed = filePath.trim();
	if (!trimmed || !suffix) return filePath;
	const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	const dirPrefix = lastSep >= 0 ? trimmed.slice(0, lastSep + 1) : '';
	const leaf = lastSep >= 0 ? trimmed.slice(lastSep + 1) : trimmed;
	const dotIndex = leaf.indexOf('.');
	const stem = dotIndex > 0 ? leaf.slice(0, dotIndex) : leaf;
	const ext = dotIndex > 0 ? leaf.slice(dotIndex) : '';
	return dirPrefix + stem + suffix + ext;
}

/**
 * Resolves the effective file extension for split outputs:
 * 1. Explicit `splitFileExtension` when set
 * 2. Global `outputExtension` when set
 * 3. Mode default: `.md` for `'individual-files'`, `.txt` for `'folder-grouped'`
 */
export function effectiveSplitExtension(settings: {
	splitMode: 'folder-grouped' | 'individual-files';
	splitFileExtension?: string;
	outputExtension?: string;
}): string {
	return (
		normalizeExtension(settings.splitFileExtension ?? '') ||
		normalizeExtension(settings.outputExtension ?? '') ||
		(settings.splitMode === 'individual-files' ? '.md' : '.txt')
	);
}
