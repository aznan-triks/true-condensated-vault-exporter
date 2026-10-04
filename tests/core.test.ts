import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { isFileIncluded, isTagScopeMatch, matchesTag, reservedOutputPaths } from '../src/core/filter';
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
		excludedFolders: ['Knowledge Base/00_Admin (Management)', '00_Admin (Management)', '.obsidian', 'sessions'],
		excludedFiles: ['INSTRUCTIONS.md', 'CLAUDE.md', 'Vault export - NotebookLM.txt'],
		excludedPrefixes: ['00_'],
	};

	it('should exclude 00_ prefix folders and specific excluded files', () => {
		expect(isFileIncluded('Knowledge Base/00_Admin (Management)/Scripts/script.md', options)).toBe(false);
		expect(isFileIncluded('00_Admin (Management)/Doc.md', options)).toBe(false);
		expect(isFileIncluded('INSTRUCTIONS.md', options)).toBe(false);
		expect(isFileIncluded('CLAUDE.md', options)).toBe(false);
		expect(isFileIncluded('sessions/2026-09-15.md', options)).toBe(false);
		expect(isFileIncluded('.obsidian/workspace.json', options)).toBe(false);
	});

	it('includes valid vault notes under Knowledge Base and root', () => {
		expect(isFileIncluded('index.md', options)).toBe(true);
		expect(isFileIncluded('Home.md', options)).toBe(true);
		expect(isFileIncluded('Audit - Canon Cross-check.md', options)).toBe(true);
		expect(isFileIncluded('Knowledge Base/Guide to categories.md', options)).toBe(true);
		expect(isFileIncluded('Knowledge Base/80_History/Events/Event A.md', options)).toBe(true);
		expect(isFileIncluded('Knowledge Base/01_World/Timeline.md', options)).toBe(true);
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
		// Different folder casing is a different vault-relative path.
		expect(isFileIncluded('OUT/exports/Vault export.md', opts)).toBe(true);
	});

	it('does not treat absolute disk outputs as vault-relative exclusions', () => {
		const reserved = reservedOutputPaths({
			notebooklmOutputPath: '/tmp/export.txt',
			htmlOutputPath: 'C:\\Exports\\export.html',
			markdownOutputPath: './Vault export.md',
			zipOutputPath: '',
			splitOutputFolder: '',
		});
		expect(reserved).toEqual(['./Vault export.md']);
		expect(isFileIncluded('Vault export.md', { ...options, reservedPaths: reserved })).toBe(false);
	});

	it('never re-ingests clean-export artifacts', () => {
		const opts = { ...options };
		expect(isFileIncluded('A/one (clean export).md', opts)).toBe(false);
		expect(isFileIncluded('Notes/My Note (CLEAN EXPORT).md', opts)).toBe(false);
		// unrelated files with a similar name are untouched
		expect(isFileIncluded('A/one.md', opts)).toBe(true);
	});

	it('onlyPath restricts inclusion to a single file (context commands)', () => {
		const opts = { ...options, onlyPath: 'Knowledge Base/01_World/Timeline.md' };
		expect(isFileIncluded('Knowledge Base/01_World/Timeline.md', opts)).toBe(true);
		expect(isFileIncluded('Knowledge Base/01_World/World.md', opts)).toBe(false);
		expect(isFileIncluded('index.md', opts)).toBe(false);
		// normalized comparison (backslashes, trailing slash)
		const opts2 = { ...options, onlyPath: 'Knowledge Base\\01_World\\Timeline.md' };
		expect(isFileIncluded('Knowledge Base/01_World/Timeline.md', opts2)).toBe(true);
	});

	it('matches normalized tags and their nested subtags without prefix collisions', () => {
		expect(matchesTag(['#Research', 'projects/notes'], '#research')).toBe(true);
		expect(matchesTag(['projects/notes'], 'projects')).toBe(true);
		expect(matchesTag(['project'], 'projects')).toBe(false);
		expect(matchesTag(['#research'], '#')).toBe(false);
		expect(isTagScopeMatch('Notes/Research.md', ['#research'], '#research')).toBe(true);
		expect(isTagScopeMatch('Notes/Research.canvas', ['#research'], 'research')).toBe(false);
		expect(isTagScopeMatch('Notes/Canvas.canvas', [], '')).toBe(true);
	});
});

describe('wikilink', () => {
	it('extracts targets, headings, and aliases', () => {
		const text = 'See [[Knowledge Base/01_World/Places#Capital|The Capital]] and [[index]]';
		const links = extractWikilinks(text);
		expect(links.length).toBe(2);
		expect(links[0]?.target).toBe('Knowledge Base/01_World/Places');
		expect(links[0]?.heading).toBe('Capital');
		expect(links[0]?.alias).toBe('The Capital');
		expect(links[0]?.displayName).toBe('The Capital');
		expect(links[1]?.displayName).toBe('index');
	});

	it('transforms wikilinks to clean text', () => {
		const text = 'See [[Knowledge Base/01_World/Places#Capital|The Capital]] and ![[image.png]]';
		const clean = transformWikilinks(text, 'clean-text');
		expect(clean).toBe('See The Capital and ');
	});

	it('transforms wikilinks to canonical-alias format', () => {
		const text = 'See [[Knowledge Base/01_World/Places#Capital|The Capital]] and [[Knowledge Base/Index]]';
		const formatted = transformWikilinks(text, 'canonical-alias');
		expect(formatted).toBe('See Places (The Capital) and Index');
	});

	it('resolves markdown links to real vault paths (full and bare targets)', () => {
		const files = [
			{ path: 'Knowledge Base/01_World/Places.md', name: 'Places.md' },
			{ path: 'index.md', name: 'index.md' },
		];
		const resolver = buildLinkResolver(files);
		const text = 'See [[Knowledge Base/01_World/Places#Capital|The Capital]] and [[index]]';
		const out = transformWikilinks(text, 'markdown', resolver);
		expect(out).toBe('See [The Capital](Knowledge%20Base/01_World/Places.md#capital) and [index](index.md)');
	});

	it('markdown format falls back to the raw target when unresolved', () => {
		const out = transformWikilinks('See [[Missing/Note]]', 'markdown', () => undefined);
		expect(out).toBe('See [Note](Missing/Note)');
	});

	it('resolves explicit extensions and URL-encodes vault paths with spaces', () => {
		const resolver = buildLinkResolver([{ path: 'Project Notes/Target Note.md', name: 'Target Note.md' }]);
		expect(resolver('Project Notes/Target Note.md')).toBe('Project Notes/Target Note.md');
		expect(transformWikilinks('[[Target Note.md|Read this]]', 'markdown', resolver))
			.toBe('[Read this](Project%20Notes/Target%20Note.md)');
	});
});

describe('canvasParser', () => {
	it('extracts text nodes and file links from canvas json', () => {
		const canvasJson = JSON.stringify({
			nodes: [
				{ id: '1', type: 'text', text: '# Canvas Title\nSome thoughts here.' },
				{ id: '2', type: 'file', file: 'Knowledge Base/01_World/Places.md' },
				{ id: '3', type: 'link', url: 'https://example.com' },
			],
			edges: [
				{ id: 'e1', fromNode: '1', toNode: '2', label: 'relates to' },
			],
		});

		const md = parseCanvasContent(canvasJson);
		expect(md).toContain('Some thoughts here.');
		expect(md).toContain('Linked note: Knowledge Base/01_World/Places');
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
		expect(parseCanvasContent('not json')).toBe('(Invalid canvas JSON)');
		expect(parseCanvasContent('null')).toContain('(Invalid canvas:');
		expect(parseCanvasContent('{"nodes": {}}')).toContain('(Invalid canvas:');
	});
});

describe('frontmatter', () => {
	it('parses YAML metadata, including legacy French field names', () => {
		const raw = '---\ntitle: "A Story"\ncategorie: History\nordre: 01\ntags: [lore, wot]\n---\nMain content';
		const res = parseFrontmatter(raw);
		expect(res.metadata.title).toBe('A Story');
		expect(res.metadata.category).toBe('History');
		expect(res.metadata.order).toBe('01');
		expect(res.metadata.tags).toEqual(['lore', 'wot']);
		expect(res.contentWithoutFrontmatter.trim()).toBe('Main content');
	});

	it('strips an empty frontmatter block, handles a BOM, and parses common list values', () => {
		const parsed = parseFrontmatter('\uFEFF---\ntitle: "A # Title" # comment\ntags: [alpha, "beta, gamma"]\nstatus: active\n---\nBody');
		expect(parsed.metadata.title).toBe('A # Title');
		expect(parsed.metadata.tags).toEqual(['alpha', 'beta, gamma']);
		expect(parsed.metadata.status).toBe('active');
		expect(parsed.contentWithoutFrontmatter).toBe('Body');
		expect(parseFrontmatter('---\n---\nBody').contentWithoutFrontmatter).toBe('Body');
		expect(parseFrontmatter("---\ntitle: Alex's note # inline comment\n---\nBody").metadata.title).toBe("Alex's note");
	});
});

describe('markdownClean', () => {
	it('cleans comments and callouts', () => {
		const text = 'Hello %%secret%% world\n\n> [!NOTE] Note\n> Important\n\n\n\nEnd';
		const cleaned = sanitizeWhitespace(cleanCallouts(removeComments(text)));
		expect(cleaned).toContain('Hello  world');
		expect(cleaned).toContain('> **[NOTE: Note]**');
		expect(cleaned).not.toContain('secret');
	});
});

describe('dataviewEngine', () => {
	const sampleFiles: VaultFile[] = [
		{
			path: 'Knowledge Base/80_History/Events/Event1.md',
			name: 'Event1.md',
			content: '---\ntitle: Event 1\nordre: 01\ntags: [lore]\n---\nDesc 1',
			mtime: 1000,
		},
		{
			path: 'Knowledge Base/80_History/Events/Event2.md',
			name: 'Event2.md',
			content: '---\ntitle: Event 2\nordre: 02\nstatut: done\n---\nDesc 2',
			mtime: 2000,
		},
		{
			path: 'Knowledge Base/80_History/World.md',
			name: 'World.md',
			content: '---\ntitle: World\nordre: 99\n---\nDesc',
			mtime: 3000,
		},
	];
	const parsed = parseVault(sampleFiles);

	it('evaluates dataview TABLE queries', () => {
		const queryText = 'TABLE ordre\nFROM "Knowledge Base/80_History/Events"\nSORT ordre ASC';
		const parseResult = parseDataviewQuery(queryText);
		expect(parseResult).not.toBeNull();
		const result = evaluateDataviewQuery(parseResult!, parsed);
		expect(result).toContain('| File | ordre |');
		expect(result).toContain('Event1');
		expect(result).toContain('Event2');
		expect(result).not.toContain('World');
	});

	it('supports WITHOUT ID and contains() in dataview queries', () => {
		const queryText = 'TABLE WITHOUT ID title, ordre\nFROM "Knowledge Base/80_History"\nWHERE contains(title, "Event")\nSORT ordre DESC';
		const parseResult = parseDataviewQuery(queryText);
		expect(parseResult).not.toBeNull();
		const result = evaluateDataviewQuery(parseResult!, parsed);
		expect(result).toContain('| title | ordre |');
		expect(result).not.toContain('| File |');
		expect(result).toContain('Event 2');
	});

	it('evaluates and/or boolean combinations', () => {
		const q1 = parseDataviewQuery('TABLE title\nFROM "Knowledge Base/80_History"\nWHERE title = "Event 1" and ordre = "01"')!;
		expect(evaluateDataviewQuery(q1, parsed)).toContain('Event 1');
		expect(evaluateDataviewQuery(q1, parsed)).not.toContain('Event 2');

		const q2 = parseDataviewQuery('TABLE title\nFROM "Knowledge Base/80_History"\nWHERE title = "World" or statut = "done"')!;
		const out2 = evaluateDataviewQuery(q2, parsed);
		expect(out2).toContain('World');
		expect(out2).toContain('Event 2');
		expect(out2).not.toContain('Event 1');

		// 'and' binds tighter than 'or'
		const q3 = parseDataviewQuery('TABLE title\nFROM "Knowledge Base/80_History"\nWHERE title = "World" or title = "Event 1" and ordre = "99"')!;
		const out3 = evaluateDataviewQuery(q3, parsed);
		expect(out3).toContain('World');
		expect(out3).not.toContain('Event 1');
	});

	it('evaluates comparisons, in() and like', () => {
		const q1 = parseDataviewQuery('TABLE title\nWHERE ordre >= "2"')!;
		const out1 = evaluateDataviewQuery(q1, parsed);
		expect(out1).toContain('Event 2');
		expect(out1).toContain('World');
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
		const q1 = parseDataviewQuery('TABLE file.folder\nWHERE file.folder = "Knowledge Base/80_History/Events"')!;
		const out1 = evaluateDataviewQuery(q1, parsed);
		expect(out1).toContain('Event1');
		expect(out1).not.toContain('World');

		const q2 = parseDataviewQuery('TABLE title\nWHERE tags = "lore"')!;
		expect(evaluateDataviewQuery(q2, parsed)).toContain('Event 1');
		expect(evaluateDataviewQuery(q2, parsed)).not.toContain('Event 2');

		const q3 = parseDataviewQuery('TABLE file.name\nWHERE file.mtime > 1500')!;
		const out3 = evaluateDataviewQuery(q3, parsed);
		expect(out3).toContain('Event2');
		expect(out3).toContain('World');
		expect(out3).not.toContain('Event1');
	});

	it('resolveField exposes known and custom fields', () => {
		const item = parsed.find((p) => p.name === 'Event2')!;
		expect(resolveField('title', item)).toBe('Event 2');
		expect(resolveField('status', item)).toBe('done');
		expect(resolveField('statut', item)).toBe('done');
		expect(resolveField('tags', parsed.find((p) => p.name === 'Event1')!)).toEqual(['lore']);
		expect(resolveField('file.day', item)).toBeUndefined();
		expect(resolveField('file.day', { ...item, name: '2026-10-04' })).toBe('2026-10-04');
		expect(resolveField('file.ctime', { ...item, ctime: 1234 })).toBe(1234);
	});

	it('supports quoted tags in FROM ("#tag" and #tag)', () => {
		const q1 = parseDataviewQuery('TABLE title\nFROM "#lore"')!;
		expect(q1.fromTag).toBe('lore');
		const q2 = parseDataviewQuery('TABLE title\nFROM #lore/sub')!;
		expect(q2.fromTag).toBe('lore/sub');
		const q3 = parseDataviewQuery('TABLE title\nFROM "Knowledge Base/80_History"')!;
		expect(q3.fromPath).toBe('Knowledge Base/80_History');

		const out = evaluateDataviewQuery(q1, parsed);
		expect(out).toContain('Event 1');
		expect(out).not.toContain('World');
		// plain tag (Event1 carries 'lore')
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
		const md = '# Contents\n```dataview\nTABLE ordre\nFROM "Knowledge Base/80_History/Events"\nSORT ordre ASC\n```\nEnd';
		const rendered = renderDataviewBlocks(md, parsed);
		expect(rendered).toContain('| File | ordre |');
		expect(rendered).not.toContain('```dataview');
	});

	it('reports no results in English', () => {
		const q = parseDataviewQuery('TABLE title\nWHERE title = "Nope"')!;
		expect(evaluateDataviewQuery(q, parsed)).toBe('*No results found.*\n');
	});

	it('leaves unsupported or malformed Dataview queries visible instead of broadening results', () => {
		const unsupported = '```dataview\nTABLE title\nLIMIT 5\n```';
		expect(renderDataviewBlocks(unsupported, parsed)).toBe(unsupported);
		const malformed = '```dataview\nTABLE title\nWHERE length(title) > 1\n```';
		expect(renderDataviewBlocks(malformed, parsed)).toBe(malformed);
		const unclosedGroup = '```dataview\nTABLE title\nWHERE (title = "Event 1" or title = "Event 2"\n```';
		expect(renderDataviewBlocks(unclosedGroup, parsed)).toBe(unclosedGroup);
		const invalidSort = '```dataview\nTABLE title\nSORT title DESC, status\n```';
		expect(renderDataviewBlocks(invalidSort, parsed)).toBe(invalidSort);
	});
});

describe('formatters and split export', () => {
	const sampleFiles: VaultFile[] = [
		{
			path: 'Knowledge Base/80_History/Event1.md',
			name: 'Event1.md',
			content: '---\ntitle: Event 1\ncanvas: hide\nstatus: draft\n---\n# Event 1\n## Details\nDescription with [[Knowledge Base/01_World/World|World]] and **bold** text.',
		},
		{
			path: 'Knowledge Base/01_World/World.md',
			name: 'World.md',
			content: '---\ntitle: World\n---\n# World\nWorld content',
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
		expect(output).toContain('DOCUMENT [1/2]: Knowledge Base/80_History/Event1.md');
		expect(output).toContain('Status: draft');
		expect(output).not.toContain('hide');
	});

	it('HTML honors the wikilink format setting', () => {
		const settings = { ...DEFAULT_SETTINGS, wikilinkFormat: 'keep-wikilink' as const };
		const html = formatForHtml(notesFor(settings), settings, NOW);
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('2 documents');
		expect(html).toContain('[[Knowledge Base/01_World/World|World]]');
	});

	it('renderInline escapes HTML and protects code spans', () => {
		expect(renderInline('<b>not bold</b>')).toBe('&lt;b&gt;not bold&lt;/b&gt;');
		expect(renderInline('a `x **y**` b')).toContain('<code>x **y**</code>');
		expect(renderInline('**a** and *b*')).toBe('<strong>a</strong> and <em>b</em>');
	});

	it('HTML strips unsafe URL schemes from links and images', () => {
		const html = renderInline('[run](javascript:alert(1)) ![bad](data:text/html,evil) [safe](https://example.com)');
		expect(html).not.toContain('href="javascript:');
		expect(html).not.toContain('src="data:text/html');
		expect(html).toContain('run');
		expect(html).toContain('bad');
		expect(html).toContain('href="https://example.com"');
	});

	it('HTML renders inline markdown', () => {
		const html = simpleMarkdownToHtml('A **bold** word, an _italic_ one, `code()`, ~~gone~~ and [a link](https://x.test) plus https://auto.test/end.');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
		expect(html).toContain('<code>code()</code>');
		expect(html).toContain('<del>gone</del>');
		expect(html).toContain('<a href="https://x.test" rel="noopener noreferrer">a link</a>');
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
		const html = simpleMarkdownToHtml('> **[NOTE: Summary]**\n> line one\n> line two');
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
		expect(html).toContain('id="doc-1-world"');
	});

	it('HTML disambiguates repeated and non-Latin heading anchors', () => {
		const files: VaultFile[] = [{ path: 'Repeat.md', name: 'Repeat.md', content: '# Repeat\n# Repeat\n# 文档\n# 文档' }];
		const ctx = createExportContext(files, DEFAULT_SETTINGS);
		const html = formatForHtml(files.map((file) => cleanNote(file, ctx)), DEFAULT_SETTINGS, NOW);
		const ids = [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((match) => match[1]);
		expect(ids).toEqual(['doc-0-repeat', 'doc-0-repeat-2', 'doc-0-section', 'doc-0-section-2']);
		for (const id of ids) expect(html).toContain('href="#' + id + '"');
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
		const injectedCss = formatForHtml(notesFor({ ...DEFAULT_SETTINGS, customCss: '</style><script>alert(1)</script>' }), { ...DEFAULT_SETTINGS, customCss: '</style><script>alert(1)</script>' }, NOW);
		expect(injectedCss).not.toContain('</style><script>');
	});

	it('noteHeadings ignores code fences', () => {
		expect(noteHeadings('# A\n```\n# not a heading\n```\n## B')).toEqual(['A', 'B']);
	});

	it('formats for consolidated Markdown', () => {
		const md = formatForMarkdown(notesFor(DEFAULT_SETTINGS), DEFAULT_SETTINGS, NOW);
		expect(md).toContain('# Vault export');
		expect(md).toContain('1. [Event 1](#event-1-0)');
		expect(md).toContain('## 2. World <a id="world-1"></a>');
		expect(md).toContain('Description with World');
	});

	it('groups split files by first folder under the scope root', () => {
		const settings = { ...DEFAULT_SETTINGS, scopeRoot: 'Knowledge Base', splitOutputFolder: 'out' };
		const outputs = buildSplitFiles(notesFor(settings), settings);
		expect(outputs.map((o) => o.path).sort()).toEqual(['out/01_World.txt', 'out/80_History.txt']);
		expect(outputs.find((o) => o.path === 'out/80_History.txt')?.content).toContain('Event 1');
	});

	it('groups split files by subfolders of the split group folder', () => {
		const settings = { ...DEFAULT_SETTINGS, splitGroupFolder: 'Knowledge Base', splitOutputFolder: 'out' };
		const extra = [...sampleFiles, { path: 'index.md', name: 'index.md', content: 'home' }];
		const ctx = createExportContext(extra, settings);
		const notes = extra.map((f) => cleanNote(f, ctx));
		expect(buildSplitFiles(notes, settings).map((o) => o.path).sort()).toEqual(['out/01_World.txt', 'out/80_History.txt', 'out/Root.txt']);
	});

	it('uses the vault root when the split destination is blank and honors a nested group folder', () => {
		const extra: VaultFile[] = [
			{ path: 'Area/Subgroup/one.md', name: 'one.md', content: 'one' },
			{ path: 'Area/Subgroup/GroupA/two.md', name: 'two.md', content: 'two' },
		];
		const settings = { ...DEFAULT_SETTINGS, scopeRoot: 'Area', splitGroupFolder: 'Area/Subgroup', splitOutputFolder: '' };
		const ctx = createExportContext(extra, settings);
		const notes = extra.map((file) => cleanNote(file, ctx));
		const outputs = buildSplitFiles(notes, settings);
		expect(outputs.map((output) => output.path).sort()).toEqual(['GroupA.txt', 'Root.txt']);
	});

	it('individual split files keep frontmatter when not stripped', () => {
		const settings = { ...DEFAULT_SETTINGS, splitMode: 'individual-files' as const, stripFrontmatter: false, splitOutputFolder: 'out' };
		const outputs = buildSplitFiles(notesFor(settings), settings);
		expect(outputs[0]?.path).toBe('out/Knowledge Base/80_History/Event1.md');
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
		expect(parsed[0]?.body).toBe('body');
		expect(parsed[0]?.rawFrontmatter).toBe('title: A');
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
		const merged = mergeSettings({ pdfOutputPath: 'x.pdf', executionEngine: 'external-python', scopeRoot: 'Knowledge Base' });
		expect(merged.scopeRoot).toBe('Knowledge Base');
		expect('pdfOutputPath' in merged).toBe(false);
		expect('executionEngine' in merged).toBe(false);
	});

	it('has the new v2 keys with neutral defaults', () => {
		expect(DEFAULT_SETTINGS.zipOutputPath).toBe('Vault export.zip');
		expect(DEFAULT_SETTINGS.scopeTag).toBe('');
		expect(DEFAULT_SETTINGS.yieldEvery).toBeGreaterThan(0);
	});

	it('falls back safely when saved settings have invalid types or enum values', () => {
		const merged = mergeSettings({
			documentTitle: 42,
			excludedFolders: 'not-an-array',
			excludedFiles: [' a.md ', 4, 'a.md', ''],
			includeCanvas: 'yes',
			splitMode: 'invalid',
			wikilinkFormat: 'unknown',
			yieldEvery: 1e30,
		});
		expect(merged.documentTitle).toBe(DEFAULT_SETTINGS.documentTitle);
		expect(merged.excludedFolders).toEqual(DEFAULT_SETTINGS.excludedFolders);
		expect(merged.excludedFiles).toEqual(['a.md']);
		expect(merged.includeCanvas).toBe(DEFAULT_SETTINGS.includeCanvas);
		expect(merged.splitMode).toBe(DEFAULT_SETTINGS.splitMode);
		expect(merged.wikilinkFormat).toBe(DEFAULT_SETTINGS.wikilinkFormat);
		expect(merged.yieldEvery).toBe(1000);
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
