/**
 * HTML consolidated document generator.
 * Produces a standalone, styled HTML document with a dynamic Table of Contents.
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

export function simpleMarkdownToHtml(md: string): string {
	const lines = md.split(/\r?\n/);
	const htmlLines: string[] = [];
	let inList = false;
	let inCode = false;
	let inTable = false;

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i] ?? '';
		const line = rawLine.trimEnd();

		if (line.startsWith('```')) {
			if (inCode) {
				htmlLines.push('</code></pre>');
				inCode = false;
			} else {
				if (inList) { htmlLines.push('</ul>'); inList = false; }
				if (inTable) { htmlLines.push('</tbody></table>'); inTable = false; }
				const lang = line.slice(3).trim();
				htmlLines.push('<pre><code class=\x22language-' + escapeHtml(lang) + '\x22>');
				inCode = true;
			}
			continue;
		}
		if (inCode) {
			htmlLines.push(escapeHtml(rawLine));
			continue;
		}

		if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
			if (inList) { htmlLines.push('</ul>'); inList = false; }
			if (inTable) { htmlLines.push('</tbody></table>'); inTable = false; }
			htmlLines.push('<hr />');
			continue;
		}

		const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
		if (headingMatch && headingMatch[1] && headingMatch[2]) {
			if (inList) { htmlLines.push('</ul>'); inList = false; }
			if (inTable) { htmlLines.push('</tbody></table>'); inTable = false; }
			const level = headingMatch[1].length;
			const text = headingMatch[2].trim();
			const id = text.toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, '-');
			htmlLines.push('<h' + level + ' id=\x22' + id + '\x22>' + escapeHtml(text) + '</h' + level + '>');
			continue;
		}

		if (line.startsWith('|') && line.endsWith('|')) {
			if (inList) { htmlLines.push('</ul>'); inList = false; }
			const cells = line.split('|').slice(1, -1).map(c => c.trim());
			if (cells.every(c => /^:?-+:?$/.test(c))) {
				continue;
			}
			if (!inTable) {
				htmlLines.push('<table><thead><tr>');
				for (const c of cells) {
					htmlLines.push('<th>' + escapeHtml(c) + '</th>');
				}
				htmlLines.push('</tr></thead><tbody>');
				inTable = true;
			} else {
				htmlLines.push('<tr>');
				for (const c of cells) {
					htmlLines.push('<td>' + escapeHtml(c) + '</td>');
				}
				htmlLines.push('</tr>');
			}
			continue;
		} else if (inTable) {
			htmlLines.push('</tbody></table>');
			inTable = false;
		}

		if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
			if (inTable) { htmlLines.push('</tbody></table>'); inTable = false; }
			if (!inList) {
				htmlLines.push('<ul>');
				inList = true;
			}
			const itemText = line.trim().slice(2);
			htmlLines.push('<li>' + escapeHtml(itemText) + '</li>');
			continue;
		} else if (inList) {
			htmlLines.push('</ul>');
			inList = false;
		}

		if (line.trim().startsWith('>')) {
			const bqText = line.trim().slice(1).trim();
			htmlLines.push('<blockquote>' + escapeHtml(bqText) + '</blockquote>');
			continue;
		}

		if (!line.trim()) {
			continue;
		}

		htmlLines.push('<p>' + escapeHtml(line) + '</p>');
	}

	if (inCode) htmlLines.push('</code></pre>');
	if (inList) htmlLines.push('</ul>');
	if (inTable) htmlLines.push('</tbody></table>');

	return htmlLines.join('\n');
}

export function formatForHtml(notes: CleanedNote[], settings: ExporterSettings): string {
	const tocItems: string[] = [];
	const contentSections: string[] = [];

	notes.forEach((note, i) => {
		const docId = 'doc-' + i;
		tocItems.push('<li><a href="#' + docId + '">' + escapeHtml(note.title) + ' <span class="path-hint">(' + escapeHtml(note.path) + ')</span></a></li>');

		const badges = visibleMetadata(note, settings)
			.map(([k, v]) => '<span class="badge">' + escapeHtml(k + ': ' + v) + '</span>')
			.join('\n');

		contentSections.push([
			'<article id="' + docId + '" class="vault-document">',
			'<header class="doc-header">',
			'<h1 class="doc-title">' + escapeHtml(note.title) + '</h1>',
			'<div class="doc-meta">',
			'<span class="badge">' + escapeHtml(note.path) + '</span>',
			badges,
			'</div>',
			'</header>',
			'<div class="doc-content">',
			simpleMarkdownToHtml(note.body),
			'</div>',
			'</article>',
		].join('\n'));
	});

	const css = settings.customCss || '';
	return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n' +
		'<title>' + escapeHtml(settings.documentTitle) + '</title>\n' +
		'<style>\n' +
		'  body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background: #1e1e24; color: #e6e6e6; margin: 0; padding: 24px; display: flex; gap: 32px; }\n' +
		'  nav#toc { width: 320px; position: sticky; top: 24px; max-height: calc(100vh - 48px); overflow-y: auto; background: #2b2b36; padding: 16px; border-radius: 8px; border: 1px solid #3d3d4d; flex-shrink: 0; }\n' +
		'  nav#toc h2 { font-size: 16px; margin-top: 0; border-bottom: 1px solid #3d3d4d; padding-bottom: 8px; }\n' +
		'  nav#toc ul { list-style: none; padding-left: 0; margin: 0; font-size: 13px; }\n' +
		'  nav#toc li { margin-bottom: 6px; }\n' +
		'  nav#toc a { color: #e6e6e6; text-decoration: none; }\n' +
		'  nav#toc a:hover { color: #7c5cbf; }\n' +
		'  .path-hint { color: #9aa0a6; font-size: 11px; }\n' +
		'  main#content { flex: 1; min-width: 0; max-width: 900px; }\n' +
		'  article.vault-document { background: #2b2b36; border: 1px solid #3d3d4d; border-radius: 8px; padding: 24px 32px; margin-bottom: 32px; }\n' +
		'  header.doc-header { border-bottom: 1px solid #3d3d4d; padding-bottom: 12px; margin-bottom: 20px; }\n' +
		'  h1.doc-title { margin: 0 0 8px 0; font-size: 24px; color: #fff; }\n' +
		'  .doc-meta { display: flex; gap: 8px; flex-wrap: wrap; }\n' +
		'  .badge { background: #3c3c4f; padding: 2px 8px; border-radius: 4px; font-size: 12px; color: #9aa0a6; }\n' +
		'  table { border-collapse: collapse; width: 100%; margin: 16px 0; }\n' +
		'  th, td { border: 1px solid #3d3d4d; padding: 8px 12px; text-align: left; }\n' +
		'  th { background: #323242; }\n' +
		'  blockquote { border-left: 4px solid #7c5cbf; margin: 16px 0; padding-left: 16px; color: #9aa0a6; }\n' +
		'  pre { background: #18181f; padding: 12px; border-radius: 6px; overflow-x: auto; }\n' +
		'  code { font-family: Consolas, monospace; font-size: 13px; }\n' +
		'  ' + css + '\n' +
		'</style>\n</head>\n<body>\n' +
		'<nav id="toc">\n' +
		'  <h2>' + escapeHtml(settings.documentTitle) + ' (' + notes.length + ' notes)</h2>\n' +
		'  <ul>\n    ' + tocItems.join('\n    ') + '\n  </ul>\n</nav>\n' +
		'<main id="content">\n' + contentSections.join('\n') + '\n</main>\n</body>\n</html>';
}
