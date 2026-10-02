/**
 * Obsidian Vault Gateway abstraction.
 * Wraps Obsidian Vault operations for reading notes and writing outputs.
 */

import { App, TFile, normalizePath } from 'obsidian';
import { ExportGateway, ExporterSettings, VaultFile } from '../core/types';
import { isFileIncluded } from '../core/filter';
import * as fs from 'fs';
import * as path from 'path';

export class ObsidianVaultGateway implements ExportGateway {
	constructor(private readonly app: App) {}

	/**
	 * Scans and reads all matching markdown and canvas files in the vault.
	 */
	async loadVaultFiles(settings: ExporterSettings): Promise<VaultFile[]> {
		const allFiles = this.app.vault.getFiles();
		const result: VaultFile[] = [];

		for (const file of allFiles) {
			if (!isFileIncluded(file.path, settings)) {
				continue;
			}
			const content = await this.app.vault.read(file);
			result.push({
				path: file.path,
				name: file.name,
				content,
				mtime: file.stat.mtime,
			});
		}

		// Sort by path for determinism
		result.sort((a, b) => a.path.localeCompare(b.path));
		return result;
	}

	/**
	 * Returns all relative folder paths in the vault for autocompletion.
	 */
	getAllFolders(): string[] {
		return this.app.vault.getAllFolders(false).map((f) => f.path);
	}

	/**
	 * Returns all relative file paths in the vault for autocompletion.
	 */
	getAllFiles(): string[] {
		return this.app.vault.getFiles().map((f) => f.path);
	}

	/**
	 * Scans vault metadata cache and returns all unique frontmatter property keys.
	 */
	getAllFrontmatterKeys(): string[] {
		const keys = new Set<string>();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter) {
				for (const key of Object.keys(cache.frontmatter)) {
					if (key !== 'position') {
						keys.add(key);
					}
				}
			}
		}
		return Array.from(keys).sort();
	}

	/**
	 * Writes a text file either to vault or to absolute disk path.
	 */
	async writeFile(targetPath: string, content: string): Promise<void> {
		if (path.isAbsolute(targetPath)) {
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			fs.writeFileSync(targetPath, content, 'utf8');
			return;
		}

		// Vault-relative path
		const norm = normalizePath(targetPath);
		const parentDir = norm.split('/').slice(0, -1).join('/');
		if (parentDir && !this.app.vault.getAbstractFileByPath(parentDir)) {
			await this.app.vault.createFolder(parentDir);
		}

		const existing = this.app.vault.getAbstractFileByPath(norm);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(norm, content);
		}
	}
}
