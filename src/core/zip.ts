/**
 * Minimal ZIP archive writer (no external dependency).
 * Uses node's zlib (externalized at bundle time, available in Obsidian's
 * Electron runtime and in tests). Entries smaller than a threshold, or
 * where deflate would expand the data, are stored uncompressed.
 */

import { deflateRawSync } from 'zlib';

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
	if (CRC_TABLE) return CRC_TABLE;
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	CRC_TABLE = table;
	return table;
}

/** CRC-32 (IEEE 802.3) as used by the ZIP format. */
export function crc32(data: Uint8Array): number {
	const table = crcTable();
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc = (crc >>> 8) ^ table[(crc ^ data[i]!) & 0xff]!;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
	/** Entry path inside the archive (forward slashes) */
	name: string;
	/** UTF-8 encoded content */
	data: Uint8Array;
}

function dosDateTime(date: Date): { time: number; date: number } {
	const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
	const year = Math.min(2107, Math.max(1980, date.getFullYear()));
	const dateVal = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
	return { time, date: dateVal };
}

function u16(n: number): Uint8Array {
	return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}

function u32(n: number): Uint8Array {
	return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

const STORE_THRESHOLD = 256;
const MAX_ZIP32_VALUE = 0xffffffff;

/** Builds a complete ZIP archive (local headers + central directory + EOCD). */
export function buildZip(entries: ZipEntry[], modifiedAt: Date = new Date()): Uint8Array {
	if (entries.length > 0xffff) throw new Error('This ZIP writer does not support more than 65,535 entries.');
	const { time, date } = dosDateTime(modifiedAt);
	const encoder = new TextEncoder();

	const localParts: Uint8Array[] = [];
	const centralParts: Uint8Array[] = [];
	const names = new Set<string>();
	let localOffset = 0;

	for (const entry of entries) {
		const safeName = entry.name.replace(/\\/g, '/');
		if (!safeName || safeName.startsWith('/') || /^[a-z]:\//i.test(safeName) || safeName.split('/').includes('..')) {
			throw new Error('Unsafe ZIP entry path: ' + entry.name);
		}
		if (names.has(safeName)) throw new Error('Duplicate ZIP entry path: ' + safeName);
		names.add(safeName);
		const nameBytes = encoder.encode(safeName);
		if (nameBytes.length > 0xffff) throw new Error('ZIP entry name is too long: ' + safeName);
		const raw = entry.data;
		if (raw.length > MAX_ZIP32_VALUE) throw new Error('ZIP entry is too large for ZIP32: ' + safeName);
		const crc = crc32(raw);

		let compressed: Uint8Array;
		let method: number;
		if (raw.length > STORE_THRESHOLD) {
			const deflated = new Uint8Array(deflateRawSync(Buffer.from(raw), { level: 6 } as object));
			method = deflated.length < raw.length ? 8 : 0;
			compressed = method === 8 ? deflated : raw;
		} else {
			method = 0;
			compressed = raw;
		}
		if (compressed.length > MAX_ZIP32_VALUE) throw new Error('Compressed ZIP entry is too large for ZIP32: ' + safeName);

		const local = concat([
			u32(0x04034b50),
			u16(20), // version needed
			u16(0x0800), // flags: UTF-8 name
			u16(method),
			u16(time),
			u16(date),
			u32(crc),
			u32(compressed.length),
			u32(raw.length),
			u16(nameBytes.length),
			u16(0), // extra length
			nameBytes,
			compressed,
		]);

		centralParts.push(concat([
			u32(0x02014b50),
			u16(20), // version made by
			u16(20), // version needed
			u16(0x0800),
			u16(method),
			u16(time),
			u16(date),
			u32(crc),
			u32(compressed.length),
			u32(raw.length),
			u16(nameBytes.length),
			u16(0), // extra
			u16(0), // comment
			u16(0), // disk
			u16(0), // internal attrs
			u32(0), // external attrs
			u32(localOffset),
			nameBytes, // name follows the fixed 46-byte header
		]));

		localParts.push(local);
		localOffset += local.length;
		if (localOffset > MAX_ZIP32_VALUE) throw new Error('ZIP archive exceeds the ZIP32 size limit.');
	}

	const centralDir = concat(centralParts);
	if (centralDir.length > MAX_ZIP32_VALUE) throw new Error('ZIP central directory exceeds the ZIP32 size limit.');
	const eocd = concat([
		u32(0x06054b50),
		u16(0),
		u16(0),
		u16(entries.length),
		u16(entries.length),
		u32(centralDir.length),
		u32(localOffset),
		u16(0),
	]);

	return concat([...localParts, centralDir, eocd]);
}

/**
 * Maps a configured output path to a sensible archive entry name.
 * Vault-relative paths keep their structure; absolute paths are reduced
 * to "<last folder>/<file>" so the bundle stays portable.
 */
export function zipEntryName(targetPath: string): string {
	const normalized = targetPath.trim().replace(/\\/g, '/');
	const absolute = normalized.startsWith('/') || /^[a-z]:\//i.test(normalized);
	const parts: string[] = [];
	for (const part of normalized.split('/')) {
		if (!part || part === '.' || /^[a-z]:$/i.test(part)) continue;
		if (part === '..') {
			if (parts.length === 0) {
				if (!absolute) throw new Error('ZIP entry path cannot escape the archive root: ' + targetPath);
			} else {
				parts.pop();
			}
			continue;
		}
		parts.push(part);
	}

	if (absolute) {
		const file = parts[parts.length - 1] ?? 'export.txt';
		const root = parts.length > 1 ? parts[parts.length - 2]! : 'export';
		return root + '/' + file;
	}
	return parts.join('/') || 'export.txt';
}
