import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { isFileIncluded, isTagScopeMatch, matchesTag, reservedOutputPaths } from '../src/core/filter';
import { extractWikilinks, transformWikilinks, buildLinkResolver } from '../src/core/wikilink';
import { parseFrontmatter } from '../src/core/frontmatter';
import { applyToProse, removeComments, cleanCallouts, sanitizeWhitespace, splitContentSegments } from '../src/core/markdownClean';
import { parseDataviewQuery, evaluateDataviewQuery, renderDataviewBlocks, resolveField } from '../src/core/dataviewEngine';
import { formatForNotebookLM } from '../src/core/notebooklmFormatter';
import { formatForHtml, simpleMarkdownToHtml, renderInline, noteHeadings } from '../src/core/htmlFormatter';
import { formatForMarkdown } from '../src/core/markdownFormatter';
import { parseCanvasContent } from '../src/core/canvasParser';
import {
	SPLIT_PRESETS,
	applySplitPreset,
	buildSplitFiles,
	detectSplitPreset,
	parseSubfolderSplitRule,
	previewSplitFiles,
} from '../src/features/exportSplit';
import { cleanNote, createExportContext, parseVault } from '../src/core/pipeline';
import { DEFAULT_SETTINGS, ExporterSettings, VaultFile, mergeSettings } from '../src/core/types';
import {
	canonicalOutputPath,
	externalFolderBase,
	isAbsoluteOutputPath,
	outputLeafName,
	resolveOutputPath,
	resolveOutputSettings,
	usesExternalOutputFolder,
	vaultRelativeOutputPath,
} from '../src/core/outputTarget';

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
		expect(clean).toBe('See The Capital and image.png');
	});

	it('keeps the display text of note embeds instead of deleting them', () => {
		expect(transformWikilinks('![[Embedded Note]]', 'clean-text')).toBe('Embedded Note');
		expect(transformWikilinks('![[Notes/Target#Section|Alias]]', 'clean-text')).toBe('Alias');
		expect(transformWikilinks('![[Embedded Note]]', 'canonical-alias')).toBe('Embedded Note');
		expect(transformWikilinks('Before ![[Embedded Note]] after', 'clean-text')).toBe('Before Embedded Note after');
	});

	it('emits attachment embeds as images and note embeds as links in markdown mode', () => {
		const files = [
			{ path: 'Assets/pic.png', name: 'pic.png' },
			{ path: 'Notes/Target.md', name: 'Target.md' },
		];
		const resolver = buildLinkResolver(files);
		expect(transformWikilinks('![[Assets/pic.png]]', 'markdown', resolver)).toBe('![pic.png](Assets/pic.png)');
		expect(transformWikilinks('![[Target]]', 'markdown', resolver)).toBe('[Target](Notes/Target.md)');
		expect(transformWikilinks('![[Target|Alias]]', 'markdown', resolver)).toBe('[Alias](Notes/Target.md)');
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

	it('splits prose from fenced blocks and inline code', () => {
		const segments = splitContentSegments('before `inline` after\n\n```js\nconst a = 1;\n```\nend');
		expect(segments.map((s) => s.code)).toEqual([false, true, false, true, false]);
		expect(segments.filter((s) => s.code).map((s) => s.text)).toEqual(['`inline`', '```js\nconst a = 1;\n```']);
	});

	it('never rewrites comments, wikilinks or callouts inside code', () => {
		const text = [
			'Prose %%secret%% and [[Link]].',
			'',
			'```python',
			'# [[AnotherLink]] inside code',
			'x = "%% not a comment %%"',
			'> [!NOTE] not a callout',
			'```',
			'',
			'Inline `[[NotALink]] and %%not a comment%%` end.',
		].join('\n');
		const cleaned = sanitizeWhitespace(
			applyToProse(
				applyToProse(applyToProse(text, removeComments), cleanCallouts),
				(prose) => transformWikilinks(prose, 'markdown', () => undefined)
			)
		);
		expect(cleaned).toContain('Prose  and [Link](Link).');
		expect(cleaned).toContain('# [[AnotherLink]] inside code');
		expect(cleaned).toContain('x = "%% not a comment %%"');
		expect(cleaned).toContain('> [!NOTE] not a callout');
		expect(cleaned).toContain('Inline `[[NotALink]] and %%not a comment%%` end.');
		expect(cleaned).not.toContain('secret');
		// Unterminated fence: everything after it is literal code.
		const open = applyToProse('text %%gone%%\n```\nstill %%kept%%', removeComments);
		expect(open).toBe('text \n```\nstill %%kept%%');
	});

	it('collapses blank lines in prose but keeps them inside code', () => {
		expect(sanitizeWhitespace('a\n\n\n\n```\nx\n\n\ny\n```\n\n\n\nb')).toBe('a\n\n```\nx\n\n\ny\n```\n\nb');
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

	it('parses single-line queries (canonical Dataview syntax)', () => {
		const query = parseDataviewQuery(
			'TABLE ordre, title FROM "Knowledge Base/80_History/Events" WHERE ordre = "01" SORT ordre ASC'
		)!;
		expect(query.columns).toEqual(['ordre', 'title']);
		expect(query.fromPath).toBe('Knowledge Base/80_History/Events');
		expect(query.whereClauses).toEqual(['ordre = "01"']);
		expect(query.sortField).toBe('ordre');
		const output = evaluateDataviewQuery(query, parsed);
		expect(output).toContain('| File | ordre | title |');
		expect(output).toContain('Event 1');
		expect(output).not.toContain('Event 2');
		expect(output).not.toContain('World');

		const list = parseDataviewQuery('LIST FROM #lore')!;
		expect(list.fromTag).toBe('lore');
		const listOutput = evaluateDataviewQuery(list, parsed);
		expect(listOutput).toContain('Event1');
		expect(listOutput).not.toContain('World');
	});

	it('supports AS aliases and keyword-like quoted values', () => {
		const query = parseDataviewQuery(
			'TABLE file.name AS "Name", ordre AS Order FROM "Knowledge Base/80_History" WHERE title = "World" SORT ordre DESC'
		)!;
		expect(query.columns).toEqual(['file.name', 'ordre']);
		expect(query.columnLabels).toEqual(['Name', 'Order']);
		const output = evaluateDataviewQuery(query, parsed);
		expect(output).toContain('| File | Name | Order |');
		expect(output).toContain('World');
		// The aliased column keeps the real value (aliases only relabel it).
		expect(output).toMatch(/\| \[\[Knowledge Base\/80_History\/World\.md\|World\]\] \| World \| 99 \|/);
		expect(output).not.toContain('Event 1');

		// Quoted keywords are values, not clauses.
		const quoted = parseDataviewQuery('TABLE title WHERE title = "from where sort"')!;
		expect(quoted.fromPath).toBeUndefined();
		expect(quoted.whereClauses).toEqual(['title = "from where sort"']);
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

		// Unsupported clauses must stay visible in single-line form too.
		const groupBy = '```dataview\nTABLE title FROM "Knowledge Base/80_History" GROUP BY ordre\n```';
		expect(renderDataviewBlocks(groupBy, parsed)).toBe(groupBy);
		const limit = '```dataview\nTABLE title FROM "Knowledge Base/80_History" LIMIT 5\n```';
		expect(renderDataviewBlocks(limit, parsed)).toBe(limit);
		const listExpression = '```dataview\nLIST file.mtime FROM #lore\n```';
		expect(renderDataviewBlocks(listExpression, parsed)).toBe(listExpression);
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

	it('HTML ships an optional client-side document filter', () => {
		const html = formatForHtml(notesFor(DEFAULT_SETTINGS), DEFAULT_SETTINGS, NOW);
		expect(html).toContain('<input id="ve-search"');
		expect(html).toContain('data-doc-id="doc-0"');
		expect(html).toContain('window.veFilter = apply;');
		// every toc item is associated with its document
		expect((html.match(/data-doc-id="doc-\d+"/g) ?? []).length).toBe(2);

		const withoutSearchSettings = { ...DEFAULT_SETTINGS, htmlShowSearch: false };
		const withoutSearch = formatForHtml(notesFor(withoutSearchSettings), withoutSearchSettings, NOW);
		expect(withoutSearch).toContain('<nav id="toc">');
		expect(withoutSearch).not.toContain('<input id="ve-search"');
		expect(withoutSearch).not.toContain('window.veFilter = apply;');
	});

	it('HTML supports system, light, and dark themes and export date', () => {
		const html = formatForHtml(notesFor(DEFAULT_SETTINGS), DEFAULT_SETTINGS, NOW);
		expect(html).toContain('<html data-ve-theme="system">');
		expect(html).toContain('prefers-color-scheme: light');
		expect(html).toContain('Exported ' + NOW);
		const light = formatForHtml(notesFor({ ...DEFAULT_SETTINGS, htmlTheme: 'light' }), { ...DEFAULT_SETTINGS, htmlTheme: 'light' }, NOW);
		expect(light).toContain('<html data-ve-theme="light">');
		expect(light).toContain('html[data-ve-theme="light"]');
		const dark = formatForHtml(notesFor({ ...DEFAULT_SETTINGS, htmlTheme: 'dark' }), { ...DEFAULT_SETTINGS, htmlTheme: 'dark' }, NOW);
		expect(dark).toContain('<html data-ve-theme="dark">');
		const unsafeAccent = { ...DEFAULT_SETTINGS, htmlAccentColor: '#123456; background: url(evil)' };
		const safeAccentHtml = formatForHtml(notesFor(unsafeAccent), unsafeAccent, NOW);
		expect(safeAccentHtml).toContain('--ve-accent: #8b72d9');
		expect(safeAccentHtml).not.toContain('background: url(evil)');

		const withCss = formatForHtml(notesFor({ ...DEFAULT_SETTINGS, customCss: ':root { --ve-accent: #c0392b; }' }), { ...DEFAULT_SETTINGS, customCss: ':root { --ve-accent: #c0392b; }' }, NOW);
		expect(withCss).toContain('--ve-accent: #c0392b');
		const injectedCss = formatForHtml(notesFor({ ...DEFAULT_SETTINGS, customCss: '</style><script>alert(1)</script>' }), { ...DEFAULT_SETTINGS, customCss: '</style><script>alert(1)</script>' }, NOW);
		expect(injectedCss).not.toContain('</style><script>');
	});

	it('HTML personalization controls accent, typography, width, visibility, and escaped attribution', () => {
		const settings = {
			...DEFAULT_SETTINGS,
			htmlTheme: 'dark' as const,
			htmlAccentColor: '#c0392b',
			htmlFont: 'serif' as const,
			htmlContentWidth: 1120,
			htmlShowToc: false,
			htmlShowSearch: false,
			htmlShowPaths: false,
			htmlShowMetadata: false,
			htmlShowFooter: true,
			htmlFooterText: 'Acme <Research>',
		};
		const html = formatForHtml(notesFor(settings), settings, NOW);
		expect(html).toContain('--ve-accent: #c0392b');
		expect(html).toContain('--ve-font-family: Georgia, \'Times New Roman\', serif');
		expect(html).toContain('--ve-content-width: 1120px');
		expect(html).toContain('<body id="top" class="ve-no-toc">');
		expect(html).not.toContain('<nav id="toc">');
		expect(html).not.toContain('<input id="ve-search"');
		expect(html).not.toContain('<span class="path-hint">');
		expect(html).not.toContain('<div class="doc-meta">');
		expect(html).toContain('Acme &lt;Research&gt;');

		const noFooter = formatForHtml(notesFor({ ...settings, htmlShowFooter: false }), { ...settings, htmlShowFooter: false }, NOW);
		expect(noFooter).not.toContain('<footer class="ve-footer">');
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

	it('splits selected subfolders with flat-prefixed naming by default and supports chaining (direct 1-level mode)', () => {
		const nestedFiles: VaultFile[] = [
			{ path: 'Knowledge Base/01_World/Overview.md', name: 'Overview.md', content: 'world overview' },
			{ path: 'Knowledge Base/01_World/Regions/North.md', name: 'North.md', content: 'north region' },
			{ path: 'Knowledge Base/01_World/Regions/Cities/Capital.md', name: 'Capital.md', content: 'capital city' },
			{ path: 'Knowledge Base/01_World/Factions/Guild.md', name: 'Guild.md', content: 'guild faction' },
			{ path: 'Knowledge Base/80_History/Eras/Ancient.md', name: 'Ancient.md', content: 'ancient era' },
		];
		const settings = {
			...DEFAULT_SETTINGS,
			scopeRoot: 'Knowledge Base',
			splitOutputFolder: 'out',
			splitSubfolders: ['Knowledge Base/01_World'],
			splitSubfolderDepth: 'direct' as const,
		};
		const ctx = createExportContext(nestedFiles, settings);
		const notes = nestedFiles.map((f) => cleanNote(f, ctx));
		const outputs = buildSplitFiles(notes, settings);

		expect(outputs.map((o) => o.path).sort()).toEqual([
			'out/01_World - Factions.txt',
			'out/01_World - Regions.txt',
			'out/01_World.txt',
			'out/80_History.txt',
		]);
		expect(outputs.find((o) => o.path === 'out/01_World.txt')?.content).toContain('world overview');
		expect(outputs.find((o) => o.path === 'out/01_World - Regions.txt')?.content).toContain('north region');
		// In 1-level mode, Cities stays grouped inside Regions until 01_World/Regions is also selected
		expect(outputs.find((o) => o.path === 'out/01_World - Regions.txt')?.content).toContain('capital city');
		expect(outputs.find((o) => o.path === 'out/01_World - Factions.txt')?.content).toContain('guild faction');
		expect(outputs.find((o) => o.path === 'out/80_History.txt')?.content).toContain('ancient era');

		// Chaining a deeper subfolder splits that deeper level as well
		const chainedSettings = {
			...settings,
			splitSubfolders: ['01_World', '01_World/Regions'],
		};
		const chainedOutputs = buildSplitFiles(notes, chainedSettings);
		expect(chainedOutputs.map((o) => o.path).sort()).toEqual([
			'out/01_World - Factions.txt',
			'out/01_World - Regions - Cities.txt',
			'out/01_World - Regions.txt',
			'out/01_World.txt',
			'out/80_History.txt',
		]);
		expect(chainedOutputs.find((o) => o.path === 'out/01_World - Regions - Cities.txt')?.content).toContain('capital city');
	});

	it('supports all subfolder naming styles (flat-prefixed, flat-leaf, flat-underscored, nested) and scope-wide depth modes', () => {
		const nestedFiles: VaultFile[] = [
			{ path: '01_World/Regions/North.md', name: 'North.md', content: 'north region' },
			{ path: '01_World/Regions/Cities/Capital.md', name: 'Capital.md', content: 'capital city' },
			{ path: '01_World/Regions/Cities/Districts/Market.md', name: 'Market.md', content: 'market district' },
			{ path: '80_History/Eras/Ancient/Timeline.md', name: 'Timeline.md', content: 'timeline' },
		];
		const baseSettings = {
			...DEFAULT_SETTINGS,
			splitOutputFolder: 'out',
			splitSubfolders: ['01_World'],
			splitSubfolderDepth: 'recursive' as const,
		};
		const ctx = createExportContext(nestedFiles, baseSettings);
		const notes = nestedFiles.map((f) => cleanNote(f, ctx));

		// flat-leaf
		const leafOutputs = buildSplitFiles(notes, { ...baseSettings, splitSubfolderStyle: 'flat-leaf' });
		expect(leafOutputs.map((o) => o.path).sort()).toEqual([
			'out/80_History.txt',
			'out/Cities.txt',
			'out/Districts.txt',
			'out/Regions.txt',
		]);

		// flat-underscored
		const underscoredOutputs = buildSplitFiles(notes, { ...baseSettings, splitSubfolderStyle: 'flat-underscored' });
		expect(underscoredOutputs.map((o) => o.path).sort()).toEqual([
			'out/01_World_Regions.txt',
			'out/01_World_Regions_Cities.txt',
			'out/01_World_Regions_Cities_Districts.txt',
			'out/80_History.txt',
		]);

		// nested
		const nestedOutputs = buildSplitFiles(notes, { ...baseSettings, splitSubfolderStyle: 'nested' });
		expect(nestedOutputs.map((o) => o.path).sort()).toEqual([
			'out/01_World/Regions.txt',
			'out/01_World/Regions/Cities.txt',
			'out/01_World/Regions/Cities/Districts.txt',
			'out/80_History.txt',
		]);

		// all-two-levels across the entire scope without needing splitSubfolders
		const twoLevelsOutputs = buildSplitFiles(notes, {
			...DEFAULT_SETTINGS,
			splitOutputFolder: 'out',
			splitSubfolderDepth: 'all-two-levels',
			splitSubfolderStyle: 'flat-prefixed',
		});
		expect(twoLevelsOutputs.map((o) => o.path).sort()).toEqual([
			'out/01_World - Regions.txt',
			'out/80_History - Eras.txt',
		]);

		// all-recursive across the entire scope
		const allRecursiveOutputs = buildSplitFiles(notes, {
			...DEFAULT_SETTINGS,
			splitOutputFolder: 'out',
			splitSubfolderDepth: 'all-recursive',
			splitSubfolderStyle: 'flat-prefixed',
		});
		expect(allRecursiveOutputs.map((o) => o.path).sort()).toEqual([
			'out/01_World - Regions - Cities - Districts.txt',
			'out/01_World - Regions - Cities.txt',
			'out/01_World - Regions.txt',
			'out/80_History - Eras - Ancient.txt',
		]);

		// Per-folder override: 01_World/* (1-level) + 80_History/** (recursive)
		const mixedSettings = {
			...DEFAULT_SETTINGS,
			splitOutputFolder: 'out',
			splitSubfolderDepth: 'direct' as const,
			splitSubfolderStyle: 'flat-leaf' as const,
			splitSubfolders: ['01_World/*', '80_History/**'],
		};
		const mixedOutputs = buildSplitFiles(notes, mixedSettings);
		expect(mixedOutputs.map((o) => o.path).sort()).toEqual([
			'out/Ancient.txt',
			'out/Regions.txt',
		]);
		expect(parseSubfolderSplitRule('Knowledge Base/01_World/**', 'Knowledge Base', 'direct')).toEqual({
			path: '01_World',
			mode: 'recursive',
		});
		expect(parseSubfolderSplitRule('01_World/*', '', 'recursive')).toEqual({
			path: '01_World',
			mode: 'direct',
		});
	});

	it('disambiguates colliding leaf folder names only when two split groups share a leaf name in flat-leaf mode', () => {
		const collidingFiles: VaultFile[] = [
			{ path: 'Projects/Archive/old-spec.md', name: 'old-spec.md', content: 'project archive' },
			{ path: 'Projects/Frontend/ui.md', name: 'ui.md', content: 'frontend ui' },
			{ path: 'Notes/Archive/old-note.md', name: 'old-note.md', content: 'notes archive' },
		];
		const settings = {
			...DEFAULT_SETTINGS,
			splitOutputFolder: 'out',
			splitSubfolders: ['Projects', 'Notes'],
			splitSubfolderStyle: 'flat-leaf' as const,
		};
		const ctx = createExportContext(collidingFiles, settings);
		const notes = collidingFiles.map((f) => cleanNote(f, ctx));
		const outputs = buildSplitFiles(notes, settings);
		expect(outputs.map((o) => o.path).sort()).toEqual([
			'out/Frontend.txt',
			'out/Notes - Archive.txt',
			'out/Projects - Archive.txt',
		]);
	});

	it('applies and detects split presets and builds live preview paths', () => {
		expect(SPLIT_PRESETS.length).toBeGreaterThanOrEqual(7);
		expect(detectSplitPreset(DEFAULT_SETTINGS)).toBe('top-level');

		const s = { ...DEFAULT_SETTINGS, splitSubfolders: ['Projects'] };
		expect(detectSplitPreset(s)).toBe('notebooklm-selected');

		applySplitPreset(s, 'notebooklm-deep');
		expect(s.splitSubfolderDepth).toBe('all-recursive');
		expect(s.splitSubfolderStyle).toBe('flat-prefixed');
		expect(detectSplitPreset(s)).toBe('notebooklm-deep');
		expect(previewSplitFiles(s)).toContain('Vault export - split/Projects - SubfolderA - Deep.txt');

		applySplitPreset(s, 'folder-tree');
		expect(s.splitSubfolderStyle).toBe('nested');
		expect(detectSplitPreset(s)).toBe('folder-tree');
		expect(previewSplitFiles(s)).toContain('Vault export - split/Projects/SubfolderA/Deep.txt');

		applySplitPreset(s, 'clean-leaf');
		expect(s.splitSubfolderStyle).toBe('flat-leaf');
		expect(detectSplitPreset(s)).toBe('clean-leaf');

		applySplitPreset(s, 'top-level');
		expect(s.splitSubfolders).toEqual([]);
		expect(detectSplitPreset(s)).toBe('top-level');

		applySplitPreset(s, 'markdown-mirror');
		expect(s.splitMode).toBe('individual-files');
		expect(detectSplitPreset(s)).toBe('markdown-mirror');
		expect(previewSplitFiles(s)[0]).toMatch(/\.md$/);
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

	it('cleans prose without rewriting code blocks', () => {
		const files: VaultFile[] = [
			{
				path: 'Code.md',
				name: 'Code.md',
				content: 'Prose %%hidden%% [[Cible]]\n\n```python\nx = "%% kept %%"\n# [[Cible]] kept\n```\n',
			},
			{ path: 'Cible.md', name: 'Cible.md', content: 'target' },
		];
		const ctx = createExportContext(files, { ...DEFAULT_SETTINGS, wikilinkFormat: 'markdown' });
		const note = cleanNote(files[0]!, ctx);
		expect(note.body).toContain('```python\nx = "%% kept %%"\n# [[Cible]] kept\n```');
		expect(note.body).toContain('[Cible](Cible.md)');
		expect(note.body).not.toContain('hidden');
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
		expect(DEFAULT_SETTINGS.rememberTargetSelection).toBe(true);
		expect(DEFAULT_SETTINGS.lastSelectedTargets).toEqual(['all']);
		expect(DEFAULT_SETTINGS.progressPanelAutoCloseSeconds).toBe(8);
		expect(DEFAULT_SETTINGS.autoRevealOutput).toBe(false);
		expect(DEFAULT_SETTINGS.yieldEvery).toBeGreaterThan(0);
		expect(DEFAULT_SETTINGS.htmlTheme).toBe('system');
		expect(DEFAULT_SETTINGS.htmlAccentColor).toMatch(/^#[0-9a-f]{6}$/i);
		expect(DEFAULT_SETTINGS.htmlShowToc).toBe(true);
		expect(DEFAULT_SETTINGS.splitSubfolders).toEqual([]);
		expect(DEFAULT_SETTINGS.splitSubfolderDepth).toBe('direct');
		expect(DEFAULT_SETTINGS.splitSubfolderStyle).toBe('flat-prefixed');
	});

	it('normalizes splitSubfolders, splitSubfolderDepth, and splitSubfolderStyle', () => {
		const merged = mergeSettings({
			splitSubfolders: [' Projects ', '', 'Projects', 'Notes/**'],
			splitSubfolderDepth: 'all-two-levels',
			splitSubfolderStyle: 'nested',
		});
		expect(merged.splitSubfolders).toEqual(['Projects', 'Notes/**']);
		expect(merged.splitSubfolderDepth).toBe('all-two-levels');
		expect(merged.splitSubfolderStyle).toBe('nested');

		const invalid = mergeSettings({
			splitSubfolders: 'not-an-array',
			splitSubfolderDepth: 'infinite',
			splitSubfolderStyle: 'random',
		});
		expect(invalid.splitSubfolders).toEqual([]);
		expect(invalid.splitSubfolderDepth).toBe('direct');
		expect(invalid.splitSubfolderStyle).toBe('flat-prefixed');
	});

	it('defaults to writing inside the vault and round-trips an external folder', () => {
		expect(DEFAULT_SETTINGS.useExternalOutputFolder).toBe(false);
		expect(DEFAULT_SETTINGS.externalOutputFolder).toBe('');
		const merged = mergeSettings({ useExternalOutputFolder: true, externalOutputFolder: '  C:\\Exports  ' });
		expect(merged.useExternalOutputFolder).toBe(true);
		expect(merged.externalOutputFolder).toBe('C:\\Exports');
	});

	it('normalizes remembered target preferences and supports opting out', () => {
		const settings = mergeSettings({ rememberTargetSelection: false, lastSelectedTargets: ['zip', 'html', 'zip', 'invalid'] });
		expect(settings.rememberTargetSelection).toBe(false);
		expect(settings.lastSelectedTargets).toEqual(['zip', 'html']);
		expect(mergeSettings({ lastSelectedTargets: [] }).lastSelectedTargets).toEqual(['all']);
		const behavior = mergeSettings({ progressPanelAutoCloseSeconds: 0, autoRevealOutput: true });
		expect(behavior.progressPanelAutoCloseSeconds).toBe(0);
		expect(behavior.autoRevealOutput).toBe(true);
	});

	it('falls back safely when saved settings have invalid types or enum values', () => {
		const merged = mergeSettings({
			documentTitle: 42,
			rememberTargetSelection: 'yes',
			lastSelectedTargets: ['html', 'invalid', 'html', 'all'],
			progressPanelAutoCloseSeconds: 10,
			autoRevealOutput: 'yes',
			excludedFolders: 'not-an-array',
			excludedFiles: [' a.md ', 4, 'a.md', ''],
			includeCanvas: 'yes',
			splitMode: 'invalid',
			wikilinkFormat: 'unknown',
			htmlTheme: 'sepia',
			htmlAccentColor: 'red; background: url(evil)',
			htmlFont: 'comic-sans',
			htmlContentWidth: 20,
			htmlShowToc: 'yes',
			htmlFooterText: 'x'.repeat(250),
			yieldEvery: 1e30,
		});
		expect(merged.documentTitle).toBe(DEFAULT_SETTINGS.documentTitle);
		expect(merged.rememberTargetSelection).toBe(true);
		expect(merged.lastSelectedTargets).toEqual(['all']);
		expect(merged.progressPanelAutoCloseSeconds).toBe(DEFAULT_SETTINGS.progressPanelAutoCloseSeconds);
		expect(merged.autoRevealOutput).toBe(DEFAULT_SETTINGS.autoRevealOutput);
		expect(merged.excludedFolders).toEqual(DEFAULT_SETTINGS.excludedFolders);
		expect(merged.excludedFiles).toEqual(['a.md']);
		expect(merged.includeCanvas).toBe(DEFAULT_SETTINGS.includeCanvas);
		expect(merged.splitMode).toBe(DEFAULT_SETTINGS.splitMode);
		expect(merged.wikilinkFormat).toBe(DEFAULT_SETTINGS.wikilinkFormat);
		expect(merged.htmlTheme).toBe('system');
		expect(merged.htmlAccentColor).toBe(DEFAULT_SETTINGS.htmlAccentColor);
		expect(merged.htmlFont).toBe('system');
		expect(merged.htmlContentWidth).toBe(680);
		expect(merged.htmlShowToc).toBe(true);
		expect(merged.htmlFooterText).toHaveLength(200);
		expect(merged.yieldEvery).toBe(1000);
		expect(merged.useExternalOutputFolder).toBe(false);
		expect(merged.externalOutputFolder).toBe('');
	});
});

describe('output target (external folder)', () => {
	const enabled = { useExternalOutputFolder: true, externalOutputFolder: 'C:\\Exports' };

	it('recognizes absolute paths including drives, UNC shares and roots', () => {
		expect(isAbsoluteOutputPath('C:\\Exports')).toBe(true);
		expect(isAbsoluteOutputPath('c:/Exports')).toBe(true);
		expect(isAbsoluteOutputPath('\\\\server\\share\\out')).toBe(true);
		expect(isAbsoluteOutputPath('/home/user/Exports')).toBe(true);
		expect(isAbsoluteOutputPath('Out/notes.md')).toBe(false);
		expect(isAbsoluteOutputPath('')).toBe(false);
	});

	it('is only active with an absolute, non-empty folder', () => {
		expect(usesExternalOutputFolder({ useExternalOutputFolder: true, externalOutputFolder: 'C:\\Exports' })).toBe(true);
		expect(usesExternalOutputFolder({ useExternalOutputFolder: false, externalOutputFolder: 'C:\\Exports' })).toBe(false);
		expect(usesExternalOutputFolder({ useExternalOutputFolder: true, externalOutputFolder: 'Exports' })).toBe(false);
		expect(usesExternalOutputFolder({ useExternalOutputFolder: true, externalOutputFolder: '   ' })).toBe(false);
	});

	it('re-roots relative paths and reduces absolute paths to their name', () => {
		expect(resolveOutputPath(enabled, 'Vault export.md')).toBe('C:/Exports/Vault export.md');
		expect(resolveOutputPath(enabled, 'Out\\nested\\notes.md')).toBe('C:/Exports/Out/nested/notes.md');
		expect(resolveOutputPath(enabled, 'D:/work/split')).toBe('C:/Exports/split');
		expect(resolveOutputPath(enabled, '/home/you/out.html')).toBe('C:/Exports/out.html');
		expect(resolveOutputPath(enabled, 'Out/../notes.md')).toBe('C:/Exports/notes.md');
	});

	it('leaves paths untouched while the option is disabled or the folder is relative', () => {
		const disabled = { useExternalOutputFolder: false, externalOutputFolder: 'C:\\Exports' };
		expect(resolveOutputPath(disabled, 'Vault export.md')).toBe('Vault export.md');
		const relative = { useExternalOutputFolder: true, externalOutputFolder: 'Exports' };
		expect(resolveOutputPath(relative, 'Vault export.md')).toBe('Vault export.md');
	});

	it('resolves every configured output path in one settings copy', () => {
		const resolved = resolveOutputSettings({
			...DEFAULT_SETTINGS,
			useExternalOutputFolder: true,
			externalOutputFolder: '/home/you/Exports',
		});
		expect(resolved).not.toBe(DEFAULT_SETTINGS);
		expect(resolved.notebooklmOutputPath).toBe('/home/you/Exports/Vault export - NotebookLM.txt');
		expect(resolved.htmlOutputPath).toBe('/home/you/Exports/Vault export.html');
		expect(resolved.markdownOutputPath).toBe('/home/you/Exports/Vault export.md');
		expect(resolved.zipOutputPath).toBe('/home/you/Exports/Vault export.zip');
		expect(resolved.splitOutputFolder).toBe('/home/you/Exports/Vault export - split');
	});

	it('routes a blank split destination to the external folder root', () => {
		const resolved = resolveOutputSettings({
			...DEFAULT_SETTINGS,
			useExternalOutputFolder: true,
			externalOutputFolder: 'C:\\Exports\\',
			splitOutputFolder: '',
		});
		expect(resolved.splitOutputFolder).toBe('C:/Exports');
	});

	it('returns the same settings object when external output is disabled', () => {
		expect(resolveOutputSettings(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS);
	});

	it('normalizes folder bases and leaf names for portable paths', () => {
		expect(externalFolderBase('C:\\Exports\\')).toBe('C:/Exports');
		expect(externalFolderBase('C:\\')).toBe('C:/');
		expect(externalFolderBase('/home/you/Exports/')).toBe('/home/you/Exports');
		expect(outputLeafName('C:\\Users\\me\\Exports\\')).toBe('Exports');
		expect(canonicalOutputPath('C:\\Exports\\A\\..\\B.md')).toBe('c:/exports/b.md');
		expect(canonicalOutputPath('Out/Notes.md')).toBe('Out/Notes.md');
	});

	it('maps absolute outputs inside the vault back to vault-relative paths', () => {
		expect(vaultRelativeOutputPath('C:\\Vault\\Out\\notes.md', 'C:\\Vault')).toBe('Out/notes.md');
		expect(vaultRelativeOutputPath('c:/vault/notes.md', 'C:/Vault/')).toBe('notes.md');
		expect(vaultRelativeOutputPath('/home/you/vault/out.md', '/home/you/vault')).toBe('out.md');
		expect(vaultRelativeOutputPath('C:\\Other\\notes.md', 'C:\\Vault')).toBeNull();
		expect(vaultRelativeOutputPath('C:\\Vault', 'C:\\Vault')).toBeNull();
		expect(vaultRelativeOutputPath('/home/you/vault/out.md', '')).toBeNull();
	});

	it('protects external outputs that are written back inside the vault', () => {
		const inside = {
			...DEFAULT_SETTINGS,
			useExternalOutputFolder: true,
			externalOutputFolder: 'C:\\Vault\\Exports',
		};
		expect(reservedOutputPaths(inside, { vaultBasePath: 'C:\\Vault' })).toEqual([
			'Exports/Vault export - NotebookLM.txt',
			'Exports/Vault export.html',
			'Exports/Vault export.md',
			'Exports/Vault export.zip',
			'Exports/Vault export - split',
		]);
		const outside = { ...inside, externalOutputFolder: 'C:\\Elsewhere' };
		expect(reservedOutputPaths(outside, { vaultBasePath: 'C:\\Vault' })).toEqual([]);
		// Without a known vault base path, absolute locations cannot be mapped.
		expect(reservedOutputPaths(inside)).toEqual([]);
	});

	it('excludes a vault-internal external folder from the next export', () => {
		const reserved = reservedOutputPaths(
			{ ...DEFAULT_SETTINGS, useExternalOutputFolder: true, externalOutputFolder: 'C:\\Vault\\Exports' },
			{ vaultBasePath: 'C:\\Vault' }
		);
		const options = {
			scopeRoot: '',
			excludedFolders: [],
			excludedFiles: [],
			excludedPrefixes: [],
			reservedPaths: reserved,
		};
		expect(isFileIncluded('Exports/Vault export.md', options)).toBe(false);
		expect(isFileIncluded('Exports/nested/Vault export.html', options)).toBe(false);
		expect(isFileIncluded('Notes/Real note.md', options)).toBe(true);
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

	// Obsidian's view/plugin lifecycle calls methods on the plugin's own
	// instances (View.open(), View.load(), PluginSettingTab.display()…). A
	// class *field* with the same name replaces the method on the instance and
	// makes Obsidian fail with "Failed to open view: e.open is not a function".
	it('never shadows Obsidian lifecycle members with instance fields', () => {
		const lifecycleMembers = new Set([
			'open', 'close', 'load', 'unload', 'onload', 'onunload', 'onOpen', 'onClose',
			'getState', 'setState', 'getEphemeralState', 'setEphemeralState', 'getIcon',
			'getViewType', 'getDisplayText', 'onResize', 'onPaneMenu', 'addAction', 'addChild',
			'register', 'registerEvent', 'registerDomEvent', 'registerInterval',
			'display', 'hide', 'onSelect', 'selectSuggestion', 'renderSuggestion', 'getSuggestions',
			'setValue', 'getValue', 'setIcon', 'setName', 'setDesc', 'setHeading', 'setDisabled',
			'then', 'addText', 'addTextArea', 'addButton', 'addToggle', 'addDropdown', 'addSlider',
			'addExtraButton', 'addSearch', 'addRibbonIcon', 'addCommand', 'addSettingTab', 'registerView',
			'loadData', 'saveData',
		]);
		const keywords = new Set(['const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'throw', 'new', 'await', 'type', 'interface', 'function', 'import', 'export', 'this', 'super', 'yield', 'typeof']);
		const violations: string[] = [];
		for (const file of [...tsFiles('src/ui'), ...tsFiles('src/settings'), path.join('src', 'main.ts')]) {
			fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
				const field = /^\s+(?:(?:private|protected|public|readonly|static|override|declare)\s+)?([A-Za-z_$][\w$]*)\s*[:=]/.exec(line);
				const name = field?.[1];
				if (!name || keywords.has(name)) return;
				if (lifecycleMembers.has(name)) {
					violations.push(`${file}:${index + 1} declares a field named "${name}"`);
				}
			});
		}
		expect(violations).toEqual([]);
	});

	it('core never imports features, ui, commands or the gateway', () => {
		for (const file of tsFiles('src/core')) {
			for (const imp of importsOf(file)) {
				expect(imp, file).not.toMatch(/features|ui|commands|obsidian\//);
			}
		}
	});

	// Guards against importing APIs Obsidian does not export (e.g. a `Shell`
	// helper that only ever existed in an internal type augmentation).
	it('only imports symbols the obsidian package actually exports', () => {
		const dts = fs.readFileSync(path.join('node_modules', 'obsidian', 'obsidian.d.ts'), 'utf8');
		const exported = new Set<string>();
		for (const match of dts.matchAll(
			/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm
		)) {
			exported.add(match[1]!);
		}
		expect(exported.size).toBeGreaterThan(100);
		for (const file of tsFiles('src')) {
			const source = fs.readFileSync(file, 'utf8');
			for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*'obsidian'/g)) {
				for (const entry of match[1]!.split(',')) {
					const name = entry.trim().split(/\s+as\s+/)[0]?.trim();
					if (name) {
						expect(exported.has(name), file + ' imports `' + name + '` which obsidian does not export').toBe(true);
					}
				}
			}
		}
	});
});
