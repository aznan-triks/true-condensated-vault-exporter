# VE-003 — Export split quadratique : validation des collisions et regroupement

| | |
|---|---|
| **Priorité** | **P1** — 153 s mesurées pour 16 000 notes, sur le chemin le plus courant (`split`, `all`) |
| **Type** | performance (algorithme) |
| **Preuve** | **Mesuré** (gateway factice, aucun I/O, Node 22) |
| **Références** | `src/features/exportOrchestrator.ts:95-134` · `src/features/exportSplit.ts:47-63` |
| **Dépend de** | VE-001 (même fonction `selectOutputs`) |
| **Bloque** | VE-009 (boucle d'écriture), VE-013 |
| **Séance** | 1 |

## Constat — mesure de départ

Gateway factice (`writeFile` vide), `targets: ['split']`, `splitMode: 'individual-files'`. Le tableau « sans timers » remplace le `setTimeout(0)` de `yieldToUi` par une résolution immédiate, uniquement dans le script de mesure jetable, pour isoler l'algorithmique.

| Notes | Total (timers réels) | Sans timers | Dont **avant la 1ʳᵉ écriture** |
|---|---|---|---|
| 2 000 | 4,55 s | 2,22 s | 2,20 s |
| 4 000 | 13,31 s | 8,44 s | 8,41 s |
| 8 000 | 44,13 s | 33,68 s | **33,57 s** |
| 16 000 | 153,12 s | — | — |

Référence : cible `markdown` seule sur le même corpus = **37 / 40 / 116 ms** (2 k / 4 k / 8 k). Le coût est donc dans la préparation, pas dans la lecture ni l'écriture. ×3,8 puis ×4,0 quand la taille double → O(n²).

`buildSplitFiles` seul, mesuré séparément : 59 / 608 / 5 353 ms à 8 k / 16 k / 32 k (O(n²) également, constante bien plus faible).

## Comportement actuel / attendu

- **Actuel** : la préparation de l'export (validation des collisions) est quadratique ; à 16 000 notes elle dure plus de deux minutes, dont 99 % avant la première écriture.
- **Cible** : `selectOutputs` et `buildSplitFiles` en O(n log n) ou mieux ; **< 2 s au total pour 16 000 fichiers** contre 153 s, sans changer le résultat (mêmes erreurs de conflit, mêmes contenus).
- **Contrainte** : la détection d'overlap doit rester **exacte** (aucun conflit manqué), y compris entre un dossier et un fichier qu'il contient.

## Cause racine

1. `selectOutputs` (`exportOrchestrator.ts:114-132`) compare chaque sortie à **toutes** les précédentes (`for (const [otherPath, other] of seen)` à l'intérieur de la boucle), et chaque comparaison appelle `pathsOverlap` → deux `canonicalOutputPath` (découpage de chaîne, réassemblage, regex). À 8 000 sorties : ~32 M de comparaisons × ~1 µs = 33 s. C'est **la** cause du temps mesuré.
2. `buildSplitFiles` (`exportSplit.ts:53`) recopie le tableau de groupe à chaque note : `groups.set(group, [...(groups.get(group) ?? []), note])`. Somme des copies quadratique par groupe.

## Sites affectés

- `exportOrchestrator.ts:114-132` — boucle de déduplication + overlap (cause principale).
- `exportOrchestrator.ts:89-93` — `pathsOverlap` (à conserver pour le contrôle ZIP ↔ sorties, qui ne porte que sur peu d'éléments).
- `exportSplit.ts:47-63` — regroupement par dossier (cause secondaire).
- `exportOrchestrator.ts:301-320` — `yieldToUi()` par fichier écrit (~1 ms × n : ~16 s à 16 k). **Hors du correctif principal**, voir étape 4.
- `tests/features.test.ts:295-309` — tests de conflits de chemins à conserver verts.

## Plan d'action

1. **Remplacer la boucle par un index d'ancêtres** (O(n · profondeur)), dans `selectOutputs` :
   - `seen` (Map chemin canonique → sortie) reste pour l'égalité exacte ;
   - `ancestors` (Set des préfixes de dossiers de toutes les sorties déjà vues) : pour chaque nouvelle clé `k`, si `ancestors.has(k)` → `k` est un dossier déjà utilisé par une sortie → conflit ; sinon, pour chaque préfixe `p` de `k` (segments successifs joints par `/`), si `seen.has(p)` → `p` est une sortie déjà écrite, `k` est dedans → conflit ; ajouter tous les préfixes de `k` à `ancestors`, puis `seen.set(k, item)`.
   - Le message d'erreur actuel (`'Output paths overlap: ' + other + ' and ' + item + '.'`) doit être conservé mot pour mot : un test de `features.test.ts` peut s'y appuyer ; vérifier avant de changer.
   - Preuve d'équivalence : `a` et `b` se chevauchent si et seulement si l'un est un préfixe-dossier strict de l'autre. L'ensemble `ancestors` contient exactement tous les préfixes-dossiers des sorties déjà vues, donc les deux directions sont couvertes.
2. **Regroupement en O(1)** : `const list = groups.get(group); if (list) list.push(note); else groups.set(group, [note]);`
3. **Vérifier l'ordre de sortie** : l'itération d'une `Map` est stable (ordre d'insertion) ; le remplacement ne doit pas changer l'ordre des fichiers produits. Le test de non-régression doit comparer la liste complète des `path` avant/après sur un petit corpus.
4. **Facultatif, après mesure** : ne plus `yieldToUi()` après *chaque* fichier mais tous les `yieldEvery` fichiers (valeur déjà utilisée pour le nettoyage), en gardant `checkCancelled` à chaque fichier. Gain attendu ~14 s à 16 k fichiers. **Condition** : mesurer la latence d'annulation (clic → arrêt) et ne retenir que si elle reste < 1 s. Si le gain n'est pas mesuré en conditions réelles, ne pas l'inclure.
5. **Ne pas** ajouter de cache de `canonicalOutputPath` : avec l'index d'ancêtres, le nombre d'appels devient linéaire ; un cache serait de la complexité sans gain mesurable.

## Test de non-régression

**Correction** (obligatoire, avant/après) :

- `selectOutputs` (via `runExports`) avec `htmlOutputPath: 'same.md'` + `markdownOutputPath: 'same.md'` → `Output path conflict` (existant, doit rester).
- `zipOutputPath: 'Vault export.html'` → `overlaps another selected output` (existant).
- Nouveaux cas : `a.md` + `a/b.md` → overlap ; `a/b.md` + `a.md` (ordre inverse) → overlap ; `a.md` + `ab.md` → **pas** de conflit ; `a/b.md` + `a/c.md` → pas de conflit ; `A.md` + `a.md` → pas de conflit (casse significative, comportement actuel conservé).
- Un test de liste complète des chemins produits sur 50 notes réparties dans 5 dossiers (ordre inchangé).

**Preuve de gain** (script jetable, non commité) : même harnais que la mesure de départ, n = 2 000 / 4 000 / 8 000 / 16 000 ; consigner les temps dans la PR. Critère : 16 000 < 2 s, et courbe ~n log n.

## Points d'impact

- `exportOrchestrator.ts` et `exportSplit.ts` uniquement ; aucun changement de format de sortie.
- `buildSplitFiles` est aussi utilisé par les tests (`core.test.ts:700-745`) : ces tests passent sans modification.
- Mémoire : l'index d'ancêtres ajoute O(n · profondeur) chaînes, négligeable devant les 16 k contenus.

## Non-objectifs

- Ne pas paralléliser les écritures : l'API Obsidian n'est pas thread-safe et l'ordre des écritures est visible dans l'UI.
- Ne pas compresser les sorties split (hors sujet).
- Ne pas changer la limite des 65 535 entrées ZIP.

## Critères d'acceptation

- 16 000 notes, cible split : < 2 s (contre 153 s), mesuré par le même script.
- Tous les tests de conflit existants et nouveaux passent.
- Aucune différence dans la liste ordonnée des fichiers produits sur un corpus de contrôle.
- `npm run check` passe.

## Risques

- Une erreur d'index (préfixe sans séparateur) manquerait un conflit : les cas `a.md`/`ab.md` et `a/b.md`/`a.md` verrouillent les deux directions.
- Le `yield` par lot (étape 4) peut dégrader la réactivité du bouton Cancel : condition mesurée, sinon abandon.

## Journal d'exécution

### 2026-10-21 — `7bf8a83`, implementation validated, numerical gate blocked; documentation follow-up

- Baseline: `git pull --rebase` up to date, `npm run check` **PASS** (133 tests / 100 smoke). Read the full plan and affected source/test sites.
- Tests first in `tests/features.test.ts`, suite `linear split validation (VE-003)`: **7 passed / 1 failed** before the fix. `canonicalizes a linear number of paths instead of every pair` observed **10,300** canonicalizations for only 100 outputs (required <1,000); it now passes. The other tests lock exact overlap messages in both insertion directions, four non-overlapping pairs (including case-sensitive outputs), and the complete ordered 50-path/content list across five folders. Existing conflicts, ZIP overlap, unsafe-path and cancellation tests are unchanged.
- Corrected a test-example typo without changing the intended invariant: `a.md` and `a/b.md` are distinct paths, not ancestors. They are tested as a valid pair; actual overlap is tested with `a.md` and `a.md/b.md`, in both orders. No existing test was changed for this correction.
- Replaced the pairwise scan with an ancestor **Map**, rather than a Set, to retain the first original descendant for the unchanged error message without a secondary scan. Grouping appends to the existing array. No path cache or parallel writes.
- Disposable measurement harness: Node **v22.22.3**, fake gateway, no I/O, ordered path and content checks at every write, sizes 2k/4k/8k/16k. "No timers" replaces only the harness's `setTimeout(0)` with queued microtasks, matching the audit's algorithm-isolation method. Real-timer runs do not stub timers. Actual measurements:

| Notes | Before, no timers (ms) | After ancestor/group fix, no timers (ms) | After fix, real timers, per-file yield (ms) | After batched yield, real timers (ms) |
|---|---:|---:|---:|---:|
| 2,000 | 1,630.66 | 51.13 | 2,421.00 | 238.56 |
| 4,000 | 6,201.85 | 84.18 | 4,767.97 | 459.41 |
| 8,000 | 23,525.40 | 190.11 | 9,718.24 | 957.17 |
| 16,000 | 94,809.28 | 449.53 | 19,482.00 | **2,036.18** |

- Before-first-write time at 16k: **94,510.62 → 148.58 ms** in the no-timer algorithm measurements. Full ordered names and bodies remained identical. Grouped-only `buildSplitFiles`: **44.60 → 8.35 ms** (8k), **471.96 → 21.66 ms** (16k), **3,554.26 → 33.58 ms** (32k).
- Optional batching was measured only after removing the algorithmic bottleneck. It uses existing `yieldEvery`, preserves a cancellation check per file, and still yields after the final file. A disposable extension of the real bundle's mock-Obsidian smoke test scheduled a real timer after the first write and clicked the actual Cancel button. At 16k notes:
  - batch 25: **Cancelled**, 25 files written, timer-request → stop **42.91 ms**, click → stop **12.85 ms**;
  - batch 1,000 (maximum setting): **Cancelled**, 1,000 files written, timer-request → stop **122.15 ms**, click → stop **3.37 ms**.
  These are real Node timers and jsdom click handling with a fake gateway, **not a live Electron/Obsidian measurement**; no stronger claim is made.
- `npm run check` **PASS**: 141/141 tests, 100/100 smoke assertions; strict typecheck and production build. All measurement scripts/bundles were kept in `/tmp` and removed after collecting the results.
- **Numerical gate NOT met:** final real-timer total **2,036.18 ms**, exceeding the strict 2,000 ms bound by **36.18 ms (1.81%)**. No rerun selected for a better number, no setting/default changed to game the target, no completion claim. The dated audit's 153.12 s baseline is left unchanged.
- **Out-of-scope observation (not fixed):** every `checkCancelled(signal, snapshot())` eagerly copies `written`/`skippedFiles` and reduces all written bytes even when the signal is not aborted. In the write loop this performs growing work on each file; it is separate from the two planned root causes. Keep all partial-result/cancellation safeguards intact.
- **Proposal, awaiting user approval:** extend VE-003 narrowly to construct the existing cancellation snapshot only when cancellation is actually observed, without changing its contents or any error handling; test identical partial results and remeasure with the same harness. Alternatively the user may explicitly accept the measured 2.036 s bound. No further implementation or subsequent plan is started pending that decision.
- Implementation `7bf8a83` pushed to the session branch; this documentation follow-up records its hash. Status: **bloqué**, not `fait`. Remaining: decision on this small scope extension / numerical criterion, final measurement and validation if approved, then VE-005.

### 2026-10-21 — `f284dd7`; documentation follow-up

- User approval: **"enchaîne sans t'arrêter"**, following the explicit request to extend VE-003 to lazy cancellation snapshots. The numerical target is unchanged.
- Restored the local Git metadata to the already-pushed session history after verifying all restored workspace files byte-for-byte against `60294fa`; fast-forwarded this same branch, retained a backup stash, reinstalled only the existing lockfile. Baseline check PASS (141 tests / 100 smoke).
- Added `does not eagerly reduce cancellation snapshots for successful split writes` first: **184 reductions** for 60 notes (expected <10), failing for the growing-snapshot work. Changed only the local cancellation helper to accept a snapshot callback and evaluate it on abort. Every cancellation check and all partial-result fields are retained; existing load/clean/write cancellation regressions pass unchanged.
- Same real-timer, no-I/O harness, default `yieldEvery: 25`, all ordered names/bodies checked: **235.21 / 448.39 / 891.28 / 1,727.26 ms** for 2k/4k/8k/16k. At 16k the previously blocked **2,036.18 ms → 1,727.26 ms** now meets <2s. No timer stubbing, default tuning, or best-of rerun. Disposable `/tmp` script and bundle removed.
- `npm run check` PASS: **142/142 tests, 100/100 smoke**, strict typecheck and production build. The nine VE-003 tests and all prior cancellation/ordered-output tests pass. No partial-failure behavior changed (VE-009 remains separate).

- Implementation `f284dd7` pushed; tracker marked `fait`. All acceptance criteria met; remaining: none.
