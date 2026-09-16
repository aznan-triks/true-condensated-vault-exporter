/**
 * NotebookLM consolidated file formatter.
 * Produces structured plain text with metadata blocks and clear file delimiters.
 */

import { VaultFile, ExporterSettings } from './types';
import { parseFrontmatter } from './frontmatter';
import { transformWikilinks } from './wikilink';
import { removeComments, cleanCallouts, sanitizeWhitespace } from './markdownClean';
import { renderDataviewBlocks } from './dataviewEngine';
import { parseCanvasContent } from './canvasParser';

export function formatForNotebookLM(
	files: VaultFile[],
	settings: ExporterSettings
): string {
	const parts: string[] = [];

	// File Header
	parts.push('================================================================================');
	parts.push('WORLD OF TROIS - ARCHIVES DU LORE COMPLET (NOTEBOOKLM EXPORT)');
	parts.push('Total documents : ' + files.length);
	parts.push('Date d\'export   : ' + new Date().toISOString());
	parts.push('================================================================================\n');

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		if (!file) continue;

		// Handle .canvas files
		if (file.path.endsWith('.canvas')) {
			const canvasBody = parseCanvasContent(file.content);
			parts.push('\n--------------------------------------------------------------------------------');
			parts.push('DOCUMENT [' + (i + 1) + '/' + files.length + '] : ' + file.path + ' (CANVAS)');
			parts.push('Titre     : ' + file.name.replace(/\.canvas$/, ''));
			parts.push('--------------------------------------------------------------------------------\n');
			parts.push(canvasBody);
			parts.push('\n');
			continue;
		}

		let body = file.content;
		const parsed = parseFrontmatter(body);
		const meta = parsed.metadata;

		// Strip frontmatter if requested
		if (settings.stripFrontmatter) {
			body = parsed.contentWithoutFrontmatter;
		}

		// Render Dataview queries if enabled
		if (settings.renderDataview) {
			body = renderDataviewBlocks(body, files);
		}

		// Remove comments & clean callouts
		body = removeComments(body);
		body = cleanCallouts(body);

		// Transform wikilinks
		body = transformWikilinks(body, settings.wikilinkFormat);

		// Sanitize whitespace
		body = sanitizeWhitespace(body);

		// Document delimiter & metadata header
		parts.push('\n--------------------------------------------------------------------------------');
		parts.push('DOCUMENT [' + (i + 1) + '/' + files.length + '] : ' + file.path);
		if (meta.title) parts.push('Titre     : ' + meta.title);
		if (meta.category) parts.push('Catégorie : ' + meta.category);
		if (meta.order) parts.push('Ordre     : ' + meta.order);
		if (meta.tags && meta.tags.length > 0) parts.push('Tags      : ' + meta.tags.join(', '));

		// Additional custom frontmatter properties (unless ignored)
		const ignored = new Set(settings.ignoredProperties.map(p => p.toLowerCase()));
		for (const [k, v] of Object.entries(meta.custom)) {
			if (!ignored.has(k.toLowerCase()) && v !== undefined && v !== '') {
				parts.push(k + ' : ' + (Array.isArray(v) ? v.join(', ') : String(v)));
			}
		}

		parts.push('--------------------------------------------------------------------------------\n');
		parts.push(body);
		parts.push('\n');
	}

	return parts.join('\n');
}