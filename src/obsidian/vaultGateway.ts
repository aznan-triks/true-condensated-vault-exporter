/**
 * Obsidian Vault Gateway abstraction.
 * Wraps Obsidian Vault operations for reading notes and writing outputs.
 * This is the ONLY layer that touches the Obsidian API and node builtins.
 */

import { App, FileSystemAdapter, TFile, normalizePath, Platform, Shell } from 'obsidian';
import { ExportGateway, ExporterSettings, VaultFile } from '../core/types';
import { isFileIncluded, reservedOutputPaths } from '../core/filter';
import * as fs from 'fs';
import * as path from 'path';

const READ_CONCURRENCY = 8;

export class ObsidianVaultGateway implements ExportGateway {
	constructor(private readonly app: App) {}

	/**
	 * Scans and reads all matching markdown and canvas files in the vault.
	 * Reads are batched for throughput; individual read failures are
	 * skipped (and reported to the console) instead of aborting the run.
	 */
	async loadVaultFiles(settings: ExporterSettings): Promise<VaultFile[]> {
		const reserved = reservedOutputPaths(settings);
		const tag = settings.scopeTag?.replace(/^#/, '').trim().toLowerCase();

		const candidates = this.app.vault.getFiles().filter((file) => {
			if (!isFileIncluded(file.path, {
				scopeRoot: settings.scopeRoot,
				excludedFolders: settings.excludedFolders,
				excludedFiles: settings.excludedFiles,
				excludedPrefixes: settings.excludedPrefixes,
				includeCanvas: settings.includeCanvas,
				reservedPaths: reserved,
			})) {
				return false;
			}
			if (tag && !file.path.endsWith('.canvas') && !this.fileHasTag(file, tag)) {
				return false;
			}
			return true;
		});

		const result: VaultFile[] = [];
		for (let i = 0; i < candidates.length; i += READ_CONCURRENCY) {
			const batch = candidates.slice(i, i + READ_CONCURRENCY);
			const settled = await Promise.all(batch.map(async (file) => {
				try {
					const content = await this.app.vault.read(file);
					return { file, content };
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					console.warn('[vault-exporter] Could not read ' + file.path + ' : ' + msg);
					return null;
				}
			}));
			for (const item of settled) {
				if (item) {
					result.push({
						path: item.file.path,
						name: item.file.name,
						content: item.content,
						mtime: item.file.stat.mtime,
					});
				}
			}
		}

		// Sort by path for determinism
		result.sort((a, b) => a.path.localeCompare(b.path));
		return result;
	}

	/** True when the file carries the (lowercase, tagless) tag in body or frontmatter. */
	private fileHasTag(file: TFile, tag: string): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return false;
		const bodyTags = (cache.tags ?? []).map((t) => t.tag.toLowerCase());
		const fm = cache.frontmatter?.tags;
		const fmTags = Array.isArray(fm)
			? fm.map((t) => String(t).toLowerCase())
			: typeof fm === 'string' ? [fm.toLowerCase()] : [];
		const all = [...bodyTags, ...fmTags];
		return all.some((t) => t === tag || t.startsWith(tag + '/'));
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
	 * Light-weight file listing for stats/preview UIs (no content read).
	 */
	getVaultFilesInfo(): { path: string; size: number }[] {
		return this.app.vault.getFiles().map((f) => ({ path: f.path, size: f.stat.size }));
	}

	/**
	 * Writes a text file either to vault or to absolute disk path.
	 */
	async writeFile(targetPath: string, content: string): Promise<void> {
		if (path.isAbsolute(targetPath)) {
			await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
			await fs.promises.writeFile(targetPath, content, 'utf8');
			return;
		}

		await this.writeInVault(normalizePath(targetPath), async () => {
			const existing = this.app.vault.getAbstractFileByPath(normalizePath(targetPath));
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
			} else {
				await this.app.vault.create(normalizePath(targetPath), content);
			}
		});
	}

	/**
	 * Writes binary data (e.g. a ZIP archive) to a vault or absolute path.
	 */
	async writeBinary(targetPath: string, data: Uint8Array): Promise<void> {
		// Copy into a fresh ArrayBuffer (data.buffer may be a SharedArrayBuffer view)
		const buffer = new ArrayBuffer(data.byteLength);
		new Uint8Array(buffer).set(data);
		if (path.isAbsolute(targetPath)) {
			await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
			await fs.promises.writeFile(targetPath, data);
			return;
		}

		const norm = normalizePath(targetPath);
		await this.writeInVault(norm, async () => {
			const existing = this.app.vault.getAbstractFileByPath(norm);
			if (existing instanceof TFile) {
				await this.app.vault.modifyBinary(existing, buffer);
			} else {
				await this.app.vault.createBinary(norm, buffer);
			}
		});
	}

	/** Ensures the parent folder exists (vault-only paths), then runs the write. */
	private async writeInVault(norm: string, write: () => Promise<void>): Promise<void> {
		const parentDir = norm.split('/').slice(0, -1).join('/');
		if (parentDir && !this.app.vault.getAbstractFileByPath(parentDir)) {
			await this.app.vault.createFolder(parentDir);
		}
		await write();
	}

	/**
	 * OS path for a vault-relative or absolute output, when this platform
	 * can reveal it (desktop only). Returns null otherwise.
	 */
	revealOutput(targetPath: string): string | null {
		if (Platform.isMobile) return null;
		if (path.isAbsolute(targetPath)) {
			return targetPath;
		}
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return null;
		return path.join(adapter.getBasePath(), normalizePath(targetPath));
	}

	/** Opens/reveals an output in the OS file manager (desktop only). */
	revealInFileManager(targetPath: string): boolean {
		const osPath = this.revealOutput(targetPath);
		if (!osPath) return false;
		Shell.revealInFileExplorer(osPath);
		return true;
	}
}
