/**
 * Single note-cleaning pipeline shared by every export format.
 * Pure TypeScript — no Obsidian imports allowed.
 *
 * The orchestrator builds an `ExportContext` once per run: every note's
 * frontmatter is parsed exactly once (`parseVault`) and shared by the
 * cleaner and the dataview engine.
 */

import { ExporterSettings, FileMetadata, ParsedFile, VaultFile } from './types';
import { defaultFileMetadata, parseFrontmatter } from './frontmatter';
import { buildLinkResolver, transformWikilinks } from './wikilink';
import { normalizePath } from './filter';
import { removeComments, cleanCallouts, sanitizeWhitespace } from './markdownClean';
import { renderDataviewBlocks } from './dataviewEngine';
import { parseCanvasContent } from './canvasParser';

export interface CleanedNote {
	path: string;
	title: string;
	isCanvas: boolean;
	metadata: FileMetadata;
	/** Raw YAML frontmatter (without delimiters), empty if none */
	rawFrontmatter: string;
	/** Cleaned body, frontmatter always removed */
	body: string;
}

/** What the cleaning pipeline and formatters need for one export run. */
export interface ExportContext {
	/** Every loaded file, parsed once */
	parsed: ParsedFile[];
	/** Resolves wikilink targets to real vault paths */
	resolver: (target: string) => string | undefined;
	settings: ExporterSettings;
}

/** Parses frontmatter of every loaded file exactly once. */
export function parseVault(files: VaultFile[]): ParsedFile[] {
	return files.map((file) => {
		const parsed = parseFrontmatter(file.content);
		const normPath = normalizePath(file.path);
		const parts = normPath.split('/');
		return {
			path: normPath,
			name: file.name.replace(/\.(md|canvas)$/i, ''),
			folder: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
			metadata: parsed.metadata,
			mtime: file.mtime,
		};
	});
}

export function createExportContext(files: VaultFile[], settings: ExporterSettings): ExportContext {
	return {
		parsed: parseVault(files),
		resolver: buildLinkResolver(files),
		settings,
	};
}

export function cleanNote(file: VaultFile, ctx: ExportContext): CleanedNote {
	const { settings, parsed, resolver } = ctx;
	const baseName = file.name.replace(/\.(md|canvas)$/i, '');

	if (file.path.endsWith('.canvas')) {
		return {
			path: file.path,
			title: baseName,
			isCanvas: true,
			metadata: defaultFileMetadata(),
			rawFrontmatter: '',
			body: parseCanvasContent(file.content),
		};
	}

	const result = parseFrontmatter(file.content);
	let body = result.contentWithoutFrontmatter;
	if (settings.renderDataview) {
		body = renderDataviewBlocks(body, parsed);
	}
	body = removeComments(body);
	body = cleanCallouts(body);
	body = transformWikilinks(body, settings.wikilinkFormat, resolver);
	body = sanitizeWhitespace(body);

	return {
		path: file.path,
		title: result.metadata.title || baseName,
		isCanvas: false,
		metadata: result.metadata,
		rawFrontmatter: result.rawFrontmatter ?? '',
		body,
	};
}

/** Visible metadata as [label, value] pairs, honoring ignoredProperties. Empty when frontmatter is stripped. */
export function visibleMetadata(note: CleanedNote, settings: ExporterSettings): [string, string][] {
	if (settings.stripFrontmatter || note.isCanvas) {
		return [];
	}
	const meta = note.metadata;
	const pairs: [string, string][] = [];
	if (meta.category) pairs.push(['Category', meta.category]);
	if (meta.order) pairs.push(['Order', meta.order]);
	if (meta.tags.length > 0) pairs.push(['Tags', meta.tags.join(', ')]);
	const ignored = new Set(settings.ignoredProperties.map((p) => p.toLowerCase()));
	for (const [k, v] of Object.entries(meta.custom)) {
		if (!ignored.has(k.toLowerCase()) && v !== undefined && v !== '') {
			pairs.push([k, Array.isArray(v) ? v.join(', ') : String(v)]);
		}
	}
	return pairs;
}
