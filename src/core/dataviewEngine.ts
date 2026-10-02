/**
 * In-memory Dataview query evaluator.
 * Parses ```dataview blocks (TABLE, LIST) and evaluates them against
 * pre-parsed vault files (frontmatter parsed exactly once per run).
 *
 * Supported WHERE expression subset:
 *   - boolean combinators:  A and B, A or B, ( ... )   ('or' binds loosest)
 *   - equality:             field = value,  field != value
 *   - ordering:             field > value,  field >= value, field < value, field <= value
 *   - membership:           field in (a, b, c)
 *   - pattern:              field like "pre*fic*"   (* and ? wildcards)
 *   - functions:            contains(x, y), startswith(x, y), endswith(x, y)
 *   - fields:               title, tags, category, order, statut, any custom property,
 *                           file.name, file.path, file.folder, file.ctime, file.mtime, file.day
 */

import { ParsedFile } from './types';

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

export type FieldValue = string | string[] | number | undefined;

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
			// FROM #tag, FROM "#tag", FROM "path" or FROM path
			const fromVal = stripEnclosingQuotes(line.slice(4).trim());
			if (fromVal.startsWith('#')) {
				fromTag = fromVal.slice(1).trim();
			} else {
				fromPath = fromVal;
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

/* ---------------- Field resolution ---------------- */

export function resolveField(field: string, item: ParsedFile): FieldValue {
	const f = field.trim().toLowerCase();
	switch (f) {
		case 'file.name':
		case 'name':
			return item.name;
		case 'file.path':
		case 'path':
			return item.path;
		case 'file.folder':
		case 'folder':
			return item.folder;
		case 'file.mtime':
		case 'mtime':
			return item.mtime ?? 0;
		case 'file.ctime':
		case 'ctime':
			return item.mtime ?? 0;
		case 'file.day':
		case 'day':
			return item.mtime ? new Date(item.mtime).toISOString().slice(0, 10) : '';
	}

	const meta = item.metadata;
	switch (f) {
		case 'tags':
			return meta.tags;
		case 'title':
		case 'titre':
			return meta.title;
		case 'category':
		case 'categorie':
			return meta.category;
		case 'order':
		case 'ordre':
			return meta.order;
		case 'statut':
			return meta.statut;
		case 'trello_url':
			return meta.trelloUrl ?? '';
		case 'date_creation':
		case 'datecreation':
		case 'date':
			return meta.dateCreation ?? meta.dateRevision ?? '';
		case 'date_revision':
			return meta.dateRevision ?? '';
	}

	for (const [key, value] of Object.entries(meta.custom)) {
		if (key.toLowerCase() === f) {
			if (Array.isArray(value)) return value.map(String);
			return value === undefined ? undefined : String(value);
		}
	}
	return undefined;
}

/* ---------------- Expression evaluator ---------------- */

type Op = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'startswith' | 'endswith' | 'in' | 'like';

function valueToStrings(v: FieldValue): string[] {
	if (v === undefined) return [];
	if (Array.isArray(v)) return v.map(String);
	return [String(v)];
}

function isNumeric(s: string): boolean {
	return s !== '' && !Number.isNaN(Number(s));
}

function compareWith(lhs: FieldValue, rhs: string, op: Op): boolean {
	if (Array.isArray(lhs)) {
		const items = lhs.map((x) => String(x).toLowerCase());
		const r = rhs.toLowerCase();
		switch (op) {
			case '=': return items.includes(r);
			case '!=': return !items.includes(r);
			case 'contains': return items.some((x) => x.includes(r));
			default: return false;
		}
	}

	const ls = String(lhs ?? '').toLowerCase();
	const rs = rhs.toLowerCase();
	const numA = Number(ls);
	const numB = Number(rs);
	const bothNumeric = isNumeric(ls) && isNumeric(rs);

	switch (op) {
		case '=': return ls === rs;
		case '!=': return ls !== rs;
		case '>': return bothNumeric ? numA > numB : ls.localeCompare(rs) > 0;
		case '<': return bothNumeric ? numA < numB : ls.localeCompare(rs) < 0;
		case '>=': return bothNumeric ? numA >= numB : ls.localeCompare(rs) >= 0;
		case '<=': return bothNumeric ? numA <= numB : ls.localeCompare(rs) <= 0;
		case 'contains': return ls.includes(rs);
		case 'startswith': return ls.startsWith(rs);
		case 'endswith': return ls.endsWith(rs);
		default: return false;
	}
}

function likeToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' || c === '?' ? c : '\\' + c))
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');
	return new RegExp('^' + escaped + '$', 'i');
}

interface ParserState {
	src: string;
	pos: number;
}

function skipWs(p: ParserState): void {
	while (p.pos < p.src.length && /\s/.test(p.src[p.pos]!)) p.pos++;
}

function peekWord(p: ParserState): string {
	const m = /^[A-Za-z_]+[A-Za-z0-9_.]*/.exec(p.src.slice(p.pos));
	return m?.[0] ?? '';
}

function takeKeyword(p: ParserState, keyword: string): boolean {
	const word = peekWord(p);
	if (word.toLowerCase() === keyword && !/[A-Za-z0-9_]/.test(p.src[p.pos + word.length] ?? '')) {
		p.pos += word.length;
		return true;
	}
	return false;
}

function readTerm(p: ParserState): string {
	skipWs(p);
	const ch = p.src[p.pos];
	if (ch === '"' || ch === "'") {
		const end = p.src.indexOf(ch, p.pos + 1);
		if (end === -1) {
			const v = p.src.slice(p.pos + 1);
			p.pos = p.src.length;
			return v;
		}
		const v = p.src.slice(p.pos + 1, end);
		p.pos = end + 1;
		return v;
	}
	// Bareword: anything up to whitespace, parens, commas, or comparison chars
	const m = /^[^ \t\r\n(),=!<>]+/.exec(p.src.slice(p.pos));
	const v = m?.[0] ?? '';
	p.pos += v.length;
	return v;
}

function callFunction(name: string, args: string[], item: ParsedFile): boolean {
	const lhs = resolveField(args[0] ?? '', item);
	const rhs = args[1] ?? '';
	switch (name.toLowerCase()) {
		case 'contains': return compareWith(lhs, rhs, 'contains');
		case 'startswith': return compareWith(lhs, rhs, 'startswith');
		case 'endswith': return compareWith(lhs, rhs, 'endswith');
		default:
			// Unknown function: be permissive (do not exclude the row)
			return true;
	}
}

function parseCondition(p: ParserState, item: ParsedFile): boolean {
	const lhs = readTerm(p);
	skipWs(p);

	// Function call form: contains(x, y)
	if (p.src[p.pos] === '(') {
		p.pos++;
		const args: string[] = [];
		skipWs(p);
		if (p.src[p.pos] !== ')') {
			while (true) {
				args.push(readTerm(p));
				skipWs(p);
				if (p.src[p.pos] === ',') {
					p.pos++;
					continue;
				}
				break;
			}
		}
		skipWs(p);
		if (p.src[p.pos] === ')') p.pos++;
		return callFunction(lhs, args, item);
	}

	// Operator (symbols, 'in', 'like', and the string functions used infix-style)
	let op: Op;
	const two = p.src.slice(p.pos, p.pos + 2);
	if (two === '!=' || two === '>=' || two === '<=') {
		op = two as Op;
		p.pos += 2;
	} else if ('=><'.includes(p.src[p.pos] ?? '')) {
		op = p.src[p.pos] as Op;
		p.pos += 1;
	} else if (takeKeyword(p, 'in')) {
		op = 'in';
	} else if (takeKeyword(p, 'like')) {
		op = 'like';
	} else if (takeKeyword(p, 'contains')) {
		op = 'contains';
	} else if (takeKeyword(p, 'startswith')) {
		op = 'startswith';
	} else if (takeKeyword(p, 'endswith')) {
		op = 'endswith';
	} else {
		return true; // Unrecognized condition: be permissive
	}

	if (op === 'in') {
		skipWs(p);
		if (p.src[p.pos] !== '(') return true;
		p.pos++;
		const values: string[] = [];
		while (true) {
			skipWs(p);
			if (p.src[p.pos] === ')') {
				p.pos++;
				break;
			}
			values.push(readTerm(p));
			skipWs(p);
			if (p.src[p.pos] === ',') {
				p.pos++;
			}
		}
		const lhsVal = resolveField(lhs, item);
		const lhsStrs = valueToStrings(lhsVal).map((s) => s.toLowerCase());
		return values.some((v) => lhsStrs.includes(stripEnclosingQuotes(v).toLowerCase()));
	}

	const rhs = stripEnclosingQuotes(readTerm(p));
	if (op === 'like') {
		return likeToRegex(rhs).test(String(resolveField(lhs, item) ?? ''));
	}
	return compareWith(resolveField(lhs, item), rhs, op);
}

function parseAnd(p: ParserState, item: ParsedFile): boolean {
	let left = parseAtom(p, item);
	skipWs(p);
	while (takeKeyword(p, 'and')) {
		const right = parseAtom(p, item);
		left = left && right;
	}
	return left;
}

function parseAtom(p: ParserState, item: ParsedFile): boolean {
	skipWs(p);
	if (p.src[p.pos] === '(') {
		p.pos++;
		const v = parseOr(p, item);
		skipWs(p);
		if (p.src[p.pos] === ')') p.pos++;
		return v;
	}
	return parseCondition(p, item);
}

function parseOr(p: ParserState, item: ParsedFile): boolean {
	let left = parseAnd(p, item);
	skipWs(p);
	while (takeKeyword(p, 'or')) {
		const right = parseAnd(p, item);
		left = left || right;
	}
	return left;
}

function evaluateWhereCondition(item: ParsedFile, condition: string): boolean {
	const trimmed = condition.trim();
	if (!trimmed) return true;
	try {
		return parseOr({ src: trimmed, pos: 0 }, item);
	} catch {
		return true; // Unparseable condition: be permissive
	}
}

/* ---------------- Query evaluation ---------------- */

function matchesFrom(query: ParsedDataviewQuery, item: ParsedFile): boolean {
	if (query.fromPath) {
		const targetFrom = query.fromPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
		const p = item.path.replace(/\\/g, '/');
		if (p !== targetFrom && !p.startsWith(targetFrom + '/')) {
			return false;
		}
	}
	if (query.fromTag) {
		const lowTag = query.fromTag.toLowerCase();
		const hasTag = item.metadata.tags.some(
			(t) => t.toLowerCase() === lowTag || t.toLowerCase().startsWith(lowTag + '/')
		);
		if (!hasTag) return false;
	}
	return true;
}

function sortValue(field: string, item: ParsedFile): string {
	const v = resolveField(field, item);
	if (v === undefined) return '';
	if (Array.isArray(v)) return v.join(', ');
	return String(v);
}

function columnValue(column: string, item: ParsedFile): string {
	const colLow = column.toLowerCase();
	if (colLow === 'file.link' || colLow === 'link') {
		return '[[' + item.path + '|' + item.name + ']]';
	}
	const v = resolveField(column, item);
	if (v === undefined) return '';
	if (Array.isArray(v)) return v.join(', ');
	return String(v);
}

/**
 * Evaluates a parsed dataview query against a collection of parsed vault files
 * and renders markdown.
 */
export function evaluateDataviewQuery(query: ParsedDataviewQuery, files: ParsedFile[]): string {
	const matched = files.filter((item) => {
		if (!matchesFrom(query, item)) return false;
		for (const clause of query.whereClauses) {
			if (!evaluateWhereCondition(item, clause)) return false;
		}
		return true;
	});

	if (query.sortField) {
		const field = query.sortField.toLowerCase();
		const isNumericField = field === 'file.mtime' || field === 'file.ctime' || field === 'mtime' || field === 'ctime';
		matched.sort((a, b) => {
			const valA = isNumericField ? Number(resolveField(field, a)) : sortValue(field, a);
			const valB = isNumericField ? Number(resolveField(field, b)) : sortValue(field, b);
			let comp: number;
			if (typeof valA === 'number' && typeof valB === 'number') {
				comp = valA - valB;
			} else {
				comp = String(valA ?? '').localeCompare(String(valB ?? ''), undefined, { numeric: true });
			}
			return query.sortOrder === 'DESC' ? -comp : comp;
		});
	}

	if (matched.length === 0) {
		return '*No results found.*\n';
	}

	if (query.type === 'LIST') {
		return matched.map(m => '- [[' + m.path + '|' + m.name + ']]').join('\n') + '\n';
	}

	const headers = query.showId ? ['File', ...query.columns] : [...query.columns];
	const headerLine = '| ' + headers.join(' | ') + ' |';
	const separatorLine = '| ' + headers.map(() => '---').join(' | ') + ' |';

	const rows = matched.map(m => {
		const rowCells = query.showId ? ['[[' + m.path + '|' + m.name + ']]'] : [];
		for (const col of query.columns) {
			rowCells.push(columnValue(col, m));
		}
		return '| ' + rowCells.join(' | ') + ' |';
	});

	return [headerLine, separatorLine, ...rows].join('\n') + '\n';
}

const DATAVIEW_BLOCK_REGEX = /^ {0,3}```dataview\r?\n([\s\S]*?)^ {0,3}```/gm;

export function renderDataviewBlocks(content: string, files: ParsedFile[]): string {
	return content.replace(DATAVIEW_BLOCK_REGEX, (_fullMatch, queryText: string) => {
		const parsed = parseDataviewQuery(queryText);
		if (!parsed) return _fullMatch;
		return evaluateDataviewQuery(parsed, files);
	});
}
