# Changelog

## [2.1.0] - 2026-10-05

### Added
- **Export to an external folder.** A new *External Output Folder* settings section can redirect every output (all consolidated formats, the ZIP bundle, and split files) into an absolute folder outside the vault, keeping the configured names and subfolders. Vault-relative paths keep their structure; absolute paths keep only their file or folder name, so nothing is ever written outside the selected folder. The native system folder picker chooses the destination, an extra button opens it in the file manager, and the sidebar reports where outputs go. While the option is on without a usable absolute folder, the setting explains that exports still go into the vault.
- **Open Vault Exporter settings** command, so the settings page can be reached from the Command Palette (and assigned a hotkey).
- A blank split destination now means “the output root”: the vault root normally, the external folder while external output is enabled.

### Fixed
- **The sidebar’s Settings button no longer opens Obsidian’s settings on the wrong tab.** The shortcut only called `app.setting.openTabById()` when `app.setting.tabs` happened to list a tab whose `id` matched, and it fired that internal call before an asynchronous `open()` had rendered the modal — several app versions ignore the call in that window. It now assigns the plugin id to its own settings tab, waits for `open()` when it returns a promise, retries briefly while the plugin tab is demonstrably inactive, and opens the modal even when tab selection is unavailable.
- Outputs written back inside the vault are protected from re-export again, even when they come from an absolute path or an external folder that lives under the vault root. Previously only vault-relative output paths were reserved.
- ZIP archives created with an external output folder store entry names relative to that folder instead of embedding its path.

## [2.0.4] - 2026-10-04

### Added
- Grouped and searchable settings, plus standalone HTML personalization for theme, accent color, typography, reading width, optional navigation and metadata, footer attribution, and a live appearance preview.
- Optional memory for the sidebar’s selected targets, with history actions to reveal an output or clear history without deleting exported files.
- Export feedback preferences: keep successful progress panels open or choose an auto-close delay, and optionally reveal the first output automatically after success. Cancelled and failed panels remain visible for review.
- Elapsed-time feedback in the progress panel, completion summary, and export history. The sidebar reports the count and names of selected targets.

### Improved
- Sidebar target selection updates in place, retains keyboard focus, and is announced accessibly. The sidebar and progress panel adapt to narrow and short windows, with larger touch controls.
- Expanded unit and mock-Obsidian smoke coverage for settings persistence, automatic reveal, progress timing, accessible status, and target selection.

## [2.0.3] - 2026-10-04

### Fixed
- **The sidebar could not open in desktop Obsidian.** `ExporterSidebarView` declared a private field named `open`, which replaced Obsidian's internal `View.open()` lifecycle method on every instance. Opening the view therefore failed with `Failed to open view — TypeError: e.open is not a function`, making the ribbon icon, the sidebar, and the sidebar-driven exports unusable. The field is now `isViewOpen`, and the mock-Obsidian smoke test reproduces Obsidian's `view.open()` call so this class of shadowing cannot return unnoticed.
- The **Open folder** shortcut no longer calls a non-existent Obsidian API (`Shell.revealInFileExplorer`), which threw inside the click handler on desktop. It now uses Electron's `shell.showItemInFolder` and logs a single warning when the shell is unavailable.
- Embedded wikilinks (`![[Note]]`) keep their display text instead of being silently deleted from exports; in Markdown mode an embedded note becomes a link (`[Note](Note.md)`) while images, PDFs, and other attachments keep image syntax.
- The project now type-checks against the declared `minAppVersion` (Obsidian 1.7.2 typings) instead of the newest published typings, so APIs newer than the minimum supported app version fail the build. This removed an `override` on `Plugin.settings` and an unchecked access to the internal `app.setting.tabs` shape.

### Added
- A source-level regression test that fails when a view, plugin, or settings-tab class declares an instance field shadowing an Obsidian lifecycle member (`open`, `load`, `display`, …).
- `npm run smoke`: loads the production bundle against a mock Obsidian API in jsdom and a real temporary vault, then verifies plugin load, the workspace view lifecycle, sidebar rendering, the settings tab, every export target, content transformations, cancellation, ZIP integrity, and the reveal shortcut. It runs as the last step of `npm run check`.

## [2.0.2] - 2026-10-04

### Fixed
- Export cancellation now stays responsive during vault reads, and cancelled runs report files already written.
- Read failures are included in the export summary instead of disappearing before the result is built.
- Conflicting, empty, overlapping, or vault-escaping output paths are rejected before any output is written.
- Split exports now handle a blank destination and nested grouping folders correctly.
- Saved settings are type-checked and normalized on load; malformed values fall back to safe defaults.
- Context commands now clear a saved tag filter while exporting the active folder or note, without changing persisted settings.
- Tag-scoped exports exclude Canvas files and normalize body/frontmatter tags consistently.
- Empty and BOM-prefixed frontmatter is parsed correctly. Each Markdown note's frontmatter is parsed once per run.
- Dataview `file.ctime` and `file.day` now use creation time and ISO dates in note names. Unsupported or malformed queries remain visible instead of broadening results.
- HTML exports now block unsafe link schemes, keep custom CSS inside the style element, and generate unique anchors for repeated or non-Latin headings.
- ZIP paths are protected from archive traversal; unsupported ZIP32 size limits now produce a clear error.
- Markdown links resolve explicit file extensions and encode spaces. The sidebar uses real icons and keyboard-accessible target controls, refreshes history immediately, and displays progress logs in the correct order.

### Changed
- All plugin UI, export labels, project documentation, and helper-script messages are in English.
- The README is shorter and includes illustrative UI previews; these are clearly identified as mock-ups, not live Obsidian captures.
- Updated the development-only Moment dependency to a patched version.

## [2.0.1] - 2026-10-02

### Changed
- Removed completed refactoring notes and unused format-label code.
- Replaced dated local-backup ignore rules with the general `_backup_*/` pattern.
- Corrected the documented unit-test count.

## [2.0.0] - 2026-10-02

### Added
- ZIP bundles containing the consolidated formats and split files.
- Multi-target exports, live scope preview, and a five-run export history.
- Context commands for exporting the active note's folder or creating a clean Markdown copy.
- Client-side search, dark/light theming, a two-level table of contents, print styles, and mobile layout in HTML exports.
- Tag scoping, in-memory Dataview rendering, Canvas extraction in visual order, and advanced settings for custom CSS and UI yielding.

### Changed
- Shared frontmatter and link indexes reduce repeated parsing. Vault reads run in batches of eight.
- Read failures are skipped instead of stopping the entire export.
- Export settings and history use a backward-compatible persisted format.

### Fixed
- Prevented exporter outputs from being re-imported on later runs.
- Corrected quoted Dataview tag sources, Canvas group headings, duplicate HTML anchors, and synchronous absolute-path writes.

## [1.1.0] - 2026-09-29

### Added
- Cancellable exports, configurable titles, and configurable split grouping.

### Changed
- All output formats now use the same note-cleaning pipeline. Defaults no longer depend on a personal vault, and split files can be written inside or outside the vault.

### Removed
- The advertised-but-unimplemented PDF export and external Python execution mode.

### Fixed
- Inline code at the start of a line no longer breaks HTML layout.
