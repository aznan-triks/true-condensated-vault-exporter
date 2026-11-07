# Next Session — Vault Exporter

## Release preparation checkpoint — 2026-11-07 (v2.3.1)

- Package, manifest, and bundled changelog are prepared as **2.3.1** (minimum Obsidian 1.7.2). `CHANGELOG.md` preserves full release history and adds a **2.3.1** entry with dual **Plain** + **Technical** voice notes.
- Key performance improvements delivered in **2.3.1**:
  - **High-throughput Vault Filtering (`compileFilter` & `CompiledFilter`):** Early rejection of non-Markdown/non-Canvas files skips Unicode NFC normalization and string allocations for non-text attachments. Filter options (`scopeRoot`, `reservedPaths`, `excludedFiles`, `excludedFolders`, `excludedPrefixes`) are pre-normalized once per scan in `vaultGateway.ts` and `SidebarView.ts`.
  - **Single-Pass Note Cleaning (`cleanNoteBody`):** Fused note cleaning combines comment stripping (`%%`), callout cleaning (`[!`), wikilink formatting (`[[`), and whitespace sanitization into a single segmentation pass, eliminating up to 4 redundant tokenization loops per note. Notes without `dataview` blocks completely bypass the Dataview query engine.
  - **Lag-Free Settings & Autocompletion:** Short-lived TTL caching for vault frontmatter keys (`getAllFrontmatterKeys`) and autocomplete suggestions (`VaultPathSuggest`), pre-indexed searchable settings row attributes for instantaneous search filtering, and memoized changelog Markdown parsing with a shared DOMParser instance.
- Latest full verification check: **307 Vitest unit tests across 7 files and 137 mock-Obsidian smoke assertions PASS**, zero TypeScript errors, zero unexpected console errors, clean production bundle (`main.js`).
- Technical status note preserved from prior audit: [implementation tracker](docs/plans/technique/README.md) — **16 plans complete; VE-013 remaining RSS work explicitly deferred by prior user decision.** No live Electron/Obsidian screenshot test is available inside headless Node/jsdom; README preview mock-ups remain illustrative.

## Core invariants

Read `AGENTS.md`, then `CONTEXT.md`. Keep all source, UI strings, commits, PRs, and documentation in English, strict TypeScript, no new dependencies or suppressed checks. Preserve source-overwrite prevention, output reservation, Unicode comparison-only keys, literal code/unsupported Dataview, exact full partial-error/cancellation results, portable named split collision errors, lazy output plans, current-panel cleanup, and ordered bounded history persistence.

Generated `main.js` is ignored by Git; do not commit build/measurement artifacts. Clearing/sampling history must never delete exported files. Context command export overrides remain in-memory only.
