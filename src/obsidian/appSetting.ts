/**
 * Access to Obsidian internal APIs that exist at runtime but are missing from
 * the published `obsidian` type definitions. Every cast lives in this file so
 * the rest of the codebase stays typed.
 *
 * Note: the module does *not* export a `Shell` helper. OS-level integration
 * goes through Electron in `vaultGateway.ts` instead.
 */

import { App } from 'obsidian';

/** Shape of the app-level settings modal (`app.setting`). */
export interface AppSettingsView {
	open(): void;
	/** Opens the tab with the given id (a plugin's tab id is its plugin id). */
	openTabById?(id: string): void;
	/** Registered tabs; typed structurally because older typings omit `id`. */
	tabs?: { id?: string }[];
}

export function getAppSettings(app: App): AppSettingsView | null {
	const setting = (app as unknown as { setting?: AppSettingsView }).setting;
	return setting ?? null;
}

/**
 * Opens the app settings modal, on the given tab when the internal
 * `openTabById` API is available. Never throws: a failed settings shortcut
 * must not break the sidebar button that triggered it.
 */
export function openSettingsTab(app: App, tabId: string): void {
	const setting = getAppSettings(app);
	if (!setting || typeof setting.open !== 'function') {
		console.warn('[vault-exporter] The app settings modal is not available.');
		return;
	}
	try {
		setting.open();
	} catch (error: unknown) {
		console.warn('[vault-exporter] Could not open app settings:', error);
		return;
	}
	if (typeof setting.openTabById === 'function' && Array.isArray(setting.tabs)
		&& setting.tabs.some((tab) => tab?.id === tabId)) {
		try {
			setting.openTabById(tabId);
		} catch (error: unknown) {
			// Falling back to the settings root is fine; the tab may not be
			// registered yet on very old versions.
			console.warn('[vault-exporter] Could not open the settings tab "' + tabId + '":', error);
		}
	}
}
