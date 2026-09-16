/**
 * In-memory Dataview query evaluator.
 * Parses `dataview blocks (TABLE, LIST) and evaluates them against filtered vault files.
 */

import { VaultFile } from './types';
import { parseFrontmatter } from './frontmatter';
import { normalizePath } from './filter';

export interface ParsedDataviewQuery {
	type: 'TABLE' | 'LIST';
	showId: boolean;
	columns: string[];
	fromPath?: string;
	fromTag?: string;
	whereClauses: string[];
	sortField?: string;
	sortOrder?: 'ASC' | 'DESC';
}

function stripEnclosingQuotes(str: string): string {
	const trimmed = str.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * Parses a Dataview block.
 */
export function parseDataviewQuery(rawBlock: string): ParsedDataviewQuery | null {
	const lines = rawBlock.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('//'));
	if (lines.length === 0) return null;

	const firstLine = lines[0] ?? '';
	let type: 'TABLE' | 'LIST' = 'TABLE';
	let showId = true;
	let columns: string[] = [];

	let lineClean = firstLine;
	if (lineClean.toUpperCase().includes('WITHOUT ID')) {
		showId = false;
		lineClean = lineClean.replace(/WITHOUT ID/gi, '').trim();
	}

	if (lineClean.toUpperCase().startsWith('TABLE')) {
		type = 'TABLE';
		const rest = lineClean.slice(5).trim();
		if (rest) {
			columns = rest.split(',').map(c => c.trim()).filter(Boolean);
		}
	} else if (lineClean.toUpperCase().startsWith('LIST')) {
		type = 'LIST';
	} else {
		return null;
	}

	let fromPath: string | undefined;
	let fromTag: string | undefined;
	const whereClauses: string[] = [];
	let sortField: string | undefined;
	let sortOrder: 'ASC' | 'DESC' = 'ASC';

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const upper = line.toUpperCase();

		if (upper.startsWith('FROM')) {
			const fromVal = line.slice(4).trim();
			if (fromVal.startsWith('#')) {
				fromTag = fromVal.slice(1).trim();
			} else {
				fromPath = stripEnclosingQuotes(fromVal);
			}
		} else if (upper.startsWith('WHERE')) {
			whereClauses.push(line.slice(5).trim());
		} else if (upper.startsWith('SORT')) {
			const sortParts = line.slice(4).trim().split(/\s+/);
			sortField = sortParts[0];
			if (sortParts[1]?.toUpperCase() === 'DESC') {
				sortOrder = 'DESC';
			}
		}
	}

	return {
		type,
		showId,
		columns,
		fromPath,
		fromTag,
		whereClauses,
		sortField,
		sortOrder,
	};
}

function evaluateWhereCondition(file: { path: string; name: string; folder: string; meta: any }, condition: string): boolean {
	const trimmed = condition.trim();
	if (!trimmed) return true;

	// contains(field, "value")
	const containsMatch = trimmed.match(/contains\s*\(\s*([\w.]+)\s*,\s*["']?([^"']*)["']?\s*\)/i);
	if (containsMatch && containsMatch[1] && containsMatch[2]) {
		const field = containsMatch[1].trim();
		const searchVal = containsMatch[2].trim().toLowerCase();
		let targetVals: string[] = [];
		if (field === 'file.name' || field === 'name') targetVals = [file.name];
		else if (field === 'file.folder' || field === 'folder') targetVals = [file.folder];
		else if (field === 'tags') targetVals = file.meta.tags || [];
		else if (file.meta[field]) {
			const v = file.meta[field];
			targetVals = Array.isArray(v) ? v.map(String) : [String(v)];
		} else if (file.meta.custom[field]) {
			const v = file.meta.custom[field];
			targetVals = Array.isArray(v) ? v.map(String) : [String(v)];
		}
		return targetVals.some(v => v.toLowerCase().includes(searchVal));
	}

	// != operator
	if (trimmed.includes('!=')) {
		const [field, rawVal] = trimmed.split('!=').map(s => s.trim());
		const searchVal = stripEnclosingQuotes(rawVal || '').toLowerCase();
		if (field === 'file.name') return file.name.toLowerCase() !== searchVal;
		if (field === 'file.folder') return file.folder.toLowerCase() !== searchVal;
		const actual = String(file.meta[field || ''] || file.meta.custom[field || ''] || '').toLowerCase();
		return actual !== searchVal;
	}

	// = operator
	if (trimmed.includes('=')) {
		const [field, rawVal] = trimmed.split('=').map(s => s.trim());
		const searchVal = stripEnclosingQuotes(rawVal || '').toLowerCase();
		if (field === 'file.name') return file.name.toLowerCase() === searchVal;
		if (field === 'file.folder') return file.folder.toLowerCase() === searchVal;
		const actual = String(file.meta[field || ''] || file.meta.custom[field || ''] || '').toLowerCase();
		return actual === searchVal;
	}

	return true;
}

/**
 * Evaluates a parsed dataview query against a collection of vault files and renders markdown.
 */
export function evaluateDataviewQuery(query: ParsedDataviewQuery, files: VaultFile[]): string {
	const parsedFiles = files.map(f => {
		const parsed = parseFrontmatter(f.content);
		const normPath = normalizePath(f.path);
		const parts = normPath.split('/');
		const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
		return {
			file: f,
			path: normPath,
			folder,
			name: f.name.replace(/\.md$/, ''),
			meta: parsed.metadata,
		};
	});

	const matched = parsedFiles.filter(item => {
		if (query.fromPath) {
			const targetFrom = normalizePath(query.fromPath);
			if (!item.path.startsWith(targetFrom + '/') && item.path !== targetFrom && !item.folder.includes(targetFrom)) {
				return false;
			}
		}
		if (query.fromTag) {
			const lowTag = query.fromTag.toLowerCase();
			const hasTag = item.meta.tags.some(t => t.toLowerCase() === lowTag);
			if (!hasTag) return false;
		}

		for (const clause of query.whereClauses) {
			if (!evaluateWhereCondition(item, clause)) {
				return false;
			}
		}

		return true;
	});

	if (query.sortField) {
		const field = query.sortField.toLowerCase();
		matched.sort((a, b) => {
			let valA: unknown = a.name;
			let valB: unknown = b.name;

			if (field === 'ordre' || field === 'order') {
				valA = a.meta.order || '';
				valB = b.meta.order || '';
			} else if (field === 'file.name' || field === 'name') {
				valA = a.name;
				valB = b.name;
			} else if (field === 'date_creation' || field === 'date') {
				valA = a.meta.dateCreation || '';
				valB = b.meta.dateRevision || '';
			} else if (a.meta.custom[field] !== undefined) {
				valA = a.meta.custom[field];
				valB = b.meta.custom[field];
			}

			const comp = String(valA ?? '').localeCompare(String(valB ?? ''), undefined, { numeric: true });
			return query.sortOrder === 'DESC' ? -comp : comp;
		});
	}

	if (matched.length === 0) {
		return '*Aucun résultat trouvé.*\n';
	}

	if (query.type === 'LIST') {
		return matched.map(m => '- [[' + m.file.path + '|' + m.name + ']]').join('\n') + '\n';
	}

	const headers = query.showId ? ['Fichier', ...query.columns] : [...query.columns];
	const headerLine = '| ' + headers.join(' | ') + ' |';
	const separatorLine = '| ' + headers.map(() => '---').join(' | ') + ' |';

	const rows = matched.map(m => {
		const rowCells = query.showId ? ['[[' + m.file.path + '|' + m.name + ']]'] : [];
		for (const col of query.columns) {
			const colLow = col.toLowerCase();
			let cellVal = '';
			if (colLow === 'title' || colLow === 'titre') cellVal = m.meta.title || m.name;
			else if (colLow === 'file.name' || colLow === 'name') cellVal = m.name;
			else if (colLow === 'file.folder' || colLow === 'folder') cellVal = m.folder;
			else if (colLow === 'ordre' || colLow === 'order') cellVal = m.meta.order || '';
			else if (colLow === 'categorie' || colLow === 'category') cellVal = m.meta.category || '';
			else if (colLow === 'statut') cellVal = m.meta.statut || '';
			else if (colLow === 'date_creation') cellVal = m.meta.dateCreation || '';
			else if (colLow === 'tags') cellVal = m.meta.tags.join(', ');
			else if (m.meta.custom[col] !== undefined) cellVal = String(m.meta.custom[col]);
			else if ((m.meta as any)[col] !== undefined) cellVal = String((m.meta as any)[col]);
			rowCells.push(cellVal);
		}
		return '| ' + rowCells.join(' | ') + ' |';
	});

	return [headerLine, separatorLine, ...rows].join('\n') + '\n';
}

export function renderDataviewBlocks(content: string, allFiles: VaultFile[]): string {
	const DATAVIEW_BLOCK_REGEX = /```dataview\r?\n([\s\S]*?)```/g;
	return content.replace(DATAVIEW_BLOCK_REGEX, (_fullMatch, queryText) => {
		const parsed = parseDataviewQuery(queryText);
		if (!parsed) return _fullMatch;
		return evaluateDataviewQuery(parsed, allFiles);
	});
}