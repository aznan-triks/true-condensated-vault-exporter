/**
 * Obsidian Vault Gateway abstraction.
 * Wraps Obsidian Vault operations for reading notes and writing outputs.
 * This is the ONLY layer that touches the Obsidian API and node builtins.
 */

import { App, FileSystemAdapter, TFile, normalizePath, Platform } from 'obsidian';
import { ExportGateway, ExporterSettings, VaultFile } from '../core/types';
import { isFileIncluded, isTagScopeMatch, reservedOutputPaths } from '../core/filter';
import * as fs from 'fs';
import * as path from 'path';

const READ_CONCURRENCY = 8;

function normalizeVaultTarget(targetPath: string): string {
	const raw = targetPath.replace(/\\/g, '/');
	if (raw.split('/').includes('..')) {
		throw new Error('Vault-relative output paths cannot contain ".." segments.');
	}
	const normalized = normalizePath(raw);
	if (!normalized) throw new Error('Output path cannot be empty.');
	return normalized;
}

interface ElectronShell {
	showItemInFolder?: (fullPath: string) => void;
}

/**
 * Resolves Electron's `shell` module. Obsidian's renderer exposes
 * `window.require`; a bundler `require` is used as a fallback. Returns null
 * when neither is available instead of throwing.
 */
function resolveElectronShell(): ElectronShell | null {
	try {
		const hostWindow = (globalThis as { window?: { require?: (id: string) => unknown } }).window;
		const loader = typeof hostWindow?.require === 'function'
			? hostWindow.require
			: typeof require === 'function' ? require : null;
		if (!loader) return null;
		const electron = loader('electron') as { shell?: ElectronShell } | null;
		return electron?.shell ?? null;
	} catch {
		return null;
	}
}

export class ObsidianVaultGateway implements ExportGateway {
	constructor(private readonly app: App) {}

	/**
	 * Scans and reads all matching markdown and canvas files in the vault.
	 * Reads are batched for throughput; individual read failures are
	 * skipped (and reported to the console) instead of aborting the run.
	 */
	async loadVaultFiles(
		settings: ExporterSettings,
		signal?: AbortSignal,
		onProgress?: (current: number, total: number, currentFile?: string) => void,
		onSkipped?: (path: string, message: string) => void
	): Promise<VaultFile[]> {
		const reserved = reservedOutputPaths(settings);
		const tag = settings.scopeTag?.replace(/^#+/, '').trim().toLowerCase();

		const candidates = this.app.vault.getFiles().filter((file) => {
			if (!isFileIncluded(file.path, {
				scopeRoot: settings.scopeRoot,
				excludedFolders: settings.excludedFolders,
				excludedFiles: settings.excludedFiles,
				excludedPrefixes: settings.excludedPrefixes,
				includeCanvas: settings.includeCanvas,
				reservedPaths: reserved,
				onlyPath: settings.onlyFile,
			})) {
				return false;
			}
			return !tag || isTagScopeMatch(file.path, this.fileTags(file), tag);
		});

		const result: VaultFile[] = [];
		let completed = 0;
		onProgress?.(0, candidates.length);
		for (let i = 0; i < candidates.length; i += READ_CONCURRENCY) {
			if (signal?.aborted) break;
			const batch = candidates.slice(i, i + READ_CONCURRENCY);
			const settled = await Promise.all(batch.map(async (file) => {
				try {
					const content = await this.app.vault.read(file);
					return { file, content };
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					console.warn('[vault-exporter] Could not read ' + file.path + ': ' + msg);
					onSkipped?.(file.path, msg);
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
						ctime: item.file.stat.ctime,
					});
				}
			}
			completed += batch.length;
			onProgress?.(completed, candidates.length, batch[batch.length - 1]?.path);
			if (i + READ_CONCURRENCY < candidates.length && !signal?.aborted) {
				await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
			}
		}

		// Sort by path for determinism
		result.sort((a, b) => a.path.localeCompare(b.path));
		return result;
	}

	/** Returns tags from the body and frontmatter cache. */
	private fileTags(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return [];
		const bodyTags = (cache.tags ?? []).map((item) => item.tag);
		const fm = cache.frontmatter?.tags;
		const fmTags = Array.isArray(fm)
			? fm.map((value) => String(value))
			: typeof fm === 'string' ? [fm] : [];
		return [...bodyTags, ...fmTags];
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

		const norm = normalizeVaultTarget(targetPath);
		await this.writeInVault(norm, async () => {
			const existing = this.app.vault.getAbstractFileByPath(norm);
			if (existing && !(existing instanceof TFile)) {
				throw new Error('Output path is already a folder: ' + norm);
			}
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
			} else {
				await this.app.vault.create(norm, content);
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

		const norm = normalizeVaultTarget(targetPath);
		await this.writeInVault(norm, async () => {
			const existing = this.app.vault.getAbstractFileByPath(norm);
			if (existing && !(existing instanceof TFile)) {
				throw new Error('Output path is already a folder: ' + norm);
			}
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
		if (parentDir) {
			const parent = this.app.vault.getAbstractFileByPath(parentDir);
			if (parent instanceof TFile) throw new Error('Output parent is a file: ' + parentDir);
			if (!parent) await this.app.vault.createFolder(parentDir);
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

	/**
	 * Opens/reveals an output in the OS file manager (desktop only).
	 *
	 * Obsidian does not export a reveal helper: the `obsidian` module has no
	 * `Shell` (that name only ever existed as an unverified assumption), so this
	 * uses Electron's shell, which is available in Obsidian's renderer because
	 * the plugin is desktop-only. Missing/blocked APIs degrade to `false`
	 * instead of throwing inside the progress panel's click handler.
	 */
	revealInFileManager(targetPath: string): boolean {
		const osPath = this.revealOutput(targetPath);
		if (!osPath) return false;
		const shell = resolveElectronShell();
		if (typeof shell?.showItemInFolder !== 'function') {
			console.warn('[vault-exporter] Could not reveal ' + osPath + ': no Electron shell available in this runtime.');
			return false;
		}
		try {
			shell.showItemInFolder(osPath);
			return true;
		} catch (error: unknown) {
			console.warn('[vault-exporter] Could not reveal ' + osPath + ':', error);
			return false;
		}
	}
}
