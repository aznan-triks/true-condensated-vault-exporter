/**
 * Split export.
 * - 'folder-grouped'   : one .txt per top-level folder under the scope root
 * - 'individual-files' : one cleaned .md per note, mirroring the vault tree
 */

import { ExporterSettings } from '../core/types';
import { CleanedNote } from '../core/pipeline';
import { normalizePath } from '../core/filter';

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

export function buildSplitFiles(notes: CleanedNote[], settings: ExporterSettings): OutputFile[] {
	const base = settings.splitOutputFolder;

	if (settings.splitMode === 'individual-files') {
		return notes.map((note) => {
			const frontmatter = !settings.stripFrontmatter && note.rawFrontmatter
				? '---\n' + note.rawFrontmatter + '\n---\n\n'
				: '';
			const rel = (relativeToFolder(note.path, settings.scopeRoot) ?? note.path)
				.replace(/\.canvas$/i, '.md');
			return { path: joinPath(base, rel), content: frontmatter + note.body };
		});
	}

	const groupingRoot = normalizePath(settings.splitGroupFolder) || normalizePath(settings.scopeRoot);
	const groups = new Map<string, CleanedNote[]>();
	for (const note of notes) {
		const relative = relativeToFolder(note.path, groupingRoot);
		const firstSegment = relative?.split('/')[0];
		const group = relative && relative.includes('/') ? firstSegment ?? ROOT_GROUP : ROOT_GROUP;
		groups.set(group, [...(groups.get(group) ?? []), note]);
	}

	return [...groups.entries()].map(([group, groupNotes]) => {
		const lines = [RULE, 'Folder: ' + group, 'Documents: ' + groupNotes.length, RULE, ''];
		for (const note of groupNotes) {
			lines.push('', SEPARATOR, note.title + ' (' + note.path + ')', SEPARATOR, '', note.body, '');
		}
		const safeName = group.replace(/[<>:"/\\|?*]/g, '_') + '.txt';
		return { path: joinPath(base, safeName), content: lines.join('\n') };
	});
}
