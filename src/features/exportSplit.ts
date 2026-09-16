/**
 * Export split files engine.
 * Supports:
 * - 'folder-grouped' : produces one consolidated .txt per top-level folder (matching legacy export_split)
 * - 'individual-files' : exports individual cleaned markdown files 1-to-1
 */

import { ExporterSettings, ProgressCallback, VaultFile } from '../core/types';
import { parseFrontmatter } from '../core/frontmatter';
import { transformWikilinks } from '../core/wikilink';
import { removeComments, cleanCallouts, sanitizeWhitespace } from '../core/markdownClean';
import { renderDataviewBlocks } from '../core/dataviewEngine';
import { parseCanvasContent } from '../core/canvasParser';
import * as path from 'path';
import * as fs from 'fs';

function cleanSingleFileContent(file: VaultFile, files: VaultFile[], settings: ExporterSettings): { title: string; text: string } {
	const nameWithoutExt = file.name.replace(/\.(md|canvas)$/, '');

	if (file.path.endsWith('.canvas')) {
		return {
			title: 'CANVAS : ' + nameWithoutExt,
			text: parseCanvasContent(file.content),
		};
	}

	let body = file.content;
	const parsed = parseFrontmatter(body);
	const meta = parsed.metadata;

	if (settings.stripFrontmatter) {
		body = parsed.contentWithoutFrontmatter;
	}

	if (settings.renderDataview) {
		body = renderDataviewBlocks(body, files);
	}

	body = removeComments(body);
	body = cleanCallouts(body);
	body = transformWikilinks(body, settings.wikilinkFormat);
	body = sanitizeWhitespace(body);

	return {
		title: meta.title || nameWithoutExt,
		text: body,
	};
}

export async function runSplitFilesExport(
	settings: ExporterSettings,
	files: VaultFile[],
	onProgress: ProgressCallback
): Promise<number> {
	if (!settings.exportSplitFiles || !settings.splitOutputFolder) {
		return 0;
	}

	const destBase = settings.splitOutputFolder;
	fs.mkdirSync(destBase, { recursive: true });

	// MODE 1: FOLDER-GROUPED (One consolidated .txt per top-level folder / category)
	if (settings.splitMode === 'folder-grouped') {
		const groups = new Map<string, VaultFile[]>();

		for (const file of files) {
			const parts = file.path.replace(/\\/g, '/').split('/');
			let groupName = 'Racine';
			if (parts.length === 1) {
				// File at root, e.g. "Accueil.md"
				groupName = file.name.replace(/\.(md|canvas)$/, '');
			} else {
				// Subfolder group, e.g. "WoT/01_Univers" or "WoT"
				if (parts[0] === 'WoT' && parts.length > 2) {
					groupName = parts[1]!;
				} else {
					groupName = parts[0]!;
				}
			}

			const list = groups.get(groupName) ?? [];
			list.push(file);
			groups.set(groupName, list);
		}

		let created = 0;
		const totalGroups = groups.size;
		let currentIdx = 0;

		for (const [groupName, groupFiles] of groups.entries()) {
			currentIdx++;
			onProgress({
				stage: 'Split Folders',
				current: currentIdx,
				total: totalGroups,
				log: 'Building category: ' + groupName + ' (' + groupFiles.length + ' notes)...',
			});

			const lines: string[] = [];
			lines.push('================================================================================');
			lines.push('CATEGORIE : ' + groupName);
			lines.push('Nombre de documents : ' + groupFiles.length);
			lines.push('================================================================================\n');

			for (const file of groupFiles) {
				const cleaned = cleanSingleFileContent(file, files, settings);
				lines.push('\n----------------------------------------');
				lines.push(cleaned.title);
				lines.push('----------------------------------------\n');
				lines.push(cleaned.text);
				lines.push('\n');
			}

			const safeFileName = groupName.replace(/[<>:"/\\|?*]/g, '_') + '.txt';
			const outPath = path.join(destBase, safeFileName);
			fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
			created++;
		}

		return created;
	}

	// MODE 2: INDIVIDUAL FILES (1-to-1 markdown export)
	let count = 0;
	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		if (!file) continue;

		onProgress({
			stage: 'Split Files',
			current: i + 1,
			total: files.length,
			currentFile: file.name,
			log: 'Exporting: ' + file.path,
		});

		const cleaned = cleanSingleFileContent(file, files, settings);
		const targetSubPath = path.join(destBase, file.path);
		fs.mkdirSync(path.dirname(targetSubPath), { recursive: true });
		fs.writeFileSync(targetSubPath, cleaned.text, 'utf8');
		count++;
	}

	return count;
}