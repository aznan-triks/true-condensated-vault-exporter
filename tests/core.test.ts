import { describe, it, expect } from 'vitest';
import { isFileIncluded } from '../src/core/filter';
import { extractWikilinks, transformWikilinks } from '../src/core/wikilink';
import { parseFrontmatter } from '../src/core/frontmatter';
import { removeComments, cleanCallouts, sanitizeWhitespace } from '../src/core/markdownClean';
import { parseDataviewQuery, evaluateDataviewQuery, renderDataviewBlocks } from '../src/core/dataviewEngine';
import { formatForNotebookLM } from '../src/core/notebooklmFormatter';
import { formatForHtml } from '../src/core/htmlFormatter';
import { formatForMarkdown } from '../src/core/markdownFormatter';
import { parseCanvasContent } from '../src/core/canvasParser';
import { runSplitFilesExport } from '../src/features/exportSplit';
import { DEFAULT_SETTINGS, VaultFile } from '../src/core/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
			content: '---\ntitle: Event 1\ncanvas: hide\n---\nDescription with [[WoT/01_Univers/Monde|Monde]]',
		},
		{
			path: 'WoT/01_Univers/Monde.md',
			name: 'Monde.md',
			content: '---\ntitle: Monde\n---\nContenu du Monde',
		},
	];

	it('formats for NotebookLM with stripped ignored properties', () => {
		const output = formatForNotebookLM(sampleFiles, {
			...DEFAULT_SETTINGS,
			ignoredProperties: ['canvas'],
		});
		expect(output).toContain('WORLD OF TROIS - ARCHIVES DU LORE COMPLET (NOTEBOOKLM EXPORT)');
		expect(output).toContain('DOCUMENT [1/2] : WoT/80_Histroisre/Ev1.md');
		expect(output).not.toContain('canvas: hide');
	});

	it('generates folder-grouped split files', async () => {
		const tempDir = path.join(os.tmpdir(), 'vault-exporter-test-' + Date.now());
		const count = await runSplitFilesExport(
			{
				...DEFAULT_SETTINGS,
				exportSplitFiles: true,
				splitMode: 'folder-grouped',
				splitOutputFolder: tempDir,
			},
			sampleFiles,
			() => {}
		);

		expect(count).toBe(2);
		const file80 = path.join(tempDir, '80_Histroisre.txt');
		const file01 = path.join(tempDir, '01_Univers.txt');
		expect(fs.existsSync(file80)).toBe(true);
		expect(fs.existsSync(file01)).toBe(true);
		expect(fs.readFileSync(file80, 'utf8')).toContain('Event 1');
		expect(fs.readFileSync(file01, 'utf8')).toContain('Contenu du Monde');

		// Cleanup
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it('formats for HTML', () => {
		const html = formatForHtml(sampleFiles, DEFAULT_SETTINGS);
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('Sommaire (2 notes)');
		expect(html).toContain('doc-0');
	});

	it('formats for consolidated Markdown', () => {
		const md = formatForMarkdown(sampleFiles, DEFAULT_SETTINGS);
		expect(md).toContain('# World of Trois - Archives Complètes');
		expect(md).toContain('## Table des Matières');
		expect(md).toContain('1. [Event 1](#event-1-0)');
		expect(md).toContain('2. [Monde](#monde-1)');
		expect(md).toContain('## 1. Event 1 <a id="event-1-0"></a>');
		expect(md).toContain('## 2. Monde <a id="monde-1"></a>');
		expect(md).toContain('Description with Monde');
		expect(md).toContain('Contenu du Monde');
	});
});