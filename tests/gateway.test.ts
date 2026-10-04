import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Integration tests for the Obsidian boundary (vault reads/writes and the
 * OS-level reveal) running the real gateway against a temporary directory and
 * a stubbed `obsidian` module. A call to an API Obsidian does not have — the
 * old `Shell.revealInFileExplorer` — fails here instead of in the user's vault.
 */

const state = vi.hoisted(() => ({ shellCalls: [] as string[], shellThrows: false }));

vi.mock('obsidian', () => {
	class TFile {
		stat: { mtime: number; ctime: number; size: number };
		constructor(public path: string, stat: { mtime: number; ctime: number; size: number }) {
			this.stat = stat;
		}
		get name(): string {
			return this.path.split('/').pop() ?? this.path;
		}
		get basename(): string {
			return this.name.replace(/\.[^.]+$/, '');
		}
	}
	class TFolder {
		constructor(public path: string) {}
	}
	class FileSystemAdapter {
		constructor(private readonly basePath: string) {}
		getBasePath(): string {
			return this.basePath;
		}
	}
	return {
		TFile,
		TFolder,
		FileSystemAdapter,
		Platform: { isMobile: false, isDesktop: true },
		normalizePath: (value: string) => value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
	};
});

vi.mock('electron', () => ({
	shell: {
		showItemInFolder: (target: string) => {
			if (state.shellThrows) throw new Error("Cannot find module 'electron'");
			state.shellCalls.push(target);
		},
	},
}));

// Obsidian's renderer is an Electron window with CommonJS require available;
// mirror that so the gateway's loader lookup is exercised the way Obsidian runs it.
type PluginHost = { window?: { require?: (id: string) => unknown } };
const host = globalThis as unknown as PluginHost;
if (!host.window) host.window = {};
if (typeof host.window.require !== 'function') {
	host.window.require = (id: string) => {
		if (id === 'electron') {
			if (state.shellThrows) throw new Error("Cannot find module 'electron'");
			return { shell: { showItemInFolder: (target: string) => state.shellCalls.push(target) } };
		}
		throw new Error('Unexpected require: ' + id);
	};
}

import { TFile, FileSystemAdapter } from 'obsidian';

const makeFile = (relative: string, stat: { mtime: number; ctime: number; size: number }): TFile =>
	new (TFile as unknown as new (path: string, stat: unknown) => TFile)(relative, stat);
const makeAdapter = (base: string): FileSystemAdapter =>
	new (FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter)(base);
import { ObsidianVaultGateway } from '../src/obsidian/vaultGateway';
import { DEFAULT_SETTINGS } from '../src/core/types';

let vaultDir: string;

function write(relative: string, content: string): void {
	const full = path.join(vaultDir, relative);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content, 'utf8');
}

function makeApp() {
	const files = new Map<string, TFile>();
	const folders = new Set<string>(['']);
	const scan = (): void => {
		files.clear();
		folders.clear();
		folders.add('');
		const walk = (dir: string): void => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				const relative = path.relative(vaultDir, full).split(path.sep).join('/');
				if (entry.isDirectory()) {
					folders.add(relative);
					walk(full);
				} else {
					const stat = fs.statSync(full);
					files.set(relative, makeFile(relative, { mtime: stat.mtimeMs, ctime: stat.birthtimeMs, size: stat.size }));
				}
			}
		};
		walk(vaultDir);
	};
	scan();
	const vault = {
		adapter: makeAdapter(vaultDir),
		getName: () => path.basename(vaultDir),
		getFiles: () => [...files.values()],
		getMarkdownFiles: () => [...files.values()],
		getAllFolders: (includeRoot = false) => [...folders].filter((p) => includeRoot || p !== '').map((p) => ({ path: p })),
		getAbstractFileByPath: (p: string) => files.get(p) ?? (folders.has(p) ? { path: p } : null),
		read: async (file: TFile) => fs.readFileSync(path.join(vaultDir, file.path), 'utf8'),
		create: async (p: string, content: string) => {
			write(p, content);
			scan();
			return files.get(p);
		},
		modify: async (file: TFile, content: string) => {
			write(file.path, content);
			scan();
		},
		createBinary: async (p: string, data: Uint8Array) => {
			const full = path.join(vaultDir, p);
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, Buffer.from(data));
			scan();
			return files.get(p);
		},
		modifyBinary: async (file: TFile, data: Uint8Array) => {
			fs.writeFileSync(path.join(vaultDir, file.path), Buffer.from(data));
			scan();
		},
		createFolder: async (p: string) => {
			fs.mkdirSync(path.join(vaultDir, p), { recursive: true });
			folders.add(p);
			return { path: p };
		},
	};
	return { vault, metadataCache: { getFileCache: () => null } };
}

function gatewayWith(app: { vault: unknown; metadataCache: unknown }): ObsidianVaultGateway {
	return new ObsidianVaultGateway(app as never);
}

beforeEach(() => {
	vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-gateway-'));
	state.shellCalls.length = 0;
	state.shellThrows = false;
});
afterEach(() => {
	fs.rmSync(vaultDir, { recursive: true, force: true });
});

describe('ObsidianVaultGateway', () => {
	it('loads matching markdown files and reports unreadable ones', async () => {
		write('a.md', '# A');
		write('locked.md', '# Locked');
		write('.trash/gone.md', '# trashed');
		const app = makeApp();
		const gateway = gatewayWith(app);
		app.vault.read = async (file: TFile) => {
			if (file.path === 'locked.md') throw new Error('EACCES');
			return fs.readFileSync(path.join(vaultDir, file.path), 'utf8');
		};
		const skipped: string[] = [];
		const files = await gateway.loadVaultFiles(DEFAULT_SETTINGS, undefined, undefined, (p, message) => {
			skipped.push(p + ': ' + message);
		});
		expect(files.map((f) => f.path)).toEqual(['a.md']);
		expect(files[0]?.name).toBe('a.md');
		expect(skipped).toEqual(['locked.md: EACCES']);
	});

	it('excludes the configured output paths from the next export', async () => {
		write('Notes/Keep.md', '# Keep');
		write('Vault export.md', 'previous export');
		const gateway = gatewayWith(makeApp());
		const files = await gateway.loadVaultFiles(DEFAULT_SETTINGS);
		expect(files.map((f) => f.path)).toEqual(['Notes/Keep.md']);
	});

	it('writes text and binary outputs, creating parent folders and updating existing files', async () => {
		const gateway = gatewayWith(makeApp());
		await gateway.writeFile('Out/nested/report.md', 'hello');
		await gateway.writeBinary('Out/nested/bundle.zip', new Uint8Array([1, 2, 3]));
		await gateway.writeFile('Out/nested/report.md', 'updated');
		expect(fs.readFileSync(path.join(vaultDir, 'Out/nested/report.md'), 'utf8')).toBe('updated');
		expect([...fs.readFileSync(path.join(vaultDir, 'Out/nested/bundle.zip'))]).toEqual([1, 2, 3]);
	});

	it('rejects vault-escaping output paths', async () => {
		const gateway = gatewayWith(makeApp());
		await expect(gateway.writeFile('../outside.md', 'x')).rejects.toThrow(/\.\./);
	});

	it('reveals vault outputs through Electron', async () => {
		write('Vault export.md', '# export');
		const gateway = gatewayWith(makeApp());
		expect(gateway.revealInFileManager('Vault export.md')).toBe(true);
		expect(state.shellCalls).toEqual([path.join(vaultDir, 'Vault export.md')]);
	});

	it('returns false instead of throwing when the shell API is unavailable', async () => {
		write('Vault export.md', '# export');
		const gateway = gatewayWith(makeApp());
		state.shellThrows = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(gateway.revealInFileManager('Vault export.md')).toBe(false);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
