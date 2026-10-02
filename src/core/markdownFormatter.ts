/**
 * Consolidated Markdown document generator.
 * Produces a single Markdown file with a table of contents and anchored sections.
 */

import { ExporterSettings } from './types';
import { CleanedNote, visibleMetadata } from './pipeline';

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

export function formatForMarkdown(notes: CleanedNote[], settings: ExporterSettings, exportedAt: string): string {
	const parts: string[] = [
		'# ' + settings.documentTitle,
		'',
		'> *Documents: ' + notes.length + '*  ',
		'> *Exported: ' + exportedAt + '*',
		'',
		'---',
		'',
		'## Table of Contents',
		'',
	];

	notes.forEach((note, i) => {
		const title = displayTitle(note);
		parts.push((i + 1) + '. [' + title + '](#' + generateAnchor(title, i) + ') <small>*(' + note.path + ')*</small>');
	});
	parts.push('', '---', '');

	notes.forEach((note, i) => {
		const title = displayTitle(note);
		parts.push('## ' + (i + 1) + '. ' + title + ' <a id="' + generateAnchor(title, i) + '"></a>');
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
