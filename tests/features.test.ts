import { describe, it, expect, vi } from 'vitest';
import * as outputTarget from '../src/core/outputTarget';
import { inflateRawSync } from 'zlib';
import { crc32, buildZip, zipEntryName } from '../src/core/zip';
import * as zipModule from '../src/core/zip';
import { CONSOLIDATED_FORMATS } from '../src/features/formats';
import { assignGroupFileNames, buildSplitFiles, planSplitFiles, previewSplitFiles } from '../src/features/exportSplit';
import * as splitModule from '../src/features/exportSplit';
import { cleanNote, createExportContext } from '../src/core/pipeline';
import { defaultFileMetadata } from '../src/core/frontmatter';
import { runExports, ExportCancelledError, ExportFailedError, utf8ByteLength } from '../src/features/exportOrchestrator';
import {
	ExportHistoryEntry,
	sanitizeHistory,
	pushHistory,
	formatBytes,
	formatDuration,
	totalBytes,
	relativeTime,
} from '../src/features/exportHistory';
import { DEFAULT_SETTINGS, ExportGateway, ExporterSettings, VaultFile } from '../src/core/types';
import { isFileIncluded, reservedOutputPaths } from '../src/core/filter';

/* ---------------- ZIP writer ---------------- */

describe('zip writer', () => {
	it('computes the canonical CRC-32', () => {
		// Well-known check value: CRC-32 of "123456789" is 0xCBF43926
		const data = new TextEncoder().encode('123456789');
		expect(crc32(data)).toBe(0xcbf43926);
	});

	function readZip(zip: Uint8Array): { name: string; method: number; offset: number; size: number; crc: number }[] {
		// Minimal central directory reader for test verification
		const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
		const bytes = new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength);
		// Find EOCD from the end
		let eocd = -1;
		for (let i = bytes.length - 22; i >= 0; i--) {
			if (view.getUint32(i, true) === 0x06054b50) {
				eocd = i;
				break;
			}
		}
		expect(eocd, 'EOCD signature').toBeGreaterThan(-1);
		const entryCount = view.getUint16(eocd + 10, true);
		const cdOffset = view.getUint32(eocd + 16, true);
		let p = cdOffset;
		const out: { name: string; method: number; offset: number; size: number; crc: number }[] = [];
		const decoder = new TextDecoder();
		for (let i = 0; i < entryCount; i++) {
			expect(view.getUint32(p, true), 'central header signature').toBe(0x02014b50);
			const method = view.getUint16(p + 10, true);
			const crc = view.getUint32(p + 16, true);
			const compSize = view.getUint32(p + 20, true);
			const nameLen = view.getUint16(p + 28, true);
			const extraLen = view.getUint16(p + 30, true);
			const commentLen = view.getUint16(p + 32, true);
			const localOffset = view.getUint32(p + 42, true);
			const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
			out.push({ name, method, offset: localOffset, size: compSize, crc });
			p += 46 + nameLen + extraLen + commentLen;
		}
		return out;
	}

	function entryData(zip: Uint8Array, entry: { offset: number }): { method: number; data: Uint8Array } {
		const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
		const bytes = new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength);
		expect(view.getUint32(entry.offset, true), 'local header signature').toBe(0x04034b50);
		const method = view.getUint16(entry.offset + 8, true);
		const compSize = view.getUint32(entry.offset + 18, true);
		const nameLen = view.getUint16(entry.offset + 26, true);
		const extraLen = view.getUint16(entry.offset + 28, true);
		const dataStart = entry.offset + 30 + nameLen + extraLen;
		return { method, data: bytes.subarray(dataStart, dataStart + compSize) };
	}

	it('builds a valid archive readable by a central directory parser', () => {
		const encoder = new TextEncoder();
		const entries = [
			{ name: 'a/first.txt', data: encoder.encode('hello world') },
			{ name: 'second.html', data: encoder.encode('<html>big ' + 'x'.repeat(2000) + '</html>') },
		];
		const zip = buildZip(entries, new Date(2026, 0, 2, 10, 30, 0));

		const read = readZip(zip);
		expect(read.map((e) => e.name)).toEqual(['a/first.txt', 'second.html']);

		// small entry stored, big entry deflated
		const e0 = entryData(zip, read[0]!);
		expect(e0.method).toBe(0);
		expect(new TextDecoder().decode(e0.data)).toBe('hello world');

		const e1 = entryData(zip, read[1]!);
		expect(e1.method).toBe(8);
		expect(e1.data.length).toBeLessThan(2050);
		const inflated = inflateRawSync(Buffer.from(e1.data));
		expect(inflated.toString('utf8')).toBe(new TextDecoder().decode(entries[1]!.data));
	});

	it('keeps deflate results consistent with the stored CRC', () => {
		const encoder = new TextEncoder();
		const content = 'naïve archive naïve ' + 'z'.repeat(500);
		const zip = buildZip([{ name: 'x.txt', data: encoder.encode(content) }]);
		const read = readZip(zip);
		const e = entryData(zip, read[0]!);
		const recovered = e.method === 8 ? inflateRawSync(Buffer.from(e.data)).toString('utf8') : new TextDecoder().decode(e.data);
		expect(recovered).toBe(content);
		expect(crc32(encoder.encode(content))).toBe(read[0]!.crc);
	});

	it('counts single-pass iterable entries and preserves the complete archive (VE-013)', () => {
		const entries = [{ name: 'a.txt', data: new TextEncoder().encode('a') }, { name: 'b.txt', data: new TextEncoder().encode('b'.repeat(800)) }];
		const date = new Date('2026-10-21T10:00:00Z');
		function* once() { yield* entries; }
		const archive = buildZip(once(), date);
		expect(readZip(archive).map((entry) => entry.name)).toEqual(['a.txt', 'b.txt']);
		expect(archive).toEqual(buildZip(entries, date));
	});

	it('propagates a mid-iteration error without returning a partial archive (VE-013)', () => {
		const cause = new Error('entry failed');
		function* entries() { yield { name: 'a.txt', data: new Uint8Array([1]) }; throw cause; }
		expect(() => buildZip(entries())).toThrow(cause);
	});

	it('keeps the ZIP32 entry-count limit for iterables (VE-013)', () => {
		function* entries() {
			for (let i = 0; i < 65536; i++) yield { name: i + '.txt', data: new Uint8Array() };
		}
		expect(() => buildZip(entries())).toThrow('65,535 entries');
	});

	it('keeps all plain bytes, ZIP names/sizes/CRCs and archive bytes equal (VE-013)', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
		try {
			const files = [{ path: 'A/é.md', name: 'é.md', content: '---\ntags: [one, two]\n---\n# Body\n' + 'naïve '.repeat(100) }];
			const ctx = createExportContext(files, DEFAULT_SETTINGS);
			const notes = files.map((file) => cleanNote(file, ctx));
			const expected = [
				...Object.values(CONSOLIDATED_FORMATS).map((format) => ({ path: format.outputPath(DEFAULT_SETTINGS), content: format.render(notes, DEFAULT_SETTINGS, new Date().toISOString()) })),
				...buildSplitFiles(notes, DEFAULT_SETTINGS),
			];
			const expectedZip = buildZip(expected.map((out) => ({ name: zipEntryName(out.path), data: new TextEncoder().encode(out.content) })));
			const { gateway, written, writtenBinary } = fakeGateway(files);
			await runExports(gateway, DEFAULT_SETTINGS, ['all', 'zip'], () => {});
			const actual = writtenBinary.get(DEFAULT_SETTINGS.zipOutputPath)!;
			expect([...written]).toEqual(expected.map((out) => [out.path, out.content]));
			expect(readZip(actual)).toEqual(readZip(expectedZip));
			expect(actual).toEqual(expectedZip);
		} finally { vi.useRealTimers(); }
	});

	it('keeps canonical ZIP entry order when HTML is prepared first (VE-013 compressed records)', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
		try {
			const first = fakeGateway(manyFiles.slice(0, 1));
			await runExports(first.gateway, DEFAULT_SETTINGS, ['zip'], () => {});
			const second = fakeGateway(manyFiles.slice(0, 1));
			await runExports(second.gateway, DEFAULT_SETTINGS, ['html', 'zip'], () => {});
			expect([...second.written.keys()]).toEqual(['Vault export.html']);
			const actual = second.writtenBinary.get(DEFAULT_SETTINGS.zipOutputPath)!;
			expect(readZip(actual).map((entry) => entry.name)).toEqual(['Vault export - NotebookLM.txt', 'Vault export.html', 'Vault export.md', 'Vault export - split/A.txt']);
			expect(actual).toEqual(first.writtenBinary.get(DEFAULT_SETTINGS.zipOutputPath));
		} finally { vi.useRealTimers(); }
	});

	it('maps absolute output paths to portable entry names', () => {
		expect(zipEntryName('Vault export.md')).toBe('Vault export.md');
		expect(zipEntryName('out\\nested\\file.txt')).toBe('out/nested/file.txt');
		expect(zipEntryName('C:/Users/Example/Exports/01_World.txt')).toBe('Exports/01_World.txt');
			expect(zipEntryName('/home/user/exports/Vault export.zip')).toBe('exports/Vault export.zip');
		expect(() => zipEntryName('../outside.txt')).toThrow('escape the archive root');
		expect(() => buildZip([{ name: '../outside.txt', data: new TextEncoder().encode('unsafe') }])).toThrow('Unsafe ZIP entry path');
	});
});

/* ---------------- Orchestrator ---------------- */

function fakeGateway(files: VaultFile[]) {
	const written = new Map<string, string>();
	const writtenBinary = new Map<string, Uint8Array>();
	const gateway: ExportGateway = {
		loadVaultFiles: async () => files,
		writeFile: async (p, c) => { written.set(p, c); },
		writeBinary: async (p, d) => { writtenBinary.set(p, d); },
	};
	return { gateway, written, writtenBinary };
}

const manyFiles: VaultFile[] = Array.from({ length: 60 }, (_, i) => ({
	path: 'A/n' + i + '.md', name: 'n' + i + '.md', content: 'body ' + i,
}));

describe('orchestrator', () => {
	it('writes every consolidated format and split files for target all', async () => {
		const { gateway, written } = fakeGateway(manyFiles);
		await runExports(gateway, DEFAULT_SETTINGS, ['all'], () => {});
		expect([...written.keys()].sort()).toEqual([
			'Vault export - NotebookLM.txt',
			'Vault export - split/A.txt',
			'Vault export.html',
			'Vault export.md',
		]);
	});

	it('writes only the requested targets', async () => {
		const { gateway, written } = fakeGateway(manyFiles);
		await runExports(gateway, DEFAULT_SETTINGS, ['html'], () => {});
		expect([...written.keys()]).toEqual(['Vault export.html']);
	});

	it('writes multiple selected targets without duplicates', async () => {
		const { gateway, written } = fakeGateway(manyFiles);
		await runExports(gateway, DEFAULT_SETTINGS, ['html', 'split', 'html'], () => {});
		expect([...written.keys()].sort()).toEqual(['Vault export - split/A.txt', 'Vault export.html']);
	});

	it('zip target writes a single binary archive containing all outputs', async () => {
		const { gateway, written, writtenBinary } = fakeGateway(manyFiles);
		const result = await runExports(gateway, DEFAULT_SETTINGS, ['zip'], () => {});
		expect(written.size).toBe(0);
		expect([...writtenBinary.keys()]).toEqual(['Vault export.zip']);
		expect(result.written).toHaveLength(1);
		expect(result.written[0]!.path).toBe('Vault export.zip');
		expect(result.written[0]!.bytes).toBe(writtenBinary.get('Vault export.zip')!.length);

		const zip = writtenBinary.get('Vault export.zip')!;
		// PK\x03\x04 signature
		expect(zip.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
		// contains all expected entry names
		const asText = new TextDecoder().decode(zip);
		expect(asText).toContain('Vault export - NotebookLM.txt');
		expect(asText).toContain('Vault export.html');
		expect(asText).toContain('Vault export.md');
		expect(asText).toContain('Vault export - split/A.txt');
	});

	it('writes every output inside the external folder when it is enabled', async () => {
		const { gateway, written } = fakeGateway(manyFiles);
		await runExports(gateway, {
			...DEFAULT_SETTINGS,
			useExternalOutputFolder: true,
			externalOutputFolder: 'C:\\Exports',
		}, ['all'], () => {});
		expect([...written.keys()].sort()).toEqual([
			'C:/Exports/Vault export - NotebookLM.txt',
			'C:/Exports/Vault export - split/A.txt',
			'C:/Exports/Vault export.html',
			'C:/Exports/Vault export.md',
		]);
	});

	it('stores the external ZIP in the external folder with folder-relative entry names', async () => {
		const { gateway, written, writtenBinary } = fakeGateway(manyFiles);
		const result = await runExports(gateway, {
			...DEFAULT_SETTINGS,
			useExternalOutputFolder: true,
			externalOutputFolder: '/tmp/ve-exports',
		}, ['zip'], () => {});
		expect(written.size).toBe(0);
		expect([...writtenBinary.keys()]).toEqual(['/tmp/ve-exports/Vault export.zip']);
		expect(result.written[0]!.path).toBe('/tmp/ve-exports/Vault export.zip');
		const asText = new TextDecoder().decode(writtenBinary.get('/tmp/ve-exports/Vault export.zip')!);
		// Entry names are relative to the external folder, not to the OS root.
		expect(asText).toContain('Vault export - NotebookLM.txt');
		expect(asText).toContain('Vault export - split/A.txt');
		expect(asText).not.toContain('ve-exports/Vault export.md');
	});

	it('passes the external output paths to the gateway so vault reads stay protected', async () => {
		const seen: string[] = [];
		const gateway: ExportGateway = {
			loadVaultFiles: async (settings) => {
				seen.push(settings.htmlOutputPath, settings.splitOutputFolder);
				return manyFiles;
			},
			writeFile: async () => {},
			writeBinary: async () => {},
		};
		await runExports(gateway, {
			...DEFAULT_SETTINGS,
			useExternalOutputFolder: true,
			externalOutputFolder: '/tmp/ve-exports',
		}, ['html'], () => {});
		expect(seen).toEqual(['/tmp/ve-exports/Vault export.html', '/tmp/ve-exports/Vault export - split']);
	});

	it('stops mid-run when cancelled and writes nothing afterwards', async () => {
		const { gateway, written } = fakeGateway(manyFiles);
		const controller = new AbortController();
		const run = runExports(gateway, { ...DEFAULT_SETTINGS, yieldEvery: 10 }, ['all'], (p) => {
			if (p.stage === 'Cleaning notes' && p.current >= 20) controller.abort();
		}, controller.signal);
		await expect(run).rejects.toBeInstanceOf(ExportCancelledError);
		expect(written.size).toBe(0);
	});

	it('records readable-file failures in the result instead of hiding them', async () => {
		const files = [{ path: 'A/good.md', name: 'good.md', content: 'readable' }];
		const gateway: ExportGateway = {
			loadVaultFiles: async (_settings, _signal, _onProgress, onSkipped) => {
				onSkipped?.('A/bad.md', 'permission denied');
				return files;
			},
			writeFile: async () => {},
			writeBinary: async () => {},
		};
		const result = await runExports(gateway, DEFAULT_SETTINGS, ['markdown'], () => {});
		expect(result.skippedFiles).toEqual(['A/bad.md']);
	});

	it('is cancellable while loading and carries partial results when cancelled', async () => {
		const controller = new AbortController();
		const gateway: ExportGateway = {
			loadVaultFiles: async (_settings, _signal, onProgress) => {
				onProgress?.(0, manyFiles.length);
				controller.abort();
				return [];
			},
			writeFile: async () => {},
			writeBinary: async () => {},
		};
		const run = runExports(gateway, DEFAULT_SETTINGS, ['markdown'], () => {}, controller.signal);
		await expect(run).rejects.toMatchObject({
			partialResult: { written: [], skippedFiles: [], totalBytes: 0 },
		});
	});

	it('retains the files already written when the user cancels mid-export', async () => {
		const controller = new AbortController();
		const written = new Map<string, string>();
		const gateway: ExportGateway = {
			loadVaultFiles: async () => manyFiles,
			writeFile: async (filePath, content) => {
				written.set(filePath, content);
				controller.abort();
			},
			writeBinary: async () => {},
		};
		let thrown: unknown;
		try {
			await runExports(gateway, DEFAULT_SETTINGS, ['all'], () => {}, controller.signal);
		} catch (error: unknown) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(ExportCancelledError);
		if (thrown instanceof ExportCancelledError) {
			expect(thrown.partialResult?.written).toHaveLength(1);
			expect(thrown.partialResult?.totalBytes).toBeGreaterThan(0);
		}
		 expect(written.size).toBe(1);
	});

	it('rejects conflicting and unsafe output paths before writing anything', async () => {
		const { gateway, written, writtenBinary } = fakeGateway(manyFiles);
		const sharedPath = { ...DEFAULT_SETTINGS, htmlOutputPath: 'same.md', markdownOutputPath: 'same.md' };
		await expect(runExports(gateway, sharedPath, ['html', 'markdown'], () => {})).rejects.toThrow('Output path conflict');
		await expect(runExports(gateway, { ...DEFAULT_SETTINGS, markdownOutputPath: '../outside.md' }, ['markdown'], () => {}))
			.rejects.toThrow('must stay inside the vault');
		await expect(runExports(gateway, { ...DEFAULT_SETTINGS, markdownOutputPath: 'nested/../inside.md' }, ['markdown'], () => {}))
			.rejects.toThrow('must stay inside the vault');
		await expect(runExports(gateway, { ...DEFAULT_SETTINGS, htmlOutputPath: '' }, ['html'], () => {}))
			.rejects.toThrow('output path cannot be empty');
		await expect(runExports(gateway, { ...DEFAULT_SETTINGS, markdownOutputPath: '.' }, ['markdown'], () => {}))
			.rejects.toThrow('must name a file');
		await expect(runExports(gateway, { ...DEFAULT_SETTINGS, markdownOutputPath: 'Exports/' }, ['markdown'], () => {}))
			.rejects.toThrow('must name a file');
		const zipCollision = { ...DEFAULT_SETTINGS, zipOutputPath: 'Vault export.html' };
		await expect(runExports(gateway, zipCollision, ['zip', 'html'], () => {})).rejects.toThrow('overlaps another selected output');
		expect(written.size).toBe(0);
		expect(writtenBinary.size).toBe(0);
	});

	describe('source overwrite protection (VE-001)', () => {
		const source: VaultFile = { path: 'A.md', name: 'A.md', content: '---\nstatus: keep-me\n---\nBody %%secret%%' };

		it.each(['split', 'markdown', 'zip'] as const)('rejects a %s output equal to a source before any write', async (target) => {
			const { gateway, written, writtenBinary } = fakeGateway([source]);
			const stages: string[] = [];
			await expect(runExports(gateway, {
				...DEFAULT_SETTINGS,
				splitMode: 'individual-files',
				splitOutputFolder: target === 'split' ? '' : 'out',
				markdownOutputPath: target === 'markdown' ? 'A.md' : DEFAULT_SETTINGS.markdownOutputPath,
				zipOutputPath: 'A.md',
			}, [target], (progress) => { stages.push(progress.stage); })).rejects.toThrow(
				'Output "A.md" would overwrite the note "A.md". Choose another output folder or name.'
			);
			expect(written.size).toBe(0);
			expect(writtenBinary.size).toBe(0);
			expect(stages).toContain('Validating outputs');
		});

		it('rejects an absolute split output inside the vault before any write', async () => {
			const { gateway, written, writtenBinary } = fakeGateway([{ ...source, path: 'Exports/A.md' }]);
			const withBase: ExportGateway & { getVaultBasePath(): string } = {
				...gateway,
				getVaultBasePath: () => '/vault',
			};
			await expect(runExports(withBase, {
				...DEFAULT_SETTINGS,
				scopeRoot: 'Exports',
				useExternalOutputFolder: true,
				externalOutputFolder: '/vault/Exports',
				splitMode: 'individual-files',
				splitOutputFolder: '',
			}, ['split'], () => {})).rejects.toThrow(
				'Output "/vault/Exports/A.md" would overwrite the note "Exports/A.md".'
			);
			expect(written.size).toBe(0);
			expect(writtenBinary.size).toBe(0);
		});

		it('rejects portable case-only source collisions before any write', async () => {
			const { gateway, written } = fakeGateway([source]);
			await expect(runExports(gateway, { ...DEFAULT_SETTINGS, markdownOutputPath: 'a.md' }, ['markdown'], () => {}))
				.rejects.toThrow('Output "a.md" would overwrite the note "A.md".');
			expect(written.size).toBe(0);
		});

		it('keeps distinct split destinations working', async () => {
			const { gateway, written } = fakeGateway([source]);
			const result = await runExports(gateway, {
				...DEFAULT_SETTINGS, splitMode: 'individual-files', splitOutputFolder: 'out',
			}, ['split'], () => {});
			expect([...written.keys()]).toEqual(['out/A.md']);
			expect(result.written).toHaveLength(1);
		});
	});

	describe('linear split validation (VE-003)', () => {
		it.each([
			['a.md', 'a.md/b.md'], ['a.md/b.md', 'a.md'],
		])('rejects exact ancestor overlap %s then %s', async (left, right) => {
			const { gateway, written } = fakeGateway(manyFiles);
			await expect(runExports(gateway, {
				...DEFAULT_SETTINGS, htmlOutputPath: left, markdownOutputPath: right,
			}, ['html', 'markdown'], () => {})).rejects.toThrow('Output paths overlap: ' + left + ' and ' + right + '.');
			expect(written.size).toBe(0);
		});

		it.each([
			['a.md', 'ab.md'], ['a/b.md', 'a/c.md'], ['A.md', 'a.md'], ['a.md', 'a/b.md'],
		])('allows distinct outputs %s and %s', async (left, right) => {
			const { gateway, written } = fakeGateway(manyFiles);
			await runExports(gateway, {
				...DEFAULT_SETTINGS, htmlOutputPath: left, markdownOutputPath: right,
			}, ['html', 'markdown'], () => {});
			expect([...written.keys()]).toEqual([left, right]);
		});

		it('preserves the complete insertion order of 50 split outputs across five folders', async () => {
			const files = Array.from({ length: 50 }, (_, i) => ({
				path: 'G' + i % 5 + '/n' + (49 - i) + '.md', name: 'n' + (49 - i) + '.md', content: 'body ' + i,
			}));
			const { gateway, written } = fakeGateway(files);
			const result = await runExports(gateway, {
				...DEFAULT_SETTINGS, splitMode: 'individual-files', splitOutputFolder: 'out',
			}, ['split'], () => {});
			const expected = files.map((f) => 'out/' + f.path);
			expect([...written.keys()]).toEqual(expected);
			expect(result.written.map((f) => f.path)).toEqual(expected);
			expect([...written.values()]).toEqual(files.map((f) => f.content));
		});

		it('does not eagerly reduce cancellation snapshots for successful split writes', async () => {
			const reduce = vi.spyOn(Array.prototype, 'reduce');
			try {
				const result = await runExports(fakeGateway(manyFiles).gateway, {
					...DEFAULT_SETTINGS, splitMode: 'individual-files', splitOutputFolder: 'out',
				}, ['split'], () => {});
				expect(reduce.mock.calls.length).toBeLessThan(10);
				expect(result.written).toHaveLength(manyFiles.length);
			} finally {
				reduce.mockRestore();
			}
		});

		it('canonicalizes a linear number of paths instead of every pair', async () => {
			const files = Array.from({ length: 100 }, (_, i) => ({ path: 'N/' + i + '.md', name: i + '.md', content: 'body' }));
			const canonical = vi.spyOn(outputTarget, 'canonicalOutputPath');
			try {
				await runExports(fakeGateway(files).gateway, {
					...DEFAULT_SETTINGS, splitMode: 'individual-files', splitOutputFolder: 'out',
				}, ['split'], () => {});
				expect(canonical.mock.calls.length).toBeLessThan(1000);
			} finally {
				canonical.mockRestore();
			}
		});
	});

	it.each(['clean-text', 'canonical-alias', 'markdown'] as const)('renders anchor-only wikilinks in all exports with %s (VE-005)', async (wikilinkFormat) => {
		const { gateway, written } = fakeGateway([{ path: 'Index.md', name: 'Index.md', content: '[[#Sommaire]]' }]);
		await runExports(gateway, { ...DEFAULT_SETTINGS, wikilinkFormat }, ['all'], () => {});
		expect(written.size).toBe(4);
		for (const content of written.values()) {
			expect(content).toContain('Sommaire');
			expect(content).not.toContain('[[');
		}
	});

	describe('per-run settings snapshot (VE-008)', () => {
		it('keeps all links and destination/title settings uniform during a mutation', async () => {
			const files = Array.from({ length: 12 }, (_, i) => ({ path: 'N/' + i + '.md', name: i + '.md', content: '[[Target]]' }));
			files.push({ path: 'Target.md', name: 'Target.md', content: 'target' });
			const { gateway, written } = fakeGateway(files);
			const raw: ExporterSettings = { ...DEFAULT_SETTINGS, yieldEvery: 1, wikilinkFormat: 'markdown', ignoredProperties: [] };
			await runExports(gateway, raw, ['markdown'], (progress) => {
				if (progress.stage === 'Cleaning notes' && progress.current === 3) {
					raw.wikilinkFormat = 'keep-wikilink';
					raw.markdownOutputPath = 'changed.md';
					raw.documentTitle = 'Changed mid-run';
				}
			});
			expect([...written.keys()]).toEqual(['Vault export.md']);
			const text = written.get('Vault export.md') ?? '';
			expect(text.match(/\[Target\]\(Target\.md\)/g)).toHaveLength(12);
			expect(text).not.toContain('[[Target]]');
			expect(text).not.toContain('Changed mid-run');
			expect(raw.wikilinkFormat).toBe('keep-wikilink');
			expect(raw.markdownOutputPath).toBe('changed.md');
		});

		it('isolates in-place ignoredProperties mutations from rendered metadata', async () => {
			const files = Array.from({ length: 6 }, (_, i) => ({ path: 'N/' + i + '.md', name: i + '.md', content: '---\nreviewer: Alice\n---\nbody' }));
			const { gateway, written } = fakeGateway(files);
			const raw: ExporterSettings = { ...DEFAULT_SETTINGS, yieldEvery: 1, stripFrontmatter: false, ignoredProperties: [] };
			await runExports(gateway, raw, ['notebooklm'], (progress) => {
				if (progress.stage === 'Cleaning notes' && progress.current === 3) raw.ignoredProperties.push('reviewer');
			});
			expect(written.get(DEFAULT_SETTINGS.notebooklmOutputPath)?.match(/reviewer: Alice/g)).toHaveLength(6);
			expect(raw.ignoredProperties).toEqual(['reviewer']);
		});

		it.each([false, true])('does not mutate raw settings and detaches arrays with external output %s', async (useExternalOutputFolder) => {
			const raw = { ...structuredClone(DEFAULT_SETTINGS), useExternalOutputFolder, externalOutputFolder: '/tmp/ve-snapshot' };
			const before = structuredClone(raw);
			const gateway: ExportGateway = {
				loadVaultFiles: async (settings) => {
					expect(settings).not.toBe(raw);
					expect(settings.ignoredProperties).not.toBe(raw.ignoredProperties);
					expect(settings.excludedFolders).not.toBe(raw.excludedFolders);
					expect(settings.lastSelectedTargets).not.toBe(raw.lastSelectedTargets);
					return manyFiles;
				},
				writeFile: async () => {}, writeBinary: async () => {},
			};
			await runExports(gateway, raw, ['markdown'], () => {});
			expect(raw).toEqual(before);
		});
	});

	describe('partial write failures (VE-009)', () => {
		it('reports exactly the completed files, bytes and failed third path', async () => {
			const { gateway, written } = fakeGateway(manyFiles);
			const originalWrite = gateway.writeFile;
			gateway.writeFile = async (path, content) => {
				if (path === 'Vault export.md') throw new Error('disk full');
				await originalWrite(path, content);
			};
			const error: unknown = await runExports(gateway, DEFAULT_SETTINGS, ['notebooklm', 'html', 'markdown'], () => {}).catch((failure: unknown) => failure);
			const completed = [...written].map(([path, content]) => ({ path, bytes: new TextEncoder().encode(content).length }));
			expect(error).toMatchObject({
				name: 'ExportFailedError', failedPath: 'Vault export.md',
				partialResult: { written: completed, skippedFiles: [], totalBytes: completed.reduce((sum, f) => sum + f.bytes, 0) },
			});
			expect(error).toBeInstanceOf(ExportFailedError);
			expect(error instanceof Error ? error.message : '').toContain('disk full');
			expect(error instanceof Error ? error.message : '').toContain('Vault export.md');
			expect(completed.map((f) => f.path)).toEqual(['Vault export - NotebookLM.txt', 'Vault export.html']);
		});

		it('reports an empty partial result when the ZIP write fails', async () => {
			const { gateway, written, writtenBinary } = fakeGateway(manyFiles);
			gateway.writeBinary = async () => { throw new Error('archive disk full'); };
			const error: unknown = await runExports(gateway, DEFAULT_SETTINGS, ['zip'], () => {}).catch((failure: unknown) => failure);
			expect(error).toMatchObject({
				name: 'ExportFailedError', failedPath: 'Vault export.zip',
				partialResult: { written: [], skippedFiles: [], totalBytes: 0 },
			});
			expect(written.size).toBe(0);
			expect(writtenBinary.size).toBe(0);
		});

		it('retains successful plain files when the later ZIP write fails (VE-013 approved migration)', async () => {
			const { gateway, written, writtenBinary } = fakeGateway(manyFiles);
			const cause = new Error('archive disk full');
			gateway.writeBinary = async () => { throw cause; };
			const error: unknown = await runExports(gateway, DEFAULT_SETTINGS, ['zip', 'markdown'], () => {}).catch((failure: unknown) => failure);
			const completed = [...written].map(([path, content]) => ({ path, bytes: new TextEncoder().encode(content).length }));
			expect(completed.map((file) => file.path)).toEqual(['Vault export.md']);
			expect(error).toMatchObject({
				name: 'ExportFailedError', failedPath: 'Vault export.zip', cause,
				partialResult: { written: completed, totalBytes: completed.reduce((sum, file) => sum + file.bytes, 0) },
			});
			expect(writtenBinary.size).toBe(0);
		});
	});

	it.each([
		{ paths: ['A?B/x.md', 'A_B/y.md'], splitMode: 'folder-grouped' as const },
		{ paths: ['X.md', 'X.canvas'], splitMode: 'individual-files' as const },
	])('rejects named split collisions before plain or ZIP writes: $paths (VE-004)', async ({ paths, splitMode }) => {
		const files = paths.map((path) => ({ path, name: path.split('/').pop() ?? path, content: path.endsWith('.canvas') ? '{"nodes":[{"type":"text","text":"body"}]}' : 'body' }));
		const { gateway, written, writtenBinary } = fakeGateway(files);
		let error: unknown;
		try { await runExports(gateway, { ...DEFAULT_SETTINGS, splitMode, splitOutputFolder: 'out' }, ['zip', 'all'], () => {}); }
		catch (failure: unknown) { error = failure; }
		expect(error instanceof Error ? error.message : '').toContain('Two split outputs');
		for (const path of paths) expect(error instanceof Error ? error.message : '').toContain(splitMode === 'folder-grouped' ? path.split('/')[0] : path);
		expect(written.size).toBe(0);
		expect(writtenBinary.size).toBe(0);
	});

	describe('output retention and write order (VE-013)', () => {
		it.each([
			{ targets: ['all', 'zip'] as const },
			{ targets: ['html', 'zip'] as const },
			{ targets: ['zip', 'markdown'] as const },
			{ targets: ['split', 'zip'] as const },
		])('renders each output only once for $targets (VE-013 compressed records)', async ({ targets }) => {
			const formatSpies = Object.values(CONSOLIDATED_FORMATS).map((format) => vi.spyOn(format, 'render'));
			let splitRenders = 0;
			const plan = splitModule.planSplitFiles;
			const splitSpy = vi.spyOn(splitModule, 'planSplitFiles').mockImplementation((...args) => plan(...args).map((out) => ({
				...out, render: () => { splitRenders++; return out.render(); },
			})));
			try {
				const { gateway } = fakeGateway(manyFiles.slice(0, 1));
				await runExports(gateway, DEFAULT_SETTINGS, [...targets], () => {});
				for (const spy of formatSpies) expect(spy).toHaveBeenCalledTimes(1);
				expect(splitRenders).toBe(1);
			} finally { for (const spy of formatSpies) spy.mockRestore(); splitSpy.mockRestore(); }
		});

		it('counts UTF-8 bytes without allocating encoded output copies', () => {
			const values = ['ascii', 'é漢😀', '\uD800', 'a\uDC00b'];
			const expected = values.map((text) => new TextEncoder().encode(text).length);
			const spy = vi.spyOn(TextEncoder.prototype, 'encode');
			try {
				expect(values.map(utf8ByteLength)).toEqual(expected);
				expect(spy).not.toHaveBeenCalled();
			} finally { spy.mockRestore(); }
		});

		it('renders only the next consolidated output before each plain write', async () => {
			const events: string[] = [];
			const spies = Object.values(CONSOLIDATED_FORMATS).map((format) => {
				const render = format.render;
				return vi.spyOn(format, 'render').mockImplementation((...args) => { events.push('render ' + format.label); return render(...args); });
			});
			try {
				const { gateway } = fakeGateway(manyFiles.slice(0, 1));
				gateway.writeFile = async (path) => { events.push('write ' + path); };
				await runExports(gateway, DEFAULT_SETTINGS, ['all'], () => {});
				expect(events).toEqual([
					'render NotebookLM', 'write Vault export - NotebookLM.txt',
					'render HTML', 'write Vault export.html',
					'render Markdown', 'write Vault export.md',
					'write Vault export - split/A.txt',
				]);
			} finally { for (const spy of spies) spy.mockRestore(); }
		});
		it('writes every selected plain file before the ZIP', async () => {
			const events: string[] = [];
			const { gateway } = fakeGateway(manyFiles.slice(0, 1));
			gateway.writeFile = async (path) => { events.push(path); };
			gateway.writeBinary = async (path) => { events.push(path); };
			const result = await runExports(gateway, DEFAULT_SETTINGS, ['zip', 'all'], () => {});
			expect(events).toEqual(['Vault export - NotebookLM.txt', 'Vault export.html', 'Vault export.md', 'Vault export - split/A.txt', 'Vault export.zip']);
			expect(result.written.map((file) => file.path)).toEqual(events);
		});
		it('reports no ZIP or completed file if the first plain write fails', async () => {
			const { gateway, writtenBinary } = fakeGateway(manyFiles.slice(0, 1));
			gateway.writeFile = async () => { throw new Error('plain disk full'); };
			const error: unknown = await runExports(gateway, DEFAULT_SETTINGS, ['zip', 'markdown'], () => {}).catch((failure: unknown) => failure);
			expect(error).toMatchObject({ name: 'ExportFailedError', failedPath: 'Vault export.md', partialResult: { written: [], totalBytes: 0 } });
			expect(writtenBinary.size).toBe(0);
		});
		it('retains completed outputs if a later lazy formatter fails (VE-013 compressed records)', async () => {
			const cause = new Error('formatter failed');
			const spy = vi.spyOn(CONSOLIDATED_FORMATS.html, 'render').mockImplementation(() => { throw cause; });
			try {
				const { gateway, written } = fakeGateway(manyFiles.slice(0, 1));
				const error: unknown = await runExports(gateway, DEFAULT_SETTINGS, ['all'], () => {}).catch((failure: unknown) => failure);
				const completed = [...written].map(([path, content]) => ({ path, bytes: new TextEncoder().encode(content).length }));
				expect(completed.map((file) => file.path)).toEqual(['Vault export - NotebookLM.txt']);
				expect(error).toMatchObject({ name: 'ExportFailedError', failedPath: 'Vault export.html', cause, partialResult: { written: completed, totalBytes: completed.reduce((sum, file) => sum + file.bytes, 0) } });
			} finally { spy.mockRestore(); }
		});

		it('retains exact completed files if deferred ZIP construction fails', async () => {
			const cause = new Error('compressor failed');
			const spy = vi.spyOn(zipModule, 'buildPreparedZip').mockImplementation(() => { throw cause; });
			try {
				const { gateway, written, writtenBinary } = fakeGateway(manyFiles.slice(0, 1));
				const error: unknown = await runExports(gateway, DEFAULT_SETTINGS, ['markdown', 'zip'], () => {}).catch((failure: unknown) => failure);
				const completed = [...written].map(([path, content]) => ({ path, bytes: new TextEncoder().encode(content).length }));
				expect(completed.map((file) => file.path)).toEqual(['Vault export.md']);
				expect(error).toMatchObject({ name: 'ExportFailedError', failedPath: 'Vault export.zip', cause, partialResult: { written: completed, totalBytes: completed.reduce((sum, file) => sum + file.bytes, 0) } });
				expect(writtenBinary.size).toBe(0);
			} finally { spy.mockRestore(); }
		});
		it('keeps pre-write ZIP construction failures bare', async () => {
			const cause = new Error('entry generator failed');
			const spy = vi.spyOn(zipModule, 'buildPreparedZip').mockImplementation(() => { throw cause; });
			try {
				const { gateway, written, writtenBinary } = fakeGateway(manyFiles.slice(0, 1));
				const error: unknown = await runExports(gateway, DEFAULT_SETTINGS, ['zip'], () => {}).catch((failure: unknown) => failure);
				expect(error).toBe(cause);
				expect(written.size + writtenBinary.size).toBe(0);
			} finally { spy.mockRestore(); }
		});
		it('rejects predictable ZIP-name conflicts before writing any file', async () => {
			const { gateway, written, writtenBinary } = fakeGateway(manyFiles.slice(0, 1));
			await expect(runExports(gateway, { ...DEFAULT_SETTINGS, notebooklmOutputPath: '/a/shared/export.txt', markdownOutputPath: '/b/shared/export.txt' }, ['all', 'zip'], () => {})).rejects.toThrow('ZIP entry name conflict: shared/export.txt.');
			expect(written.size + writtenBinary.size).toBe(0);
		});
	});

	it('rejects an empty target list', async () => {
		const { gateway } = fakeGateway(manyFiles);
		await expect(runExports(gateway, DEFAULT_SETTINGS, [], () => {})).rejects.toThrow('Select at least one');
	});

	it('fails explicitly when no file matches', async () => {
		const { gateway } = fakeGateway([]);
		await expect(runExports(gateway, DEFAULT_SETTINGS, ['all'], () => {})).rejects.toThrow('No files matched');
	});

	it('reports bytes written and duration', async () => {
		const { gateway } = fakeGateway(manyFiles);
		const result = await runExports(gateway, DEFAULT_SETTINGS, ['markdown'], () => {});
		expect(result.written[0]!.bytes).toBeGreaterThan(1000);
		expect(result.totalBytes).toBe(result.written[0]!.bytes);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it('single-note export (onlyFile) writes only that note', async () => {
		const files: VaultFile[] = [
			{ path: 'A/one.md', name: 'one.md', content: 'one body' },
			{ path: 'B/two.md', name: 'two.md', content: 'two body' },
		];
		const written = new Map<string, string>();
		const gateway: ExportGateway = {
			// same inclusion logic as the real gateway
			loadVaultFiles: async (s) => files.filter((f) => isFileIncluded(f.path, {
				scopeRoot: s.scopeRoot,
				excludedFolders: s.excludedFolders,
				excludedFiles: s.excludedFiles,
				excludedPrefixes: s.excludedPrefixes,
				includeCanvas: s.includeCanvas,
				reservedPaths: reservedOutputPaths(s),
				onlyPath: s.onlyFile,
			})),
			writeFile: async (p, c) => { written.set(p, c); },
			writeBinary: async () => {},
		};
		const result = await runExports(
			gateway,
			{ ...DEFAULT_SETTINGS, onlyFile: 'A/one.md', markdownOutputPath: 'A/one (clean export).md' },
			['markdown'],
			() => {}
		);
		expect([...written.keys()]).toEqual(['A/one (clean export).md']);
		expect(written.get('A/one (clean export).md')).toContain('one body');
		expect(written.get('A/one (clean export).md')).not.toContain('two body');
		expect(result.written).toHaveLength(1);
	});
});

/* ---------------- History ---------------- */

describe('export history', () => {
	const entry = (id: string, outcome: ExportHistoryEntry['outcome'] = 'success'): ExportHistoryEntry => ({
		id,
		label: 'All exports',
		startedAt: Number(id),
		durationMs: 123,
		outcome,
		files: [{ path: 'Vault export.md', bytes: 100 }],
	});

	it('sanitizes unknown persisted data', () => {
		expect(sanitizeHistory(undefined)).toEqual([]);
		expect(sanitizeHistory('nope')).toEqual([]);
		expect(sanitizeHistory([{ id: '1', label: 'x', startedAt: 1, durationMs: 1, outcome: 'success', files: [{ path: 'a', bytes: 1 }] }])).toHaveLength(1);
		// invalid entries dropped
		expect(sanitizeHistory([{ id: 1, label: 'x' }, { id: '2' }])).toEqual([]);
	});

	describe('bounded persistence (VE-017)', () => {
		const many = (count: number) => Array.from({ length: count }, (_, i) => ({ path: 'Exports/Notes/N' + i + '.md', bytes: 1024 }));
		it('samples pushed files without changing the original full result or totals', () => {
			const files = many(10000);
			const result = pushHistory([], { ...entry('1'), files })[0];
			expect(result?.fileCount).toBe(10000);
			expect(result?.totalBytes).toBe(10240000);
			expect(result?.files).toEqual(files.slice(0, 20));
			expect(files).toHaveLength(10000);
		});
		it('migrates a legacy one-file entry with the same display/reveal information', () => {
			const result = sanitizeHistory([entry('1')])[0];
			expect(result).toMatchObject({ fileCount: 1, totalBytes: 100, files: [{ path: 'Vault export.md', bytes: 100 }] });
		});
		it('counts a giant legacy list before retaining only twenty samples', () => {
			const result = sanitizeHistory([{ ...entry('1'), files: many(10000) }])[0];
			expect(result?.fileCount).toBe(10000);
			expect(result?.totalBytes).toBe(10240000);
			expect(result?.files).toHaveLength(20);
			expect(result?.files[0]?.path).toBe('Exports/Notes/N0.md');
		});
		it('retains exact summary totals across serialization, load and another push', () => {
			const history = pushHistory([], { ...entry('1'), files: many(10000) });
			const loaded = sanitizeHistory(JSON.parse(JSON.stringify(history)));
			const result = pushHistory([], loaded[0]!)[0];
			expect(result?.fileCount).toBe(10000);
			expect(result?.totalBytes).toBe(10240000);
			expect(result?.files).toHaveLength(20);
		});
		it('falls back to known file totals for malformed summary fields', () => {
			const result = sanitizeHistory([{ ...entry('1'), fileCount: -4, totalBytes: NaN }])[0];
			expect(result).toMatchObject({ fileCount: 1, totalBytes: 100 });
		});
		it('keeps five 32k-file exports below 200 kB in plugin data', () => {
			let history: ExportHistoryEntry[] = [];
			for (let i = 0; i < 5; i++) history = pushHistory(history, { ...entry(String(i)), files: many(32000) });
			expect(Buffer.byteLength(JSON.stringify({ settings: DEFAULT_SETTINGS, history }), 'utf8')).toBeLessThan(200000);
			expect(history.map((item) => item.fileCount)).toEqual([32000, 32000, 32000, 32000, 32000]);
		});
	});

	it('caps history at the limit, newest first', () => {
		let h: ExportHistoryEntry[] = [];
		for (let i = 1; i <= 8; i++) h = pushHistory(h, entry(String(i)));
		expect(h).toHaveLength(5);
		expect(h[0]!.id).toBe('8');
	});

	it('formats bytes, totals and relative time', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(2048)).toBe('2.0 KB');
		expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
		expect(formatDuration(0)).toBe('0s');
		expect(formatDuration(999)).toBe('<1s');
		expect(formatDuration(12_000)).toBe('12s');
		expect(formatDuration(65_000)).toBe('1m 5s');
		expect(formatDuration(3_720_000)).toBe('1h 2m');
		expect(formatDuration(-1000)).toBe('0s');
		expect(totalBytes([{ bytes: 100 }, { bytes: 200 }])).toBe(300);
		const now = Date.now();
		expect(relativeTime(now - 5000, now)).toBe('just now');
		expect(relativeTime(now - 5 * 60000, now)).toBe('5 min ago');
		expect(relativeTime(now - 3 * 3600 * 1000, now)).toBe('3 h ago');
		expect(relativeTime(now - 26 * 3600 * 1000, now)).toBe('yesterday');
	});
});

describe('custom extensions in split & full export pipeline', () => {
	it('applies custom extensions across assignGroupFileNames, previewSplitFiles, and planSplitFiles', () => {
		const nested = assignGroupFileNames(['Projects.mdx/Backend'], 'nested', '.mdx');
		expect(nested.get('Projects.mdx/Backend')).toBe('Projects_mdx/Backend.mdx');

		const previewGrouped = previewSplitFiles(
			{ ...DEFAULT_SETTINGS, splitOutputFolder: 'Out', outputExtension: '.mdx' },
			['Projects/Web', 'Notes']
		);
		expect(previewGrouped.every((p) => p.endsWith('.mdx'))).toBe(true);

		const previewIndividual = previewSplitFiles(
			{ ...DEFAULT_SETTINGS, splitMode: 'individual-files', splitFileExtension: '.org' }
		);
		expect(previewIndividual.every((p) => p.endsWith('.org'))).toBe(true);

		const individualPlans = planSplitFiles(
			[
				{
					title: 'Alpha',
					path: 'Projects/Alpha.md',
					metadata: defaultFileMetadata(),
					body: 'Body A',
					rawFrontmatter: '',
					isCanvas: false,
				},
				{
					title: 'Board',
					path: 'Projects/Board.canvas',
					metadata: defaultFileMetadata(),
					body: 'Canvas body',
					rawFrontmatter: '',
					isCanvas: true,
				},
			],
			{ ...DEFAULT_SETTINGS, splitMode: 'individual-files', splitFileExtension: '.mdx' }
		);
		expect(individualPlans.map((p) => p.path)).toEqual([
			'Vault export - split/Projects/Alpha.mdx',
			'Vault export - split/Projects/Board.mdx',
		]);
	});

	it('writes consolidated files, split files, and ZIP archive entries using custom extensions', async () => {
		const writtenText = new Map<string, string>();
		const writtenBinary = new Map<string, Uint8Array>();
		const gateway: ExportGateway = {
			loadVaultFiles: async () => [
				{ path: 'Projects/Alpha.md', name: 'Alpha.md', content: '# Alpha\nHello world' },
				{ path: 'Notes/Beta.md', name: 'Beta.md', content: '# Beta\nSecond note' },
			],
			writeFile: async (p, c) => { writtenText.set(p, c); },
			writeBinary: async (p, c) => { writtenBinary.set(p, c); },
		};

		await runExports(
			gateway,
			{
				...DEFAULT_SETTINGS,
				outputExtension: '.mdx',
				splitFileExtension: '.org',
			},
			['all', 'zip'],
			() => {}
		);

		expect([...writtenText.keys()].sort()).toEqual([
			'Vault export - HTML.mdx',
			'Vault export - NotebookLM.mdx',
			'Vault export - split/Notes.org',
			'Vault export - split/Projects.org',
			'Vault export.mdx',
		]);

		const zipBytes = writtenBinary.get('Vault export.zip');
		expect(zipBytes).toBeDefined();
		const rawZip = Buffer.from(zipBytes!);
		expect(rawZip.includes(Buffer.from('Vault export.mdx'))).toBe(true);
		expect(rawZip.includes(Buffer.from('Vault export - HTML.mdx'))).toBe(true);
		expect(rawZip.includes(Buffer.from('Vault export - NotebookLM.mdx'))).toBe(true);
		expect(rawZip.includes(Buffer.from('Vault export - split/Projects.org'))).toBe(true);
	});
});

