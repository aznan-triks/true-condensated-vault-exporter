/**
 * Consolidated export formats. Adding a format = adding one entry here.
 */

import { ExporterSettings } from '../core/types';
import { CleanedNote } from '../core/pipeline';
import { formatForNotebookLM } from '../core/notebooklmFormatter';
import { formatForHtml } from '../core/htmlFormatter';
import { formatForMarkdown } from '../core/markdownFormatter';

export interface ConsolidatedFormat {
	label: string;
	outputPath: (settings: ExporterSettings) => string;
	render: (notes: CleanedNote[], settings: ExporterSettings, exportedAt: string) => string;
}

export const CONSOLIDATED_FORMATS = {
	notebooklm: {
		label: 'NotebookLM',
		outputPath: (s) => s.notebooklmOutputPath,
		render: formatForNotebookLM,
	},
	html: {
		label: 'HTML',
		outputPath: (s) => s.htmlOutputPath,
		render: (notes, s, exportedAt) => formatForHtml(notes, s, exportedAt),
	},
	markdown: {
		label: 'Markdown',
		outputPath: (s) => s.markdownOutputPath,
		render: formatForMarkdown,
	},
} satisfies Record<string, ConsolidatedFormat>;

export type ConsolidatedFormatId = keyof typeof CONSOLIDATED_FORMATS;
