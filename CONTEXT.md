# Project context: Vault Exporter

> Last updated: 2026-10-04 (v2.0.2 hardening). Keep this file in English.

## Product

Obsidian desktop plugin that exports a vault, folder, or tagged subset to NotebookLM text, HTML, consolidated Markdown, split files, or a ZIP bundle. TypeScript core; no production npm dependencies. See `README.md` for user instructions and `CHANGELOG.md` for release history.

## Commands

```sh
npm run check    # TypeScript, Vitest, and production build
npm run test     # Vitest only
npm run dev      # esbuild watch mode
```

`npm run check` writes the generated `main.js`, which is intentionally ignored by Git. `npm audit` checks the development dependency tree; the `moment` override keeps Obsidian's pinned development dependency on a patched release.

## Architecture

| Area | Responsibility |
|---|---|
| `src/core/` | Pure data transforms: settings/types, filters, frontmatter, cleaning pipeline, wikilinks, Dataview, Canvas, HTML/Markdown/NotebookLM formatters, ZIP records. |
| `src/obsidian/` | Obsidian and Node boundary: vault reads/writes, tag and file metadata, binary output, reveal-in-file-manager, local declarations for Obsidian internal APIs. |
| `src/features/` | Export orchestration, consolidated format registry, split exports, history. |
| `src/commands/registry.ts` | Single command registry used by the Command Palette and sidebar; owns run/cancel orchestration. |
| `src/ui/` | Export sidebar, progress panel, path suggestions. |
| `src/settings/SettingsTab.ts` | Obsidian settings UI. |
| `tests/` | Core, feature, cancellation, output-safety, and architecture regression tests. |

## Invariants

- `core/` must not import Obsidian or `features/`. `features/` must not import Obsidian. Keep vault access in `src/obsidian/vaultGateway.ts`.
- `ExporterSettings` and `DEFAULT_SETTINGS` in `src/core/types.ts` are the settings source of truth. Add settings in all three places: type/default, settings UI, and validation/merge tests. Renaming a saved key needs a migration.
- Validate output paths before writing. Use `reservedOutputPaths()` through `isFileIncluded()` to prevent re-export loops. Do not duplicate output filtering in the orchestrator.
- Check the abort signal and yield to the UI in long loops. Cancellation must preserve and report files already written.
- ZIP output is binary: use the gateway's `writeBinary`, not a text writer. The archive is ZIP32; reject values beyond its supported limits.
- Keep Node/Electron APIs (`fs`, `path`, `zlib`, shell integration) behind the existing platform boundary. Keep casts for undocumented Obsidian APIs in `src/obsidian/` and guard desktop-only APIs.
- `onlyFile`, `onlyPath`, and command `settingsOverride` are temporary in-memory scope overrides; never persist them.
- User-facing strings and project documentation are English. `parseFrontmatter` recognizes legacy property aliases for existing vaults.
- Add or update regression tests for fixes. The `architecture` suite in `tests/core.test.ts` enforces import boundaries.

## Important behavior and limitations

- Dataview support is intentionally a subset. Unsupported or malformed blocks remain in the note; do not silently interpret them as matching all files.
- Tag scoping excludes Canvas files. The sidebar's live count is path-based while a tag filter is active and displays a warning.
- Markdown wikilinks point to vault-root-relative paths, not paths relative to each exported file. Consolidated outputs in a subfolder and split mirrors may need their links adjusted.
- Individual split files that cannot be read are skipped and included in the export result.
- HTML has light/dark, responsive, print, search, and custom-CSS support; verify changes to those features in a browser.

## Manual UI checklist

When an Obsidian instance is available, verify the sidebar, target selection, progress/cancel panel, settings persistence, output files, and HTML light/dark view. The README preview assets are illustrative mock-ups, **not** evidence of a live Obsidian test.
