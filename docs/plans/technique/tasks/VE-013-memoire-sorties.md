# VE-013 — Mémoire : ne pas retenir toutes les sorties et toutes leurs copies

| | |
|---|---|
| **Priorité** | **P3** — courant seulement sur les très gros vaults (seuil mesuré ~150 Mo de texte) |
| **Type** | performance (mémoire) |
| **Preuve** | **Mesuré** (Node 22, corpus synthétique, `--max-old-space-size`) |
| **Références** | `src/features/exportOrchestrator.ts:52-65, 137-157, 291-320` · `src/core/zip.ts:70-160` · `src/obsidian/vaultGateway.ts:177-181` |
| **Dépend de** | VE-009 (même phase d'écriture) |
| **Bloque** | — |
| **Séance** | 1 |

## Constat — mesure de départ

Corpus de 20 000 notes × 8 Ko (≈ **154 Mo** de Markdown brut), les quatre formats activés + ZIP, même code que la production :

| Indicateur | Valeur |
|---|---|
| Sorties produites | `md` 156 Mo + `html` 165 Mo + `nlm` 157 Mo + `split` 155 Mo = **634 Mo** |
| `heapUsed` en fin de parcours | 1 134 Mo |
| **RSS de pic** | **2 243 Mo** |
| Durée | 10,6 s |

Mesures complémentaires :

- ZIP de 120 Mo **incompressibles** : 252 Mo d'`ArrayBuffer` (données + archive), RSS 577 Mo. Le contenu est compressible dans le cas ci-dessus (ZIP final 4 Mo), mais l'archive intermédiaire existe quand même.
- `crc32` 120 Mo : 360 ms ; encodage UTF-8 de 318 Mo : 561 ms ; `cleanNote` seul sur 154 Mo : 3,1 s / 588 Mo de RSS.
- `writeBinary` recopie l'archive dans un second `ArrayBuffer` (`vaultGateway.ts:179-180`).

Ordre de grandeur : **~14,6 × la taille du corpus** en RSS. À 300 Mo de notes (vault très volumineux), on dépasse 4 Go — zone d'OOM d'Electron.

## Comportement actuel / attendu

- **Actuel** : les quatre chaînes de sortie sont construites et conservées (`consolidated` Map + `split`), le ZIP est construit **avant** les fichiers (`l. 291-305`), `zipEntries` encode **toutes** les chaînes en `Uint8Array` d'un coup (`l. 137-157`), puis `writeBinary` en fait une copie. Au pic : 4 chaînes (634 Mo) + 4 tableaux d'octets (634 Mo) + archive (≈150 Mo) + copie (≈150 Mo).
- **Attendu** : au plus **une** sortie non compressée vivante à la fois ; pic < 1,2 Go sur le même corpus ; durée ≤ +20 %.

## Cause racine

Aucune libération explicite et un ordre défavorable : tout est calculé, puis tout est encodé, puis tout est écrit, puis tout est copié. Le point d'étranglement n'est pas `cleanNote` (3,1 s pour 154 Mo) mais la **rétention simultanée** des représentations (chaîne, octets, archive, copie).

## Sites affectés

| Site | Rétention |
|---|---|
| `exportOrchestrator.ts:52-65` (`consolidatedOutputs`) | toutes les chaînes consolidées |
| `exportOrchestrator.ts:274-276` | `split` complet |
| `exportOrchestrator.ts:137-157` (`zipEntries`) | **toutes** les encodages UTF-8 |
| `exportOrchestrator.ts:291-305` | ZIP construit avant les fichiers |
| `zip.ts:70-160` (`buildZip`) | archive complète + `entries[].data` + copie finale par `concat` (inévitable sans streaming) |
| `vaultGateway.ts:177-181` | copie de l'archive |

## Plan d'action

1. **Écrire les fichiers avant le ZIP** (inverser les blocs `l. 298-305` et `l. 307-320`) et **libérer la référence** après chaque écriture (`item.out.content = ''` ou suppression de la Map). Les erreurs restent couvertes par VE-009 (le ZIP n'est plus « déjà écrit » en cas d'échec d'un fichier — comportement plus simple à expliquer).
2. **Encoder paresseusement** : faire de `zipEntries` un générateur (`function* zipEntries(...)`) et faire consommer ce générateur par `buildZip` en une seule passe. Après chaque entrée, la chaîne source et son `Uint8Array` ne sont plus référencés ; seule la partie **compressée** reste. La copie finale de `concat` (`zip.ts:120-160`) reste inévitable tant que `writeBinary` exige un `Uint8Array` complet — ne pas essayer de la supprimer.
   - `buildZip` conserve son API publique pour les tests (`buildZip(entries: ZipEntry[])`) en acceptant `Iterable<ZipEntry>` ; le central directory n'a besoin que des métadonnées déjà accumulées.
   - Si les formats ne sont plus en mémoire au moment du ZIP (étape 1), les **re-rendre** un par un : `format.render(notes, settings, exportedAt)` avec le **même** `exportedAt` (obligatoire pour que l'archive soit identique aux fichiers).
3. **Supprimer la copie inutile** dans `writeBinary` : si `data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer`, passer `data.buffer` directement ; sinon copier (cas `SharedArrayBuffer`). Gain : une archive entière.
4. **Facultatif, mesuré** : remplacer `utf8ByteLength` (`l. 48-50`, appelé `l. 317`) par `Buffer.byteLength(content, 'utf8')` — 561 ms pour 318 Mo contre ~0 (calcul natif sans allocation). Ne le faire que si le profil après étapes 1-3 montre encore ce coût.
5. **Ne pas** tenter de ZIP en flux : `ExportGateway.writeBinary` prend un `ArrayBuffer` complet et `DataAdapter.append` n'accepte que du texte. C'est une contrainte de l'API Obsidian, pas un choix. À documenter pour éviter un futur plan irréalisable.

## Preuve de gain

Même script que la mesure de départ (corpus 20 k × 8 Ko, `node --max-old-space-size=4096`) :

| Critère | Avant | Cible |
|---|---|---|
| RSS de pic | 2 243 Mo | **< 1 200 Mo** |
| Durée | 10,6 s | ≤ 12,7 s |
| Contenu des fichiers et du ZIP | référence | identique octet pour octet (comparer les tailles et un hash) |

Sur un corpus de 40 Mo (cas courant), le gain attendu est de ~500 Mo de RSS — non mesuré ici, à consigner dans la PR.

## Test de non-régression

- Test d'égalité : sur un petit corpus, l'archive produite avant/après a les **mêmes noms d'entrées**, les mêmes tailles et le même CRC (comparer `crc32` de l'archive ou son contenu décompressé via `DecompressionStream`/`zlib.inflateRawSync`).
- Test d'ordre : les fichiers consolidés sont écrits **avant** `writeBinary` (espionner l'ordre des appels du gateway) — c'est un changement observable, à assumer explicitement.
- `buildZip` avec un `Iterable` : test avec un générateur qui jette au milieu → l'erreur remonte, aucune écriture n'a eu lieu (le ZIP est construit avant `writeBinary`).

## Points d'impact

- `src/features/exportOrchestrator.ts`, `src/core/zip.ts`, `src/obsidian/vaultGateway.ts`.
- Ordre des écritures visible dans le panneau de progression (ZIP en dernier au lieu du premier).
- `tests/features.test.ts:192-206` vérifie le contenu du ZIP : doit rester vert.
- Aucun changement de format, de nom d'entrée, ni de réglage.

## Non-objectifs

- Streaming de l'archive sur disque (impossible via l'API, voir étape 5).
- Compression parallèle ou `worker_threads` : gain non mesuré, complexité réelle.
- Réduire le coût de `cleanNote`/des formateurs (3,1 s pour 154 Mo, déjà linéaire).

## Critères d'acceptation

- RSS de pic < 1,2 Go sur le corpus de mesure, durée ≤ 12,7 s.
- Archive identique (noms, tailles, CRC) et fichiers identiques.
- `npm run check` passe.

## Risques

- Re-rendre les formats pour le ZIP peut produire un contenu différent si un formateur dépend d'un état (aucun ne le fait ; `exportedAt` est passé explicitement). Un test d'égalité le verrouille.
- L'ordre d'écriture change : un échec du ZIP après les fichiers laisse des fichiers sans archive — c'est déjà le cas dans l'autre sens aujourd'hui, et VE-009 rend l'état explicite.

## Journal d'exécution

### 2026-10-21 — blocked before implementation; user decision required

- Baseline: `git pull --rebase` up to date; `npm run check` **PASS (210 tests, 107 smoke)** after VE-011 (`b71ba3e`, completion `7b00f85`). Read the full plan, orchestrator retention/validation/write paths, complete ZIP writer, gateway binary path, command error handling and affected tests. No VE-013 source or existing test has been changed.
- **Legitimate existing-test conflict:** action step 1 deliberately changes the write order, but two VE-009 regressions explicitly lock the opposite order in `tests/features.test.ts`:
  - `reports an empty partial result when the ZIP write fails` (line 514), with `['zip', 'all']`, requires **zero** text writes and an empty partial result. Files-first necessarily leaves successful text files before that failure.
  - `retains a successful ZIP in the partial result when a later plain write fails` (line 526), with `['zip', 'markdown']`, requires the ZIP and its exact bytes in partialResult. With ZIP-last and the first plain write failing, no ZIP exists.
  - Focused existing VE-009 run: **3/3 PASS**. These are not flaky tests to loosen: their scenarios must be explicitly migrated while preserving exact path/byte/cause accounting. Written approval is required before changing them under the standing test-conflict rule.
- **Related error-contract gap in the proposed order:** VE-009 intentionally leaves ZIP construction errors unwrapped because construction currently precedes every write. VE-013 moves construction after the plain writes. Simply moving the blocks would leave those already-written files absent from the UI/history when a generator, ZIP-name check or compressor throws; `registry.ts` only recovers a partial result from `ExportFailedError`.
- Concrete current-code proof with a fake gateway: NotebookLM path `/a/shared/export.txt`, Markdown path `/b/shared/export.txt`, `['all', 'zip']` gives bare `Error: ZIP entry name conflict: shared/export.txt.` and **zero writes**. Distinct disk paths pass inter-format checks but collapse to the same ZIP entry. After a simple files-first move that same deferred check would run after successful files. Proof bundled with the existing esbuild dependency under `/tmp`; both disposable files removed. No actual disk output/user data was touched.
- **Proposed narrow adjustment, awaiting approval:**
  1. Keep VE-013's files-first/ZIP-last order; migrate those two tests to (a) ZIP-only failure with no completed output and (b) failed ZIP after successful plain files with exact retained paths/UTF-8 bytes; also test first-plain failure before any ZIP write. Do not weaken the non-rollback/partial-result guarantees or cancellation smoke.
  2. Extend typed partial-failure handling to ZIP construction **only when prior files have been written**; preserve the bare pre-write error behavior otherwise. Preflight predictable ZIP path/name conflicts before any write where possible. Add tests-first coverage for a deferred ZIP-construction failure retaining the completed outputs.
  3. Then implement lazy entries, retention reduction and the binary-copy guard, run the unchanged memory/time/equality gates and full check. No dependencies, build configuration, release or data changes.
- **Status: bloqué.** Remaining: written approval for this test/error-contract migration, then regressions before implementation and actual 20k × 8 KiB measurements. No memory/time improvement is claimed yet; the audit figures above remain historical. VE-014 through VE-017 have not been started, preserving the imposed order.

### 2026-10-21 — resumed with approval; green intermediate implementation, numerical gate blocked

- The user selected **“Valider et poursuivre”** for the exact test/error-contract migration proposed above. No other gate was relaxed. After the tool pause, Git metadata had reverted to the base while all working-file hashes exactly matched pushed `0ad656c`; retained a duplicate backup stash, fast-forwarded the same session branch to that verified commit, and restored existing-lockfile dependencies. Resumed pull/check: **210 tests / 107 smoke PASS**.
- Tests first: **8 failed / 5 passed** in the initial focused run (including one migrated scenario). Failures cover iterable EOCD counts and ZIP32 limits, eager rendering, ZIP-first writes, first-plain failure, deferred-build partial results and unnecessary binary copying. The other approved migration makes ZIP-only failure explicitly ZIP-only. Later byte-count allocation regression also failed first. Total: **13 new tests**, two existing scenario migrations with exact result assertions preserved.
- Consolidated and split destination plans validate before rendering, materialize one output on demand and release plain-write references before yielding. `planSplitFiles` is the necessary additional affected site: keeping its old eager strings would retain the entire split output; the existing `buildSplitFiles` API/bytes/order are preserved via a wrapper. All VE-001/003/004 guards remain intact.
- Plain files precede the ZIP; ZIP entries are lazily re-rendered with the same `exportedAt`, encoded and compressed one at a time. ZIP names/deduplication/count/length checks are preflighted using shared core validation. Deferred construction failures carry exact partial results only after successful writes; pre-write errors remain bare. Cancellation and no-rollback behavior are unchanged.
- `buildZip` now consumes single-pass iterables and preserves ZIP32 limits/counts. zlib consumes its input view directly rather than copying an entire raw entry. Vault binary writes reuse a whole normal ArrayBuffer, but still copy subviews/SharedArrayBuffers; absolute disk writes need no vault buffer copy.
- Optional byte-count step was selected **after** profiling steps 1–3: on 5k × 8 KiB, byte counting encoded **168,524,207 bytes**, taking **200.36 ms**, versus **45.29 ms** for matching native counts. `Buffer.byteLength` now avoids those counting-only arrays; tests include Unicode and lone surrogates. The intermediate 40 MiB profile took 3,512.72 ms, peak RSS 452.41 MB (not the 20k acceptance gate).
- Full `npm run check` **PASS: 223/223 tests, 107/107 smoke**, strict typecheck/build. Small-corpus tests compare complete archive bytes, central-directory names/sizes/CRCs and plain bytes, as well as call order, safety, partial errors and buffer handling.

#### Numerical evidence — strict gates NOT met

- Disposable harness: **20,000 distinct notes × exactly 8,192 ASCII bytes**, one `Notes` folder, default grouped split/yield=25, `['all', 'zip']`, real UI timers, Node 22 with `--max-old-space-size=4096`. Fake writes retain only sizes/SHA-256 metadata; they hash text in 64 KiB chunks. Document/ZIP timestamps fixed at `2026-10-21T10:00:00Z` solely for deterministic equality; Date.now/performance/timers remain real. No forced GC or timing suppression.
- The audit's original script is not in the repository; this is a documented same-size deterministic reconstruction, measured unchanged before/after. Historical audit numbers above are not overwritten.
- **Peak RSS: 2,371.90 → 1,363.52 MB** (OS process maxRSS, decimal MB). A real reduction, but **FAIL `<1,200 MB`**.
- **Duration: 12,545.17 → 13,094.61 ms**. Relative +4.38% meets +20% against this baseline, but **FAIL strict `≤12,700 ms`**. The gate is not silently rebased to the slower local baseline.
- Plain output total: **674,399,215 bytes**. ZIP: **3,393,537 bytes**. Every plain path/size/SHA-256 and every archive name/size/CRC plus the entire ZIP SHA-256 matched before/after. Archive SHA-256: `0d7aeafd7a086d2d4cc40a08228392a016de403e9f7b19e96ad6ed7e7887bdec`.

| Output / ZIP entry | Bytes | CRC-32 | SHA-256 (plain UTF-8) |
|---|---:|---|---|
| `Vault export - NotebookLM.txt` | 168226021 | `ac33712d` | `5af9b4e57ab4165f4223b7e422f5748663000ac3202382d0ff1f6f493bf7e120` |
| `Vault export.html` | 173508002 | `84fea9d6` | `ed10d9b724f9a1c87230be9c8de83278695f0c40af1d93f8fbd40e93f5a02c56` |
| `Vault export.md` | 166628119 | `3a3c4b10` | `bbf77dc75ed93ddccf14e251dab09d529b2e615f1607f0608726ddd314d16379` |
| `Vault export - split/Notes.txt` | 166037073 | `b2267fb3` | `f97d5f9a7aef6fc95f188d380da451006d9eb3fa90361d5c1f4905b18041f090` |

- Stopped on the first full-size post-change gate failure; no repeat-until-green runs, altered thresholds, forced GC or later-plan work. Measurement scripts/bundles/data removed after recording this evidence.
- **Proposed bounded extension, awaiting written approval:** compress each rendered output once while it is available, retaining only prepared compressed ZIP records; assemble/write the ZIP last in its original canonical entry order. Reuse that preparation/assembly in the public iterable `buildZip`, rather than re-rendering every format for the ZIP. Preserve preflight checks, exact partial-error/cancellation accounting, output bytes and archive metadata. Add regressions before that extension, then repeat the same unchanged harness/gates. No disk streaming, parallel workers, dependencies or build configuration changes; no guarantee of the numerical result until measured.
- **Status: bloqué on RSS/time**, not on the now-approved test migration. Remaining: approval for this extension (or an explicit written P3 deferral), measurements meeting both strict gates, final green check and completion record. VE-014–017 remain unstarted.
