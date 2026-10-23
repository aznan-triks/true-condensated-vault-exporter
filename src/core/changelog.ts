/**
 * Changelog parser, dual-voice filter (Plain / Technical / All), category filter,
 * version range slicer, and safe HTML renderer for the Settings Changelog viewer.
 * Pure TypeScript — no Obsidian imports allowed.
 */

export type ChangelogViewMode = 'all' | 'plain' | 'tech';

export interface ChangelogVoiceBlock {
	type: 'plain' | 'tech' | 'legacy';
	marker: string;
	content: string;
}

export interface RawChangelogItem {
	ver: string;
	date: string;
	bodyContent: string;
}

export interface ChangelogDateGroup {
	date: string;
	versions: RawChangelogItem[];
}

export interface ChangelogFilterOptions {
	searchQuery: string;
	viewMode: ChangelogViewMode;
	activeCats: Set<string>;
	sortOrder: 'desc' | 'asc';
	versionFrom: string;
	versionTo: string;
}

export interface FilteredChangelogResult {
	processedItems: RawChangelogItem[];
	dateGroups: ChangelogDateGroup[];
	uniqueVersions: string[];
}

export const KNOWN_CHANGELOG_CATEGORIES = ['Added', 'Improved', 'Changed', 'Fixed', 'Removed', 'Security'] as const;

export const CHANGELOG_CATEGORY_ICONS: Record<string, string> = {
	Added: '✨',
	Improved: '🚀',
	Changed: '⚡',
	Fixed: '🐛',
	Removed: '🗑️',
	Security: '🛡️',
	Internal: '🔧',
	Documentation: '📚',
};

export const CHANGELOG_CATEGORY_CLASSES: Record<string, string> = {
	Added: 've-cl-added',
	Improved: 've-cl-improved',
	Changed: 've-cl-modified',
	Fixed: 've-cl-fixed',
	Removed: 've-cl-removed',
	Security: 've-cl-security',
	Internal: 've-cl-internal',
	Documentation: 've-cl-added',
};

export function escapeChangelogHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function renderChangelogMarkdown(text: string): string {
	if (!text) return '';
	let src = String(text).replace(/\r\n/g, '\n');

	const codeBlocks: string[] = [];
	src = src.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
		codeBlocks.push('<pre class="ve-cl-md-code-block"><code>' + escapeChangelogHtml(code.trim()) + '</code></pre>');
		return '%%CODEBLOCK' + (codeBlocks.length - 1) + '%%';
	});

	const inlineCodes: string[] = [];
	src = src.replace(/`([^`]+)`/g, (_m, code: string) => {
		inlineCodes.push('<code>' + escapeChangelogHtml(code) + '</code>');
		return '%%INLINECODE' + (inlineCodes.length - 1) + '%%';
	});

	src = escapeChangelogHtml(src);

	src = src
		.replace(/^#### (.*)$/gm, '<h4>$1</h4>')
		.replace(/^### (.*)$/gm, '<h3>$1</h3>')
		.replace(/^## (.*)$/gm, '<h2>$1</h2>')
		.replace(/^# (.*)$/gm, '<h1>$1</h1>');

	src = src.replace(/^(---|[*]{3}|___)$/gm, '<hr>');

	src = src.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
	src = src.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

	src = src
		.replace(/~~(.*?)~~/g, '<del>$1</del>')
		.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
		.replace(/__(.*?)__/g, '<strong>$1</strong>')
		.replace(/\*(.*?)\*/g, '<em>$1</em>')
		.replace(/_(.*?)_/g, '<em>$1</em>');

	src = src.replace(
		/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
		'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
	);

	const lines = src.split('\n');
	const grouped: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? '';
		const ulMatch = /^[ \t]*[-*]\s+(.*)$/.exec(line);
		const olMatch = /^[ \t]*\d+\.\s+(.*)$/.exec(line);
		if (ulMatch) {
			const items: string[] = [];
			while (i < lines.length) {
				const current = lines[i] ?? '';
				const m = /^[ \t]*[-*]\s+(.*)$/.exec(current);
				if (!m) break;
				items.push('<li>' + (m[1] ?? '') + '</li>');
				i++;
			}
			grouped.push('<ul class="ve-cl-md-list">' + items.join('') + '</ul>');
		} else if (olMatch) {
			const items: string[] = [];
			while (i < lines.length) {
				const current = lines[i] ?? '';
				const m = /^[ \t]*\d+\.\s+(.*)$/.exec(current);
				if (!m) break;
				items.push('<li>' + (m[1] ?? '') + '</li>');
				i++;
			}
			grouped.push('<ol class="ve-cl-md-list">' + items.join('') + '</ol>');
		} else {
			grouped.push(line);
			i++;
		}
	}
	src = grouped.join('\n');
	src = src.replace(/\n/g, '<br>');

	src = src.replace(/%%INLINECODE(\d+)%%/g, (_m, idx: string) => inlineCodes[parseInt(idx, 10)] ?? '');
	src = src.replace(/%%CODEBLOCK(\d+)%%/g, (_m, idx: string) => codeBlocks[parseInt(idx, 10)] ?? '');

	return src;
}

export function parseRawChangelogMarkdown(markdownText: string): {
	introHtml: string;
	rawItems: RawChangelogItem[];
} {
	if (!markdownText) return { introHtml: '', rawItems: [] };
	const rawSections = markdownText.split(/^##\s+/m);
	let introHtml = '';
	const rawItems: RawChangelogItem[] = [];

	rawSections.forEach((sec, idx) => {
		if (idx === 0) {
			const cleanIntro = sec.replace(/^#\s+Changelog\s*/i, '').trim();
			if (cleanIntro) {
				introHtml = '<div class="ve-cl-intro">' + renderChangelogMarkdown(cleanIntro) + '</div>';
			}
			return;
		}

		const firstLineEnd = sec.indexOf('\n');
		const headerLine = (firstLineEnd !== -1 ? sec.substring(0, firstLineEnd) : sec).trim();
		const bodyContent = (firstLineEnd !== -1 ? sec.substring(firstLineEnd + 1) : '').trim();

		const match = headerLine.match(/\[(.*?)\](?:\s*[-\u2014]\s*(.*))?/);
		const ver = match && match[1] ? match[1] : headerLine;
		const date = match && match[2]
			? match[2]
			: ver.toLowerCase().includes('unreleased')
				? 'Unreleased'
				: 'History';

		if (!bodyContent && ver.toLowerCase().includes('unreleased')) return;
		rawItems.push({ ver, date, bodyContent });
	});

	return { introHtml, rawItems };
}

const VOICE_LABEL_PATTERN =
	'(?:Plain(?:[ \\t]+(?:words?|terms?|text|language))?|Human(?:[ \\t]+words?)?|Technical(?:[ \\t]+(?:details?|notes?|specs?))?|Tech)';

export function parseChangelogVoiceBlocks(catBody: string): ChangelogVoiceBlock[] {
	if (!catBody) return [];
	const markerRegex = new RegExp(
		'(?:^|\\r?\\n)[ \\t]*(?:[-*+>]\\s*)?(' +
			'(?:(?:\\*\\*|__|\\*|_)\\s*' + VOICE_LABEL_PATTERN + '\\s*:?\\s*(?:\\*\\*|__|\\*|_)\\s*:?|' +
			VOICE_LABEL_PATTERN + '\\s*:)' +
			'\\s*)',
		'gi'
	);
	const parts = catBody.split(markerRegex);
	if (parts.length <= 1) {
		return [{ type: 'legacy', marker: '', content: catBody.trim() }];
	}
	const blocks: ChangelogVoiceBlock[] = [];
	if ((parts[0] ?? '').trim()) {
		blocks.push({ type: 'legacy', marker: '', content: (parts[0] ?? '').trim() });
	}
	for (let i = 1; i < parts.length; i += 2) {
		const marker = (parts[i] ?? '').trim();
		const content = (parts[i + 1] ?? '').trim();
		if (!content) continue;
		const isPlain = /Plain|Human/i.test(marker);
		const isTech = /Tech/i.test(marker);
		const type: 'plain' | 'tech' | 'legacy' = isPlain ? 'plain' : isTech ? 'tech' : 'legacy';
		blocks.push({ type, marker, content });
	}
	return blocks;
}

export function filterChangelogCatBody(catBody: string, viewMode: ChangelogViewMode): string {
	if (viewMode === 'all') return catBody;
	const blocks = parseChangelogVoiceBlocks(catBody);
	if (blocks.length === 1 && blocks[0]?.type === 'legacy') return catBody;

	let out = '';
	for (const block of blocks) {
		if (block.type === 'legacy') {
			out += block.content + '\n\n';
		} else if (viewMode === 'plain' && block.type === 'plain') {
			const marker = block.marker.includes(':') ? block.marker : block.marker + ':';
			const sep = block.content.startsWith('-') || block.content.startsWith('*') ? '\n' : ' ';
			out += marker + sep + block.content + '\n\n';
		} else if (viewMode === 'tech' && block.type === 'tech') {
			const marker = block.marker.includes(':') ? block.marker : block.marker + ':';
			const sep = block.content.startsWith('-') || block.content.startsWith('*') ? '\n' : ' ';
			out += marker + sep + block.content + '\n\n';
		}
	}
	return out.trim();
}

function renderVoiceBlocksHtml(text: string): string {
	const blocks = parseChangelogVoiceBlocks(text);
	let html = '';
	for (const voiceBlock of blocks) {
		if (voiceBlock.type === 'plain') {
			html +=
				'<div class="ve-cl-voice-entry ve-cl-voice-plain">' +
				'<div class="ve-cl-voice-label"><span class="ve-cl-tag ve-cl-tag-plain">👤 Plain</span></div>' +
				'<div class="ve-cl-voice-content">' +
				renderChangelogMarkdown(voiceBlock.content) +
				'</div>' +
				'</div>';
		} else if (voiceBlock.type === 'tech') {
			html +=
				'<div class="ve-cl-voice-entry ve-cl-voice-tech">' +
				'<div class="ve-cl-voice-label"><span class="ve-cl-tag ve-cl-tag-tech">💻 Technical</span></div>' +
				'<div class="ve-cl-voice-content">' +
				renderChangelogMarkdown(voiceBlock.content) +
				'</div>' +
				'</div>';
		} else {
			html += '<div class="ve-cl-voice-entry ve-cl-voice-legacy">' + renderChangelogMarkdown(voiceBlock.content) + '</div>';
		}
	}
	return html;
}

export function formatChangelogBody(bodyContent: string): string {
	const catBlocks = bodyContent.split(/^###\s+/m);
	let html = '';

	catBlocks.forEach((block, bIdx) => {
		if (bIdx === 0) {
			if (block.trim()) {
				html += '<div class="ve-cl-preamble">' + renderVoiceBlocksHtml(block.trim()) + '</div>';
			}
			return;
		}

		const firstLineEnd = block.indexOf('\n');
		const catName = (firstLineEnd !== -1 ? block.substring(0, firstLineEnd) : block).trim();
		const catBody = (firstLineEnd !== -1 ? block.substring(firstLineEnd + 1) : '').trim();

		const icon = CHANGELOG_CATEGORY_ICONS[catName] ?? '📌';
		const headerClass = CHANGELOG_CATEGORY_CLASSES[catName] ?? 've-cl-added';

		html += '<div class="ve-cl-category-section">';
		html += '<div class="ve-cl-sec-header ' + headerClass + '">' + icon + ' ' + escapeChangelogHtml(catName) + '</div>';
		html += renderVoiceBlocksHtml(catBody);
		html += '</div>';
	});

	return html;
}

export function buildChangelogVersionCard(item: RawChangelogItem): string {
	const isUnreleased = item.ver.toLowerCase().includes('unreleased');
	const badgeClass = isUnreleased ? 've-cl-badge-unreleased' : 've-cl-badge-release';
	const labelVer = (isUnreleased ? '⚠️ ' : '🏷️ ') + escapeChangelogHtml(item.ver);
	const formattedBody = formatChangelogBody(item.bodyContent);

	return (
		'<div class="ve-cl-version-card">' +
		'<div class="ve-cl-version-card__header">' +
		'<span class="' + badgeClass + '">' + labelVer + '</span>' +
		'<span class="ve-cl-version-card__date">📅 ' + escapeChangelogHtml(item.date) + '</span>' +
		'</div>' +
		'<div class="ve-cl-body">' + formattedBody + '</div>' +
		'</div>'
	);
}

export function filterAndGroupChangelog(
	rawItems: RawChangelogItem[],
	options: ChangelogFilterOptions
): FilteredChangelogResult {
	const uniqueVersions = rawItems.map((i) => i.ver).filter((v, idx, a) => Boolean(v) && a.indexOf(v) === idx);

	let filteredItems = rawItems;
	if (options.versionFrom !== 'all' || options.versionTo !== 'all') {
		const allVers = rawItems.map((i) => i.ver);
		const fromIdx = options.versionFrom !== 'all' ? allVers.indexOf(options.versionFrom) : 0;
		const toIdx = options.versionTo !== 'all' ? allVers.indexOf(options.versionTo) : allVers.length - 1;
		if (fromIdx !== -1 && toIdx !== -1) {
			const start = Math.min(fromIdx, toIdx);
			const end = Math.max(fromIdx, toIdx);
			filteredItems = rawItems.slice(start, end + 1);
		}
	}

	const processedItems: RawChangelogItem[] = [];
	const hasAllDefaultCats = KNOWN_CHANGELOG_CATEGORIES.every((cat) => options.activeCats.has(cat));

	for (const item of filteredItems) {
		const catBlocks = item.bodyContent.split(/^###\s+/m);
		let catContent = '';
		let hasMatchingCat = false;

		catBlocks.forEach((block, bIdx) => {
			if (bIdx === 0) return;
			const firstLineEnd = block.indexOf('\n');
			const catName = (firstLineEnd !== -1 ? block.substring(0, firstLineEnd) : block).trim();
			const catBody = (firstLineEnd !== -1 ? block.substring(firstLineEnd + 1) : '').trim();

			const isCatActive =
				options.activeCats.has(catName) ||
				(hasAllDefaultCats && !(KNOWN_CHANGELOG_CATEGORIES as readonly string[]).includes(catName));
			if (!isCatActive) return;

			const filteredCatBody = filterChangelogCatBody(catBody, options.viewMode);
			if (filteredCatBody.trim()) {
				hasMatchingCat = true;
				catContent += '### ' + catName + '\n' + filteredCatBody + '\n\n';
			}
		});

		if (!hasMatchingCat) continue;

		const preamble = filterChangelogCatBody((catBlocks[0] ?? '').trim(), options.viewMode);
		const newBodyContent = (preamble ? preamble + '\n\n' : '') + catContent;

		if (options.searchQuery) {
			const fullText = (item.ver + ' ' + item.date + ' ' + newBodyContent).toLowerCase();
			if (!fullText.includes(options.searchQuery.toLowerCase())) continue;
		}

		processedItems.push({
			ver: item.ver,
			date: item.date,
			bodyContent: newBodyContent.trim(),
		});
	}

	if (options.sortOrder === 'asc') {
		processedItems.reverse();
	}

	const dateGroups: ChangelogDateGroup[] = [];
	const dateMap = new Map<string, ChangelogDateGroup>();
	for (const item of processedItems) {
		let group = dateMap.get(item.date);
		if (!group) {
			group = { date: item.date, versions: [] };
			dateMap.set(item.date, group);
			dateGroups.push(group);
		}
		group.versions.push(item);
	}

	return { processedItems, dateGroups, uniqueVersions };
}
