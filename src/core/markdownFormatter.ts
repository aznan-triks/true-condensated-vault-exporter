/**
 * Consolidated Markdown document generator.
 * Produces a single, structured Markdown file with a dynamic Table of Contents,
 * clean headings, rendered Dataview blocks, sanitized comments, and preserved document anchors.
 */

import { VaultFile, ExporterSettings } from './types';
import { parseFrontmatter } from './frontmatter';
import { transformWikilinks } from './wikilink';
import { removeComments, cleanCallouts, sanitizeWhitespace } from './markdownClean';
import { renderDataviewBlocks } from './dataviewEngine';
import { parseCanvasContent } from './canvasParser';

function generateAnchor(title: string, index: number): string {
	const slug = title
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-');
	return slug ? slug + '-' + index : 'doc-' + index;
}

export function formatForMarkdown(
	files: VaultFile[],
	settings: ExporterSettings
): string {
	const parts: string[] = [];

	// Header
	parts.push('# World of Trois - Archives Complètes');
	parts.push('');
	parts.push('> **Export consolidé au format Markdown**  ');
	parts.push('> *Nombre total de documents : ' + files.length + '*  ');
	parts.push('> *Date d\'export : ' + new Date().toISOString() + '*');
	parts.push('');
	parts.push('---');
	parts.push('');

	// Table of Contents
	parts.push('## Table des Matières');
	parts.push('');

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		if (!file) continue;

		let docTitle = file.name.replace(/\.(md|canvas)$/, '');
		if (file.path.endsWith('.canvas')) {
			docTitle = 'Canvas: ' + docTitle;
		} else {
			const parsed = parseFrontmatter(file.content);
			if (parsed.metadata.title) {
				docTitle = parsed.metadata.title;
			}
		}

		const anchor = generateAnchor(docTitle, i);
		const folderPrefix = file.path.includes('/')
			? file.path.substring(0, file.path.lastIndexOf('/')) + ' / '
			: '';

		parts.push((i + 1) + '. [' + docTitle + '](#' + anchor + ') <small>*(📁 ' + folderPrefix + file.name + ')*</small>');
	}

	parts.push('');
	parts.push('---');
	parts.push('');

	// Documents Body
	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		if (!file) continue;

		const isCanvas = file.path.endsWith('.canvas');
		let title = file.name.replace(/\.(md|canvas)$/, '');
		let body = file.content;

		if (isCanvas) {
			title = 'Canvas: ' + title;
			const anchor = generateAnchor(title, i);
			parts.push('## ' + (i + 1) + '. ' + title + ' <a id="' + anchor + '"></a>');
			parts.push('*Fichier source : `' + file.path + '`*');
			parts.push('');
			parts.push(parseCanvasContent(file.content));
			parts.push('');
			parts.push('---');
			parts.push('');
			continue;
		}

		const parsed = parseFrontmatter(body);
		const meta = parsed.metadata;
		if (meta.title) {
			title = meta.title;
		}

		const anchor = generateAnchor(title, i);
		parts.push('## ' + (i + 1) + '. ' + title + ' <a id="' + anchor + '"></a>');
		parts.push('*Fichier source : `' + file.path + '`*');
		parts.push('');

		// Metadata block if not stripped
		if (!settings.stripFrontmatter) {
			const metaLines: string[] = [];
			if (meta.category) metaLines.push('- **Catégorie** : ' + meta.category);
			if (meta.order) metaLines.push('- **Ordre** : ' + meta.order);
			if (meta.tags && meta.tags.length > 0) metaLines.push('- **Tags** : `' + meta.tags.join('`, `') + '`');

			const ignored = new Set(settings.ignoredProperties.map((p) => p.toLowerCase()));
			for (const [k, v] of Object.entries(meta.custom)) {
				if (!ignored.has(k.toLowerCase()) && v !== undefined && v !== '') {
					const valStr = Array.isArray(v) ? v.join(', ') : String(v);
					metaLines.push('- **' + k + '** : ' + valStr);
				}
			}

			if (metaLines.length > 0) {
				parts.push('> [!INFO] Métadonnées');
				for (const line of metaLines) {
					parts.push('> ' + line);
				}
				parts.push('');
			}
			body = parsed.contentWithoutFrontmatter;
		} else {
			body = parsed.contentWithoutFrontmatter;
		}

		// Dataview
		if (settings.renderDataview) {
			body = renderDataviewBlocks(body, files);
		}

		// Clean comments & callouts
		body = removeComments(body);
		body = cleanCallouts(body);

		// Transform wikilinks
		body = transformWikilinks(body, settings.wikilinkFormat);

		// Sanitize whitespace
		body = sanitizeWhitespace(body);

		parts.push(body);
		parts.push('');
		parts.push('---');
		parts.push('');
	}

	return parts.join('\n');
}
