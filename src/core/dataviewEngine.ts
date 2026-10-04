/**
 * In-memory Dataview query evaluator.
 * Parses ```dataview blocks (TABLE, LIST) and evaluates them against
 * pre-parsed vault files (frontmatter parsed exactly once per run).
 *
 * Queries may be written on a single line (`TABLE status FROM "Notes" WHERE
 * status = "active"`) or with one clause per line; both forms are equivalent.
 *
 * Supported WHERE expression subset:
 *   - boolean combinators:  A and B, A or B, ( ... )   ('or' binds loosest)
 *   - equality:             field = value,  field != value
 *   - ordering:             field > value,  field >= value, field < value, field <= value
 *   - membership:           field in (a, b, c)
 *   - pattern:              field like "pre*fic*"   (* and ? wildcards)
 *   - functions:            contains(x, y), startswith(x, y), endswith(x, y)
 *   - fields:               title, tags, category, order (legacy aliases supported), any custom property,
 *                           file.name, file.path, file.folder, file.ctime, file.mtime, file.day
 *   - column aliases:       TABLE file.name AS "Name", status
 */

import { ParsedFile } from './types';

export interface ParsedDataviewQuery {
	type: 'TABLE' | 'LIST';
	showId: boolean;
	/** Field expression for each column (what is evaluated). */
	columns: string[];
	/** Header label for each column (alias when `AS` is used, else the field). */
	columnLabels?: string[];
	fromPath?: string;
	fromTag?: string;
	whereClauses: string[];
	sortField?: string;
	sortOrder?: 'ASC' | 'DESC';
}

export type FieldValue = string | string[] | number | undefined;

class DataviewQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DataviewQueryError';
	}
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
 *
 * The whole block is tokenized rather than read line-by-line so that the
 * canonical one-line form (`TABLE a, b FROM "x" WHERE … SORT …`) behaves like
 * the multi-line form. Unsupported clauses (GROUP BY, FLATTEN, LIMIT, …) make
 * the query unparseable, which leaves the block visible in the export instead
 * of silently broadening the result set.
 */
export function parseDataviewQuery(rawBlock: string): ParsedDataviewQuery | null {
	const text = rawBlock
		.split(/\r?\n/)
		.filter((line) => !line.trim().startsWith('//'))
		.join('\n')
		.trim();
	if (!text) return null;

	const withoutId = /\bWITHOUT\s+ID\b/i.test(text);
	const stripped = text.replace(/\bWITHOUT\s+ID\b/gi, ' ');
	const typeMatch = /^(TABLE|LIST)\b/i.exec(stripped);
	if (!typeMatch) return null;

	const type = typeMatch[1]?.toUpperCase() === 'LIST' ? 'LIST' : 'TABLE';
	const { head, clauses } = splitClauses(stripped.slice(typeMatch[0].length));

	let columns: string[] = [];
	let columnLabels: string[] = [];
	if (type === 'TABLE') {
		for (const raw of splitTopLevel(head, ',')) {
			const column = parseColumn(raw);
			if (column) {
				columns.push(column.field);
				columnLabels.push(column.label);
			}
		}
	} else if (head.trim()) {
		// `LIST <expression>` (e.g. `LIST file.mtime`) is not supported.
		return null;
	}

	let fromPath: string | undefined;
	let fromTag: string | undefined;
	const whereClauses: string[] = [];
	let sortField: string | undefined;
	let sortOrder: 'ASC' | 'DESC' = 'ASC';

	for (const clause of clauses) {
		if (clause.keyword === 'group' || clause.keyword === 'flatten' || clause.keyword === 'limit') {
			return null;
		}
		if (clause.keyword === 'from') {
			const fromVal = stripEnclosingQuotes(clause.body);
			if (!fromVal) return null;
			if (fromVal.startsWith('#')) {
				fromTag = fromVal.slice(1).trim();
				if (!fromTag) return null;
			} else {
				fromPath = fromVal;
			}
		} else if (clause.keyword === 'where') {
			const expression = clause.body.trim();
			if (!expression) return null;
			whereClauses.push(expression);
		} else if (clause.keyword === 'sort') {
			const sortParts = clause.body.trim().split(/\s+/).filter(Boolean);
			if (
				!sortParts[0] ||
				sortParts.length > 2 ||
				(sortParts[1] && !['ASC', 'DESC'].includes(sortParts[1].toUpperCase()))
			) return null;
			sortField = sortParts[0];
			sortOrder = sortParts[1]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
		}
	}

	return {
		type,
		showId: !withoutId,
		columns,
		...(columns.length > 0 ? { columnLabels } : {}),
		fromPath,
		fromTag,
		whereClauses,
		sortField,
		sortOrder,
	};
}

/** Clauses recognised at the top level of a Dataview query. */
const CLAUSE_KEYWORDS = new Set(['from', 'where', 'sort', 'group', 'flatten', 'limit']);

interface QueryClause {
	keyword: string;
	body: string;
}

/**
 * Splits the text following TABLE/LIST into the column/source head and the
 * clause bodies. Keywords are detected at top level only (outside quotes and
 * parentheses), so values such as `"born in FROM"` are not mistaken for
 * clauses.
 */
function splitClauses(text: string): { head: string; clauses: QueryClause[] } {
	const clauses: QueryClause[] = [];
	let head = '';
	let keyword = '';
	let clauseStart = 0;
	let quote = '';
	let depth = 0;
	let i = 0;

	const closeClause = (end: number): void => {
		if (keyword) {
			clauses.push({ keyword, body: text.slice(clauseStart, end) });
		} else {
			head += text.slice(clauseStart, end);
		}
	};

	while (i < text.length) {
		const char = text[i] ?? '';
		if (quote) {
			if (char === '\\') {
				i += 2;
				continue;
			}
			if (char === quote) quote = '';
			i++;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			i++;
			continue;
		}
		if (char === '(') {
			depth++;
			i++;
			continue;
		}
		if (char === ')') {
			depth = Math.max(0, depth - 1);
			i++;
			continue;
		}
		if (depth === 0 && (i === 0 || /\s/.test(text[i - 1] ?? ''))) {
			const match = /^[A-Za-z]+/.exec(text.slice(i));
			if (match) {
				const word = match[0];
				const after = text[i + word.length] ?? '';
				if (!/[A-Za-z0-9_]/.test(after) && CLAUSE_KEYWORDS.has(word.toLowerCase())) {
					closeClause(i);
					keyword = word.toLowerCase();
					clauseStart = i + word.length;
					i = clauseStart;
					continue;
				}
			}
		}
		i++;
	}
	closeClause(text.length);

	return { head: head.trim(), clauses };
}

/** Splits on top-level separators, ignoring separators inside quotes/parens. */
function splitTopLevel(text: string, separator: string): string[] {
	const parts: string[] = [];
	let current = '';
	let quote = '';
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i] ?? '';
		if (quote) {
			current += char;
			if (char === '\\') {
				const next = text[i + 1];
				if (next !== undefined) {
					current += next;
					i++;
				}
				continue;
			}
			if (char === quote) quote = '';
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === '(') depth++;
		if (char === ')') depth = Math.max(0, depth - 1);
		if (char === separator && depth === 0) {
			parts.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts;
}

/** Parses one table column, supporting `field AS "Label"` aliases. */
function parseColumn(raw: string): { field: string; label: string } | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const aliasMatch = /^(.*?)\s+AS\s+(.+)$/i.exec(trimmed);
	if (!aliasMatch?.[1]) return { field: trimmed, label: trimmed };
	const field = aliasMatch[1].trim();
	const label = stripEnclosingQuotes(aliasMatch[2] ?? '').trim() || field;
	return { field, label };
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
			return item.ctime ?? 0;
		case 'file.day':
		case 'day': {
			const match = item.name.match(/(?:^|[^0-9])(\d{4}-\d{2}-\d{2})(?:$|[^0-9])/);
			if (!match?.[1]) return undefined;
			const date = new Date(match[1] + 'T00:00:00.000Z');
			return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1] ? undefined : match[1];
		}
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
		case 'status':
		case 'statut':
			return meta.status;
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
		let escaped = false;
		for (let end = p.pos + 1; end < p.src.length; end++) {
			const current = p.src[end] ?? '';
			if (current === ch && !escaped) {
				const value = p.src.slice(p.pos + 1, end);
				p.pos = end + 1;
				return value.replace(/\\([\\"'])/g, '$1');
			}
			escaped = current === '\\' && !escaped;
			if (current !== '\\') escaped = false;
		}
		throw new DataviewQueryError('Unclosed quoted value.');
	}
	// Bareword: anything up to whitespace, parens, commas, or comparison chars
	const m = /^[^ \t\r\n(),=!<>]+/.exec(p.src.slice(p.pos));
	if (!m?.[0]) throw new DataviewQueryError('Expected a field or value.');
	p.pos += m[0].length;
	return m[0];
}

function callFunction(name: string, args: string[], item: ParsedFile): boolean {
	const lhs = resolveField(args[0] ?? '', item);
	const rhs = args[1] ?? '';
	switch (name.toLowerCase()) {
		case 'contains': return compareWith(lhs, rhs, 'contains');
		case 'startswith': return compareWith(lhs, rhs, 'startswith');
		case 'endswith': return compareWith(lhs, rhs, 'endswith');
		default:
			throw new DataviewQueryError('Unsupported function: ' + name);
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
				if (p.src[p.pos] !== ',') break;
				p.pos++;
			}
		}
		if (p.src[p.pos] !== ')') throw new DataviewQueryError('Unclosed function call.');
		p.pos++;
		if (args.length !== 2) throw new DataviewQueryError('Expected two function arguments.');
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
		throw new DataviewQueryError('Unsupported or incomplete WHERE expression.');
	}

	if (op === 'in') {
		skipWs(p);
		if (p.src[p.pos] !== '(') throw new DataviewQueryError('Expected a parenthesized list after "in".');
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
				continue;
			}
			if (p.src[p.pos] !== ')') throw new DataviewQueryError('Expected a comma or closing parenthesis in "in" list.');
			p.pos++;
			break;
		}
		if (values.length === 0) throw new DataviewQueryError('The "in" list cannot be empty.');
		const lhsVal = resolveField(lhs, item);
		const lhsStrs = valueToStrings(lhsVal).map((value) => value.toLowerCase());
		return values.some((value) => lhsStrs.includes(value.toLowerCase()));
	}

	const rhs = readTerm(p);
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
		if (p.src[p.pos] !== ')') throw new DataviewQueryError('Unclosed parenthesized expression.');
		p.pos++;
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
	const parser: ParserState = { src: trimmed, pos: 0 };
	const result = parseOr(parser, item);
	skipWs(parser);
	if (parser.pos !== parser.src.length) {
		throw new DataviewQueryError('Unexpected text in WHERE expression.');
	}
	return result;
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
		const normalizeTag = (value: string): string => value.trim().replace(/^#/, '').toLowerCase();
		const lowTag = normalizeTag(query.fromTag);
		const hasTag = item.metadata.tags.some((tag) => {
			const value = normalizeTag(tag);
			return value === lowTag || value.startsWith(lowTag + '/');
		});
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

function escapeMarkdownTableCell(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function columnValue(column: string, item: ParsedFile): string {
	const colLow = column.toLowerCase();
	if (colLow === 'file.link' || colLow === 'link') {
		return '[[' + item.path + '|' + item.name + ']]';
	}
	const value = resolveField(column, item);
	if (value === undefined) return '';
	return escapeMarkdownTableCell(Array.isArray(value) ? value.join(', ') : String(value));
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

	const labels = query.columnLabels ?? query.columns;
	const headers = query.showId ? ['File', ...labels] : [...labels];
	const headerLine = '| ' + headers.map(escapeMarkdownTableCell).join(' | ') + ' |';
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
	return content.replace(DATAVIEW_BLOCK_REGEX, (fullMatch, queryText: string) => {
		const parsed = parseDataviewQuery(queryText);
		if (!parsed) return fullMatch;
		try {
			return evaluateDataviewQuery(parsed, files);
		} catch (error: unknown) {
			if (error instanceof DataviewQueryError) return fullMatch;
			throw error;
		}
	});
}
