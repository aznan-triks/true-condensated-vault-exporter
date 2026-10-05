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
	open(): void | Promise<void>;
	/** Opens the tab with the given id (a plugin's tab id is its plugin id). */
	openTabById?(id: string): void;
	/** Id of the tab currently displayed, when this app version exposes it. */
	activeTab?: unknown;
	/** Registered tabs; typed structurally because older typings omit `id`. */
	tabs?: unknown;
}

/** The plugin's own settings tab instance, used to detect that it became visible. */
export interface SettingsTabHandle {
	containerEl?: HTMLElement;
}

/** Delay between two attempts to activate the plugin's settings tab. */
export const SETTINGS_TAB_RETRY_DELAY_MS = 40;
/** How many times `openTabById` is retried while the plugin tab is not active. */
export const SETTINGS_TAB_MAX_ATTEMPTS = 8;

export function getAppSettings(app: App): AppSettingsView | null {
	const setting = (app as unknown as { setting?: AppSettingsView }).setting;
	return setting ?? null;
}

/**
 * Assigns the plugin id to a settings tab before it is registered.
 *
 * `PluginSettingTab` does not declare an `id` in the public typings, but
 * `app.setting.openTabById(pluginId)` resolves tabs by id internally. Setting
 * it on our own tab instance keeps that lookup working across app versions,
 * and an id already assigned by the host is never overwritten.
 */
export function withSettingsTabId<T extends object>(tab: T, pluginId: string): T {
	const candidate = tab as { id?: unknown };
	if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
		candidate.id = pluginId;
	}
	return tab;
}

function schedule(callback: () => void): void {
	const host = typeof window === 'undefined' ? globalThis : window;
	host.setTimeout(callback, SETTINGS_TAB_RETRY_DELAY_MS);
}

/** Whether the plugin's tab is visibly active; `null` when it cannot be told. */
function isTabActive(setting: AppSettingsView, tabId: string, tab?: SettingsTabHandle): boolean | null {
	if (typeof setting.activeTab === 'string') {
		return setting.activeTab === tabId;
	}
	const container = tab?.containerEl;
	if (container && typeof container.isConnected === 'boolean') {
		return container.isConnected;
	}
	return null;
}

/**
 * Opens the app settings modal, on the given tab when the internal
 * `openTabById` API is available. Never throws: a failed settings shortcut
 * must not break the sidebar button that triggered it.
 *
 * `openTabById` is host-set, internal API. Two problems made the previous
 * version open the settings on the wrong tab: it skipped the call unless
 * `app.setting.tabs` listed a tab whose `id` matched, and several app versions
 * ignore the call until `open()` has rendered. This version calls it straight
 * away, waits for an asynchronous `open()`, and retries while the plugin's tab
 * is demonstrably not active.
 */
export function openSettingsTab(app: App, tabId: string, tab?: SettingsTabHandle): void {
	const setting = getAppSettings(app);
	if (!setting || typeof setting.open !== 'function') {
		console.warn('[vault-exporter] The app settings modal is not available.');
		return;
	}
	if (typeof setting.openTabById !== 'function') {
		try {
			setting.open();
		} catch (error: unknown) {
			console.warn('[vault-exporter] Could not open app settings:', error);
			return;
		}
		console.warn('[vault-exporter] This app version cannot open a settings tab by id.');
		return;
	}

	let finished = false;
	const selectTab = (attempt: number): void => {
		if (finished) return;
		try {
			setting.openTabById?.(tabId);
		} catch (error: unknown) {
			finished = true;
			console.warn('[vault-exporter] Could not open the settings tab "' + tabId + '":', error);
			return;
		}
		const active = isTabActive(setting, tabId, tab);
		const next = attempt + 1;
		// Keep retrying while the plugin tab is demonstrably inactive (a slow
		// render ignoring early calls). When it looks active — or its state
		// cannot be told — confirm once after the modal finished opening.
		if (active === false ? next < SETTINGS_TAB_MAX_ATTEMPTS : attempt === 0) {
			schedule(() => selectTab(next));
			return;
		}
		finished = true;
	};

	let opened: void | Promise<void>;
	try {
		opened = setting.open();
	} catch (error: unknown) {
		console.warn('[vault-exporter] Could not open app settings:', error);
		return;
	}
	if (opened && typeof (opened as PromiseLike<void>).then === 'function') {
		// Some app versions open the modal asynchronously; selecting a tab
		// before it has rendered is ignored.
		void Promise.resolve(opened)
			.then(() => selectTab(0))
			.catch((error: unknown) => {
				console.warn('[vault-exporter] Could not open app settings:', error);
			});
		return;
	}
	selectTab(0);
}
