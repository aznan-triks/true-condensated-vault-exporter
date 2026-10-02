/**
 * HTML consolidated document generator.
 * Produces a standalone, styled HTML document with:
 *  - inline markdown rendering (code, bold, italic, strikethrough, links, images)
 *  - task lists, ordered lists, merged blockquotes (callouts styled)
 *  - a two-level Table of Contents (documents + their headings)
 *  - automatic dark/light theme following the viewer's preference
 *  - print support (TOC hidden)
 */

import { ExporterSettings } from './types';
import { CleanedNote, visibleMetadata } from './pipeline';

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\x22/g, '&quot;')
		.replace(/\x27/g, '&#039;');
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/&[a-z0-9#]+;/g, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/[^a-z0-9\u00e0-\u00ff-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Renders inline markdown on already-HTML-escaped text.
 * Code spans, images and links are stashed in placeholders so later
 * passes (bold, italic, autolinks) cannot corrupt them.
 */
export function renderInline(text: string): string {
	let out = escapeHtml(text);
	const stash: string[] = [];
	const put = (html: string): string => {
		stash.push(html);
		return '\u0001' + (stash.length - 1) + '\u0001';
	};

	// `code` spans first (contents stay verbatim)
	out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => put('<code>' + code + '</code>'));
	// images
	out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
		(_m, alt: string, src: string) => put('<img src="' + src + '" alt="' + alt + '" loading="lazy">'));
	// links
	out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
		(_m, label: string, href: string) => put('<a href="' + href + '">' + label + '</a>'));
	// bold
	out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
	out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
	// italic (word-boundary safe for underscores)
	out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
	out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
	// strikethrough
	out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
	// bare autolinks (only outside stashed markup)
	out = out.replace(/\b(https?:\/\/[^\s<>()]+(?:[^\s<>().,;!?]|$))/g,
		(_m, url: string) => {
			const bare = url.replace(/[),.;!?]+$/, '');
			const tail = url.slice(bare.length);
			return put('<a href="' + bare + '">' + bare + '</a>') + tail;
		});

	return out.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => stash[Number(i)] ?? '');
}

function closeBlock(out: string[], kind: 'list' | 'table' | 'quote', listTag = 'ul'): void {
	if (kind === 'list') out.push('</' + listTag + '>');
	else if (kind === 'table') out.push('</tbody></table>');
	else if (kind === 'quote') out.push('</blockquote>');
}

/**
 * Block-level markdown -> HTML. `idPrefix` keeps heading anchors unique
 * across documents (e.g. 'doc-3-').
 */
export function simpleMarkdownToHtml(md: string, idPrefix = ''): string {
	const lines = md.split(/\r?\n/);
	const htmlLines: string[] = [];
	let block: 'none' | 'code' | 'table' | 'list' | 'quote' = 'none';
	let listTag = 'ul';
	let quoteLines: string[] = [];

	const flushQuote = (): void => {
		if (quoteLines.length === 0) return;
		const inner = quoteLines.join('\n');
		let cls = '';
		const calloutMatch = inner.match(/^\*\*\[([A-Za-z_-]+)(?::\s*([^\]]*))?\]\*\*/);
		if (calloutMatch) {
			cls = ' class="callout callout-' + escapeHtml((calloutMatch[1] ?? 'note').toLowerCase()) + '"';
		}
		const body = inner
			.split('\n')
			.map((l) => (l.trim() === '' ? '<br>' : '<p>' + renderInline(l) + '</p>'))
			.join('');
		htmlLines.push('<blockquote' + cls + '>' + body + '</blockquote>');
		quoteLines = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i] ?? '';
		const line = rawLine.trimEnd();
		const trimmed = line.trim();

		// Code fences
		if (trimmed.startsWith('```')) {
			if (block === 'code') {
				htmlLines.push('</code></pre>');
				block = 'none';
			} else {
				if (block === 'list') closeBlock(htmlLines, 'list', listTag);
				if (block === 'table') closeBlock(htmlLines, 'table');
				if (block === 'quote') flushQuote();
				const lang = trimmed.slice(3).trim();
				htmlLines.push('<pre><code class="language-' + escapeHtml(lang) + '">');
				block = 'code';
			}
			continue;
		}
		if (block === 'code') {
			htmlLines.push(escapeHtml(rawLine));
			continue;
		}

		// Blockquote lines
		if (trimmed.startsWith('>')) {
			if (block === 'list') closeBlock(htmlLines, 'list', listTag);
			if (block === 'table') closeBlock(htmlLines, 'table');
			block = 'quote';
			quoteLines.push(trimmed.replace(/^>\s?/, ''));
			continue;
		} else if (block === 'quote') {
			flushQuote();
			block = 'none';
		}

		// Horizontal rule
		if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
			if (block === 'list') closeBlock(htmlLines, 'list', listTag);
			if (block === 'table') closeBlock(htmlLines, 'table');
			htmlLines.push('<hr />');
			block = 'none';
			continue;
		}

		// Headings
		const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
		if (headingMatch && headingMatch[1] && headingMatch[2]) {
			if (block === 'list') closeBlock(htmlLines, 'list', listTag);
			if (block === 'table') closeBlock(htmlLines, 'table');
			const level = headingMatch[1].length;
			const text = headingMatch[2].trim();
			const id = idPrefix + slugify(text);
			htmlLines.push('<h' + level + ' id="' + id + '">' + renderInline(text) + '</h' + level + '>');
			block = 'none';
			continue;
		}

		// Tables: first row = header, second (separator) = skipped
		if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
			if (block === 'list') closeBlock(htmlLines, 'list', listTag);
			const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
			const isSeparator = cells.every((c) => /^:?-+:?$/.test(c));
			if (block !== 'table') {
				htmlLines.push('<table><thead><tr>');
				for (const c of cells) {
					htmlLines.push('<th>' + renderInline(c) + '</th>');
				}
				htmlLines.push('</tr></thead><tbody>');
				block = 'table';
				continue;
			}
			if (isSeparator) continue;
			htmlLines.push('<tr>');
			for (const c of cells) {
				htmlLines.push('<td>' + renderInline(c) + '</td>');
			}
			htmlLines.push('</tr>');
			continue;
		} else if (block === 'table') {
			closeBlock(htmlLines, 'table');
			block = 'none';
		}

		// Lists (bulleted, ordered, task)
		const listMatch = trimmed.match(/^([-*]|\d+\.)\s+(.*)$/);
		if (listMatch) {
			const marker = listMatch[1] ?? '-';
			const wantOl = /^\d+\.$/.test(marker);
			const tag = wantOl ? 'ol' : 'ul';
			if (block !== 'list' || listTag !== tag) {
				if (block === 'list') closeBlock(htmlLines, 'list', listTag);
				htmlLines.push('<' + tag + '>');
				block = 'list';
				listTag = tag;
			}
			const itemText = listMatch[2] ?? '';
			const taskMatch = itemText.match(/^\[([ xX])\]\s+(.*)$/);
			if (taskMatch) {
				const checked = (taskMatch[1] ?? '').toLowerCase() === 'x' ? ' checked' : '';
				htmlLines.push('<li class="task"><input type="checkbox" disabled' + checked + '> ' + renderInline(taskMatch[2] ?? '') + '</li>');
			} else {
				htmlLines.push('<li>' + renderInline(itemText) + '</li>');
			}
			continue;
		} else if (block === 'list') {
			closeBlock(htmlLines, 'list', listTag);
			block = 'none';
		}

		if (!trimmed) {
			continue;
		}

		htmlLines.push('<p>' + renderInline(line) + '</p>');
		block = 'none';
	}

	if (block === 'code') htmlLines.push('</code></pre>');
	if (block === 'list') closeBlock(htmlLines, 'list', listTag);
	if (block === 'table') closeBlock(htmlLines, 'table');
	if (block === 'quote') flushQuote();

	return htmlLines.join('\n');
}

/** Collects headings (levels 1-2) of a note body, outside code fences. */
export function noteHeadings(body: string): string[] {
	const out: string[] = [];
	let inCode = false;
	for (const raw of body.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith('```')) {
			inCode = !inCode;
			continue;
		}
		if (inCode) continue;
		const m = line.match(/^(#{1,2})\s+(.*)$/);
		if (m) {
			out.push((m[2] ?? '').trim());
			if (out.length >= 40) break;
		}
	}
	return out;
}

function themeCss(customCss: string): string {
	return `  :root {
    --ve-bg: #1e1e24; --ve-panel: #26262e; --ve-border: #3a3a48; --ve-text: #e6e6e6;
    --ve-muted: #9aa0a6; --ve-accent: #8b72d9; --ve-code-bg: #18181f; --ve-strong: #ffffff;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --ve-bg: #f5f6f8; --ve-panel: #ffffff; --ve-border: #d8dbe0; --ve-text: #24292f;
      --ve-muted: #6b7280; --ve-accent: #6d4fc2; --ve-code-bg: #eef0f3; --ve-strong: #111418;
    }
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: var(--ve-bg); color: var(--ve-text); margin: 0; padding: 24px; display: flex; gap: 32px; }
  nav#toc { width: 320px; position: sticky; top: 24px; align-self: flex-start; max-height: calc(100vh - 48px); overflow-y: auto; background: var(--ve-panel); padding: 16px; border-radius: 8px; border: 1px solid var(--ve-border); flex-shrink: 0; }
  nav#toc h2 { font-size: 16px; margin-top: 0; border-bottom: 1px solid var(--ve-border); padding-bottom: 8px; color: var(--ve-strong); }
  nav#toc ul { list-style: none; padding-left: 0; margin: 0 0 8px 0; font-size: 13px; }
  nav#toc li { margin-bottom: 5px; }
  nav#toc ul ul { padding-left: 14px; margin-top: 3px; font-size: 12px; }
  nav#toc a { color: var(--ve-text); text-decoration: none; display: block; padding: 1px 0; }
  nav#toc a:hover { color: var(--ve-accent); }
  nav#toc .toc-doc { font-weight: 600; }
  nav#toc .toc-sub { color: var(--ve-muted); }
  .path-hint { color: var(--ve-muted); font-size: 11px; }
  main#content { flex: 1; min-width: 0; max-width: 920px; }
  article.vault-document { background: var(--ve-panel); border: 1px solid var(--ve-border); border-radius: 8px; padding: 24px 32px; margin-bottom: 32px; }
  header.doc-header { border-bottom: 1px solid var(--ve-border); padding-bottom: 12px; margin-bottom: 20px; }
  h1.doc-title { margin: 0 0 8px 0; font-size: 24px; color: var(--ve-strong); }
  .doc-meta { display: flex; gap: 8px; flex-wrap: wrap; }
  .badge { background: var(--ve-code-bg); border: 1px solid var(--ve-border); padding: 2px 8px; border-radius: 4px; font-size: 12px; color: var(--ve-muted); }
  .doc-title-line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .back-to-top { font-size: 11px; color: var(--ve-muted); text-decoration: none; white-space: nowrap; }
  .back-to-top:hover { color: var(--ve-accent); }
  article.vault-document h1, article.vault-document h2, article.vault-document h3 { color: var(--ve-strong); }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px; }
  th, td { border: 1px solid var(--ve-border); padding: 8px 12px; text-align: left; }
  th { background: var(--ve-code-bg); }
  tr:nth-child(even) td { background: color-mix(in srgb, var(--ve-code-bg) 40%, transparent); }
  blockquote { border-left: 4px solid var(--ve-accent); margin: 16px 0; padding: 8px 16px; background: var(--ve-code-bg); border-radius: 0 6px 6px 0; color: var(--ve-text); }
  blockquote p { margin: 4px 0; }
  blockquote.callout { border-left-width: 4px; }
  pre { background: var(--ve-code-bg); padding: 12px; border-radius: 6px; overflow-x: auto; border: 1px solid var(--ve-border); }
  code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; }
  p code, li code, td code { background: var(--ve-code-bg); padding: 1px 5px; border-radius: 4px; }
  img { max-width: 100%; border-radius: 6px; }
  a { color: var(--ve-accent); }
  hr { border: none; border-top: 1px solid var(--ve-border); margin: 24px 0; }
  li.task { list-style: none; margin-left: -18px; }
  li.task input { margin-right: 6px; }
  footer.ve-footer { color: var(--ve-muted); font-size: 12px; padding: 8px 4px 32px; text-align: center; }
  @media print {
    body { display: block; padding: 0; }
    nav#toc { display: none; }
    article.vault-document { border: none; padding: 0 0 16px 0; page-break-after: always; }
    .back-to-top { display: none; }
  }
  @media (max-width: 900px) {
    body { flex-direction: column; }
    nav#toc { position: static; width: 100%; max-height: none; }
  }
  ` + (customCss || '');
}

export function formatForHtml(notes: CleanedNote[], settings: ExporterSettings, exportedAt: string): string {
	const tocItems: string[] = [];
	const contentSections: string[] = [];

	notes.forEach((note, i) => {
		const docId = 'doc-' + i;
		const subs = noteHeadings(note.body).map((t) => ({
			label: t,
			id: docId + '-' + slugify(t),
		}));

		let toc = '<li><a class="toc-doc" href="#' + docId + '">' + escapeHtml(note.title);
		toc += ' <span class="path-hint">(' + escapeHtml(note.path) + ')</span></a>';
		if (subs.length > 0) {
			toc += '<ul>';
			for (const sub of subs) {
				toc += '<li class="toc-sub"><a class="toc-sub" href="#' + sub.id + '">' + escapeHtml(sub.label) + '</a></li>';
			}
			toc += '</ul>';
		}
		toc += '</li>';
		tocItems.push(toc);

		const badges = visibleMetadata(note, settings)
			.map(([k, v]) => '<span class="badge">' + escapeHtml(k + ': ' + v) + '</span>')
			.join('\n');

		contentSections.push([
			'<article id="' + docId + '" class="vault-document">',
			'<header class="doc-header">',
			'<div class="doc-title-line">',
			'<h1 class="doc-title">' + escapeHtml(note.title) + '</h1>',
			'<a class="back-to-top" href="#top">Back to top</a>',
			'</div>',
			'<div class="doc-meta">',
			'<span class="badge">' + escapeHtml(note.path) + (note.isCanvas ? ' (canvas)' : '') + '</span>',
			badges,
			'</div>',
			'</header>',
			'<div class="doc-content">',
			simpleMarkdownToHtml(note.body, docId + '-'),
			'</div>',
			'</article>',
		].join('\n'));
	});

	return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n' +
		'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
		'<title>' + escapeHtml(settings.documentTitle) + '</title>\n' +
		'<style>\n' + themeCss(settings.customCss) +
		'</style>\n</head>\n<body id="top">\n' +
		'<nav id="toc">\n' +
		'  <h2>' + escapeHtml(settings.documentTitle) + ' (' + notes.length + ' notes)</h2>\n' +
		'  <ul>\n    ' + tocItems.join('\n    ') + '\n  </ul>\n</nav>\n' +
		'<main id="content">\n' + contentSections.join('\n') + '\n' +
		'<footer class="ve-footer">Exported ' + escapeHtml(exportedAt) + ' · ' + notes.length + ' documents · Vault Exporter</footer>\n' +
		'</main>\n</body>\n</html>';
}
