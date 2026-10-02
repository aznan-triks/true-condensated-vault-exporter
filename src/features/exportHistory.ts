/**
 * Export history: last N export runs, persisted with plugin data.
 * Pure TypeScript — no Obsidian imports allowed.
 */

export interface ExportHistoryEntry {
	id: string;
	/** Command label, e.g. 'Export everything as ZIP bundle' */
	label: string;
	startedAt: number;
	durationMs: number;
	outcome: 'success' | 'cancelled' | 'error';
	files: { path: string; bytes: number }[];
}

export const HISTORY_LIMIT = 5;

/** Coerces unknown persisted data into a valid history list (max HISTORY_LIMIT entries). */
export function sanitizeHistory(loaded: unknown): ExportHistoryEntry[] {
	if (!Array.isArray(loaded)) return [];
	const out: ExportHistoryEntry[] = [];
	for (const raw of loaded) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		if (typeof r.id !== 'string' || typeof r.label !== 'string') continue;
		const files: { path: string; bytes: number }[] = [];
		if (Array.isArray(r.files)) {
			for (const f of r.files) {
				if (f && typeof f === 'object') {
					const fr = f as Record<string, unknown>;
					if (typeof fr.path === 'string') {
						files.push({ path: fr.path, bytes: typeof fr.bytes === 'number' ? fr.bytes : 0 });
					}
				}
			}
		}
		out.push({
			id: r.id,
			label: r.label,
			startedAt: typeof r.startedAt === 'number' ? r.startedAt : Date.now(),
			durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
			outcome: r.outcome === 'cancelled' || r.outcome === 'error' ? r.outcome : 'success',
			files,
		});
		if (out.length >= HISTORY_LIMIT) break;
	}
	return out;
}

/** Prepends a new entry, keeping at most HISTORY_LIMIT (newest first). */
export function pushHistory(history: ExportHistoryEntry[], entry: ExportHistoryEntry): ExportHistoryEntry[] {
	return [entry, ...history].slice(0, HISTORY_LIMIT);
}

export function formatBytes(n: number): string {
	if (n < 1024) return n + ' B';
	if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
	return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

export function totalBytes(files: { bytes: number }[]): number {
	return files.reduce((sum, f) => sum + f.bytes, 0);
}

/** Human-friendly relative time (e.g. 'just now', '3 min ago', 'yesterday'). */
export function relativeTime(ts: number, now: number = Date.now()): string {
	const diff = Math.max(0, now - ts);
	const min = Math.floor(diff / 60000);
	if (min < 1) return 'just now';
	if (min < 60) return min + ' min ago';
	const hours = Math.floor(min / 60);
	if (hours < 24) return hours + ' h ago';
	const days = Math.floor(hours / 24);
	if (days === 1) return 'yesterday';
	if (days < 7) return days + ' days ago';
	return new Date(ts).toLocaleDateString();
}
