/**
 * Split export.
 * - 'folder-grouped'   : one .txt per top-level folder under the scope root
 * - 'individual-files' : one cleaned .md per note, mirroring the vault tree
 */

import { ExporterSettings } from '../core/types';
import { CleanedNote } from '../core/pipeline';
import { normalizePath } from '../core/filter';
import { canonicalOutputPath } from '../core/outputTarget';

export interface OutputFile {
	path: string;
	content: string;
}

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
	if (!note.startsWith(folder + '/')) return null;
	return note.slice(folder.length + 1);
}

/** Portable generated segment; configured destination roots are not rewritten. */
function safeSegment(segment: string): string {
	const safe = segment.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || '_';
	return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe) ? '_' + safe : safe;
}

export function buildSplitFiles(notes: CleanedNote[], settings: ExporterSettings): OutputFile[] {
	const base = settings.splitOutputFolder;
	const destinations = new Map<string, { path: string; source: string }>();
	const output = (path: string, content: string, source: string): OutputFile => {
		const key = canonicalOutputPath(path).toLowerCase();
		const previous = destinations.get(key);
		if (previous) {
			throw new Error('Two split outputs would be written to "' + path + '": ' + previous.source + ' and ' + source + '. Rename one note or folder, or use another split mode.');
		}
		destinations.set(key, { path, source });
		return { path, content };
	};

	if (settings.splitMode === 'individual-files') {
		return notes.map((note) => {
			const frontmatter = !settings.stripFrontmatter && note.rawFrontmatter
				? '---\n' + note.rawFrontmatter + '\n---\n\n'
				: '';
			const rel = (relativeToFolder(note.path, settings.scopeRoot) ?? note.path)
				.replace(/\.canvas$/i, '.md').split('/').map(safeSegment).join('/');
			return output(joinPath(base, rel), frontmatter + note.body, '"' + note.path + '"');
		});
	}

	const groupingRoot = normalizePath(settings.splitGroupFolder) || normalizePath(settings.scopeRoot);
	const groups = new Map<string, CleanedNote[]>();
	for (const note of notes) {
		const relative = relativeToFolder(note.path, groupingRoot);
		const firstSegment = relative?.split('/')[0];
		const group = relative && relative.includes('/') ? firstSegment ?? ROOT_GROUP : ROOT_GROUP;
		const list = groups.get(group);
		if (list) list.push(note);
		else groups.set(group, [note]);
	}

	return [...groups.entries()].map(([group, groupNotes]) => {
		const lines = [RULE, 'Folder: ' + group, 'Documents: ' + groupNotes.length, RULE, ''];
		for (const note of groupNotes) {
			lines.push('', SEPARATOR, note.title + ' (' + note.path + ')', SEPARATOR, '', note.body, '');
		}
		const safeName = safeSegment(group) + '.txt';
		return output(joinPath(base, safeName), lines.join('\n'), 'folder "' + group + '"');
	});
}
