# Next Session — Vault Exporter

## Release checkpoint — 2026-11-14 (v2.3.2 prepared)

- **Release v2.3.2 ready on GitHub** (`aznan-triks/true-condensated-vault-exporter`).
- Package, manifest, and bundled changelog are aligned to **2.3.2** (minimum Obsidian 1.7.2). `CHANGELOG.md` preserves full release history with dual **Plain** + **Technical** voice notes.
- Key improvements delivered in **2.3.2**:
  - **NotebookLM 500k Word Limit Chunking & Multi-part Splitting (`maxWordsPerFile`):** Automatic division of large export documents into numbered parts (` - Part 1`, ` - Part 2`) whenever word counts exceed NotebookLM source capacity limits. Supported across consolidated Markdown, consolidated NotebookLM text, and folder-grouped split outputs.
  - **Allocation-Free Word Counter & Safe Thresholds (`chunker.ts`):** High-speed word counting via native `Intl.Segmenter` with Unicode whitespace fallback, 4% safety buffer for the 500,000-word ceiling against markdown tokenizer variations, single-note subdivision for gigantic notes, and continuous document numbering and TOC references.
  - **Re-export Loop Protection (`isReservedPathMatch`):** Updated vault filter to recognize chunked part suffixes on reserved output destinations, preventing previous multi-part exports from ever being re-ingested into future scans.
  - **Settings UI Control:** Added `Max Words per File (NotebookLM chunking)` in Settings under Output Paths & Split Options with debounced persistence and changed-from-default tracking.
- Latest full verification check: **322 Vitest unit tests across 8 files and 138 mock-Obsidian smoke assertions PASS**, zero TypeScript errors, zero unexpected console errors, clean production bundle (`main.js`).
- Technical status note preserved from prior audit: [implementation tracker](docs/plans/technique/README.md) — **16 plans complete; VE-013 remaining RSS work explicitly deferred by prior user decision.** No live Electron/Obsidian screenshot test is available inside headless Node/jsdom; README preview mock-ups remain illustrative.

## Core invariants

Read `AGENTS.md`, then `CONTEXT.md`. Keep all source, UI strings, commits, PRs, and documentation in English, strict TypeScript, no new dependencies or suppressed checks. Preserve source-overwrite prevention, output reservation, Unicode comparison-only keys, literal code/unsupported Dataview, exact full partial-error/cancellation results, portable named split collision errors, lazy output plans, current-panel cleanup, and ordered bounded history persistence.

Generated `main.js` is ignored by Git; do not commit build/measurement artifacts. Clearing/sampling history must never delete exported files. Context command export overrides remain in-memory only.
