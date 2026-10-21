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
| [VE-009](tasks/VE-009-echec-partiel.md) | P2 | fait | `60cfdca` | 3 new tests + 6 net smoke assertions; check PASS (180 / 107) | Partial paths/bytes exact; failure history and strict cancellation smoke pass |
| [VE-010](tasks/VE-010-ignored-properties.md) | P2 | fait | `d34e657` | 7 new tests; check PASS (187 / 107) | All built-ins filtered; default output and raw split YAML retained |
| [VE-012](tasks/VE-012-markdown-echappement.md) | P2 | fait | `67cea85` | 5 new tests; check PASS (192 / 107) | Valid special-character links; raw section titles and anchors retained |
| [VE-004](tasks/VE-004-collisions-noms-sortie.md) | P3 | fait | `82f8652` | 11 new tests; check PASS (203 / 107) | Safe corpus unchanged; strict named collision guard before text/ZIP writes |
| [VE-011](tasks/VE-011-html-fences.md) | P3 | fait | `b71ba3e` | 7 new tests; check PASS (210 / 107) | All required code assertions pass; HTML and note TOC agree |
| [VE-013](tasks/VE-013-memoire-sorties.md) | P3 | reporté | `0ad656c`, `94be0a2`, `d581bed` | 19 new tests; check PASS (229 / 107); RSS 2,371.90 → 1,349.44 MB (FAIL); time 12,545.17 → 11,820.33 ms (PASS) | Written user decision 2026-10-21: defer remaining RSS work; retain green improvement, do not claim memory gate met |
| [VE-014](tasks/VE-014-progress-panel-timer.md) | P3 | fait | `ea8a2d2` | 6 new tests + 5 smoke; check PASS (235 / 112); two live timers 2 → 1 | One live interval; unload and late callbacks leave no DOM or timers |
| [VE-015](tasks/VE-015-release-sans-tests.md) | P3 | fait | `d6d5d4b` | 9 new tests; check PASS (244 / 112); mocked shell publishing blocked on check/asset failures | Tagged full check and explicit overwrite guards pass; remote YAML read matches; no release run |
| [VE-016](tasks/VE-016-dataview-dans-fence.md) | P3 | fait | `f20c2a4` | 16 new tests + 1 smoke; check PASS (260 / 113); 10k scan 3.35 → 26.20 ms | Nested examples byte-preserved; real top-level queries execute; source regex removed |
| [VE-017](tasks/VE-017-settings-frappe.md) | P3 | fait | `482fa5c` | 27 new tests + 6 smoke; check PASS (287 / 119); JSON 7,625,960 → 6,160 B; ten keys → one save | One save per typing burst; ordered immutable writes; close/unload flush; exact sampled-history counts/bytes |

## Baseline and working rules

- Session branch: `arena/87cf4c66-true-condensated-vault-exporte`; no merge, tag, release, or force push.
- 2026-10-20, Node 22.22.3 / npm 10.9.8: after installing the existing lockfile with `npm ci`, `npm run check` **PASS** (124 tests, 99 smoke assertions). No dependency or configuration changes.
- Initial pull found no remote session branch yet. `git fetch origin` confirmed both local HEAD and `origin/main` at `53d4063`; the first push creates the remote session branch. Subsequent iterations pull only that branch with rebase.
- Each implementation commit updates this tracker and the task journal. A documentation follow-up records the implementation hash and final status after green validation. No red commit is pushed.

## Completion checkpoint — 2026-10-21

- **16 plans `fait`; VE-013 `reporté` by explicit written user decision.** No `à faire`, `en cours` or unresolved `bloqué` row remains. All P0/P1/P2 plans are complete; the deferred P3 retains its measured green improvement without claiming its RSS gate.
- Final source validation after VE-017: `npm run check` **PASS — 287 tests across 7 files, 119 smoke assertions, strict typecheck and production build**. The plan journals retain named tests-first evidence and numerical measurements; VE-013's unmet `<1,200 MB` RSS target remains visible.
- All implementation/decision records are pushed on `arena/87cf4c66-true-condensated-vault-exporte`. No change to the main branch, merge, tag, release or publishing run; release validation used safe command stubs and a read-only remote workflow view. No dependency, package, bundler, TypeScript or test-configuration change.
- The dated audit is unchanged except its tracker pointer. Disposable measurement scripts/bundles/data are not in Git. Obsidian/Electron visual testing and live publication were not performed; mock-Obsidian/jsdom evidence is identified as such, not presented as a live UI/release run.
