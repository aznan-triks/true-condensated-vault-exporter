/**
 * YAML frontmatter extraction and parsing.
 * Pure TypeScript implementation without external yaml parser dependency.
 */

import { FileMetadata } from './types';

export interface FrontmatterResult {
	metadata: FileMetadata;
	contentWithoutFrontmatter: string;
	rawFrontmatter?: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function defaultFileMetadata(): FileMetadata {
	return {
		title: '',
		category: '',
		order: '',
		tags: [],
		custom: {},
	};
}

function stripQuotes(str: string): string {
	const trimmed = str.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

export function parseFrontmatter(content: string): FrontmatterResult {
	const match = content.match(FRONTMATTER_REGEX);

	if (!match || !match[1]) {
		return {
			metadata: defaultFileMetadata(),
			contentWithoutFrontmatter: content,
		};
	}

	const rawFrontmatter = match[1];
	const contentWithoutFrontmatter = content.slice(match[0].length);
	const metadata: FileMetadata = defaultFileMetadata();

	const lines = rawFrontmatter.split(/\r?\n/);
	let currentArrayKey: string | null = null;
	let currentArray: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		if (trimmed.startsWith('- ') && currentArrayKey) {
			const itemVal = stripQuotes(trimmed.slice(2));
			currentArray.push(itemVal);
			continue;
		}

		const colonIdx = line.indexOf(':');
		if (colonIdx !== -1) {
			if (currentArrayKey) {
				if (currentArrayKey === 'tags') {
					metadata.tags = currentArray;
				} else {
					metadata.custom[currentArrayKey] = currentArray;
				}
				currentArrayKey = null;
				currentArray = [];
			}

			const key = line.slice(0, colonIdx).trim();
			let val = line.slice(colonIdx + 1).trim();

			if (!val) {
				currentArrayKey = key;
				currentArray = [];
				continue;
			}

			val = stripQuotes(val);

			if (val.startsWith('[') && val.endsWith(']')) {
				const items = val.slice(1, -1).split(',').map(s => stripQuotes(s)).filter(Boolean);
				if (key === 'tags') {
					metadata.tags = items;
				} else {
					metadata.custom[key] = items;
				}
				continue;
			}

			switch (key.toLowerCase()) {
				case 'title':
					metadata.title = val;
					break;
				case 'categorie':
				case 'category':
					metadata.category = val;
					break;
				case 'ordre':
				case 'order':
					metadata.order = val;
					break;
				case 'tags':
					metadata.tags = [val];
					break;
				case 'trello_url':
					metadata.trelloUrl = val;
					break;
				case 'date_creation':
					metadata.dateCreation = val;
					break;
				case 'date_revision':
					metadata.dateRevision = val;
					break;
				case 'statut':
					metadata.statut = val;
					break;
				default:
					metadata.custom[key] = val;
					break;
			}
		}
	}

	if (currentArrayKey) {
		if (currentArrayKey === 'tags') {
			metadata.tags = currentArray;
		} else {
			metadata.custom[currentArrayKey] = currentArray;
		}
	}

	return {
		metadata,
		contentWithoutFrontmatter,
		rawFrontmatter,
	};
}