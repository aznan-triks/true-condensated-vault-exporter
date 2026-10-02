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
	return base.replace(/[\\/]+$/, '') + '/' + rel;
}

function relativeToScope(notePath: string, scopeRoot: string): string {
	const scope = normalizePath(scopeRoot);
	const p = normalizePath(notePath);
	return scope && p.startsWith(scope + '/') ? p.slice(scope.length + 1) : p;
}

export function buildSplitFiles(notes: CleanedNote[], settings: ExporterSettings): OutputFile[] {
	const base = settings.splitOutputFolder;

	if (settings.splitMode === 'individual-files') {
		return notes.map((note) => {
			const frontmatter = !settings.stripFrontmatter && note.rawFrontmatter
				? '---\n' + note.rawFrontmatter + '\n---\n\n'
				: '';
			const rel = relativeToScope(note.path, settings.scopeRoot).replace(/\.canvas$/, '.md');
			return { path: joinPath(base, rel), content: frontmatter + note.body };
		});
	}

	const groups = new Map<string, CleanedNote[]>();
	for (const note of notes) {
		const parts = relativeToScope(relativeToScope(note.path, settings.scopeRoot), settings.splitGroupFolder).split('/');
		const group = parts.length > 1 ? parts[0]! : ROOT_GROUP;
		groups.set(group, [...(groups.get(group) ?? []), note]);
	}

	return [...groups.entries()].map(([group, groupNotes]) => {
		const lines = [RULE, 'Folder : ' + group, 'Documents : ' + groupNotes.length, RULE + '\n'];
		for (const note of groupNotes) {
			lines.push('\n' + SEPARATOR, note.title, ' (' + note.path + ')', SEPARATOR + '\n', note.body, '\n');
		}
		const safeName = group.replace(/[<>:"/\\|?*]/g, '_') + '.txt';
		return { path: joinPath(base, safeName), content: lines.join('\n') };
	});
}
