import { describe, expect, it } from 'vitest';
import {
	countWords,
	countNoteWords,
	effectiveWordLimit,
	chunkSingleNote,
	chunkNotesByWords,
} from '../src/core/chunker';
import { CleanedNote } from '../src/core/pipeline';
import { DEFAULT_SETTINGS } from '../src/core/types';
import { formatForMarkdown } from '../src/core/markdownFormatter';
import { formatForNotebookLM } from '../src/core/notebooklmFormatter';

function makeNote(path: string, title: string, wordCount: number): CleanedNote {
	const words = Array.from({ length: wordCount }, (_, i) => `word${i + 1}`).join(' ');
	return {
		path,
		title,
		body: words,
		isCanvas: false,
		rawFrontmatter: '',
		metadata: {
			title,
			category: 'Test',
			order: '1',
			tags: [],
			custom: {},
		},
	};
}

describe('chunker & word counting', () => {
	it('counts words accurately across whitespace, punctuation and empty text', () => {
		expect(countWords('')).toBe(0);
		expect(countWords('   \n\t  ')).toBe(0);
		expect(countWords('hello world')).toBe(2);
		expect(countWords('one   two   three')).toBe(3);
		expect(countWords('The quick brown fox jumps over the lazy dog.')).toBe(9);
	});

	it('computes effectiveWordLimit with safety margin for default 500k', () => {
		expect(effectiveWordLimit(0)).toBe(0);
		expect(effectiveWordLimit(-10)).toBe(0);
		expect(effectiveWordLimit(500000)).toBe(480000);
		expect(effectiveWordLimit(100000)).toBe(100000);
		expect(effectiveWordLimit(250000)).toBe(250000);
	});

	it('counts note words including title and visible metadata', () => {
		const note = makeNote('Notes/test.md', 'Test Title', 10);
		const count = countNoteWords(note, DEFAULT_SETTINGS);
		// 'Test Title' (2 words) + 10 body words + metadata ('Test', '1')
		expect(count).toBeGreaterThanOrEqual(12);
	});

	it('returns a single chunk when total words stay under the limit', () => {
		const notes = [
			makeNote('Notes/a.md', 'A', 50),
			makeNote('Notes/b.md', 'B', 50),
		];
		const chunks = chunkNotesByWords(notes, 500, DEFAULT_SETTINGS);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.part).toBe(1);
		expect(chunks[0]!.totalParts).toBe(1);
		expect(chunks[0]!.totalOriginalNotes).toBe(2);
		expect(chunks[0]!.notes).toHaveLength(2);
	});

	it('returns a single chunk when maxWords is 0 (disabled)', () => {
		const notes = [
			makeNote('Notes/a.md', 'A', 500),
			makeNote('Notes/b.md', 'B', 500),
		];
		const chunks = chunkNotesByWords(notes, 0, DEFAULT_SETTINGS);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.totalParts).toBe(1);
		expect(chunks[0]!.notes).toHaveLength(2);
	});

	it('chunks notes when cumulative word count exceeds limit', () => {
		const notes = [
			makeNote('Notes/a.md', 'A', 100),
			makeNote('Notes/b.md', 'B', 100),
			makeNote('Notes/c.md', 'C', 100),
			makeNote('Notes/d.md', 'D', 100),
		];
		// Limit to 250 words per chunk: Notes A + B ~ 205 words -> Part 1; Notes C + D ~ 205 words -> Part 2
		const chunks = chunkNotesByWords(notes, 250, DEFAULT_SETTINGS);
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(chunks[0]!.part).toBe(1);
		expect(chunks[0]!.totalParts).toBe(chunks.length);
		expect(chunks[0]!.totalOriginalNotes).toBe(4);
		expect(chunks[1]!.part).toBe(2);
		expect(chunks[1]!.noteOffset).toBe(chunks[0]!.notes.length);
	});

	it('subdivides a single note that alone exceeds the word limit', () => {
		// Note with 3 paragraphs, 100 words each = 300 words
		const p1 = Array.from({ length: 100 }, (_, i) => `p1_${i}`).join(' ');
		const p2 = Array.from({ length: 100 }, (_, i) => `p2_${i}`).join(' ');
		const p3 = Array.from({ length: 100 }, (_, i) => `p3_${i}`).join(' ');
		const hugeNote: CleanedNote = {
			path: 'Big.md',
			title: 'Big Document',
			body: `${p1}\n\n${p2}\n\n${p3}`,
			isCanvas: false,
			rawFrontmatter: '',
			metadata: { title: 'Big Document', category: '', order: '', tags: [], custom: {} },
		};

		const splitNotes = chunkSingleNote(hugeNote, 150, DEFAULT_SETTINGS);
		expect(splitNotes.length).toBeGreaterThanOrEqual(2);
		for (const n of splitNotes) {
			expect(n.title).toContain('Big Document (Part ');
			expect(countWords(n.body)).toBeLessThanOrEqual(250);
		}
	});

	it('subdivides a single massive paragraph without newlines', () => {
		const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
		const hugeNote: CleanedNote = {
			path: 'SinglePara.md',
			title: 'Single Para',
			body: words,
			isCanvas: false,
			rawFrontmatter: '',
			metadata: { title: 'Single Para', category: '', order: '', tags: [], custom: {} },
		};

		const splitNotes = chunkSingleNote(hugeNote, 100, DEFAULT_SETTINGS);
		expect(splitNotes.length).toBeGreaterThanOrEqual(5);
		for (const n of splitNotes) {
			expect(n.title).toContain('Single Para (Part ');
			expect(countWords(n.body)).toBeLessThanOrEqual(100);
		}
	});

	it('formats multi-part Markdown with continuing TOC and note numbers', () => {
		const notes = [
			makeNote('Notes/1.md', 'First Note', 10),
			makeNote('Notes/2.md', 'Second Note', 10),
		];
		const chunkMeta = {
			part: 2,
			totalParts: 3,
			totalOriginalNotes: 6,
			noteOffset: 2,
		};
		const md = formatForMarkdown(notes, { ...DEFAULT_SETTINGS, documentTitle: 'Test Vault' }, '2026-11-14', chunkMeta);
		expect(md).toContain('# Test Vault (Part 2 of 3)');
		expect(md).toContain('> *Documents: 2 (Notes 3 to 4 of 6)*');
		expect(md).toContain('3. [First Note](#first-note-2)');
		expect(md).toContain('4. [Second Note](#second-note-3)');
		expect(md).toContain('## 3. First Note <a id="first-note-2"></a>');
		expect(md).toContain('## 4. Second Note <a id="second-note-3"></a>');
	});

	it('produces valid document indices when a note is subdivided across chunks', () => {
		const p1 = Array.from({ length: 80 }, (_, i) => `p1_${i}`).join(' ');
		const p2 = Array.from({ length: 80 }, (_, i) => `p2_${i}`).join(' ');
		const note = {
			path: 'Solo.md',
			title: 'Solo Note',
			body: `${p1}\n\n${p2}`,
			isCanvas: false,
			rawFrontmatter: '',
			metadata: { title: 'Solo Note', category: '', order: '', tags: [], custom: {} },
		};
		// 1 original note, subdivided into 2 chunks with limit = 100
		const chunks = chunkNotesByWords([note], 100, DEFAULT_SETTINGS);
		expect(chunks.length).toBe(2);
		expect(chunks[1]!.totalOriginalNotes).toBeGreaterThanOrEqual(2);
		expect(chunks[1]!.noteOffset + chunks[1]!.notes.length).toBeLessThanOrEqual(chunks[1]!.totalOriginalNotes);

		const txt = formatForNotebookLM(chunks[1]!.notes, DEFAULT_SETTINGS, '2026-11-14', chunks[1]!);
		expect(txt).not.toContain('DOCUMENT [2/1]');
	});

	it('formats multi-part NotebookLM with document numbering and headers', () => {
		const notes = [
			makeNote('Notes/1.md', 'First Note', 10),
			makeNote('Notes/2.md', 'Second Note', 10),
		];
		const chunkMeta = {
			part: 2,
			totalParts: 3,
			totalOriginalNotes: 6,
			noteOffset: 2,
		};
		const txt = formatForNotebookLM(notes, { ...DEFAULT_SETTINGS, documentTitle: 'games' }, '2026-11-14', chunkMeta);
		expect(txt).toContain('GAMES (NOTEBOOKLM EXPORT) - PART 2 OF 3');
		expect(txt).toContain('Documents: 2 (Notes 3 to 4 of 6)');
		expect(txt).toContain('DOCUMENT [3/6]: Notes/1.md');
		expect(txt).toContain('DOCUMENT [4/6]: Notes/2.md');
	});
});
