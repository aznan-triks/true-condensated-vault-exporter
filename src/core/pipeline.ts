/**
 * Single note-cleaning pipeline shared by every export format.
 * Pure TypeScript — no Obsidian imports allowed.
 */

import { ExporterSettings, FileMetadata, VaultFile } from './types';
import { parseFrontmatter } from './frontmatter';
import { transformWikilinks } from './wikilink';
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

export function cleanNote(file: VaultFile, allFiles: VaultFile[], settings: ExporterSettings): CleanedNote {
	const baseName = file.name.replace(/\.(md|canvas)$/, '');

	if (file.path.endsWith('.canvas')) {
		const parsedCanvas = parseFrontmatter('');
		return {
			path: file.path,
			title: baseName,
			isCanvas: true,
			metadata: parsedCanvas.metadata,
			rawFrontmatter: '',
			body: parseCanvasContent(file.content),
		};
	}

	const parsed = parseFrontmatter(file.content);
	let body = parsed.contentWithoutFrontmatter;
	if (settings.renderDataview) {
		body = renderDataviewBlocks(body, allFiles);
	}
	body = removeComments(body);
	body = cleanCallouts(body);
	body = transformWikilinks(body, settings.wikilinkFormat);
	body = sanitizeWhitespace(body);

	return {
		path: file.path,
		title: parsed.metadata.title || baseName,
		isCanvas: false,
		metadata: parsed.metadata,
		rawFrontmatter: parsed.rawFrontmatter ?? '',
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
