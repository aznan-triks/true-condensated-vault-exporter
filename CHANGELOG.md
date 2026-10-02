# Changelog

## [2.0.1] - 2026-10-02

### Removed
- Completed refactoring plan `plans/PLAN_refonte_v1.1.md` — the v1.1 rework shipped on 2026-09-29 and every "done when" condition was met, so the plan no longer served. It stays available in Git history.
- Dead export `CONSOLIDATED_FORMAT_LABELS` (`src/features/formats.ts`) — never referenced anywhere; label strings already come from `EXPORT_COMMANDS` and `CONSOLIDATED_FORMATS`.

### Changed
- `.gitignore`: the two dated one-off backup entries (`_backup_wot_plugin_2026-09-29/`, `_backup_methode_2026-09-28/`) are replaced by a single `_backup_*/` pattern, so local temporary backups stay ignored without per-date maintenance.
- README: unit-test count corrected (59 → 63, as reported by `npm run test`).
- `NEXT_SESSION.md`: current state refreshed — v2.0.0 merged to `main` via PR #1, v2.0.1 released.

## [2.0.0] - 2026-10-02

### Added
- **ZIP bundle export**: "Export everything as ZIP bundle" packs every consolidated format + the split files into a single, portable `.zip` (deflate-compressed, zero-dependency writer). Perfect for NotebookLM multi-source notebooks or sharing an export in one file. New setting: `zipOutputPath`.
- **Multi-target exports**: the sidebar now lets you pick any combination of targets (NotebookLM, HTML, Markdown, Split, ZIP) and run them in one shot.
- **Context commands**:
  - "Export current note's folder (all targets)" — one click export of the folder containing the active note (in-memory scope override, settings untouched)
  - "Export current note as clean Markdown" — writes `<note> (clean export).md` next to the note, using the same cleaning pipeline
- **Client-side search in the HTML export**: filter box in the table of contents hides non-matching documents and TOC entries live, with a visible counter (zero-dependency inline script, works offline).
- **Live scope preview**: the sidebar shows how many notes/canvases (and how many bytes) will actually be exported, refreshed on every settings change.
- **Export history**: the last 5 export runs (targets, date, file count, size, outcome) are kept in the sidebar and persisted with the plugin data.
- **"Open folder" shortcut**: after a successful export, a button reveals the first output file in the OS file manager (desktop).
- **Tag scoping**: new `scopeTag` setting — export only notes carrying a given tag (body or frontmatter). Canvas files are excluded while a tag is active.
- **Real Dataview WHERE expressions**: `and`/`or` (with correct precedence and parentheses), comparisons `=`, `!=`, `>`, `<`, `>=`, `<=`, `in (a, b, c)`, `like "wild*card"`, and `contains`/`startswith`/`endswith` as functions *or* infix. Fields: `title`, `tags`, `category`, `order`, `statut`, any custom property, `file.name`, `file.path`, `file.folder`, `file.ctime`, `file.mtime`, `file.day`.
- **HTML export, fully reworked**:
  - inline markdown rendering (bold, italic, strikethrough, inline code, links, images, bare autolinks) — previously shown as literal text
  - (plus the client-side document search added in this release)
  - dark *and* light theme (follows the viewer's `prefers-color-scheme`), with CSS custom properties so `customCss` can restyle everything
  - two-level table of contents (documents + their headings, unique anchors), "Back to top" links, export date footer
  - merged multi-line blockquotes with callout styling, task lists (`- [x]`), ordered lists
  - print stylesheet (TOC hidden, one page per document) and mobile layout
- **Canvas exports in reading order**: nodes are sorted top-to-bottom / left-to-right and canvas groups become `## section` headers. Labels are now English ("Linked note:", "Link:", "(Empty canvas)").
- **Markdown link resolution**: the `markdown` wikilink format now resolves `[[Target]]` to the real vault path (e.g. `Notes/Target.md`) instead of a raw, extension-less target.
- **Advanced settings surfaced**: `customCss` (textarea) and `yieldEvery` (notes per UI yield) were defined but unreachable — both are now in the Advanced section.

### Changed
- **Single frontmatter parse per run**: the pipeline builds a shared `ParsedFile[]` index once; the cleaner and the Dataview engine share it. Previously every Dataview block re-parsed the frontmatter of *every* note (O(queries × notes) → O(notes)).
- **Parallel vault reads**: file loading is batched (8 at a time) instead of strictly sequential — noticeably faster on large vaults.
- **Resilient loading**: a note that fails to read is skipped and reported in the console/summary instead of aborting the whole export.
- **Split output**: group header now reads `Folder : <name>` (was `CATEGORY :`), and each document line includes its source path.
- **Dataview output**: table id-column header is now `File`; empty results render `*No results found.*`.
- Plugin data now persists `{ settings, history }`; the legacy format (bare settings object) is still read on load.

### Fixed
- **Feedback loop on re-export**: previous export outputs (consolidated files, ZIP, split folder) are now automatically excluded from the export scope, so running the export twice no longer ingests the first run's results. Same protection applies to the `* (clean export).md` artifacts produced by the "Export current note" command.
- `FROM "#tag"` (quoted) in Dataview blocks is now recognized as a tag, not a folder path.
- Canvas: a group header is no longer duplicated when ungrouped nodes sit between two grouped ones.
- Dataview `SORT date` no longer compares one side by `dateCreation` and the other by `dateRevision`.
- HTML heading anchors are now unique across documents (no more duplicated TOC targets).
- Absolute-path writes use async `fs` (the UI no longer freezes during large disk writes).

## [1.1.0] - 2026-09-29

### Changed
- Every format now cleans notes the same way, so the HTML export finally respects your link setting. — Single cleaning pipeline (`core/pipeline.ts`), notes cleaned once per run and shared by all formats; formats registered in `features/formats.ts`.
- Default settings are now generic instead of tied to one personal vault. — `DEFAULT_SETTINGS` neutralized; obsolete saved keys dropped on load (`mergeSettings`).
- Split files are grouped by the first folder under your scope root, and they can be written inside the vault. — No more hard-coded `WoT` folder; writes go through the gateway (vault-relative or absolute).

### Added
- You can cancel a running export (panel button or "Cancel running export" command). — `AbortSignal` checked between notes and files; cancellation reported as info, not error.
- You choose which folder's subfolders become split files. — `splitGroupFolder` setting.
- Title of consolidated exports is configurable. — `documentTitle` setting.

### Removed
- The PDF export that was advertised but never existed, and the external Python mode. — `pdfOutputPath`, `executionEngine`, `pythonRunner.ts`, `exportSplitFiles` toggle removed.

### Fixed
- A line starting with inline code no longer breaks the HTML layout. — Code fences detected on ``` only.
