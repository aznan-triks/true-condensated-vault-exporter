// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
	AppSettingsView,
	openSettingsTab,
	SETTINGS_TAB_MAX_ATTEMPTS,
	SETTINGS_TAB_RETRY_DELAY_MS,
	withSettingsTabId,
} from '../src/obsidian/appSetting';

/**
 * The settings shortcut must land on the plugin's own tab. The previous
 * implementation only called `app.setting.openTabById` when `app.setting.tabs`
 * happened to list a tab whose `id` matched, so on real Obsidian the modal
 * opened on whatever tab was active before.
 */

function fakeApp(setting: AppSettingsView | null) {
	return { setting } as never;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('openSettingsTab', () => {
	it('opens the modal and selects the plugin tab even when app.setting.tabs does not list it', () => {
		const calls: string[] = [];
		const tabId = 'vault-exporter';
		openSettingsTab(fakeApp({
			tabs: [],
			open() { calls.push('open'); },
			openTabById(id) { calls.push('tab:' + id); },
		}), tabId);
		expect(calls).toEqual(['open', 'tab:' + tabId]);
	});

	it('waits for an asynchronous open() before selecting the tab', async () => {
		const calls: string[] = [];
		const tabId = 'vault-exporter';
		openSettingsTab(fakeApp({
			open: () => new Promise<void>((resolve) => { setTimeout(() => { calls.push('open'); resolve(); }, 10); }),
			openTabById(id) { calls.push('tab:' + id); },
		}), tabId);
		expect(calls).toEqual([]);
		await wait(30);
		expect(calls).toEqual(['open', 'tab:' + tabId]);
	});

	it('retries while the plugin tab is not active and stops once it is', async () => {
		let activeTab = 'general';
		const attemptAt = new Map<string, number>();
		const tab = { containerEl: document.createElement('div') };
		openSettingsTab(fakeApp({
			get activeTab() { return activeTab; },
			open() {},
			openTabById(id) {
				const attempt = (attemptAt.get(id) ?? 0) + 1;
				attemptAt.set(id, attempt);
				// Obsidian ignores the first call when it races the modal render.
				if (attempt >= 2) {
					activeTab = id;
					document.body.appendChild(tab.containerEl);
				}
			},
		}), 'vault-exporter', tab);
		await wait(SETTINGS_TAB_RETRY_DELAY_MS * 4);
		expect(attemptAt.get('vault-exporter')).toBe(2);
	});

	it('gives up after a bounded number of attempts', async () => {
		let calls = 0;
		openSettingsTab(fakeApp({
			activeTab: 'general',
			open() {},
			openTabById() { calls++; },
		}), 'vault-exporter');
		await wait(SETTINGS_TAB_RETRY_DELAY_MS * (SETTINGS_TAB_MAX_ATTEMPTS + 3));
		expect(calls).toBe(SETTINGS_TAB_MAX_ATTEMPTS);
	});

	it('opens the modal but warns when this app version cannot select a tab', () => {
		const open = vi.fn();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		openSettingsTab(fakeApp({ open }), 'vault-exporter');
		expect(open).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('degrades without throwing when the settings modal is unavailable', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(() => openSettingsTab(fakeApp(null), 'vault-exporter')).not.toThrow();
		expect(() => openSettingsTab(fakeApp({ open: undefined as never }), 'vault-exporter')).not.toThrow();
		expect(warn).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});

	it('survives a host that throws while opening settings', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(() => openSettingsTab(fakeApp({
			open() { throw new Error('boom'); },
			openTabById() {},
		}), 'vault-exporter')).not.toThrow();
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe('withSettingsTabId', () => {
	it('assigns the plugin id so openTabById can resolve the tab', () => {
		const tab = {} as { id?: string };
		expect(withSettingsTabId(tab, 'vault-exporter')).toBe(tab);
		expect(tab.id).toBe('vault-exporter');
	});

	it('never overwrites an id assigned by the host', () => {
		const tab = { id: 'host-assigned' };
		withSettingsTabId(tab, 'vault-exporter');
		expect(tab.id).toBe('host-assigned');
	});
});
