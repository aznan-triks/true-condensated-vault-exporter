import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { isFileIncluded, reservedOutputPaths } from '../src/core/filter';
import { extractWikilinks, transformWikilinks, buildLinkResolver } from '../src/core/wikilink';
import { parseFrontmatter } from '../src/core/frontmatter';
import { removeComments, cleanCallouts, sanitizeWhitespace } from '../src/core/markdownClean';
import { parseDataviewQuery, evaluateDataviewQuery, renderDataviewBlocks, resolveField } from '../src/core/dataviewEngine';
import { formatForNotebookLM } from '../src/core/notebooklmFormatter';
import { formatForHtml, simpleMarkdownToHtml, renderInline, noteHeadings } from '../src/core/htmlFormatter';
import { formatForMarkdown } from '../src/core/markdownFormatter';
import { parseCanvasContent } from '../src/core/canvasParser';
import { buildSplitFiles } from '../src/features/exportSplit';
import { cleanNote, createExportContext, parseVault } from '../src/core/pipeline';
import { DEFAULT_SETTINGS, ExporterSettings, VaultFile, mergeSettings } from '../src/core/types';

describe('filter', () => {
	const options = {
		scopeRoot: '',
		excludedFolders: ['WoT/00_Metatrois (Gestion)', '00_Metatrois (Gestion)', '.obsidian', 'sessions'],
		excludedFiles: ['INSTRUCTIONS.md', 'CLAUDE.md', 'World of Trois _ NotebookLM.txt'],
		excludedPrefixes: ['00_'],
	};

	it('should exclude 00_ prefix folders and specific excluded files', () => {
		expect(isFileIncluded('WoT/00_Metatrois (Gestion)/Scripts/script.md', options)).toBe(false);
		expect(isFileIncluded('00_Metatrois (Gestion)/Doc.md', options)).toBe(false);
		expect(isFileIncluded('INSTRUCTIONS.md', options)).toBe(false);
		expect(isFileIncluded('CLAUDE.md', options)).toBe(false);
		expect(isFileIncluded('sessions/2026-09-15.md', options)).toBe(false);
		expect(isFileIncluded('.obsidian/workspace.json', options)).toBe(false);
	});

	it('should include valid lore files under WoT/ and root', () => {
		expect(isFileIncluded('index.md', options)).toBe(true);
		expect(isFileIncluded('Accueil.md', options)).toBe(true);
		expect(isFileIncluded('Audit - Crosscheck Idées vs Canon.md', options)).toBe(true);
		expect(isFileIncluded('WoT/Guide des catégories.md', options)).toBe(true);
		expect(isFileIncluded('WoT/80_Histroisre/Événements/Événement A.md', options)).toBe(true);
		expect(isFileIncluded('WoT/01_Univers/Chronologie.md', options)).toBe(true);
	});

	it('never re-exports previous export outputs (feedback loop protection)', () => {
		const settings = { ...DEFAULT_SETTINGS };
		const reserved = reservedOutputPaths(settings);
		expect(reserved).toContain('Vault export.md');
		expect(reserved).toContain('Vault export - split');

		const opts = { ...options, reservedPaths: reserved };
		expect(isFileIncluded('Vault export.md', opts)).toBe(false);
		expect(isFileIncluded('Vault export.html', opts)).toBe(false);
		expect(isFileIncluded('Vault export.zip', opts)).toBe(false);
		expect(isFileIncluded('Vault export - split/Root.txt', opts)).toBe(false);
		// A note that merely shares the output name in another folder is untouched
		expect(isFileIncluded('Notes/vault export.md', opts)).toBe(true);
	});

	it('reserved paths also protect outputs stored in subfolders (case-sensitive)', () => {
		const opts = { ...options, reservedPaths: ['out/exports/Vault export.md'] };
		expect(isFileIncluded('out/exports/Vault export.md', opts)).toBe(false);
		// different folder casing: not the same configured output
		expect(isFileIncluded('OUT/exports/Vault export.md', opts)).toBe(true);
	});

	it('never re-ingests clean-export artifacts', () => {
		const opts = { ...options };
		expect(isFileIncluded('A/one (clean export).md', opts)).toBe(false);
		expect(isFileIncluded('Notes/My Note (CLEAN EXPORT).md', opts)).toBe(false);
		// unrelated files with a similar name are untouched
		expect(isFileIncluded('A/one.md', opts)).toBe(true);
	});

	it('onlyPath restricts inclusion to a single file (context commands)', () => {
		const opts = { ...options, onlyPath: 'WoT/01_Univers/Chronologie.md' };
		expect(isFileIncluded('WoT/01_Univers/Chronologie.md', opts)).toBe(true);
		expect(isFileIncluded('WoT/01_Univers/Monde.md', opts)).toBe(false);
		expect(isFileIncluded('index.md', opts)).toBe(false);
		// normalized comparison (backslashes, trailing slash)
		const opts2 = { ...options, onlyPath: 'WoT\\01_Univers\\Chronologie.md' };
		expect(isFileIncluded('WoT/01_Univers/Chronologie.md', opts2)).toBe(true);
	});
});

describe('wikilink', () => {
	it('extracts targets, headings, and aliases', () => {
		const text = 'See [[WoT/01_Univers/Lieux#Capitale|La Capitale]] and [[index]]';
		const links = extractWikilinks(text);
		expect(links.length).toBe(2);
		expect(links[0]?.target).toBe('WoT/01_Univers/Lieux');
		expect(links[0]?.heading).toBe('Capitale');
		expect(links[0]?.alias).toBe('La Capitale');
		expect(links[0]?.displayName).toBe('La Capitale');
		expect(links[1]?.displayName).toBe('index');
	});

	it('transforms wikilinks to clean text', () => {
		const text = 'See [[WoT/01_Univers/Lieux#Capitale|La Capitale]] and ![[image.png]]';
		const clean = transformWikilinks(text, 'clean-text');
		expect(clean).toBe('See La Capitale and ');
	});

	it('transforms wikilinks to canonical-alias format', () => {
		const text = 'See [[WoT/01_Univers/Lieux#Capitale|La Capitale]] and [[WoT/Index]]';
		const formatted = transformWikilinks(text, 'canonical-alias');
		expect(formatted).toBe('See Lieux (La Capitale) and Index');
	});

	it('resolves markdown links to real vault paths (full and bare targets)', () => {
		const files = [
			{ path: 'WoT/01_Univers/Lieux.md', name: 'Lieux.md' },
			{ path: 'index.md', name: 'index.md' },
		];
		const resolver = buildLinkResolver(files);
		const text = 'See [[WoT/01_Univers/Lieux#Capitale|La Capitale]] and [[index]]';
		const out = transformWikilinks(text, 'markdown', resolver);
		expect(out).toBe('See [La Capitale](WoT/01_Univers/Lieux.md#capitale) and [index](index.md)');
	});

	it('markdown format falls back to the raw target when unresolved', () => {
		const out = transformWikilinks('See [[Missing/Note]]', 'markdown', () => undefined);
		expect(out).toBe('See [Note](Missing/Note)');
	});
});

describe('canvasParser', () => {
	it('extracts text nodes and file links from canvas json', () => {
		const canvasJson = JSON.stringify({
			nodes: [
				{ id: '1', type: 'text', text: '# Canvas Title\nSome thoughts here.' },
				{ id: '2', type: 'file', file: 'WoT/01_Univers/Lieux.md' },
				{ id: '3', type: 'link', url: 'https://example.com' },
			],
			edges: [
				{ id: 'e1', fromNode: '1', toNode: '2', label: 'relates to' },
			],
		});

		const md = parseCanvasContent(canvasJson);
		expect(md).toContain('Some thoughts here.');
		expect(md).toContain('Linked note: WoT/01_Univers/Lieux');
		expect(md).toContain('Link: https://example.com');
	});

	it('orders nodes top-to-bottom, left-to-right', () => {
		const canvasJson = JSON.stringify({
			nodes: [
				{ id: 'a', type: 'text', text: 'bottom-left', position: { x: 0, y: 100 } },
				{ id: 'b', type: 'text', text: 'top-right', position: { x: 300, y: 0 } },
				{ id: 'c', type: 'text', text: 'top-left', position: { x: 0, y: 0 } },
			],
		});
		const md = parseCanvasContent(canvasJson);
		const order = ['top-left', 'top-right', 'bottom-left'].map((t) => md.indexOf(t));
		expect(order[0]!).toBeLessThan(order[1]!);
		expect(order[1]!).toBeLessThan(order[2]!);
	});

	it('renders group labels as section headers', () => {
		const canvasJson = JSON.stringify({
			nodes: [
				{ id: 'g1', type: 'group', label: 'Actes', position: { x: -50, y: -50 } },
				{ id: 'n1', type: 'text', text: 'content A', position: { x: 0, y: 0 }, group: 'g1' },
				{ id: 'n2', type: 'file', file: 'B.md', position: { x: 200, y: 0 }, group: 'g1' },
			],
		});
		const md = parseCanvasContent(canvasJson);
		expect(md).toContain('## Actes');
		expect(md.indexOf('## Actes')).toBeLessThan(md.indexOf('content A'));
	});

	it('does not duplicate a group header when ungrouped nodes are interleaved', () => {
		const canvasJson = JSON.stringify({
			nodes: [
				{ id: 'g', type: 'group', label: 'Main' },
				{ id: 'a', type: 'text', text: 'in group', position: { x: 0, y: 0 }, group: 'g' },
				{ id: 'b', type: 'text', text: 'floating', position: { x: 0, y: 50 } },
				{ id: 'c', type: 'text', text: 'back in group', position: { x: 0, y: 100 }, group: 'g' },
			],
		});
		const md = parseCanvasContent(canvasJson);
		expect(md.match(/## Main/g)).toHaveLength(1);
	});

	it('handles empty and invalid canvas files', () => {
		expect(parseCanvasContent('{"nodes": []}')).toBe('(Empty canvas)');
		expect(parseCanvasContent('not json')).toContain('(Canvas parse error:');
	});
});

describe('frontmatter', () => {
	it('parses yaml metadata', () => {
		const raw = '---\ntitle: "Mon Histoire"\ncategorie: Histoire\nordre: 01\ntags: [lore, wot]\n---\nContenu principal';
		const res = parseFrontmatter(raw);
		expect(res.metadata.title).toBe('Mon Histoire');
		expect(res.metadata.category).toBe('Histoire');
		expect(res.metadata.order).toBe('01');
		expect(res.metadata.tags).toEqual(['lore', 'wot']);
		expect(res.contentWithoutFrontmatter.trim()).toBe('Contenu principal');
	});
});

describe('markdownClean', () => {
	it('cleans comments and callouts', () => {
		const text = 'Hello %%secret%% world\n\n> [!NOTE] Remarque\n> Important\n\n\n\nEnd';
		const cleaned = sanitizeWhitespace(cleanCallouts(removeComments(text)));
		expect(cleaned).toContain('Hello  world');
		expect(cleaned).toContain('> **[NOTE: Remarque]**');
		expect(cleaned).not.toContain('secret');
	});
});

describe('dataviewEngine', () => {
	const sampleFiles: VaultFile[] = [
		{
			path: 'WoT/80_Histroisre/Événements/Ev1.md',
			name: 'Ev1.md',
			content: '---\ntitle: Event 1\nordre: 01\ntags: [lore]\n---\nDesc 1',
			mtime: 1000,
		},
		{
			path: 'WoT/80_Histroisre/Événements/Ev2.md',
			name: 'Ev2.md',
			content: '---\ntitle: Event 2\nordre: 02\nstatut: done\n---\nDesc 2',
			mtime: 2000,
		},
		{
			path: 'WoT/80_Histroisre/Monde.md',
			name: 'Monde.md',
			content: '---\ntitle: Monde\nordre: 99\n---\nDesc',
			mtime: 3000,
		},
	];
	const parsed = parseVault(sampleFiles);

	it('evaluates dataview TABLE queries', () => {
		const queryText = 'TABLE ordre\nFROM "WoT/80_Histroisre/Événements"\nSORT ordre ASC';
		const parseResult = parseDataviewQuery(queryText);
		expect(parseResult).not.toBeNull();
		const result = evaluateDataviewQuery(parseResult!, parsed);
		expect(result).toContain('| File | ordre |');
		expect(result).toContain('Ev1');
		expect(result).toContain('Ev2');
		expect(result).not.toContain('Monde');
	});

	it('supports WITHOUT ID and contains() in dataview queries', () => {
		const queryText = 'TABLE WITHOUT ID title, ordre\nFROM "WoT/80_Histroisre"\nWHERE contains(title, "Event")\nSORT ordre DESC';
		const parseResult = parseDataviewQuery(queryText);
		expect(parseResult).not.toBeNull();
		const result = evaluateDataviewQuery(parseResult!, parsed);
		expect(result).toContain('| title | ordre |');
		expect(result).not.toContain('| File |');
		expect(result).toContain('Event 2');
	});

	it('evaluates and/or boolean combinations', () => {
		const q1 = parseDataviewQuery('TABLE title\nFROM "WoT/80_Histroisre"\nWHERE title = "Event 1" and ordre = "01"')!;
		expect(evaluateDataviewQuery(q1, parsed)).toContain('Event 1');
		expect(evaluateDataviewQuery(q1, parsed)).not.toContain('Event 2');

		const q2 = parseDataviewQuery('TABLE title\nFROM "WoT/80_Histroisre"\nWHERE title = "Monde" or statut = "done"')!;
		const out2 = evaluateDataviewQuery(q2, parsed);
		expect(out2).toContain('Monde');
		expect(out2).toContain('Event 2');
		expect(out2).not.toContain('Event 1');

		// 'and' binds tighter than 'or'
		const q3 = parseDataviewQuery('TABLE title\nFROM "WoT/80_Histroisre"\nWHERE title = "Monde" or title = "Event 1" and ordre = "99"')!;
		const out3 = evaluateDataviewQuery(q3, parsed);
		expect(out3).toContain('Monde');
		expect(out3).not.toContain('Event 1');
	});

	it('evaluates comparisons, in() and like', () => {
		const q1 = parseDataviewQuery('TABLE title\nWHERE ordre >= "2"')!;
		const out1 = evaluateDataviewQuery(q1, parsed);
		expect(out1).toContain('Event 2');
		expect(out1).toContain('Monde');
		expect(out1).not.toContain('Event 1');

		const q2 = parseDataviewQuery("TABLE title\nWHERE statut in (\"done\", \"draft\")")!;
		expect(evaluateDataviewQuery(q2, parsed)).toContain('Event 2');

		const q3 = parseDataviewQuery('TABLE title\nWHERE title like "Event ?"')!;
		const out3 = evaluateDataviewQuery(q3, parsed);
		expect(out3).toContain('Event 1');
		expect(out3).toContain('Event 2');

		const q4 = parseDataviewQuery('TABLE title\nWHERE title startswith "Ev" and title endswith "2"')!;
		const out4 = evaluateDataviewQuery(q4, parsed);
		expect(out4).toContain('Event 2');
		expect(out4).not.toContain('Event 1');
	});

	it('resolves file.* fields and tag arrays', () => {
		const q1 = parseDataviewQuery('TABLE file.folder\nWHERE file.folder = "WoT/80_Histroisre/Événements"')!;
		const out1 = evaluateDataviewQuery(q1, parsed);
		expect(out1).toContain('Ev1');
		expect(out1).not.toContain('Monde');

		const q2 = parseDataviewQuery('TABLE title\nWHERE tags = "lore"')!;
		expect(evaluateDataviewQuery(q2, parsed)).toContain('Event 1');
		expect(evaluateDataviewQuery(q2, parsed)).not.toContain('Event 2');

		const q3 = parseDataviewQuery('TABLE file.name\nWHERE file.mtime > 1500')!;
		const out3 = evaluateDataviewQuery(q3, parsed);
		expect(out3).toContain('Ev2');
		expect(out3).toContain('Monde');
		expect(out3).not.toContain('Ev1');
	});

	it('resolveField exposes known and custom fields', () => {
		const item = parsed.find((p) => p.name === 'Ev2')!;
		expect(resolveField('title', item)).toBe('Event 2');
		expect(resolveField('statut', item)).toBe('done');
		expect(resolveField('tags', parsed.find((p) => p.name === 'Ev1')!)).toEqual(['lore']);
		expect(resolveField('file.day', item)).toBe(new Date(2000).toISOString().slice(0, 10));
	});

	it('supports quoted tags in FROM ("#tag" and #tag)', () => {
		const q1 = parseDataviewQuery('TABLE title\nFROM "#lore"')!;
		expect(q1.fromTag).toBe('lore');
		const q2 = parseDataviewQuery('TABLE title\nFROM #lore/sub')!;
		expect(q2.fromTag).toBe('lore/sub');
		const q3 = parseDataviewQuery('TABLE title\nFROM "WoT/80_Histroisre"')!;
		expect(q3.fromPath).toBe('WoT/80_Histroisre');

		const out = evaluateDataviewQuery(q1, parsed);
		expect(out).toContain('Event 1');
		expect(out).not.toContain('Monde');
		// plain tag (Ev1 carries 'lore')
		const q4 = parseDataviewQuery('TABLE title\nFROM #lore')!;
		expect(evaluateDataviewQuery(q4, parsed)).toContain('Event 1');
		expect(evaluateDataviewQuery(q4, parsed)).not.toContain('Event 2');

		// hierarchical: #lore also matches tag lore/sub
		const nested = [{
			path: 'X.md', name: 'X', folder: '',
			metadata: { title: 'X', category: '', order: '', tags: ['lore/sub'], custom: {} },
			mtime: 0,
		}];
		expect(evaluateDataviewQuery(q4, nested)).toContain('X');
	});

	it('renders dataview blocks inside markdown', () => {
		const md = '# Sommaire\n```dataview\nTABLE ordre\nFROM "WoT/80_Histroisre/Événements"\nSORT ordre ASC\n```\nFin';
		const rendered = renderDataviewBlocks(md, parsed);
		expect(rendered).toContain('| File | ordre |');
		expect(rendered).not.toContain('```dataview');
	});

	it('reports no results in English', () => {
		const q = parseDataviewQuery('TABLE title\nWHERE title = "Nope"')!;
		expect(evaluateDataviewQuery(q, parsed)).toBe('*No results found.*\n');
	});
});

describe('formatters and split export', () => {
	const sampleFiles: VaultFile[] = [
		{
			path: 'WoT/80_Histroisre/Ev1.md',
			name: 'Ev1.md',
			content: '---\ntitle: Event 1\ncanvas: hide\nstatus: draft\n---\n# Event 1\n## Details\nDescription with [[WoT/01_Univers/Monde|Monde]] and **bold** text.',
		},
		{
			path: 'WoT/01_Univers/Monde.md',
			name: 'Monde.md',
			content: '---\ntitle: Monde\n---\n# Monde\nContenu du Monde',
		},
	];
	const notesFor = (settings: ExporterSettings) => {
		const ctx = createExportContext(sampleFiles, settings);
		return sampleFiles.map((f) => cleanNote(f, ctx));
	};
	const NOW = '2026-01-01T00:00:00.000Z';

	it('formats for NotebookLM, hiding ignored properties', () => {
		const settings = { ...DEFAULT_SETTINGS, stripFrontmatter: false, ignoredProperties: ['canvas'] };
		const output = formatForNotebookLM(notesFor(settings), settings, NOW);
		expect(output).toContain('VAULT EXPORT (NOTEBOOKLM EXPORT)');
		expect(output).toContain('DOCUMENT [1/2] : WoT/80_Histroisre/Ev1.md');
		expect(output).toContain('status : draft');
		expect(output).not.toContain('hide');
	});

	it('HTML honors the wikilink format setting', () => {
		const settings = { ...DEFAULT_SETTINGS, wikilinkFormat: 'keep-wikilink' as const };
		const html = formatForHtml(notesFor(settings), settings, NOW);
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('2 documents');
		expect(html).toContain('[[WoT/01_Univers/Monde|Monde]]');
	});

	it('renderInline escapes HTML and protects code spans', () => {
		expect(renderInline('<b>not bold</b>')).toBe('&lt;b&gt;not bold&lt;/b&gt;');
		expect(renderInline('a `x **y**` b')).toContain('<code>x **y**</code>');
		expect(renderInline('**a** and *b*')).toBe('<strong>a</strong> and <em>b</em>');
	});

	it('HTML renders inline markdown', () => {
		const html = simpleMarkdownToHtml('A **bold** word, an _italic_ one, `code()`, ~~gone~~ and [a link](https://x.test) plus https://auto.test/end.');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
		expect(html).toContain('<code>code()</code>');
		expect(html).toContain('<del>gone</del>');
		expect(html).toContain('<a href="https://x.test">a link</a>');
		expect(html).toContain('<a href="https://auto.test/end">https://auto.test/end</a>');
		expect(html).not.toContain('**');
	});

	it('HTML does not treat inline code as a code fence and escapes markup', () => {
		const html = simpleMarkdownToHtml('`inline` text\nnext line');
		expect(html).not.toContain('<pre>');
		const evil = simpleMarkdownToHtml('<script>alert(1)</script>');
		expect(evil).not.toContain('<script>');
		expect(evil).toContain('&lt;script&gt;');
	});

	it('HTML merges multiline blockquotes and styles callouts', () => {
		const html = simpleMarkdownToHtml('> **[NOTE: Remarque]**\n> line one\n> line two');
		const count = (html.match(/<blockquote/g) ?? []).length;
		expect(count).toBe(1);
		expect(html).toContain('callout-note');
		expect(html).toContain('line one');
		expect(html).toContain('line two');
	});

	it('HTML renders task lists and ordered lists', () => {
		const html = simpleMarkdownToHtml('- [x] done task\n- [ ] todo task\n1. first\n2. second');
		expect(html).toContain('<ol>');
		expect(html).toContain('checked');
		expect(html).toContain('<input type="checkbox" disabled> ');
	});

	it('HTML has a two-level TOC with unique heading anchors', () => {
		const html = formatForHtml(notesFor(DEFAULT_SETTINGS), DEFAULT_SETTINGS, NOW);
		expect(html).toContain('href="#doc-0"');
		expect(html).toContain('href="#doc-0-details"');
		// both notes contain a level-1 heading with the same slug-free check: ids must be prefixed
		expect(html).toContain('id="doc-0-event-1"');
		expect(html).toContain('id="doc-1-monde"');
	});

	it('HTML ships a client-side document filter', () => {
		const html = formatForHtml(notesFor(DEFAULT_SETTINGS), DEFAULT_SETTINGS, NOW);
		expect(html).toContain('<input id="ve-search"');
		expect(html).toContain('data-doc-id="doc-0"');
		expect(html).toContain('window.veFilter = apply;');
		// every toc item is associated with its document
		expect((html.match(/data-doc-id="doc-\d+"/g) ?? []).length).toBe(2);
	});

	it('HTML supports dark/light theming and export date', () => {
		const html = formatForHtml(notesFor(DEFAULT_SETTINGS), DEFAULT_SETTINGS, NOW);
		expect(html).toContain('prefers-color-scheme: light');
		expect(html).toContain('Exported ' + NOW);
		const withCss = formatForHtml(notesFor({ ...DEFAULT_SETTINGS, customCss: ':root { --ve-accent: #c0392b; }' }), { ...DEFAULT_SETTINGS, customCss: ':root { --ve-accent: #c0392b; }' }, NOW);
		expect(withCss).toContain('--ve-accent: #c0392b');
	});

	it('noteHeadings ignores code fences', () => {
		expect(noteHeadings('# A\n```\n# not a heading\n```\n## B')).toEqual(['A', 'B']);
	});

	it('formats for consolidated Markdown', () => {
		const md = formatForMarkdown(notesFor(DEFAULT_SETTINGS), DEFAULT_SETTINGS, NOW);
		expect(md).toContain('# Vault export');
		expect(md).toContain('1. [Event 1](#event-1-0)');
		expect(md).toContain('## 2. Monde <a id="monde-1"></a>');
		expect(md).toContain('Description with Monde');
	});

	it('groups split files by first folder under the scope root', () => {
		const settings = { ...DEFAULT_SETTINGS, scopeRoot: 'WoT', splitOutputFolder: 'out' };
		const outputs = buildSplitFiles(notesFor(settings), settings);
		expect(outputs.map((o) => o.path).sort()).toEqual(['out/01_Univers.txt', 'out/80_Histroisre.txt']);
		expect(outputs.find((o) => o.path === 'out/80_Histroisre.txt')?.content).toContain('Event 1');
	});

	it('groups split files by subfolders of the split group folder', () => {
		const settings = { ...DEFAULT_SETTINGS, splitGroupFolder: 'WoT', splitOutputFolder: 'out' };
		const extra = [...sampleFiles, { path: 'index.md', name: 'index.md', content: 'home' }];
		const ctx = createExportContext(extra, settings);
		const notes = extra.map((f) => cleanNote(f, ctx));
		expect(buildSplitFiles(notes, settings).map((o) => o.path).sort()).toEqual(['out/01_Univers.txt', 'out/80_Histroisre.txt', 'out/Root.txt']);
	});

	it('individual split files keep frontmatter when not stripped', () => {
		const settings = { ...DEFAULT_SETTINGS, splitMode: 'individual-files' as const, stripFrontmatter: false, splitOutputFolder: 'out' };
		const outputs = buildSplitFiles(notesFor(settings), settings);
		expect(outputs[0]?.path).toBe('out/WoT/80_Histroisre/Ev1.md');
		expect(outputs[0]?.content.startsWith('---\ntitle: Event 1')).toBe(true);
	});
});

describe('pipeline', () => {
	it('parses frontmatter exactly once per run (shared ParsedFile list)', () => {
		const files: VaultFile[] = [
			{ path: 'A.md', name: 'A.md', content: '---\ntitle: A\n---\nbody' },
			{ path: 'B/note.md', name: 'note.md', content: 'no frontmatter' },
		];
		const parsed = parseVault(files);
		expect(parsed).toHaveLength(2);
		expect(parsed[0]?.metadata.title).toBe('A');
		expect(parsed[0]?.folder).toBe('');
		expect(parsed[1]?.folder).toBe('B');
		expect(parsed[1]?.name).toBe('note');
	});

	it('cleanNote resolves markdown wikilinks to vault paths', () => {
		const files: VaultFile[] = [
			{ path: 'index.md', name: 'index.md', content: 'See [[Cible]]' },
			{ path: 'Cible.md', name: 'Cible.md', content: 'target' },
		];
		const ctx = createExportContext(files, { ...DEFAULT_SETTINGS, wikilinkFormat: 'markdown' });
		const note = cleanNote(files[0]!, ctx);
		expect(note.body).toBe('See [Cible](Cible.md)');
	});
});

describe('settings', () => {
	it('drops obsolete saved keys and keeps known ones', () => {
		const merged = mergeSettings({ pdfOutputPath: 'x.pdf', executionEngine: 'external-python', scopeRoot: 'WoT' });
		expect(merged.scopeRoot).toBe('WoT');
		expect('pdfOutputPath' in merged).toBe(false);
		expect('executionEngine' in merged).toBe(false);
	});

	it('has the new v2 keys with neutral defaults', () => {
		expect(DEFAULT_SETTINGS.zipOutputPath).toBe('Vault export.zip');
		expect(DEFAULT_SETTINGS.scopeTag).toBe('');
		expect(DEFAULT_SETTINGS.yieldEvery).toBeGreaterThan(0);
	});
});

describe('architecture', () => {
	function tsFiles(dir: string): string[] {
		return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory() ? tsFiles(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
	}
	const importsOf = (file: string) =>
		[...fs.readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

	it('core and features never import obsidian', () => {
		for (const file of [...tsFiles('src/core'), ...tsFiles('src/features')]) {
			expect(importsOf(file), file).not.toContain('obsidian');
		}
	});

	it('core never imports features, ui, commands or the gateway', () => {
		for (const file of tsFiles('src/core')) {
			for (const imp of importsOf(file)) {
				expect(imp, file).not.toMatch(/features|ui|commands|obsidian\//);
			}
		}
	});
});
