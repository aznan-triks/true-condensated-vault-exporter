// Node runner resolves the type-only Obsidian package; jsdom is installed manually.
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, ExporterSettings } from '../src/core/types';
import { VaultExporterSettingsTab } from '../src/settings/SettingsTab';
import VaultExporterPlugin from '../src/main';

vi.mock('obsidian', async () => {
	const { createRequire } = await import('node:module');
	return createRequire(import.meta.url)('../tools/mock-obsidian/obsidian-mock.cjs') as Record<string, unknown>;
});
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis } };
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'app://obsidian.md' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Event'] as const) vi.stubGlobal(key, dom.window[key]);
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
const helpers = require('../tools/mock-obsidian/dom-helpers.cjs') as { install: (host: Window) => void };
helpers.install(window);
const tabs: VaultExporterSettingsTab[] = [];
const gateway = { getAllFolders: () => [], getAllFiles: () => [], getAllFrontmatterKeys: () => [] };

function fixture() {
	const settings = structuredClone(DEFAULT_SETTINGS);
	const writes: ExporterSettings[] = [];
	const saveSettings = vi.fn(async () => { writes.push(structuredClone(settings)); });
	const plugin = { settings, gateway, saveSettings };
	const tab = new VaultExporterSettingsTab({} as never, plugin as never);
	tabs.push(tab);
	tab.display();
	return { plugin, tab, writes, saveSettings };
}
function field(tab: VaultExporterSettingsTab, label: string): HTMLInputElement | HTMLTextAreaElement {
	const row = Array.from(tab.containerEl.querySelectorAll('.setting-item')).find((el) => el.querySelector('.setting-item-name')?.textContent === label);
	const input = row?.querySelector('input[type="text"], textarea');
	if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) throw new Error('Missing text control: ' + label);
	return input;
}
function type(tab: VaultExporterSettingsTab, label: string, value: string): void {
	const input = field(tab, label);
	input.value = value;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}
function realPlugin() {
	const app = { workspace: { getLeavesOfType: () => [] } };
	const plugin = new VaultExporterPlugin(app as never, { id: 'vault-exporter' } as never);
	plugin.settings = structuredClone(DEFAULT_SETTINGS);
	return plugin;
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
	for (const tab of tabs.splice(0)) tab.hide();
	await vi.runOnlyPendingTimersAsync();
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe('settings persistence (VE-017)', () => {
	it.each([
		['Document Title', 'documentTitle'], ['Scope Root', 'scopeRoot'], ['Scope Tag', 'scopeTag'],
		['External Folder', 'externalOutputFolder'], ['NotebookLM Consolidated Output', 'notebooklmOutputPath'],
		['HTML Consolidated Output', 'htmlOutputPath'], ['Markdown Consolidated Output', 'markdownOutputPath'],
		['ZIP Bundle Output', 'zipOutputPath'], ['Split Group Folder', 'splitGroupFolder'],
		['Split Files Destination Folder', 'splitOutputFolder'], ['HTML Footer Attribution', 'htmlFooterText'],
		['Custom HTML CSS', 'customCss'], ['Yield Every N Notes', 'yieldEvery'],
	] as const)('coalesces ten changes to %s while updating live settings immediately', async (label, key) => {
		const { plugin, tab, writes, saveSettings } = fixture();
		for (let i = 1; i <= 10; i++) type(tab, label, '1234567890'.slice(0, i));
		const expected = key === 'yieldEvery' ? 1234567890 : '1234567890';
		expect(plugin.settings[key]).toBe(expected);
		expect(saveSettings).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(299);
		expect(writes).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(writes[0]?.[key]).toBe(expected);
	});
	it('shares one trailing timer across text controls', async () => {
		const { tab, writes } = fixture();
		type(tab, 'Document Title', 'first');
		await vi.advanceTimersByTimeAsync(250);
		type(tab, 'Scope Root', 'last');
		await vi.advanceTimersByTimeAsync(299);
		expect(writes).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({ documentTitle: 'first', scopeRoot: 'last' });
	});
	it('flushes the last text change on hide without a duplicate delayed write', async () => {
		const { tab, writes } = fixture();
		type(tab, 'Document Title', 'last');
		expect(writes).toHaveLength(0);
		tab.hide();
		await Promise.resolve();
		expect(writes).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(500);
		expect(writes).toHaveLength(1);
	});
	it('keeps discrete changes immediate and consumes a pending text timer', async () => {
		const { tab, writes } = fixture();
		type(tab, 'Document Title', 'last');
		const toggle = Array.from(tab.containerEl.querySelectorAll('.setting-item')).find((el) => el.querySelector('.setting-item-name')?.textContent === 'Remember Sidebar Targets')?.querySelector<HTMLInputElement>('input[type="checkbox"]');
		expect(toggle).toBeTruthy();
		if (!toggle) return;
		toggle.checked = false;
		toggle.dispatchEvent(new Event('change', { bubbles: true }));
		await Promise.resolve();
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({ documentTitle: 'last', rememberTargetSelection: false });
		await vi.advanceTimersByTimeAsync(500);
		expect(writes).toHaveLength(1);
	});
	it('reports a debounced save failure and keeps edits available for retry', async () => {
		const { plugin, tab, writes, saveSettings } = fixture();
		const cause = new Error('disk full');
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		saveSettings.mockRejectedValueOnce(cause);
		type(tab, 'Document Title', 'unsaved edit');
		await vi.advanceTimersByTimeAsync(300);
		expect(plugin.settings.documentTitle).toBe('unsaved edit');
		expect(log).toHaveBeenCalledWith('[vault-exporter] Could not save settings:', cause);
		expect(document.querySelector('.notice-message')?.textContent).toContain('Could not save Vault Exporter settings');
		type(tab, 'Document Title', 'retry');
		await vi.advanceTimersByTimeAsync(300);
		expect(writes[0]?.documentTitle).toBe('retry');
	});

	it('serializes immutable snapshots instead of overlapping saves', async () => {
		const plugin = realPlugin();
		let release = (): void => {};
		const blocked = new Promise<void>((resolve) => { release = resolve; });
		const saved: unknown[] = [];
		const save = vi.spyOn(plugin, 'saveData').mockImplementation(async (data: unknown) => {
			saved.push(structuredClone(data));
			if (saved.length === 1) await blocked;
		});
		plugin.settings.documentTitle = 'first';
		const first = plugin.saveSettings();
		plugin.settings.documentTitle = 'second';
		const second = plugin.saveSettings();
		try {
			await Promise.resolve();
			expect(save).toHaveBeenCalledTimes(1);
			expect(saved[0]).toMatchObject({ settings: { documentTitle: 'first' } });
		} finally { release(); await Promise.all([first, second]); }
		expect(saved[1]).toMatchObject({ settings: { documentTitle: 'second' } });
	});
	it('keeps the queue usable after a rejected save without hiding the rejection', async () => {
		const plugin = realPlugin();
		const cause = new Error('disk failure');
		const save = vi.spyOn(plugin, 'saveData').mockRejectedValueOnce(cause).mockResolvedValueOnce(undefined);
		await expect(plugin.saveSettings()).rejects.toBe(cause);
		await plugin.saveSettings();
		expect(save).toHaveBeenCalledTimes(2);
	});
	it('normalizes oversized history before a persisted write', async () => {
		const plugin = realPlugin();
		const save = vi.spyOn(plugin, 'saveData').mockResolvedValue(undefined);
		plugin.setHistory([{ id: '1', label: 'large', startedAt: 1, durationMs: 1, outcome: 'success', files: Array.from({ length: 10000 }, (_, i) => ({ path: 'out/' + i + '.md', bytes: 10 })) }]);
		await Promise.resolve();
		expect(plugin.history[0]?.fileCount).toBe(10000);
		expect(plugin.history[0]?.files).toHaveLength(20);
		expect(Buffer.byteLength(JSON.stringify(save.mock.calls[0]?.[0]), 'utf8')).toBeLessThan(200000);
	});
	it('flushes pending settings on plugin unload', async () => {
		const plugin = realPlugin();
		plugin.gateway = gateway as never;
		const save = vi.spyOn(plugin, 'saveData').mockResolvedValue(undefined);
		const tab = new VaultExporterSettingsTab(plugin.app, plugin);
		tabs.push(tab);
		plugin.settingsTab = tab;
		tab.display();
		type(tab, 'Document Title', 'last before unload');
		expect(save).not.toHaveBeenCalled();
		plugin.onunload();
		await Promise.resolve();
		expect(save).toHaveBeenCalledTimes(1);
		expect(save.mock.calls[0]?.[0]).toMatchObject({ settings: { documentTitle: 'last before unload' } });
		await vi.advanceTimersByTimeAsync(500);
		expect(save).toHaveBeenCalledTimes(1);
	});
});
