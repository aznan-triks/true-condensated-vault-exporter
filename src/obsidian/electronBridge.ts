/**
 * Access to Electron modules from Obsidian's renderer.
 *
 * Obsidian does not expose Electron through its typings; the desktop renderer
 * provides it via `window.require`. Everything here degrades to `null`/`false`
 * instead of throwing, so a blocked or missing API never breaks the UI that
 * called it.
 */

export interface ElectronShell {
	showItemInFolder?: (fullPath: string) => void;
	/** Opens a file or folder with the OS default application; '' means success. */
	openPath?: (fullPath: string) => Promise<string>;
}

export interface ElectronDialogResult {
	canceled?: boolean;
	filePaths?: string[];
}

export interface ElectronDialog {
	showOpenDialog?: (options: {
		title?: string;
		defaultPath?: string;
		properties?: string[];
	}) => Promise<ElectronDialogResult>;
}

export interface ElectronModule {
	shell?: ElectronShell;
	dialog?: ElectronDialog;
}

/** Resolves the Electron namespace, or null when it is unavailable. */
export function resolveElectronModule(): ElectronModule | null {
	try {
		const hostWindow = (globalThis as { window?: { require?: (id: string) => unknown } }).window;
		const loader = typeof hostWindow?.require === 'function'
			? hostWindow.require
			: typeof require === 'function' ? require : null;
		if (!loader) return null;
		const electron = loader('electron') as ElectronModule | null;
		return electron ?? null;
	} catch {
		return null;
	}
}

export function resolveElectronShell(): ElectronShell | null {
	return resolveElectronModule()?.shell ?? null;
}

/**
 * Opens the OS folder picker and returns the selected absolute path, or null
 * when the user cancels or the dialog API is unavailable.
 */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
	const dialog = resolveElectronModule()?.dialog;
	if (typeof dialog?.showOpenDialog !== 'function') {
		console.warn('[vault-exporter] No Electron folder picker is available in this runtime.');
		return null;
	}
	try {
		const result = await dialog.showOpenDialog({
			title: 'Select the export folder',
			properties: ['openDirectory', 'createDirectory'],
			...(defaultPath && defaultPath.trim() ? { defaultPath } : {}),
		});
		if (result?.canceled) return null;
		const picked = result?.filePaths?.[0];
		return typeof picked === 'string' && picked.trim().length > 0 ? picked : null;
	} catch (error: unknown) {
		console.warn('[vault-exporter] Could not open the folder picker:', error);
		return null;
	}
}

/** Opens a folder in the OS file manager; false when the API is unavailable. */
export async function openFolder(folderPath: string): Promise<boolean> {
	const shell = resolveElectronShell();
	if (typeof shell?.openPath !== 'function') {
		console.warn('[vault-exporter] Cannot open "' + folderPath + '": no Electron shell available in this runtime.');
		return false;
	}
	try {
		const message = await shell.openPath(folderPath);
		return !message;
	} catch (error: unknown) {
		console.warn('[vault-exporter] Could not open ' + folderPath + ':', error);
		return false;
	}
}
