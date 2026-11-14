/**
 * NotebookLM consolidated file formatter.
 * Produces structured plain text with metadata blocks and clear file delimiters.
 */

import { ExporterSettings } from './types';
import { CleanedNote, visibleMetadata } from './pipeline';

const RULE = '================================================================================';
const SEPARATOR = '--------------------------------------------------------------------------------';

export interface NotebookLMChunkMeta {
	part: number;
	totalParts: number;
	totalOriginalNotes: number;
	noteOffset: number;
}

export function formatForNotebookLM(
	notes: CleanedNote[],
	settings: ExporterSettings,
	exportedAt: string,
	chunkMeta?: NotebookLMChunkMeta
): string {
	const isMultiPart = Boolean(chunkMeta && chunkMeta.totalParts > 1);
	const titleSuffix = isMultiPart ? ` - PART ${chunkMeta!.part} OF ${chunkMeta!.totalParts}` : '';
	const docCount = isMultiPart
		? `${notes.length} (Notes ${chunkMeta!.noteOffset + 1} to ${chunkMeta!.noteOffset + notes.length} of ${chunkMeta!.totalOriginalNotes})`
		: `${notes.length}`;

	const parts: string[] = [
		RULE,
		settings.documentTitle.toUpperCase() + ' (NOTEBOOKLM EXPORT)' + titleSuffix,
		'Documents: ' + docCount,
		'Exported: ' + exportedAt,
		RULE + '\n',
	];

	const totalDocs = isMultiPart ? chunkMeta!.totalOriginalNotes : notes.length;
	notes.forEach((note, i) => {
		const docIdx = isMultiPart ? chunkMeta!.noteOffset + i + 1 : i + 1;
		parts.push('\n' + SEPARATOR);
		parts.push('DOCUMENT [' + docIdx + '/' + totalDocs + ']: ' + note.path + (note.isCanvas ? ' (CANVAS)' : ''));
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
