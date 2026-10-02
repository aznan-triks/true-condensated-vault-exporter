import { describe, it, expect } from 'vitest';
import { isFileIncluded } from '../src/core/filter';
import { extractWikilinks, transformWikilinks } from '../src/core/wikilink';
import { parseFrontmatter } from '../src/core/frontmatter';
import { removeComments, cleanCallouts, sanitizeWhitespace } from '../src/core/markdownClean';
import { parseDataviewQuery, evaluateDataviewQuery, renderDataviewBlocks } from '../src/core/dataviewEngine';
import { formatForNotebookLM } from '../src/core/notebooklmFormatter';
import { formatForHtml, simpleMarkdownToHtml } from '../src/core/htmlFormatter';
import { formatForMarkdown } from '../src/core/markdownFormatter';
import { parseCanvasContent } from '../src/core/canvasParser';
import { buildSplitFiles } from '../src/features/exportSplit';
import { runExports, ExportCancelledError } from '../src/features/exportOrchestrator';
import { cleanNote } from '../src/core/pipeline';
import { DEFAULT_SETTINGS, ExportGateway, ExporterSettings, VaultFile, mergeSettings } from '../src/core/types';
import * as fs from 'fs';
import * as path from 'path';

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
		expect(md).toContain('Note liée : WoT/01_Univers/Lieux');
		expect(md).toContain('Lien : https://example.com');
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
			content: '---\ntitle: Event 1\nordre: 01\n---\nDesc 1',
		},
		{
			path: 'WoT/80_Histroisre/Événements/Ev2.md',
			name: 'Ev2.md',
			content: '---\ntitle: Event 2\nordre: 02\n---\nDesc 2',
		},
		{
			path: 'WoT/01_Univers/Monde.md',
			name: 'Monde.md',
			content: '---\ntitle: Monde\n---\nDesc',
		},
	];

	it('evaluates dataview TABLE queries', () => {
		const queryText = 'TABLE ordre\nFROM "WoT/80_Histroisre/Événements"\nSORT ordre ASC';
		const parsed = parseDataviewQuery(queryText);
		expect(parsed).not.toBeNull();
		const result = evaluateDataviewQuery(parsed!, sampleFiles);
		expect(result).toContain('| Fichier | ordre |');
		expect(result).toContain('Ev1');
		expect(result).toContain('Ev2');
		expect(result).not.toContain('Monde');
	});

	it('supports WITHOUT ID and contains() in dataview queries', () => {
		const queryText = 'TABLE WITHOUT ID title, ordre\nFROM "WoT/80_Histroisre"\nWHERE contains(title, "Event")\nSORT ordre DESC';
		const parsed = parseDataviewQuery(queryText);
		expect(parsed).not.toBeNull();
		const result = evaluateDataviewQuery(parsed!, sampleFiles);
		expect(result).toContain('| title | ordre |');
		expect(result).not.toContain('| Fichier |');
		expect(result).toContain('Event 2');
	});

	it('renders dataview blocks inside markdown', () => {
		const md = '# Sommaire\n```dataview\nTABLE ordre\nFROM "WoT/80_Histroisre/Événements"\nSORT ordre ASC\n```\nFin';
		const rendered = renderDataviewBlocks(md, sampleFiles);
		expect(rendered).toContain('| Fichier | ordre |');
		expect(rendered).not.toContain('```dataview');
	});
});

describe('formatters and split export', () => {
	const sampleFiles: VaultFile[] = [
		{
			path: 'WoT/80_Histroisre/Ev1.md',
			name: 'Ev1.md',
			content: '---\ntitle: Event 1\ncanvas: hide\nstatus: draft\n---\nDescription with [[WoT/01_Univers/Monde|Monde]]',
		},
		{
			path: 'WoT/01_Univers/Monde.md',
			name: 'Monde.md',
			content: '---\ntitle: Monde\n---\nContenu du Monde',
		},
	];
	const notesFor = (settings: ExporterSettings) => sampleFiles.map((f) => cleanNote(f, sampleFiles, settings));
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
		const html = formatForHtml(notesFor(settings), settings);
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('Vault export (2 notes)');
		expect(html).toContain('[[WoT/01_Univers/Monde|Monde]]');
	});

	it('HTML does not treat inline code as a code fence', () => {
		const html = simpleMarkdownToHtml('`inline` text\nnext line');
		expect(html).not.toContain('<pre>');
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
		const notes = extra.map((f) => cleanNote(f, extra, settings));
		expect(buildSplitFiles(notes, settings).map((o) => o.path).sort()).toEqual(['out/01_Univers.txt', 'out/80_Histroisre.txt', 'out/Root.txt']);
	});

	it('individual split files keep frontmatter when not stripped', () => {
		const settings = { ...DEFAULT_SETTINGS, splitMode: 'individual-files' as const, stripFrontmatter: false, splitOutputFolder: 'out' };
		const outputs = buildSplitFiles(notesFor(settings), settings);
		expect(outputs[0]?.path).toBe('out/WoT/80_Histroisre/Ev1.md');
		expect(outputs[0]?.content.startsWith('---\ntitle: Event 1')).toBe(true);
	});
});

describe('orchestrator', () => {
	function fakeGateway(files: VaultFile[]) {
		const written = new Map<string, string>();
		const gateway: ExportGateway = {
			loadVaultFiles: async () => files,
			writeFile: async (p, c) => { written.set(p, c); },
		};
		return { gateway, written };
	}
	const files: VaultFile[] = Array.from({ length: 60 }, (_, i) => ({
		path: 'A/n' + i + '.md', name: 'n' + i + '.md', content: 'body ' + i,
	}));

	it('writes every consolidated format and split files for target all', async () => {
		const { gateway, written } = fakeGateway(files);
		await runExports(gateway, DEFAULT_SETTINGS, 'all', () => {});
		expect([...written.keys()].sort()).toEqual([
			'Vault export - NotebookLM.txt',
			'Vault export - split/A.txt',
			'Vault export.html',
			'Vault export.md',
		]);
	});

	it('writes only the requested target', async () => {
		const { gateway, written } = fakeGateway(files);
		await runExports(gateway, DEFAULT_SETTINGS, 'html', () => {});
		expect([...written.keys()]).toEqual(['Vault export.html']);
	});

	it('stops mid-run when cancelled and writes nothing afterwards', async () => {
		const { gateway, written } = fakeGateway(files);
		const controller = new AbortController();
		const run = runExports(gateway, { ...DEFAULT_SETTINGS, yieldEvery: 10 }, 'all', (p) => {
			if (p.stage === 'Cleaning notes' && p.current >= 20) controller.abort();
		}, controller.signal);
		await expect(run).rejects.toBeInstanceOf(ExportCancelledError);
		expect(written.size).toBe(0);
	});

	it('fails explicitly when no file matches', async () => {
		const { gateway } = fakeGateway([]);
		await expect(runExports(gateway, DEFAULT_SETTINGS, 'all', () => {})).rejects.toThrow('No files matched');
	});
});

describe('settings', () => {
	it('drops obsolete saved keys and keeps known ones', () => {
		const merged = mergeSettings({ pdfOutputPath: 'x.pdf', executionEngine: 'external-python', scopeRoot: 'WoT' });
		expect(merged.scopeRoot).toBe('WoT');
		expect('pdfOutputPath' in merged).toBe(false);
		expect('executionEngine' in merged).toBe(false);
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
