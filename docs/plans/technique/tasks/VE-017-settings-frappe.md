# VE-017 — Persistance : temporiser les sauvegardes et borner l'historique

| | |
|---|---|
| **Priorité** | **P3** — jank de saisie et écritures disque multipliées sur les gros vaults |
| **Type** | performance (UI + I/O) |
| **Preuve** | **Déduit du code** + **mesures de composants** (taille JSON, filtre de portée) |
| **Références** | `src/settings/SettingsTab.ts` (20+ `onChange`) · `src/main.ts:152-172` · `src/features/exportHistory.ts:6-53` · `src/features/exportSplit.ts:36-45` |
| **Dépend de** | — |
| **Bloque** | — |
| **Séance** | 1 |

## Constat

Deux facteurs se cumulent derrière un seul symptôme (saisie lente dans les réglages, disque sollicité) :

1. **Aucune temporisation.** Chaque champ texte appelle `text.onChange(async (val) => { this.plugin.settings.x = val; await this.plugin.saveSettings(); })` (20+ occurrences : titre du document, chemins de sortie, dossier externe, CSS personnalisé, pied de page…). `saveSettings` écrit **tout** `data.json` (settings + historique) via `persistSettingsData`, puis rafraîchit la sidebar (`main.ts:152-161`), laquelle relit la liste complète des fichiers.
2. **Historique non borné.** `ExportHistoryEntry.files` contient **tous** les chemins écrits (`exportHistory.ts:13, 26-36`), et 5 entrées sont conservées (`HISTORY_LIMIT = 5`). En mode split individuel, un seul export peut en produire des dizaines de milliers.

Mesures de composants :

| Élément | Mesure |
|---|---|
| `data.json` avec 5 exports de 1 000 fichiers | 0,2 Mo |
| 5 exports de 8 000 fichiers | **1,9 Mo** |
| 5 exports de 32 000 fichiers | **7,7 Mo** |
| `JSON.stringify` à 7,7 Mo | 39 ms |
| Prévisualisation de portée (`isFileIncluded` sur 20 000 chemins) | 87 ms |
| Écriture disque | non mesurée (dépend du support ; Obsidian peut synchroniser ce fichier) |

Soit ~130 ms de travail CPU **par caractère saisi**, hors écriture disque, sur un vault de 20 000 notes.

## Comportement actuel / attendu

- **Actuel** : une frappe = une écriture complète + un rafraîchissement complet ; plusieurs frappes rapides lancent des `saveData` concurrents, sans ordre garanti (deux écritures peuvent se terminer dans le désordre).
- **Attendu** : une écriture au plus toutes les ~300 ms pendant une rafale ; `data.json` < 200 Ko même avec 5 exports de 32 000 fichiers ; l'historique affiche toujours un décompte exact et permet de révéler le premier fichier.

## Cause racine

La persistance est déclenchée **par événement de frappe** au lieu de l'être par « fin de modification », et le payload persisté grandit avec le nombre de fichiers exportés alors que l'UI n'utilise que deux informations : le nombre de fichiers, le total d'octets et le premier chemin.

## Sites affectés

| Site | Rôle |
|---|---|
| `src/settings/SettingsTab.ts` (tous les `onChange` texte) | déclencheurs |
| `src/main.ts:152-161` (`saveSettings`) | écriture + refresh sidebar |
| `src/main.ts:163-172` (`setHistory`) | écriture après chaque export |
| `src/features/exportHistory.ts:6-53` | schéma et assainissement |
| `src/ui/SidebarView.ts` (rendu de l'historique) | consomme `entry.files` |
| `src/features/exportOrchestrator.ts:179-205` | construit l'entrée depuis `result.written` |

## Plan d'action

1. **Ajouter une temporisation unique** dans `SettingsTab` : `private saveTimer: number | null` + `scheduleSave()` qui fait `window.clearTimeout` puis `window.setTimeout(() => void this.plugin.saveSettings(), 300)`. Remplacer les appels `await this.plugin.saveSettings()` des champs **texte** par `this.scheduleSave()`.
   - Les `toggle`/`dropdown`/`slider` peuvent rester immédiats (un changement = une intention, pas une rafale) ; ne pas uniformiser sans raison.
   - Vider le timer dans `hide()`/`onClose` de l'onglet pour ne pas perdre la dernière frappe.
   - `plugin.settings` est muté **immédiatement** : un export lancé juste après lit la bonne valeur, seule l'écriture disque est différée.
2. **Borner l'historique** : ajouter à `ExportHistoryEntry` deux champs `fileCount: number` et `totalBytes: number`, et stocker au plus `HISTORY_FILE_SAMPLE = 20` chemins.
   - `pushHistory` : `files: entry.files.slice(0, HISTORY_FILE_SAMPLE)`, `fileCount: entry.files.length`, `totalBytes: totalBytes(entry.files)`.
   - `sanitizeHistory` : accepter les anciennes entrées sans les nouveaux champs (`fileCount = files.length`, `totalBytes = totalBytes(files)`), et tronquer les listes géantes au chargement (sinon un `data.json` déjà gros le reste).
   - `SidebarView` : afficher `fileCount`, révéler `files[0]?.path`. Vérifier chaque usage de `.files` (décompte, taille, reveal).
3. **Mesurer après** : régénérer `data.json` avec 5 entrées de 32 000 fichiers simulées (script jetable, même méthode que l'audit) → cible < 200 Ko ; vérifier qu'une rafale de 10 frappes ne produit qu'une écriture (espionner `saveData` dans le mock).
4. **Ne pas** déplacer l'historique dans un fichier séparé : une écriture de 200 Ko dans `data.json` est acceptable, et un second fichier ajouterait une migration et un chemin d'échec.

## Test de non-régression

- `tests/features.test.ts` / test unitaire de `exportHistory` :
  - `pushHistory` conserve `fileCount` exact et `files.length <= 20` ;
  - `sanitizeHistory` lit une entrée de l'ancien format (sans `fileCount`) et la complète correctement ;
  - `sanitizeHistory` tronque une entrée de 10 000 chemins à 20 tout en gardant `fileCount = 10 000`.
- Test UI/mock : 10 `onChange` successifs en < 300 ms → un seul `saveData` (espion), et la dernière valeur est bien persistée après le délai.
- Test de non-régression : un export avec 1 fichier produit un historique identique en apparence (N fichiers, taille totale, reveal du premier).

## Points d'impact

- `src/features/exportHistory.ts` (schéma, migration douce), `src/settings/SettingsTab.ts` (temporisation), `src/main.ts` (éventuel flush), `src/ui/SidebarView.ts` (décompte).
- `data.json` : schéma additif, rétro-compatible ; un utilisateur qui revient à une version antérieure lira les entrées sans les nouveaux champs (les anciens champs `files` restent présents).
- Aucun impact sur les exports eux-mêmes.

## Non-objectifs

- Changer le nombre d'entrées conservées (5).
- Compresser `data.json` ou déplacer l'historique.
- Temporiser les exports ou les commandes.

## Critères d'acceptation

- `data.json` < 200 Ko pour 5 entrées de 32 000 fichiers.
- Une rafale de frappes produit une seule écriture, et la dernière valeur est conservée.
- L'historique affiche un nombre exact de fichiers et révèle toujours le premier chemin.
- Une entrée d'ancien format est chargée sans erreur et sans perte de décompte.
- `npm run check` passe.

## Risques

- Perte de la dernière frappe si Obsidian se ferme dans la fenêtre de 300 ms : atténué par le flush dans `onClose` et par le fait que la valeur est déjà en mémoire ; à documenter.
- Si un futur code dépend de `entry.files.length`, il lira un nombre tronqué : remplacer tous les usages par `fileCount` et ajouter un commentaire sur le champ `files` (« échantillon pour l'UI, pas la liste complète »).

## Journal d'exécution

### 2026-10-21 — blocked before implementation; existing timing-test migration

- Baseline pull/check **PASS: 260 tests / 113 smoke** after VE-016 (`f20c2a4`, completion `3c72d7b`). Read the full plan and all settings callbacks/helpers, persistence/load/history paths, history schema/consumers, actual command entry construction and mock storage behavior. No VE-017 source or existing test has changed.
- **Existing timing expectation requiring migration:** `tools/mock-obsidian/run.cjs`, `edited text setting is saved`, dispatches a text change, waits **30 ms**, then checks the persisted NotebookLM path. The plan deliberately delays text persistence by **300 ms**. This scenario must wait for the debounce/explicit flush instead, while retaining its exact final-value assertion; approval is required before changing that existing scenario under the standing test-conflict rule.
- The current mock masks that timing conflict: `Plugin.saveData` retains the supplied object by reference. Concrete executed proof: after one initial mock save, mutating the settings object makes `_data.settings.title` read the new value with **0 new saveData calls**. Thus an early `_data` assertion does not prove disk persistence. New regressions must count real saveData calls and snapshot saved values rather than rely on live aliases.
- Pre-fix size measurement, same planned 5 × 32,000-file method, deterministic paths `Exports/Notes/N<i>.md`, 1,024 bytes per output, default settings: **7,625,960 bytes** for serialized plugin data, **36.28 ms** stringify, all five lists retain 32,000 paths. Disposable script/bundle/JSON removed after recording evidence.
- **Proposed targeted adaptation, awaiting approval:** migrate the existing smoke wait past 300 ms (or explicitly flush), preserving its expected final value; add ten-keystroke call-count/last-value/close-flush regressions before the fix. Snapshot and serialize plugin data writes so settings/history callbacks cannot finish out of order, while discrete controls remain immediate and pending text edits are not duplicated. Add backward-compatible summary metadata plus a 20-path sample and update all aggregate consumers; keep full ExportResult/partial results untouched.
- Status: **bloqué** pending this existing-test timing migration. Then write/run regressions before implementation, repeat the same size measurement and prove one write for ten keystrokes, final green check, docs and push. No new dependency, build configuration, user-data or export behavior change is proposed.

### 2026-10-21 — `482fa5c`, resumed with approval; completion record

- The user selected **“Valider et terminer VE-017”** for the exact timing-test migration and serialized saves. On resume, restored-file hashes matched pushed `69d1784`; retained a duplicate backup stash and fast-forwarded the same session branch to that verified history. Existing-lockfile dependencies restored; resumed pull/check **PASS: 260 tests / 113 smoke**. No pushed history/user work was discarded.
- Tests first: **25 failed / 1 passed** across 26 new cases. History lacked summaries/caps/migration and exceeded the size gate; all 13 persistent text/textarea callbacks saved ten times, the cross-field timer/close/unload semantics were absent, saves overlapped and oversized history passed through. Existing rejection/retry behavior was a positive control. Six new smoke assertions first had **3 failures**: ten writes during/after typing and unbounded persisted history. The approved old text check now waits 350 ms, with its exact final-value assertion unchanged.
- One shared 300 ms trailing timer covers the **13 actual persistent text/textarea controls** (the plan's 20+ count also includes discrete/local-only callbacks). Settings still mutate immediately. Toggles/dropdowns/sliders/color/list/picker intentions remain immediate and consume a pending text timer instead of duplicating its save. Tab `hide()` and plugin unload flush pending edits; scheduled failures are reported while edits remain in memory for retry.
- Settings, history and sidebar-target persistence share one ordered queue of immutable snapshots. The individual operation still rejects; recovering the queue does not swallow its caller's error or prevent later writes. No debounce of exports or commands. An extra error-feedback/retry regression covers the new timer boundary.
- History normalization counts the full valid legacy list before retaining **20 paths**, preserves validated existing aggregates through reload/re-push, and still keeps **5 runs**. Summary fields are optional at the TypeScript legacy-input boundary to preserve existing typed producers, but every normalized/persisted record includes them. All aggregate UI consumers use full count/bytes, with legacy fallback; first-path reveal is unchanged. Actual entry construction is in `commands/registry.ts`, already routed through `pushHistory`; `ExportResult` and full failure/cancellation results are deliberately untouched.
- All **27 new tests** pass, including ten changes on every persistent text field, trailing cross-field debounce, immediate controls, no duplicate flush, immutable ordering, error/retry, unload, legacy/large-history summaries, JSON round-trip, size and original-result immutability. New UI tests use the existing jsdom/CJS mock under the Node runner (Obsidian ships declarations only); no resolver/build/test configuration or dependency change.
- Full `npm run check` **PASS: 287/287 tests across 7 files, 119/119 smoke**. Real production-bundle mock spy: **10 keystrokes → exactly 1 saveData call**, last value persisted after the delay, live value available before it. Sampled history displays **100 files / 100.0 KB** while retaining 20 paths and revealing the actual first output.
- Same five-run × 32,000-file reconstruction as the pre-fix measurement: **7,625,960 → 6,160 bytes** serialized plugin data (**PASS <200,000 bytes**), stringify **36.28 → 0.075 ms**. Each retained list has 20 paths while each aggregate remains **32,000 files / 32,768,000 bytes**. These are deterministic default-settings/history component measurements, not a universal bound for arbitrarily large user CSS. Disposable script/bundle/JSON removed.
- README/changelog document the sample and save window. Flush is best effort: the synchronous host unload hook cannot guarantee completion if the process is forcibly terminated. No existing user vault/data.json was edited, no second persistence file added, no exported output removed.
- Implementation `482fa5c` pushed; tracker marked `fait`. All VE-017 acceptance criteria met; remaining: none.
