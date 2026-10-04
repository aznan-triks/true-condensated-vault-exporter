/**
 * NotebookLM consolidated file formatter.
 * Produces structured plain text with metadata blocks and clear file delimiters.
 */

import { ExporterSettings } from './types';
import { CleanedNote, visibleMetadata } from './pipeline';

const RULE = '================================================================================';
const SEPARATOR = '--------------------------------------------------------------------------------';

export function formatForNotebookLM(notes: CleanedNote[], settings: ExporterSettings, exportedAt: string): string {
	const parts: string[] = [
		RULE,
		settings.documentTitle.toUpperCase() + ' (NOTEBOOKLM EXPORT)',
		'Documents: ' + notes.length,
		'Exported: ' + exportedAt,
		RULE + '\n',
	];

	notes.forEach((note, i) => {
		parts.push('\n' + SEPARATOR);
		parts.push('DOCUMENT [' + (i + 1) + '/' + notes.length + ']: ' + note.path + (note.isCanvas ? ' (CANVAS)' : ''));
		parts.push('Title: ' + note.title);
		for (const [k, v] of visibleMetadata(note, settings)) {
			parts.push(k + ': ' + v);
		}
		parts.push(SEPARATOR + '\n');
		parts.push(note.body);
		parts.push('\n');
	});

	return parts.join('\n');
}
