/**
 * Output destination resolution.
 *
 * Exports normally land inside the vault, but a user can redirect every output
 * to an external folder (an absolute OS path). This module owns the pure path
 * math: portability/canonicalization, re-rooting configured output paths under
 * the external folder, and mapping an absolute output back to a vault-relative
 * path when it happens to live inside the vault (so previous external outputs
 * are still protected from re-export).
 */

import { ExporterSettings } from './types';
import { appendFileStemSuffix, normalizeExtension, replaceFileExtension } from './extension';

/** The two settings that control external output redirection. */
export interface ExternalOutputSettings {
	useExternalOutputFolder: boolean;
	externalOutputFolder: string;
}

/** True for paths rooted at a drive (`C:\…`), a UNC share (`\\server\…`) or `/`. */
export function isAbsoluteOutputPath(value: string): boolean {
	return /^(?:[a-z]:[\\/]|[\\/]{1,2})/i.test(value.trim());
}

/**
 * Normalizes separators and `.`/`..` segments without changing letter case.
 * UNC and root prefixes are preserved.
 */
function normalizePortablePath(value: string): string {
	const path = value.trim().replace(/\\/g, '/');
	const drive = path.match(/^([a-z]):\//i)?.[1];
	const prefix = drive ? drive + ':/' : path.startsWith('//') ? '//' : path.startsWith('/') ? '/' : '';
	const start = drive ? 3 : prefix === '//' ? 2 : prefix === '/' ? 1 : 0;
	const parts: string[] = [];
	for (const part of path.slice(start).split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (parts.length > 0) parts.pop();
			continue;
		}
		parts.push(part);
	}
	return prefix + parts.join('/');
}

/**
 * Portable, comparable form of a path: forward slashes, `..`/`.` resolved,
 * drive letters lower-cased, UNC/root prefixes preserved. Windows compares
 * case-insensitively, so paths with a drive letter are lower-cased as well.
 */
export function canonicalOutputPath(value: string): string {
	const normalized = normalizePortablePath(value);
	const drive = /^([a-z]):\//i.test(normalized);
	return drive ? normalized.toLowerCase() : normalized;
}

/** Last segment (file or folder name) of a path, ignoring a trailing slash. */
export function outputLeafName(value: string): string {
	const parts = normalizePortablePath(value).split('/').filter(Boolean);
	return parts[parts.length - 1] ?? '';
}

/** Normalizes a configured external folder to a joinable base (`C:/Exports`, `/home/you/Exports`). */
export function externalFolderBase(value: string): string {
	const normalized = normalizePortablePath(value);
	if (/^[a-z]:\/?$/i.test(normalized)) return normalized.replace(/\/?$/, '/');
	return normalized.replace(/\/+$/, '');
}

function joinPath(base: string, relative: string): string {
	if (!relative) return base;
	return base.endsWith('/') ? base + relative : base + '/' + relative;
}

/**
 * True when exports are redirected to a usable external folder: the option is
 * on and the configured folder is an absolute path.
 */
export function usesExternalOutputFolder(settings: ExternalOutputSettings): boolean {
	if (!settings.useExternalOutputFolder) return false;
	const folder = settings.externalOutputFolder?.trim() ?? '';
	return folder.length > 0 && isAbsoluteOutputPath(folder);
}

/**
 * Re-roots one configured output path inside the external folder.
 * Relative paths keep their structure (`Out/notes.html` → `<external>/Out/notes.html`);
 * absolute paths contribute only their last segment, so nothing is written
 * outside the selected folder. Returns the input unchanged when external
 * output is disabled or the folder is unusable.
 */
export function resolveOutputPath(settings: ExternalOutputSettings, targetPath: string): string {
	if (!usesExternalOutputFolder(settings)) return targetPath;
	const trimmed = targetPath?.trim() ?? '';
	if (!trimmed) return trimmed;
	const relative = isAbsoluteOutputPath(trimmed)
		? outputLeafName(trimmed)
		: normalizePortablePath(trimmed).replace(/^\/+/, '');
	if (!relative) return trimmed;
	return joinPath(externalFolderBase(settings.externalOutputFolder), relative);
}

export interface ExtensionOutputPaths {
	notebooklmOutputPath: string;
	htmlOutputPath: string;
	markdownOutputPath: string;
	outputExtension?: string;
}

/**
 * Applies `outputExtension` across consolidated document paths with deterministic
 * stem collision disambiguation so multiple formats never overwrite one another.
 */
export function resolveConsolidatedExtensionPaths(settings: ExtensionOutputPaths): {
	notebooklmOutputPath: string;
	htmlOutputPath: string;
	markdownOutputPath: string;
} {
	const ext = normalizeExtension(settings.outputExtension ?? '');
	if (!ext) {
		return {
			notebooklmOutputPath: settings.notebooklmOutputPath,
			htmlOutputPath: settings.htmlOutputPath,
			markdownOutputPath: settings.markdownOutputPath,
		};
	}

	const entries: Array<{
		key: 'markdownOutputPath' | 'notebooklmOutputPath' | 'htmlOutputPath';
		raw: string;
		suffix: string;
	}> = [
		{ key: 'markdownOutputPath', raw: settings.markdownOutputPath, suffix: ' - Markdown' },
		{ key: 'notebooklmOutputPath', raw: settings.notebooklmOutputPath, suffix: ' - NotebookLM' },
		{ key: 'htmlOutputPath', raw: settings.htmlOutputPath, suffix: ' - HTML' },
	];

	const taken = new Set<string>();
	const out = {
		notebooklmOutputPath: settings.notebooklmOutputPath,
		htmlOutputPath: settings.htmlOutputPath,
		markdownOutputPath: settings.markdownOutputPath,
	};

	for (const entry of entries) {
		let candidate = replaceFileExtension(entry.raw, ext);
		const candidateKey = canonicalOutputPath(candidate).toLowerCase();
		if (candidateKey && taken.has(candidateKey)) {
			candidate = appendFileStemSuffix(candidate, entry.suffix);
		}
		const finalKey = canonicalOutputPath(candidate).toLowerCase();
		if (finalKey) taken.add(finalKey);
		out[entry.key] = candidate;
	}

	return out;
}

/**
 * Returns a copy of the settings whose output paths have `outputExtension` applied
 * and (when enabled) are re-rooted inside the external folder. No-op (same object)
 * when both options are inactive, so default paths behave identically.
 */
export function resolveOutputSettings(settings: ExporterSettings): ExporterSettings {
	const hasExt = Boolean(normalizeExtension(settings.outputExtension));
	const hasExternal = usesExternalOutputFolder(settings);
	if (!hasExt && !hasExternal) return settings;

	const extended = resolveConsolidatedExtensionPaths(settings);
	if (!hasExternal) {
		return {
			...settings,
			...extended,
		};
	}

	return {
		...settings,
		notebooklmOutputPath: resolveOutputPath(settings, extended.notebooklmOutputPath),
		htmlOutputPath: resolveOutputPath(settings, extended.htmlOutputPath),
		markdownOutputPath: resolveOutputPath(settings, extended.markdownOutputPath),
		zipOutputPath: resolveOutputPath(settings, settings.zipOutputPath),
		// A blank split destination means "the output root": inside the vault
		// that is the vault root, with external output it is the external folder.
		splitOutputFolder: settings.splitOutputFolder.trim()
			? resolveOutputPath(settings, settings.splitOutputFolder)
			: externalFolderBase(settings.externalOutputFolder),
	};
}

/**
 * Vault-relative form of an absolute path that lives inside the vault, or
 * `null` when it does not. Used to keep protecting outputs written back into
 * the vault (for example when the external folder is a vault subfolder).
 */
export function vaultRelativeOutputPath(absolutePath: string, vaultBasePath: string): string | null {
	const target = normalizePortablePath(absolutePath);
	const base = normalizePortablePath(vaultBasePath).replace(/\/+$/, '');
	if (!base) return null;
	const targetKey = canonicalOutputPath(target);
	const baseKey = canonicalOutputPath(base);
	if (targetKey === baseKey || !targetKey.startsWith(baseKey + '/')) return null;
	return target.slice(base.length + 1).replace(/^\/+/, '');
}
