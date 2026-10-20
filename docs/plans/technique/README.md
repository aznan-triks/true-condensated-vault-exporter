# Technical implementation tracker

Implementation of the dated [2026-10-20 audit](../../audits/bugs-et-performance.md). Follow the execution order below; each task's execution journal records regression evidence, validation, and any remaining work. Status values follow the implementation request: `à faire`, `en cours`, `fait`, `bloqué`, `reporté`.

| Plan | Priorité | Statut | Commit(s) | Mesure/Tests | Notes |
|------|----------|--------|-----------|--------------|-------|
| [VE-001](tasks/VE-001-collision-sorties-sources.md) | P0 | fait | `10cccd7` | 6 new tests; check PASS (130 tests / 99 smoke) | Rejected before all writes; portable case-only guard |
| [VE-002](tasks/VE-002-reservation-destinations.md) | P1 | fait | `2160c68` | 3 new tests + 1 smoke; check PASS (133 / 100); Markdown count 2 → 2 | No Exports/Exports; sidebar and gateway aligned |
| [VE-003](tasks/VE-003-split-quadratique.md) | P1 | fait | `7bf8a83`, `f284dd7` | 9 new tests; check PASS (142 / 100); 16k: 1,727.26 ms, real timers | Strict <2s gate met; output order and cancellation preserved |
| [VE-005](tasks/VE-005-wikilinks-incomplets.md) | P2 | fait | `47ef39b` | 13 new tests + 1 smoke; check PASS (155 / 101) | Shared parser; empty links and code protection preserved |
| [VE-006](tasks/VE-006-normalisation-unicode.md) | P2 | fait | `9780ac8` | 7 new tests; check PASS (162 / 101) | All NFC/NFD cases pass; filenames remain unchanged |
| [VE-007](tasks/VE-007-dataview-echec-silencieux.md) | P2 | fait | `9ac9bd9` | 11 new tests; check PASS (173 / 101) | Literals and unsupported queries preserved; supported sources still render |
| [VE-008](tasks/VE-008-snapshot-settings.md) | P2 | fait | `85857ae` | 4 new tests; check PASS (177 / 101) | Uniform rendering and destinations during UI mutations; raw unchanged |
| [VE-009](tasks/VE-009-echec-partiel.md) | P2 | en cours | Implementation hash pending | 3 new tests + 6 net smoke assertions; check PASS (180 / 107) | Typed partial failures; exact history; deterministic Cancelled smoke |
| [VE-010](tasks/VE-010-ignored-properties.md) | P2 | à faire | — | — | Filter built-in metadata fields |
| [VE-012](tasks/VE-012-markdown-echappement.md) | P2 | à faire | — | — | Escape Markdown TOC labels |
| [VE-004](tasks/VE-004-collisions-noms-sortie.md) | P3 | à faire | — | — | Portable split names and source-aware errors |
| [VE-011](tasks/VE-011-html-fences.md) | P3 | à faire | — | — | HTML code blocks and heading extraction |
| [VE-013](tasks/VE-013-memoire-sorties.md) | P3 | à faire | — | — | Release output strings and binary copies |
| [VE-014](tasks/VE-014-progress-panel-timer.md) | P3 | à faire | — | — | Progress panel lifecycle |
| [VE-015](tasks/VE-015-release-sans-tests.md) | P3 | à faire | — | — | Validate before publication; explicit overwrite |
| [VE-016](tasks/VE-016-dataview-dans-fence.md) | P3 | à faire | — | — | Leave nested Dataview examples untouched |
| [VE-017](tasks/VE-017-settings-frappe.md) | P3 | à faire | — | — | Bound persisted history and debounce typing |

## Baseline and working rules

- Session branch: `arena/87cf4c66-true-condensated-vault-exporte`; no merge, tag, release, or force push.
- 2026-10-20, Node 22.22.3 / npm 10.9.8: after installing the existing lockfile with `npm ci`, `npm run check` **PASS** (124 tests, 99 smoke assertions). No dependency or configuration changes.
- Initial pull found no remote session branch yet. `git fetch origin` confirmed both local HEAD and `origin/main` at `53d4063`; the first push creates the remote session branch. Subsequent iterations pull only that branch with rebase.
- Each implementation commit updates this tracker and the task journal. A documentation follow-up records the implementation hash and final status after green validation. No red commit is pushed.
