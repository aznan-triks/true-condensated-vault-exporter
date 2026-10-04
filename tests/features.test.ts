import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'zlib';
import { crc32, buildZip, zipEntryName } from '../src/core/zip';
import { runExports, ExportCancelledError } from '../src/features/exportOrchestrator';
import {
	ExportHistoryEntry,
	sanitizeHistory,
	pushHistory,
	formatBytes,
	formatDuration,
	totalBytes,
	relativeTime,
} from '../src/features/exportHistory';
import { DEFAULT_SETTINGS, ExportGateway, VaultFile } from '../src/core/types';
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
