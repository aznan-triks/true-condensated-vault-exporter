// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelOptions, ProgressPanel } from '../src/ui/ProgressPanel';

const require = createRequire(import.meta.url);
const helpers = require('../tools/mock-obsidian/dom-helpers.cjs') as { install: (host: Window) => void };
helpers.install(window);
const panels: ProgressPanel[] = [];
function panel(options: PanelOptions): ProgressPanel {
	const created = new ProgressPanel(options);
	panels.push(created);
	return created;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
	for (const item of panels.splice(0)) item.destroy();
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe('ProgressPanel lifecycle (VE-014)', () => {
	it('keeps exactly one interval when replacing a live panel', () => {
		const clear = vi.spyOn(window, 'clearInterval');
		panel({ title: 'first' });
		panel({ title: 'second' });
		expect(clear).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);
		expect(document.querySelectorAll('.ve-panel')).toHaveLength(1);
	});

	it('makes every late entry point a no-op after destruction', () => {
		const item = panel({ title: 'first', autoCloseMs: 100 });
		const root = document.querySelector('.ve-panel')!;
		const before = root.innerHTML;
		item.destroy();
		item.update(1, 2, 'late', 'late.md');
		item.log('late log');
		item.finish('success', 'late finish', { onReveal: () => {} });
		item.destroy();
		expect(root.innerHTML).toBe(before);
		expect(document.querySelectorAll('.ve-panel')).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cleans up the current owner even after an older instance is destroyed twice', () => {
		const first = panel({ title: 'first' });
		panel({ title: 'second' });
		first.destroy();
		ProgressPanel.destroyCurrent();
		ProgressPanel.destroyCurrent();
		expect(document.querySelectorAll('.ve-panel')).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('clears an evicted success auto-close timeout without closing its replacement', () => {
		panel({ title: 'first', autoCloseMs: 100 }).finish('success', 'done');
		panel({ title: 'second' });
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(150);
		expect(document.querySelector('.ve-panel__title')?.textContent).toBe('second');
	});

	it.each(['error', 'cancelled'] as const)('keeps %s visible without auto-closing or ticking', (outcome) => {
		panel({ title: 'first', autoCloseMs: 100 }).finish(outcome, 'kept');
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(150);
		expect(document.querySelectorAll('.ve-panel')).toHaveLength(1);
	});
});
