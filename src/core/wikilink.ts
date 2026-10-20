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

const WIKILINK_REGEX = /!?\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g;

/**
 * Shared syntax/display rules for previews and exported links. One trailing
 * backslash is the table-pipe escape (a literal trailing backslash is ambiguous).
 * Embed dimensions are intentionally omitted: standard Markdown has no width syntax.
 */
function parseWikilink(raw: string, targetGroup?: string, headingGroup?: string, aliasGroup?: string): WikilinkMatch | null {
	const target = (targetGroup ?? '').trim().replace(/\\$/, '');
	const heading = headingGroup?.trim().replace(/\\$/, '');
	if (!target && !heading) return null;
	const capturedAlias = aliasGroup?.trim();
	const alias = raw.startsWith('!') && /^\d+(?:x\d+)?$/.test(capturedAlias ?? '') ? undefined : capturedAlias;
	const targetBasename = target ? target.split('/').pop() ?? target : heading ?? '';
	return { raw, target, heading, alias, displayName: alias || targetBasename };
}

export function extractWikilinks(content: string): WikilinkMatch[] {
	const matches: WikilinkMatch[] = [];
	let match: RegExpExecArray | null;
	const regex = new RegExp(WIKILINK_REGEX.source, 'g');
	while ((match = regex.exec(content)) !== null) {
		const parsed = parseWikilink(match[0], match[1], match[2], match[3]);
		if (parsed) matches.push(parsed);
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
	const normalizeTarget = (value: string): string =>
		value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.(md|canvas)$/i, '').toLowerCase();

	for (const file of files) {
		const noExt = normalizeTarget(file.path);
		if (!byPath.has(noExt)) byPath.set(noExt, file.path);
		const base = normalizeTarget(file.name);
		if (base && !byBasename.has(base)) byBasename.set(base, file.path);
	}

	return (target: string): string | undefined => {
		const normalized = normalizeTarget(target.trim());
		if (!normalized) return undefined;
		const full = byPath.get(normalized);
		if (full) return full;
		const base = normalized.split('/').pop();
		return base ? byBasename.get(base) : undefined;
	};
}

function escapeMarkdownLabel(label: string): string {
	return label.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

/** Extensions rendered as real embeds in Markdown output. */
const ATTACHMENT_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif', 'ico',
	'pdf', 'mp3', 'wav', 'm4a', 'ogg', 'flac', 'mp4', 'webm', 'mov',
	'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'zip',
]);

/**
 * True when an embed points at a real attachment (image/PDF/audio…).
 * Note and canvas embeds are links: `![Note](Note.md)` would render as a
 * broken image, so they are emitted as plain links instead.
 */
function isAttachmentTarget(target: string): boolean {
	const fileName = target.replace(/\\/g, '/').split('/').pop() ?? '';
	const dot = fileName.lastIndexOf('.');
	if (dot <= 0) return false;
	return ATTACHMENT_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase());
}

function encodeMarkdownPath(value: string): string {
	return value.replace(/\\/g, '/').split('/').map((part) => encodeURIComponent(part)).join('/');
}

export function transformWikilinks(
	content: string,
	format: WikilinkFormat = 'clean-text',
	resolveLink?: (target: string) => string | undefined
): string {
	if (format === 'keep-wikilink') {
		return content;
	}

	return content.replace(WIKILINK_REGEX, (raw: string, targetGroup: string, headingGroup: string | undefined, aliasGroup: string | undefined) => {
		const parsed = parseWikilink(raw, targetGroup, headingGroup, aliasGroup);
		if (!parsed) return raw;
		const { target, heading, alias, displayName } = parsed;
		const isEmbed = raw.startsWith('!');
		const targetBasename = target ? target.split('/').pop() ?? target : heading ?? '';

		if (format === 'clean-text') {
			// Embeds keep their display text: dropping them would silently
			// delete content from the export (transclusion is not expanded).
			return displayName;
		}

		if (format === 'canonical-alias') {
			if (!alias || alias === targetBasename || alias === target) {
				return targetBasename;
			}
			return `${targetBasename} (${alias})`;
		}

		if (format === 'markdown') {
			const resolved = target && resolveLink ? resolveLink(target) : target;
			const destination = encodeMarkdownPath(resolved || target);
			const anchor = heading ? `#${encodeURIComponent(heading.toLowerCase().trim().replace(/\s+/g, '-'))}` : '';
			if (!target) return `[${escapeMarkdownLabel(displayName)}](${anchor})`;
			if (isEmbed) {
				if (!isAttachmentTarget(resolved || target)) {
					return `[${escapeMarkdownLabel(displayName)}](${destination})`;
				}
				return `![${escapeMarkdownLabel(displayName)}](${destination})`;
			}
			return `[${escapeMarkdownLabel(displayName)}](${destination}${anchor})`;
		}

		return raw;
	});
}
