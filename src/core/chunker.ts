/**
 * Word counting and document chunking for LLM sources (NotebookLM 500k limit).
 * Pure TypeScript — no Obsidian or features imports allowed.
 */

import { ExporterSettings } from './types';
import { CleanedNote, visibleMetadata } from './pipeline';

let segmenter: Intl.Segmenter | null = null;
try {
	if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
		segmenter = new Intl.Segmenter('en', { granularity: 'word' });
	}
} catch {
	segmenter = null;
}

/**
 * Fast and accurate word counter.
 * Uses native Intl.Segmenter when available with fallback to Unicode whitespace scanning.
 */
export function countWords(text: string): number {
	if (!text) return 0;
	if (segmenter) {
		let count = 0;
		for (const segment of segmenter.segment(text)) {
			if (segment.isWordLike) count++;
		}
		return count;
	}
	let count = 0;
	let inWord = false;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code <= 32 || code === 0x00a0 || (code >= 0x2000 && code <= 0x200b) || code === 0x3000) {
			inWord = false;
		} else if (!inWord) {
			inWord = true;
			count++;
		}
	}
	return count;
}

/**
 * Counts words for a cleaned note, including title and visible metadata.
 */
export function countNoteWords(note: CleanedNote, settings?: ExporterSettings): number {
	let words = countWords(note.title) + countWords(note.body);
	if (settings) {
		for (const [k, v] of visibleMetadata(note, settings)) {
			words += countWords(k) + countWords(v);
		}
	}
	return words;
}

/**
 * Effective word limit for chunking: when set to NotebookLM's standard 500,000 ceiling,
 * a 4% buffer (480,000 words) prevents NotebookLM from rejecting uploads due to
 * subtle differences in markdown symbol, table, or punctuation tokenization.
 */
export function effectiveWordLimit(maxWords: number): number {
	if (maxWords <= 0) return 0;
	if (maxWords === 500000) return 480000;
	return maxWords;
}

/**
 * Subdivides a single massive note into multiple sub-notes when its word count
 * exceeds the effective word limit.
 */
export function chunkSingleNote(
	note: CleanedNote,
	maxWords: number,
	settings?: ExporterSettings
): CleanedNote[] {
	const limit = effectiveWordLimit(maxWords);
	if (limit <= 0) return [note];

	const totalNoteWords = countNoteWords(note, settings);
	if (totalNoteWords <= limit) return [note];

	const paragraphs = note.body.split(/\n{2,}/);
	const paraChunks: string[] = [];
	let currentPara: string[] = [];
	let currentWords = countWords(note.title);

	for (const para of paragraphs) {
		const paraWords = countWords(para);
		if (paraWords > limit) {
			if (currentPara.length > 0) {
				paraChunks.push(currentPara.join('\n\n'));
				currentPara = [];
				currentWords = 0;
			}
			// Extremely large single paragraph: split by lines or whitespace
			const lines = para.split('\n');
			let lineChunk: string[] = [];
			let lineWords = 0;
			for (const line of lines) {
				const lw = countWords(line);
				if (lineChunk.length > 0 && lineWords + lw > limit) {
					paraChunks.push(lineChunk.join('\n'));
					lineChunk = [];
					lineWords = 0;
				}
				lineChunk.push(line);
				lineWords += lw;
			}
			if (lineChunk.length > 0) {
				paraChunks.push(lineChunk.join('\n'));
			}
			continue;
		}

		if (currentPara.length > 0 && currentWords + paraWords > limit) {
			paraChunks.push(currentPara.join('\n\n'));
			currentPara = [];
			currentWords = 0;
		}

		currentPara.push(para);
		currentWords += paraWords;
	}

	if (currentPara.length > 0) {
		paraChunks.push(currentPara.join('\n\n'));
	}

	const totalParts = paraChunks.length;
	if (totalParts <= 1) return [note];

	return paraChunks.map((chunkBody, idx) => ({
		...note,
		title: `${note.title} (Part ${idx + 1} of ${totalParts})`,
		body: chunkBody,
	}));
}

export interface NoteChunk {
	/** Notes in this chunk (may include subdivided notes for giant documents) */
	notes: CleanedNote[];
	/** 1-based part index */
	part: number;
	/** Total number of parts */
	totalParts: number;
	/** Total original notes count before subdivision */
	totalOriginalNotes: number;
	/** Starting original note offset (0-based) for document numbering and TOC */
	noteOffset: number;
}

/**
 * Partitions notes into chunks such that each chunk's rendered word count stays
 * under the configured word limit.
 */
export function chunkNotesByWords(
	notes: CleanedNote[],
	maxWords: number,
	settings: ExporterSettings
): NoteChunk[] {
	const limit = effectiveWordLimit(maxWords);
	if (limit <= 0 || notes.length === 0) {
		return [{
			notes,
			part: 1,
			totalParts: 1,
			totalOriginalNotes: notes.length,
			noteOffset: 0,
		}];
	}

	// 1. Expand any note that alone exceeds the limit
	const expanded: CleanedNote[] = [];
	for (const note of notes) {
		const words = countNoteWords(note, settings);
		if (words > limit) {
			expanded.push(...chunkSingleNote(note, limit, settings));
		} else {
			expanded.push(note);
		}
	}

	const noteWordCounts = expanded.map((n) => countNoteWords(n, settings));
	const totalWords = noteWordCounts.reduce((sum, w) => sum + w, 0);

	if (totalWords <= limit) {
		return [{
			notes: expanded,
			part: 1,
			totalParts: 1,
			totalOriginalNotes: notes.length,
			noteOffset: 0,
		}];
	}

	// 2. Partition notes into parts
	const chunks: CleanedNote[][] = [];
	let currentChunk: CleanedNote[] = [];
	let currentWords = 0;

	for (let i = 0; i < expanded.length; i++) {
		const note = expanded[i]!;
		const words = noteWordCounts[i]!;

		if (currentChunk.length > 0 && currentWords + words > limit) {
			chunks.push(currentChunk);
			currentChunk = [];
			currentWords = 0;
		}

		currentChunk.push(note);
		currentWords += words;
	}

	if (currentChunk.length > 0) {
		chunks.push(currentChunk);
	}

	const totalParts = chunks.length;
	let currentOffset = 0;
	return chunks.map((chunkNotes, idx) => {
		const chunk: NoteChunk = {
			notes: chunkNotes,
			part: idx + 1,
			totalParts,
			totalOriginalNotes: notes.length,
			noteOffset: currentOffset,
		};
		currentOffset += chunkNotes.length;
		return chunk;
	});
}
