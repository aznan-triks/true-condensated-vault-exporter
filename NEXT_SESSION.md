# Next Session — Vault Exporter

## Release preparation checkpoint — 2026-10-23

- Work only on the Arena session branch `arena/87cf4c66-true-condensated-vault-exporte`; do not switch or rename it. After its PR is merged, do not add commits to the merged branch: use Arena Continue for future coding work.
- Package, lockfile and manifest are prepared as **2.2.1** (minimum Obsidian 1.7.2). `CHANGELOG.md` retains the actual published 2.1.1/2.2.0 history and has a 2.2.1 section; its Unreleased section is ready for later work.
- This is a preparation record, **not a claim of publication**. Verify the PR/release status on GitHub for the completed merge/tag/assets rather than inferring it from this file.
- The user explicitly requested checks, merge into main and a release. Before merging, keep the published v2.2.0 features: subfolder split depth/styles/presets/previews and tabbed searchable settings. Their source tag `v2.2.0` (`cd627ec4386f0d365c5c32d91598277aa9a3ebc6`) is on a different history from the current main; imported its changes without overwriting any tag or dropping the audit fixes.
- Technical status and measurements: [implementation tracker](docs/plans/technique/README.md). **16 plans complete; VE-013 remaining RSS work explicitly deferred by the user.** Do not claim the <1,200 MB gate was met or apply rejected performance experiments.
- Latest compatibility check: **297 tests across 7 files and 127 mock-Obsidian smoke assertions PASS**, strict typecheck and production build. Repeat the complete check for the final version commit before merging. Existing dependency versions are unchanged; npm reports 2 moderate/2 high development-tree advisories, not addressed in this release scope.
- Release safety: full check on the tagged tree under Node 22; no existing asset overwrite without explicit manual `overwrite=true`. Verify the merge commit/tree, use a new unused tag, run the Release workflow, verify main.js/manifest.json/styles.css, then publish. Never overwrite existing v2.2.0/v2.1.1 tags or assets.
- No live Electron/Obsidian visual test was available. Mock/jsdom tests are not screenshots or proof of native theme integration. Existing README preview images remain illustrative.

## Core invariants

Read `AGENTS.md`, then `CONTEXT.md`. Keep source/docs English, strict TypeScript, no new dependencies or suppressed checks. Preserve source-overwrite prevention, output reservation, Unicode comparison-only keys, literal code/unsupported Dataview, exact full partial-error/cancellation results, portable named split collision errors, lazy output plans, current-panel cleanup and ordered bounded history persistence.

Generated main.js is ignored; do not commit build/measurement artifacts. Clearing/sampling history must never delete exported files. Export overrides remain in-memory only.
