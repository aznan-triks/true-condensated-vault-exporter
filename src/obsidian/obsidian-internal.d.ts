/**
 * Type augmentations for Obsidian runtime APIs that exist at runtime but
 * are missing from the published d.ts of the installed `obsidian` package.
 * Desktop-only plugin — the OS-level APIs are unavailable on mobile, and
 * every call site guards with Platform.isMobile.
 */

import 'obsidian';

declare module 'obsidian' {
	/** Internal API: OS-level file opening / revealing. */
	export const Shell: {
		/** Opens a file or folder with the default OS application. */
		open(path: string): void;
		/** Reveals a file in the OS file manager (Finder/Explorer). */
		revealInFileExplorer(path: string): void;
	};

	/** Runtime properties of settings tabs (internal API). */
	interface SettingTab {
		/** Tab id (typically the plugin id). */
		id: string;
	}
}
