/**
 * Access to the app-level settings UI (internal Obsidian API, untyped in
 * the published d.ts). Kept in one place so the cast lives in one spot.
 */

import { App, PluginSettingTab } from 'obsidian';

export interface AppSettingsView {
	open(): void;
	openTabById(id: string): void;
	tabs: PluginSettingTab[];
}

export function getAppSettings(app: App): AppSettingsView {
	return (app as unknown as { setting: AppSettingsView }).setting;
}

/** Opens the app settings directly on the given tab id (falls back to opening settings). */
export function openSettingsTab(app: App, tabId: string): void {
	const setting = getAppSettings(app);
	setting.open();
	const tab = setting.tabs.find((t) => t.id === tabId);
	if (tab) {
		setting.openTabById(tab.id);
	}
}
