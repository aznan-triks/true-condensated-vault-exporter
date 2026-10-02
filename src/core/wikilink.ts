/**
 * Wikilink processing logic.
 * Transforms [[Note#Heading|Display]] into target format, and can resolve
 * link targets to real vault paths (for markdown/html output).
 */

import { WikilinkFormat } from './types';

export interface WikilinkMatch {
	raw: string;
	target: string;
	heading?: string;
	alias?: string;
	displayName: string;
}

const WIKILINK_REGEX = /!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

export function extractWikilinks(content: string): WikilinkMatch[] {
	const matches: WikilinkMatch[] = [];
	let match: RegExpExecArray | null;
	const regex = new RegExp(WIKILINK_REGEX.source, 'g');
	while ((match = regex.exec(content)) !== null) {
		const target = (match[1] ?? '').trim();
		const heading = match[2]?.trim();
		const alias = match[3]?.trim();
		const targetBasename = target.split('/').pop() ?? target;
		const displayName = alias || targetBasename;

		matches.push({
			raw: match[0],
			target,
			heading,
			alias,
			displayName,
		});
	}
	return matches;
}

/**
 * Builds a resolver mapping wikilink targets to real vault file paths.
 * Handles full paths (with or without extension) and bare basenames.
 */
export function buildLinkResolver(files: { path: string; name: string }[]): (target: string) => string | undefined {
	const byPath = new Map<string, string>();
	const byBasename = new Map<string, string>();

	for (const file of files) {
		const noExt = file.path.replace(/\.(md|canvas)$/i, '');
		if (!byPath.has(noExt.toLowerCase())) {
			byPath.set(noExt.toLowerCase(), file.path);
		}
		const base = file.name.replace(/\.(md|canvas)$/i, '');
		if (base && !byBasename.has(base.toLowerCase())) {
			byBasename.set(base.toLowerCase(), file.path);
		}
	}

	return (target: string): string | undefined => {
		const t = target.trim();
		if (!t) return undefined;
		const full = byPath.get(t.toLowerCase());
		if (full) return full;
		const base = t.split('/').pop()?.toLowerCase();
		if (base) return byBasename.get(base);
		return undefined;
	};
}

export function transformWikilinks(
	content: string,
	format: WikilinkFormat = 'clean-text',
	resolveLink?: (target: string) => string | undefined
): string {
	if (format === 'keep-wikilink') {
		return content;
	}

	return content.replace(WIKILINK_REGEX, (raw, targetGroup, headingGroup, aliasGroup) => {
		const isEmbed = raw.startsWith('!');
		const target = (targetGroup ?? '').trim();
		const heading = headingGroup?.trim();
		const alias = aliasGroup?.trim();
		const targetBasename = target.split('/').pop() ?? target;
		const displayName = alias || targetBasename;

		if (format === 'clean-text') {
			if (isEmbed) {
				return '';
			}
			return displayName;
		}

		if (format === 'canonical-alias') {
			if (isEmbed) {
				return '';
			}
			if (!alias || alias === targetBasename || alias === target) {
				return targetBasename;
			}
			return `${targetBasename} (${alias})`;
		}

		if (format === 'markdown') {
			if (isEmbed) {
				const resolved = resolveLink ? resolveLink(target) : target;
				return `![${displayName}](${resolved || target})`;
			}
			const resolved = resolveLink ? resolveLink(target) : target;
			const anchor = heading ? `#${heading.toLowerCase().replace(/\s+/g, '-')}` : '';
			return `[${displayName}](${resolved || target}${anchor})`;
		}

		return raw;
	});
}
