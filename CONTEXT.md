# Project context: Vault Exporter

> Last updated: 2026-10-04 (v2.0.4). Keep this file in English.

## Product

Obsidian desktop plugin that exports a vault, folder, or tagged subset to NotebookLM text, HTML, consolidated Markdown, split files, or a ZIP bundle. TypeScript core; no production npm dependencies. See `README.md` for user instructions and `CHANGELOG.md` for release history.

## Commands

```sh
npm run check    # TypeScript, Vitest, production build, mock-Obsidian smoke test
npm run test     # Vitest only
npm run smoke    # loads main.js against the mock Obsidian API (tools/mock-obsidian)
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
| `tests/` | Core, feature, cancellation, output-safety, gateway integration, and architecture regression tests. |
| `tools/mock-obsidian/` | Development-only mock of the Obsidian runtime (jsdom DOM helpers, API mock, filesystem-backed vault) used by `npm run smoke` to execute the real bundle. `WorkspaceLeaf.setViewState` calls `view.open()` like Obsidian does, so view-lifecycle mistakes fail the smoke test. |

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
- Never name a class *field* after an Obsidian lifecycle member (`open`, `load`, `unload`, `display`, `getState`, …) on a class that extends `Plugin`, `ItemView`/`View`, `PluginSettingTab`, or `AbstractInputSuggest`: instance fields shadow the base-class method and Obsidian fails at runtime (`Failed to open view: e.open is not a function`). `npm run smoke` and the `architecture` suite both guard this.
- The `obsidian` devDependency is pinned to `manifest.json`'s `minAppVersion` so the type-check and the mock API only expose what the oldest supported app version provides. Bump both together.

## Important behavior and limitations

- Dataview support is intentionally a subset. Unsupported or malformed blocks remain in the note; do not silently interpret them as matching all files.
- Tag scoping excludes Canvas files. The sidebar's live count is path-based while a tag filter is active and displays a warning.
- Markdown wikilinks point to vault-root-relative paths, not paths relative to each exported file. Consolidated outputs in a subfolder and split mirrors may need their links adjusted.
- Individual split files that cannot be read are skipped and included in the export result.
- The sidebar remembers selected export targets by default, but context commands remain in-memory-only. It summarizes selected targets in an `aria-live` status region and updates controls in place so keyboard focus is preserved. Clearing recent export history never deletes output files; history reveal targets the first written file.
- Export feedback preferences control completed-panel auto-close (`0` means keep open) and optional automatic reveal of the first output. Keep the duration choices synchronized between `PROGRESS_PANEL_AUTO_CLOSE_OPTIONS`, settings UI, and tests. The progress panel and history expose elapsed time; success feedback includes written-file count, bytes, and skipped files.
- HTML has system/light/dark themes, configurable accent color, typography, reading width, optional navigation/search/paths/metadata/footer, responsive layout, print support, and custom CSS. Validate user colors before interpolating them into CSS; verify visual changes in a browser.
- The progress panel and sidebar include narrow/short-window and touch-target styles in `styles.css`; these still need a visual check inside Obsidian.

## Manual UI checklist

`npm run smoke` covers load, sidebar, settings, exports, cancellation, auto-reveal, and reveal shortcuts against a mock API; it does not prove visual layout or theme integration. When an Obsidian instance is available, still verify the sidebar, remembered target selection and live selection summary, history actions/duration, progress/cancel panel and elapsed time, auto-close/auto-reveal preferences, responsive layouts, output files, and HTML system/light/dark styles and live preview. The README preview assets are illustrative mock-ups, **not** evidence of a live Obsidian test.
