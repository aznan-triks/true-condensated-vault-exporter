/**
 * Split export.
 * - 'folder-grouped'   : one .txt per top-level folder under the scope root,
 *                        plus one .txt per subfolder for any folder configured
 *                        in `splitSubfolders` or via `splitSubfolderDepth`,
 *                        formatted with `splitSubfolderStyle`
 * - 'individual-files' : one cleaned .md per note, mirroring the vault tree
 */

import {
	ExporterSettings,
	SplitPresetId,
	SplitSubfolderDepth,
	SplitSubfolderStyle,
} from '../core/types';
import { CleanedNote } from '../core/pipeline';
import { normalizePath, pathKey } from '../core/filter';
import { canonicalOutputPath } from '../core/outputTarget';
import { effectiveSplitExtension, normalizeExtension } from '../core/extension';

export interface OutputFile {
	path: string;
	content: string;
}

/** A validated destination whose content is materialized only when consumed. */
export interface OutputPlan {
	path: string;
	render: () => string;
}

export interface SubfolderSplitRule {
	/** Folder path normalized relative to groupingRoot ('' means groupingRoot itself) */
	path: string;
	mode: 'direct' | 'recursive';
}

export interface SplitPresetDefinition {
	id: SplitPresetId;
	shortLabel: string;
	label: string;
	description: string;
	splitMode: 'folder-grouped' | 'individual-files';
	splitSubfolderDepth?: SplitSubfolderDepth;
	splitSubfolderStyle?: SplitSubfolderStyle;
	clearSubfolders?: boolean;
}

export const SPLIT_PRESETS: readonly SplitPresetDefinition[] = [
	{
		id: 'top-level',
		shortLabel: 'Top-level only',
		label: 'Standard — 1 .txt per top-level folder',
		description: 'One .txt file per top-level folder under the scope root. Subfolders stay grouped inside their main folder.',
		splitMode: 'folder-grouped',
		splitSubfolderDepth: 'direct',
		splitSubfolderStyle: 'flat-prefixed',
		clearSubfolders: true,
	},
	{
		id: 'notebooklm-selected',
		shortLabel: 'Selected subfolders (NotebookLM)',
		label: 'NotebookLM — Selected subfolders (Parent - Subfolder.txt)',
		description: 'Flat .txt files in one folder with parent prefix: pick large folders below so they split into Parent - Subfolder.txt.',
		splitMode: 'folder-grouped',
		splitSubfolderDepth: 'direct',
		splitSubfolderStyle: 'flat-prefixed',
	},
	{
		id: 'notebooklm-two-levels',
		shortLabel: 'All 2 levels (flat)',
		label: 'Two levels — All main folders & direct subfolders (Parent - Subfolder.txt)',
		description: 'Automatically creates one flat .txt file for every top-level folder and its direct subfolders (2 levels deep).',
		splitMode: 'folder-grouped',
		splitSubfolderDepth: 'all-two-levels',
		splitSubfolderStyle: 'flat-prefixed',
	},
	{
		id: 'notebooklm-deep',
		shortLabel: 'All subfolders (flat)',
		label: 'Deep flat — Every subfolder at any depth (Parent - Subfolder.txt)',
		description: 'Automatically creates one flat .txt file for every folder and nested subfolder across the scope.',
		splitMode: 'folder-grouped',
		splitSubfolderDepth: 'all-recursive',
		splitSubfolderStyle: 'flat-prefixed',
	},
	{
		id: 'clean-leaf',
		shortLabel: 'Short names (Subfolder.txt)',
		label: 'Compact names — Subfolder name only (Subfolder.txt)',
		description: 'Flat .txt files named only after the final subfolder (auto-disambiguates if two folders share a name).',
		splitMode: 'folder-grouped',
		splitSubfolderDepth: 'recursive',
		splitSubfolderStyle: 'flat-leaf',
	},
	{
		id: 'folder-tree',
		shortLabel: 'Folder tree (Parent/Subfolder.txt)',
		label: 'Folder tree — Keep subfolder directories (Parent/Subfolder.txt)',
		description: 'Mirrors the folder hierarchy inside the split destination with one .txt file per subfolder.',
		splitMode: 'folder-grouped',
		splitSubfolderDepth: 'all-recursive',
		splitSubfolderStyle: 'nested',
	},
	{
		id: 'markdown-mirror',
		shortLabel: '1 .md per note',
		label: 'Markdown mirror — 1 cleaned .md file per note',
		description: 'Exports each note as its own cleaned .md file, preserving the vault folder structure.',
		splitMode: 'individual-files',
	},
] as const;

const RULE = '================================================================================';
const SEPARATOR = '----------------------------------------';
const ROOT_GROUP = 'Root';

function joinPath(base: string, rel: string): string {
	const normalizedBase = base.trim().replace(/[\\/]+$/, '');
	return normalizedBase ? normalizedBase + '/' + rel : rel;
}

function relativeToFolder(notePath: string, folderPath: string): string | null {
	const folder = normalizePath(folderPath);
	const note = normalizePath(notePath);
	if (!folder) return note;
	const depth = folder.split('/').length;
	const segments = note.split('/');
	if (pathKey(segments.slice(0, depth).join('/')).toLowerCase() !== pathKey(folder).toLowerCase()) return null;
	return segments.slice(depth).join('/');
}

/** Portable generated segment; configured destination roots are not rewritten. */
function safeSegment(segment: string): string {
	const safe = segment.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || '_';
	return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe) ? '_' + safe : safe;
}

/** Applies a named split preset onto `settings` and returns `settings`. */
export function applySplitPreset(settings: ExporterSettings, presetId: SplitPresetId): ExporterSettings {
	const preset = SPLIT_PRESETS.find((candidate) => candidate.id === presetId);
	if (!preset) return settings;
	settings.splitMode = preset.splitMode;
	if (preset.splitSubfolderDepth) {
		settings.splitSubfolderDepth = preset.splitSubfolderDepth;
	}
	if (preset.splitSubfolderStyle) {
		settings.splitSubfolderStyle = preset.splitSubfolderStyle;
	}
	if (preset.clearSubfolders) {
		settings.splitSubfolders = [];
	}
	return settings;
}

/** Identifies which split preset matches the current settings, or `'custom'`. */
export function detectSplitPreset(settings: ExporterSettings): SplitPresetId | 'custom' {
	if (settings.splitMode === 'individual-files') {
		return 'markdown-mirror';
	}
	const depth = settings.splitSubfolderDepth ?? 'direct';
	const style = settings.splitSubfolderStyle ?? 'flat-prefixed';
	const hasSubfolders = (settings.splitSubfolders?.length ?? 0) > 0;

	if (depth === 'direct' && style === 'flat-prefixed') {
		return hasSubfolders ? 'notebooklm-selected' : 'top-level';
	}
	if (depth === 'all-two-levels' && style === 'flat-prefixed') {
		return 'notebooklm-two-levels';
	}
	if (depth === 'all-recursive' && style === 'flat-prefixed') {
		return 'notebooklm-deep';
	}
	if (depth === 'recursive' && style === 'flat-leaf') {
		return 'clean-leaf';
	}
	if (depth === 'all-recursive' && style === 'nested') {
		return 'folder-tree';
	}
	return 'custom';
}

/**
 * Parses a user-configured subfolder entry into a normalized rule relative to
 * `groupingRoot`. Entries may end with `/*` (direct subfolders, 1 level) or
 * `/**` (all nested subfolders recursively) to override `defaultDepth`.
 */
export function parseSubfolderSplitRule(
	rawEntry: string,
	groupingRoot: string,
	defaultDepth: SplitSubfolderDepth = 'direct'
): SubfolderSplitRule | null {
	const trimmed = rawEntry.trim().replace(/\\/g, '/');
	if (!trimmed) return null;

	const defaultRuleMode: 'direct' | 'recursive' =
		defaultDepth === 'recursive' || defaultDepth === 'all-recursive' ? 'recursive' : 'direct';
	let mode: 'direct' | 'recursive' = defaultRuleMode;
	let rawFolder = trimmed;
	if (rawFolder === '**' || rawFolder === '/**') {
		return { path: '', mode: 'recursive' };
	}
	if (rawFolder === '*' || rawFolder === '/*') {
		return { path: '', mode: 'direct' };
	}
	if (rawFolder.endsWith('/**')) {
		mode = 'recursive';
		rawFolder = rawFolder.slice(0, -3);
	} else if (rawFolder.endsWith('/*')) {
		mode = 'direct';
		rawFolder = rawFolder.slice(0, -2);
	}

	const normFolder = normalizePath(rawFolder);
	if (!normFolder) return null;

	const normRoot = normalizePath(groupingRoot);
	if (normRoot) {
		const lowerFolder = pathKey(normFolder).toLowerCase();
		const lowerRoot = pathKey(normRoot).toLowerCase();
		if (lowerFolder === lowerRoot) {
			return { path: '', mode };
		}
		if (lowerFolder.startsWith(lowerRoot + '/')) {
			return { path: normFolder.split('/').slice(normRoot.split('/').length).join('/'), mode };
		}
	}

	return { path: normFolder, mode };
}

function resolveNoteGroup(
	notePath: string,
	groupingRoot: string,
	rules: readonly SubfolderSplitRule[],
	defaultDepth: SplitSubfolderDepth = 'direct'
): string {
	const relative = relativeToFolder(notePath, groupingRoot);
	if (!relative || !relative.includes('/')) {
		return ROOT_GROUP;
	}

	const folderSegments = relative.split('/').slice(0, -1);
	const totalDepth = folderSegments.length;
	const noteFolderLower = pathKey(folderSegments.join('/')).toLowerCase();

	const baseDepth = defaultDepth === 'all-recursive'
		? totalDepth
		: defaultDepth === 'all-two-levels'
			? Math.min(totalDepth, 2)
			: 1;

	let directFolderDepth = 1;
	let bestAncestorSpecificity = -1;
	let bestAncestorDepth = baseDepth;

	for (const rule of rules) {
		const ruleLower = pathKey(rule.path).toLowerCase();
		if (ruleLower === '') {
			const candidateDepth = rule.mode === 'recursive' ? totalDepth : 1;
			if (0 > bestAncestorSpecificity || (0 === bestAncestorSpecificity && candidateDepth > bestAncestorDepth)) {
				bestAncestorSpecificity = 0;
				bestAncestorDepth = candidateDepth;
			}
			continue;
		}

		const ruleDepth = rule.path.split('/').length;
		if (noteFolderLower === ruleLower) {
			directFolderDepth = Math.max(directFolderDepth, ruleDepth);
		} else if (noteFolderLower.startsWith(ruleLower + '/')) {
			const candidateDepth = rule.mode === 'recursive'
				? totalDepth
				: Math.min(totalDepth, ruleDepth + 1);
			if (
				ruleDepth > bestAncestorSpecificity ||
				(ruleDepth === bestAncestorSpecificity && candidateDepth > bestAncestorDepth)
			) {
				bestAncestorSpecificity = ruleDepth;
				bestAncestorDepth = candidateDepth;
			}
		}
	}

	const effectiveAncestorDepth = bestAncestorSpecificity >= 0 ? bestAncestorDepth : baseDepth;
	const finalDepth = Math.max(directFolderDepth, effectiveAncestorDepth);
	return folderSegments.slice(0, finalDepth).join('/');
}

/**
 * Assigns filenames or relative paths for each split group according to `style`
 * and `extension` (default `.txt`), preserving published layouts.
 * The output planner rejects remaining collisions.
 */
export function assignGroupFileNames(
	groupPaths: readonly string[],
	style: SplitSubfolderStyle = 'flat-prefixed',
	extension: string = '.txt'
): Map<string, string> {
	const ext = normalizeExtension(extension) || '.txt';
	const lowerExt = ext.toLowerCase();
	const safeParentSegment = (part: string): string => {
		const safe = safeSegment(part);
		return safe.toLowerCase().endsWith(lowerExt)
			? safe.slice(0, safe.length - ext.length) + '_' + ext.slice(1)
			: safe;
	};
	if (style === 'nested') {
		return new Map(groupPaths.map((group) => {
			const segments = group.split('/');
			const parents = segments.slice(0, -1).map(safeParentSegment);
			return [group, [...parents, safeSegment(segments[segments.length - 1] ?? ROOT_GROUP) + ext].join('/')];
		}));
	}
	if (style !== 'flat-leaf') {
		const separator = style === 'flat-underscored' ? '_' : ' - ';
		return new Map(groupPaths.map((group) => [group, group.split('/').map(safeSegment).join(separator) + ext]));
	}
	// Preserve the published leaf-name style: use parents only for shared raw
	// leaf names, never add numbered suffixes to hide a sanitization collision.
	const segments = new Map(groupPaths.map((group) => [group, group.split('/')]));
	const tails = new Map(groupPaths.map((group) => [group, 1]));
	const parts = (group: string): string[] => (segments.get(group) ?? [group]).slice(-(tails.get(group) ?? 1));
	while (true) {
		const buckets = new Map<string, string[]>();
		for (const group of groupPaths) {
			const key = parts(group).join(' - ').toLowerCase();
			const bucket = buckets.get(key);
			if (bucket) bucket.push(group);
			else buckets.set(key, [group]);
		}
		let progressed = false;
		for (const bucket of buckets.values()) {
			if (bucket.length < 2) continue;
			for (const group of bucket) {
				const count = tails.get(group) ?? 1;
				if (count < (segments.get(group)?.length ?? 1)) {
					tails.set(group, count + 1);
					progressed = true;
				}
			}
		}
		if (!progressed) break;
	}
	return new Map(groupPaths.map((group) => [group, parts(group).map(safeSegment).join(' - ') + ext]));
}

/**
 * Returns true when `folderPath` is a valid content folder candidate for split
 * subfolder selection/preview (excludes hidden folders, excluded folders, and
 * the split output destination).
 */
export function isCandidateSplitFolder(folderPath: string, settings: ExporterSettings): boolean {
	const norm = normalizePath(folderPath);
	if (!norm) return false;
	const parts = norm.split('/');
	if (parts.some((part) => part.startsWith('.'))) return false;
	const splitOut = normalizePath(settings.splitOutputFolder);
	if (splitOut && (norm.toLowerCase() === splitOut.toLowerCase() || norm.toLowerCase().startsWith(splitOut.toLowerCase() + '/'))) {
		return false;
	}
	for (const excluded of settings.excludedFolders ?? []) {
		const normEx = normalizePath(excluded);
		if (normEx && (norm.toLowerCase() === normEx.toLowerCase() || norm.toLowerCase().startsWith(normEx.toLowerCase() + '/'))) {
			return false;
		}
	}
	return true;
}

/**
 * Builds representative sample output paths for the current split settings so
 * the settings UI can display an immediate live preview.
 */
export function previewSplitFiles(settings: ExporterSettings, vaultFolders?: readonly string[]): string[] {
	const base = settings.splitOutputFolder.trim() || '(vault root)';
	const joinPreview = (rel: string): string => (settings.splitOutputFolder.trim() ? joinPath(base, rel) : rel);
	const ext = effectiveSplitExtension(settings);

	if (settings.splitMode === 'individual-files') {
		return [
			joinPreview('Projects/Web/Frontend/Overview' + ext),
			joinPreview('Projects/Mobile/Roadmap' + ext),
			joinPreview('Notes/Research' + ext),
		];
	}

	const groupingRoot = normalizePath(settings.splitGroupFolder) || normalizePath(settings.scopeRoot);
	const defaultDepth: SplitSubfolderDepth = settings.splitSubfolderDepth ?? 'direct';
	const style: SplitSubfolderStyle = settings.splitSubfolderStyle ?? 'flat-prefixed';
	const rules = (settings.splitSubfolders ?? [])
		.map((entry) => parseSubfolderSplitRule(entry, groupingRoot, defaultDepth))
		.filter((rule): rule is SubfolderSplitRule => rule !== null);

	// Synthesize realistic note paths from the user's configured folders (or vault folders)
	const sampleNotePaths: string[] = [];
	const prefixRoot = (rel: string): string => (groupingRoot ? groupingRoot + '/' + rel : rel);

	if (rules.length > 0) {
		for (const rule of rules.slice(0, 2)) {
			const folder = rule.path || 'Projects';
			sampleNotePaths.push(prefixRoot(folder + '/SubfolderA/Note1.md'));
			sampleNotePaths.push(prefixRoot(folder + '/SubfolderA/Deep/Note2.md'));
			sampleNotePaths.push(prefixRoot(folder + '/SubfolderB/Note3.md'));
		}
		sampleNotePaths.push(prefixRoot('OtherFolder/Nested/Note4.md'));
	} else {
		const candidateFolders = (vaultFolders ?? []).filter((folder) => isCandidateSplitFolder(folder, settings));
		const nestedVaultFolders = candidateFolders
			.map((folder) => (groupingRoot ? relativeToFolder(folder, groupingRoot) : normalizePath(folder)))
			.filter((folder): folder is string => Boolean(folder && folder.includes('/')));
		if (nestedVaultFolders.length > 0) {
			for (const folder of nestedVaultFolders.slice(0, 4)) {
				sampleNotePaths.push(prefixRoot(folder + '/Note.md'));
			}
		} else {
			sampleNotePaths.push(
				prefixRoot('Projects/Web/Frontend/App.md'),
				prefixRoot('Projects/Mobile/Roadmap.md'),
				prefixRoot('Notes/Archive/Summary.md')
			);
		}
	}

	const groups = new Set<string>();
	for (const notePath of sampleNotePaths) {
		groups.add(resolveNoteGroup(notePath, groupingRoot, rules, defaultDepth));
	}
	const fileNames = assignGroupFileNames([...groups], style, ext);
	return [...fileNames.values()].slice(0, 5).map((fileName) => joinPreview(fileName));
}

export function planSplitFiles(notes: CleanedNote[], settings: ExporterSettings): OutputPlan[] {
	const base = settings.splitOutputFolder;
	const ext = effectiveSplitExtension(settings);
	const destinations = new Map<string, { path: string; source: string }>();
	const output = (path: string, render: () => string, source: string): OutputPlan => {
		const key = canonicalOutputPath(path).toLowerCase();
		const previous = destinations.get(key);
		if (previous) {
			throw new Error('Two split outputs would be written to "' + path + '": ' + previous.source + ' and ' + source + '. Rename one note or folder, or use another split mode.');
		}
		destinations.set(key, { path, source });
		return { path, render };
	};

	if (settings.splitMode === 'individual-files') {
		return notes.map((note) => {
			const frontmatter = !settings.stripFrontmatter && note.rawFrontmatter
				? '---\n' + note.rawFrontmatter + '\n---\n\n'
				: '';
			const rawRel = relativeToFolder(note.path, settings.scopeRoot) ?? note.path;
			const parts = rawRel.split('/');
			const lastIdx = parts.length - 1;
			const stem = (parts[lastIdx] ?? '').replace(/\.(?:md|canvas)$/i, '');
			const rel = [...parts.slice(0, lastIdx).map(safeSegment), safeSegment(stem) + ext].join('/');
			return output(joinPath(base, rel), () => frontmatter + note.body, '"' + note.path + '"');
		});
	}

	const groupingRoot = normalizePath(settings.splitGroupFolder) || normalizePath(settings.scopeRoot);
	const defaultDepth = settings.splitSubfolderDepth ?? 'direct';
	const style = settings.splitSubfolderStyle ?? 'flat-prefixed';
	const rules = (settings.splitSubfolders ?? []).map((entry) => parseSubfolderSplitRule(entry, groupingRoot, defaultDepth)).filter((rule): rule is SubfolderSplitRule => rule !== null);
	const groups = new Map<string, CleanedNote[]>();
	for (const note of notes) {
		const group = resolveNoteGroup(note.path, groupingRoot, rules, defaultDepth);
		const list = groups.get(group);
		if (list) list.push(note);
		else groups.set(group, [note]);
	}

	const fileNames = assignGroupFileNames([...groups.keys()], style, ext);
	return [...groups.entries()].map(([group, groupNotes]) => {
		const safeName = fileNames.get(group) ?? safeSegment(group) + ext;
		return output(joinPath(base, safeName), () => {
			const lines = [RULE, 'Folder: ' + group, 'Documents: ' + groupNotes.length, RULE, ''];
			for (const note of groupNotes) {
				lines.push('', SEPARATOR, note.title + ' (' + note.path + ')', SEPARATOR, '', note.body, '');
			}
			return lines.join('\n');
		}, 'folder "' + group + '"');
	});
}

/** Existing eager API for callers that need all split contents at once. */
export function buildSplitFiles(notes: CleanedNote[], settings: ExporterSettings): OutputFile[] {
	return planSplitFiles(notes, settings).map((out) => ({ path: out.path, content: out.render() }));
}
