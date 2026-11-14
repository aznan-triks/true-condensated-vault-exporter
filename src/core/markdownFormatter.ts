/**
 * Consolidated Markdown document generator.
 * Produces a single Markdown file with a table of contents and anchored sections.
 */

import { ExporterSettings } from './types';
import { CleanedNote, visibleMetadata } from './pipeline';
import { escapeMarkdownLabel } from './wikilink';

function generateAnchor(title: string, index: number): string {
	const slug = title
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-');
	return slug ? slug + '-' + index : 'doc-' + index;
}

function displayTitle(note: CleanedNote): string {
	return note.isCanvas ? 'Canvas: ' + note.title : note.title;
}

export interface MarkdownChunkMeta {
	part: number;
	totalParts: number;
	totalOriginalNotes: number;
	noteOffset: number;
}

export function formatForMarkdown(
	notes: CleanedNote[],
	settings: ExporterSettings,
	exportedAt: string,
	chunkMeta?: MarkdownChunkMeta
): string {
	const isMultiPart = Boolean(chunkMeta && chunkMeta.totalParts > 1);
	const titleSuffix = isMultiPart ? ` (Part ${chunkMeta!.part} of ${chunkMeta!.totalParts})` : '';
	const docCount = isMultiPart
		? `${notes.length} (Notes ${chunkMeta!.noteOffset + 1} to ${chunkMeta!.noteOffset + notes.length} of ${chunkMeta!.totalOriginalNotes})`
		: `${notes.length}`;

	const parts: string[] = [
		'# ' + settings.documentTitle + titleSuffix,
		'',
		'> *Documents: ' + docCount + '*  ',
		'> *Exported: ' + exportedAt + '*',
		'',
		'---',
		'',
		'## Table of Contents',
		'',
	];

	notes.forEach((note, i) => {
		const docIdx = isMultiPart ? chunkMeta!.noteOffset + i : i;
		const docNum = docIdx + 1;
		const title = displayTitle(note);
		parts.push(docNum + '. [' + escapeMarkdownLabel(title) + '](#' + generateAnchor(title, docIdx) + ') <small>*(' + escapeMarkdownLabel(note.path) + ')*</small>');
	});
	parts.push('', '---', '');

	notes.forEach((note, i) => {
		const docIdx = isMultiPart ? chunkMeta!.noteOffset + i : i;
		const docNum = docIdx + 1;
		const title = displayTitle(note);
		// Section titles are not link labels: deliberately keep their original text.
		parts.push('## ' + docNum + '. ' + title + ' <a id="' + generateAnchor(title, docIdx) + '"></a>');
		parts.push('*Source: `' + note.path + '`*', '');

		const meta = visibleMetadata(note, settings);
		if (meta.length > 0) {
			parts.push('> [!INFO] Metadata');
			for (const [k, v] of meta) {
				parts.push('> - **' + k + '**: ' + v);
			}
			parts.push('');
		}

		parts.push(note.body, '', '---', '');
	});

	return parts.join('\n');
}
