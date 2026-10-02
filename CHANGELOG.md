# Changelog

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
