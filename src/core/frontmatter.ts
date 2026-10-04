/**
 * Small, dependency-free parser for common flat YAML frontmatter fields.
 * It intentionally supports scalar values and simple inline/block lists.
 */

import { FileMetadata } from './types';

export interface FrontmatterResult {
	metadata: FileMetadata;
	contentWithoutFrontmatter: string;
	rawFrontmatter?: string;
}

const FRONTMATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

export function defaultFileMetadata(): FileMetadata {
	return {
		title: '',
		category: '',
		order: '',
		tags: [],
		custom: {},
	};
}

function stripYamlComment(value: string): string {
	let quote = '';
	for (let i = 0; i < value.length; i++) {
		const char = value[i] ?? '';
		if (quote) {
			if (char === quote && value[i - 1] !== '\\') quote = '';
		} else if ((char === '"' || char === "'") && (i === 0 || /[\\s,[{]/.test(value[i - 1] ?? ''))) {
			quote = char;
		} else if (char === '#' && (i === 0 || /\s/.test(value[i - 1] ?? ''))) {
			return value.slice(0, i).trimEnd();
		}
	}
	return value.trimEnd();
}

function parseScalar(value: string): string {
	const trimmed = stripYamlComment(value).trim();
	if (trimmed.length >= 2) {
		const quote = trimmed[0];
		if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
			const inner = trimmed.slice(1, -1);
			return quote === '"'
				? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
				: inner.replace(/''/g, "'");
		}
	}
	return trimmed;
}

function splitInlineList(value: string): string[] {
	const body = value.slice(1, -1);
	const items: string[] = [];
	let quote = '';
	let start = 0;
	for (let i = 0; i < body.length; i++) {
		const char = body[i] ?? '';
		if (quote) {
			if (char === quote && body[i - 1] !== '\\') quote = '';
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === ',') {
			const item = parseScalar(body.slice(start, i));
			if (item) items.push(item);
			start = i + 1;
		}
	}
	const last = parseScalar(body.slice(start));
	if (last) items.push(last);
	return items;
}

function setMetadataValue(metadata: FileMetadata, key: string, value: string | string[]): void {
	const normalized = key.toLowerCase();
	if (normalized === 'tags') {
		metadata.tags = Array.isArray(value) ? value : value ? [value] : [];
		return;
	}
	const scalar = Array.isArray(value) ? value.join(', ') : value;
	switch (normalized) {
		case 'title':
			metadata.title = scalar;
			break;
		case 'categorie':
		case 'category':
			metadata.category = scalar;
			break;
		case 'ordre':
		case 'order':
			metadata.order = scalar;
			break;
		case 'status':
		case 'statut':
			metadata.status = scalar;
			break;
		case 'trello_url':
			metadata.trelloUrl = scalar;
			break;
		case 'date_creation':
			metadata.dateCreation = scalar;
			break;
		case 'date_revision':
			metadata.dateRevision = scalar;
			break;
		default:
			metadata.custom[key] = value;
			break;
	}
}

function parseRawFrontmatter(rawFrontmatter: string): FileMetadata {
	const metadata = defaultFileMetadata();
	let currentListKey: string | null = null;
	let currentList: string[] = [];

	const flushList = (): void => {
		if (currentListKey !== null) {
			setMetadataValue(metadata, currentListKey, currentList);
			currentListKey = null;
			currentList = [];
		}
	};

	for (const line of rawFrontmatter.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const listItem = trimmed.match(/^-[ \t]+(.*)$/);
		if (listItem && currentListKey !== null) {
			const item = parseScalar(listItem[1] ?? '');
			if (item) currentList.push(item);
			continue;
		}

		flushList();
		const property = line.match(/^([^\s][^:]*?):[ \t]*(.*)$/);
		if (!property) continue;
		const key = (property[1] ?? '').trim();
		const rawValue = stripYamlComment(property[2] ?? '').trim();
		if (!rawValue) {
			currentListKey = key;
			continue;
		}
		if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
			setMetadataValue(metadata, key, splitInlineList(rawValue));
		} else {
			setMetadataValue(metadata, key, parseScalar(rawValue));
		}
	}
	flushList();
	return metadata;
}

export function parseFrontmatter(content: string): FrontmatterResult {
	const source = content.startsWith('\uFEFF') ? content.slice(1) : content;
	const match = source.match(FRONTMATTER_REGEX);
	if (!match) {
		return {
			metadata: defaultFileMetadata(),
			contentWithoutFrontmatter: source,
		};
	}

	const rawFrontmatter = match[1] ?? '';
	return {
		metadata: parseRawFrontmatter(rawFrontmatter),
		contentWithoutFrontmatter: source.slice(match[0].length),
		rawFrontmatter,
	};
}
