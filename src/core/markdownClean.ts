/**
 * Markdown cleaner utility.
 * Removes comments, cleans extra newlines, handles admonitions/callouts.
 *
 * Cleaning must never rewrite code: `%%…%%` comments, `[[wikilinks]]` and
 * callout markers are common *literal* content inside fenced code blocks and
 * inline code spans. Those regions are therefore protected by
 * `splitContentSegments`, and only prose is transformed.
 */

/** A slice of markdown that is either prose or verbatim code. */
export interface ContentSegment {
	/** Raw text, newlines included. */
	text: string;
	/** True for fenced code blocks and inline code spans. */
	code: boolean;
}

/** Opening fence (up to three spaces of indentation, at least three markers). */
const FENCE_OPEN_REGEX = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Splits a markdown body into prose and code segments.
 * Fenced blocks (``` / ~~~, closed or unterminated) and inline code spans are
 * reported as code; everything else is prose. Concatenating the segments
 * reproduces the input exactly.
 */
export function splitContentSegments(content: string): ContentSegment[] {
	const segments: ContentSegment[] = [];
	if (!content) return segments;

	const lines: { text: string; start: number }[] = [];
	let offset = 0;
	for (const text of content.split('\n')) {
		lines.push({ text, start: offset });
		offset += text.length + 1;
	}

	let proseStart = 0;
	let i = 0;
	while (i < lines.length) {
		const opening = FENCE_OPEN_REGEX.exec(lines[i]?.text ?? '');
		if (!opening?.[1]) {
			i++;
			continue;
		}
		const marker = opening[1];
		const closer = new RegExp('^ {0,3}' + marker[0] + '{' + marker.length + ',}[ \\t]*$');
		let end = lines.length;
		for (let j = i + 1; j < lines.length; j++) {
			if (closer.test(lines[j]?.text ?? '')) {
				end = j + 1;
				break;
			}
		}
		const blockStart = lines[i]!.start;
		const lastLine = lines[end - 1]!;
		const blockEnd = lastLine.start + lastLine.text.length;
		if (blockStart > proseStart) {
			pushProseSegments(segments, content.slice(proseStart, blockStart));
		}
		segments.push({ text: content.slice(blockStart, blockEnd), code: true });
		proseStart = blockEnd;
		i = end;
	}
	if (proseStart < content.length) {
		pushProseSegments(segments, content.slice(proseStart));
	}
	return segments;
}

/** Splits prose around inline code spans (paired backtick runs on one line). */
function pushProseSegments(out: ContentSegment[], text: string): void {
	let cursor = 0;
	let i = 0;
	while (i < text.length) {
		if (text[i] !== '`') {
			i++;
			continue;
		}
		let openEnd = i;
		while (text[openEnd] === '`') openEnd++;
		const length = openEnd - i;
		const newline = text.indexOf('\n', openEnd);
		const limit = newline === -1 ? text.length : newline;
		let close = -1;
		for (let j = openEnd; j < limit; j++) {
			if (text[j] !== '`') continue;
			let runEnd = j;
			while (text[runEnd] === '`') runEnd++;
			if (runEnd - j === length && runEnd <= limit) {
				close = j;
				break;
			}
			j = runEnd - 1;
		}
		if (close === -1) {
			i = openEnd;
			continue;
		}
		if (i > cursor) {
			out.push({ text: text.slice(cursor, i), code: false });
		}
		out.push({ text: text.slice(i, close + length), code: true });
		cursor = close + length;
		i = cursor;
	}
	if (cursor < text.length) {
		out.push({ text: text.slice(cursor), code: false });
	}
}

/**
 * Applies a cleaning step to prose only, leaving fenced blocks and inline code
 * spans byte-for-byte intact.
 */
export function applyToProse(content: string, transform: (text: string) => string): string {
	return splitContentSegments(content)
		.map((segment) => (segment.code ? segment.text : transform(segment.text)))
		.join('');
}

export function removeComments(content: string): string {
	return content.replace(/%%[\s\S]*?%%/g, '');
}

export function cleanCallouts(content: string): string {
	return content.replace(/^>\s*\[!([A-Za-z_-]+)\](?:[ \t]*(.*))?$/gm, (_match, type, title) => {
		const calloutTitle = title ? ': ' + title : '';
		return '> **[' + type.toUpperCase() + calloutTitle + ']**';
	});
}

/** Normalizes line endings and whitespace without touching code content. */
export function sanitizeWhitespace(content: string): string {
	return splitContentSegments(content)
		.map((segment) => {
			const normalized = segment.text.replace(/\r\n/g, '\n');
			if (segment.code) return normalized;
			// Only strip spaces that precede a line break: a space at the end of
			// a prose segment may sit right before an inline code span.
			return normalized
				.replace(/[ \t]+\n/g, '\n')
				.replace(/\n{3,}/g, '\n\n');
		})
		.join('')
		.trim();
}
