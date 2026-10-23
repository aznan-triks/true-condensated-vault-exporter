/**
 * Deep setting value comparison and path access helpers.
 * Pure TypeScript — no Obsidian imports allowed.
 */

/** Deep equality for setting values (scalars, arrays, plain objects; key order ignored). */
export function sameSettingValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, index) => sameSettingValue(item, b[index]));
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	return keys.length === Object.keys(right).length && keys.every((key) => key in right && sameSettingValue(left[key], right[key]));
}

/** Reads `path` ("a.b") from a settings object; returns `undefined` when a step is missing. */
export function settingAt(settings: unknown, path: string): unknown {
	return path.split('.').reduce<unknown>(
		(value, step) => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[step] : undefined),
		settings
	);
}

/** Writes `value` at `path` ("a.b") in place, creating missing plain objects as needed. */
export function setSettingAt(settings: Record<string, unknown>, path: string, value: unknown): void {
	const steps = path.split('.');
	const last = steps.pop();
	if (!last) return;
	const parent = steps.reduce<Record<string, unknown>>((object, step) => {
		const next = object[step];
		if (typeof next !== 'object' || next === null) {
			const fresh: Record<string, unknown> = {};
			object[step] = fresh;
			return fresh;
		}
		return next as Record<string, unknown>;
	}, settings);
	parent[last] = value;
}
