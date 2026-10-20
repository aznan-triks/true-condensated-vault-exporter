# VE-002 — Résolution des destinations : source unique de vérité et réservation correcte

| | |
|---|---|
| **Priorité** | **P1** — pollution croissante du vault à chaque session (garantie documentée non tenue) |
| **Type** | bug (boucle de rétroaction) + simplification (déduplication de logique) |
| **Preuve** | **Reproduit** (deux gateways successifs sur vault réel) + **déduit du code** pour le mécanisme |
| **Références** | `src/core/outputTarget.ts:92-122` · `src/core/filter.ts:183-212` · `src/obsidian/vaultGateway.ts:34-52` · `src/ui/SidebarView.ts:105` · `CHANGELOG.md` section 2.1.0 |
| **Dépend de** | VE-001 (le garde-fou rend l'écrasement fatal ; VE-002 évite qu'il se déclenche sur les sorties de la veille) |
| **Bloque** | VE-006 (même fichier `filter.ts`) |
| **Séance** | 1 |

## Constat

Reproduction exécutée :

1. Vault réel : `Notes/A.md` ; `useExternalOutputFolder: true`, `externalOutputFolder: '<vault>/Exports'`, `splitMode: 'individual-files'`, `splitOutputFolder: ''`.
2. Run 1 → écrit `Exports/Notes/A.md` ; 2 fichiers `.md`.
3. Réindexation simulée (nouvelle instance de gateway), run 2 → 3 fichiers `.md`, dont **`Exports/Exports/Notes/A.md`**.

La croissance se poursuit à chaque session. Le `CHANGELOG.md` 2.1.0 affirme pourtant : « Outputs written back inside the vault are protected from re-export again, even when they come from an absolute path or an external folder that lives under the vault root. »

## Comportement actuel / attendu

- **Actuel** : les sorties d'un run sont relues comme des notes au run suivant et re-exportées, en miroir.
- **Attendu** : toute destination écrite dans le vault est exclue de la lecture, y compris quand elle provient d'un dossier externe situé sous la racine, et quel que soit le format.

## Cause racine

`resolveOutputSettings` et `reservedOutputPaths` sont **deux implémentations de la même question** (« où vont les sorties »), appelées avec des entrées de formes différentes :

1. `runExports` résout une fois (`exportOrchestrator.ts:169`) puis passe les settings **résolus** au gateway (`l. 208`).
2. Le gateway les repasse à `reservedOutputPaths` (`vaultGateway.ts:40`), qui **re-résout** chaque destination (`filter.ts:205`).
3. `resolveOutputPath` n'est **pas idempotent** : un chemin absolu est réduit à son dernier segment (`outputTarget.ts:96-100`) avant d'être re-préfixé par le dossier externe.

Conséquence exacte : pour une destination consolidée `…/Exports/Vault export.md`, la re-résolution redonne le même chemin (le dernier segment est le nom du fichier) — **protection fortuite**. Pour le dossier split `…/Exports`, elle donne `…/Exports/Exports` : le dossier réellement écrit n'est jamais réservé. C'est pourquoi seuls les miroirs split prolifèrent.

Second site divergent : `SidebarView.ts:105` appelle `reservedOutputPaths` avec les settings **bruts**, donc la prévisualisation et le gateway ne calculent pas le même ensemble. Une seule des deux formes d'entrée peut être correcte.

## Sites affectés

- `src/core/outputTarget.ts:108-122` — `resolveOutputSettings` (point de résolution).
- `src/core/filter.ts:183-212` — `reservedOutputPaths` (re-résolution ; ignore les candidats vides, `l. 203`).
- `src/obsidian/vaultGateway.ts:34-52` — appelle la réservation avec des settings résolus.
- `src/ui/SidebarView.ts:105` — appelle la réservation avec des settings bruts.
- `tests/core.test.ts:55-90, 940-965` — comportement actuel de `reservedOutputPaths`.
- `tests/features.test.ts:207-227` — verrouille le fait que le gateway reçoit des chemins **absolus** (à conserver).
- `tests/gateway.test.ts:219-231` — couvre la protection avec des settings **bruts**, jamais avec la forme **résolue** réellement passée en production : c'est ce qui a laissé passer le bug. Ce test doit rester vert et un test résolu doit être ajouté.

## Plan d'action

1. **Figer le contrat** : documenter dans `ExportGateway.loadVaultFiles` (`src/core/types.ts:291-297`) que les settings reçus sont **déjà résolus** (c'est déjà le comportement, jamais écrit). Aucun autre appelant ne doit passer de settings bruts.
2. **Rendre la réservation purement dérivée** : ajouter à `reservedOutputPaths` une option `alreadyResolved?: boolean`. Quand elle est vraie, ne plus appeler `resolveOutputPath` : pousser `candidate` tel quel s'il est relatif, sinon le convertir avec `vaultRelativeOutputPath`. Le comportement par défaut reste inchangé pour les appelants non migrés (compatibilité des tests existants).
3. **Appeler la nouvelle forme** depuis `vaultGateway.loadVaultFiles` (`alreadyResolved: true`). Le test `tests/features.test.ts:207-227` doit rester vert sans modification (le gateway reçoit toujours des chemins absolus).
4. **Aligner la sidebar** : dans `SidebarView.refresh`, appeler `resolveOutputSettings(this.plugin.settings)` avant `reservedOutputPaths` (sans `alreadyResolved`), pour que l'aperçu compte les mêmes exclusions que l'export.
5. **Ne pas toucher** à la sémantique « destination split vide » : `resolveOutputSettings` la remplit déjà avec la racine externe ; quand le dossier externe est désactivé, la réservation ne peut pas réserver la racine du vault, et c'est VE-001 qui protège ce cas.
6. **Ajouter un test d'idempotence** : `resolveOutputSettings(resolveOutputSettings(s))` doit être égal à `resolveOutputSettings(s)` pour un dossier externe absolu sous la racine. Aujourd'hui il ne l'est pas ; après le plan, l'égalité doit être garantie soit par la résolution, soit par le fait que la réservation ne re-résout plus. Si l'étape 2 est retenue, ce test documente l'invariant et empêche la réapparition du motif.

## Test de non-régression

Dans `tests/core.test.ts` :

```ts
const resolved = resolveOutputSettings({ ...DEFAULT_SETTINGS, useExternalOutputFolder: true,
  externalOutputFolder: 'C:/Vault/Exports', splitOutputFolder: '' });
const reserved = reservedOutputPaths(resolved, { vaultBasePath: 'C:/Vault', alreadyResolved: true });
expect(reserved).toContain('Exports');            // le dossier split réel
expect(reserved).not.toContain('Exports/Exports'); // la sortie erronée actuelle
expect(reserved).toContain('Exports/Vault export.md');
```

Dans `tests/gateway.test.ts`, compléter le test existant par la forme **résolue** :

```ts
const resolved = resolveOutputSettings({
  ...DEFAULT_SETTINGS, useExternalOutputFolder: true,
  externalOutputFolder: path.join(vaultDir, 'Exports'), splitOutputFolder: '',
});
fs.writeFileSync(path.join(vaultDir, 'Exports/Notes/A.md'), 'previous export');
const files = await gateway.loadVaultFiles(resolved);
expect(files.map((f) => f.path)).toEqual(['Notes/Keep.md']);   // échoue aujourd'hui
```

Et dans `tests/features.test.ts` : un test avec un gateway réel (ou un double qui applique `isFileIncluded`) qui vérifie qu'un fichier `Exports/Notes/A.md` n'est **pas** chargé au run 2. Avant correctif, il est chargé et un troisième niveau apparaît.

## Points d'impact

- `src/core/outputTarget.ts`, `src/core/filter.ts`, `src/obsidian/vaultGateway.ts`, `src/ui/SidebarView.ts`.
- Tests `core.test.ts` (nouvelles assertions), `features.test.ts` (inchangé).
- Aucun changement de format de fichier ni de réglage utilisateur.
- `CHANGELOG.md` : la garantie 2.1.0 devient vraie ; ajouter une entrée « fixed » datée.

## Non-objectifs

- Ne pas fusionner `resolveOutputSettings` et `reservedOutputPaths` en un seul module : la première compose, la seconde traduit en chemins vault ; une fusion plus large serait une refonte sans gain mesuré (KISS).
- Ne pas changer la règle « chemin absolu = seulement son dernier segment » (protection contre l'écriture hors du dossier choisi).
- Ne pas traiter les noms de sortie invalides (VE-004) ni l'Unicode (VE-006).

## Critères d'acceptation

- Après deux runs successifs avec dossier externe sous la racine et split vide, le nombre de `.md` du vault reste **constant**.
- `reservedOutputPaths(resolved, { alreadyResolved: true })` contient `Exports`, jamais `Exports/Exports`.
- L'aperçu de la sidebar et la réservation du gateway calculent le même ensemble pour les mêmes settings.
- `npm run check` passe.

## Risques

- L'option `alreadyResolved` est un drapeau : mal utilisée, elle laisse passer une destination non résolue. Atténuation : un seul appelant, documenté, et un test d'idempotence.
- Un utilisateur ayant déjà des dossiers `Exports/Exports` les verra rester (ils ne sont plus *créés*, mais pas nettoyés). À signaler dans le message de release ; ne jamais supprimer de fichiers automatiquement.

## Journal d'exécution

### 2026-10-20 — blocked before implementation; user decision required

- Baseline: `git pull --rebase` up to date; `npm run check` **PASS**, 130 tests and 99 smoke assertions after VE-001 (`10cccd7`, documentation `51d1850`). Read the full plan and all listed affected sites.
- **Contradiction in action step 4:** it asks the sidebar to resolve settings, then call `reservedOutputPaths` **without** `alreadyResolved`. That is the very double-resolution the gateway fix is intended to remove. Reproduction with the plan's `C:/Vault/Exports` fixture and blank split destination gives:
  - first resolution: `splitOutputFolder = C:/Vault/Exports`;
  - second resolution: `splitOutputFolder = C:/Vault/Exports/Exports`;
  - reservation exactly as step 4 prescribes: `Exports/Vault export - NotebookLM.txt`, `Exports/Vault export.html`, `Exports/Vault export.md`, `Exports/Vault export.zip`, **`Exports/Exports`** (not `Exports`).
- **Contradiction in action step 6:** literal `resolveOutputSettings(resolveOutputSettings(s)) === resolveOutputSettings(s)` cannot follow merely from preventing re-resolution in the reservation function. The resolver's required absolute-path rule deliberately keeps only the final segment. For example `resolveOutputPath(raw, 'C:/Vault/Exports/nested/report.md')` returns `C:/Vault/Exports/report.md`; making paths under the external root implicitly "already resolved" would change that rule, which this plan explicitly forbids.
- **Existing test that would legitimately break:** `tests/gateway.test.ts`, `protects external outputs that are written back inside the vault`, passes raw external settings to `loadVaultFiles`. Step 3's unconditional `alreadyResolved: true` interprets its relative `Vault export.md` as a vault-root output instead of `Exports/Vault export.md`. Preserving that exact raw call conflicts with step 1's resolved-only gateway contract. Its assertions must be retained, but its input must be explicitly resolved (requires approval before modifying an existing test).
- Evidence executed with the existing esbuild dependency and pure core functions from a disposable `/tmp/ve-002-proof.mjs`; script removed. No VE-002 production code, dependency, build setting, or existing test changed. No red commit pushed.
- **Proposed minimal alternative, awaiting approval:**
  1. Keep the optional `alreadyResolved` flag and the resolver's current absolute-path semantics as planned.
  2. Gateway **and sidebar** reserve resolved settings using `alreadyResolved: true` (correct step 4's flag).
  3. Test stable **reservation of resolved settings**, not literal repeated resolution: expect `Exports`, never `Exports/Exports`, with matching sidebar/gateway sets. Keep default raw-settings compatibility tests for `reservedOutputPaths`.
  4. Migrate the existing raw gateway test's argument through `resolveOutputSettings`, preserving its name/coverage/assertions; add resolved blank-split and real two-run regression tests before the fix.
- Status: **bloqué**. Remaining: obtain written user approval for these adjustments; then execute VE-002 tests first and continue the imposed order. VE-003 and later plans have not been started.

### 2026-10-21 — resumed with user approval; implementation hash follows

- The user's **"continue"** approves the three adjustments requested in the preceding response: resolved reservations in both callers, stable reservation rather than repeated resolution, and explicit resolution of the existing gateway test input without weakening its assertions.
- Added `alreadyResolved` to `reservedOutputPaths`; both gateway and sidebar use it. Documented the resolved-only `loadVaultFiles` contract. Kept `resolveOutputSettings` and its absolute-leaf rule unchanged.
- Tests first: `reserves resolved destinations without re-rooting them (VE-002)` failed on missing `Exports`; `excludes previous blank-root split outputs with resolved settings (VE-002)` loaded the prior output; `keeps the Markdown count constant across reindexed split runs (VE-002)` failed on VE-001's overwrite rejection. All three pass after the fix. The two-run regression uses the existing **real gateway fixture in `tests/gateway.test.ts`**, rather than duplicating that fixture in features tests: **2 Markdown files after each run**, same output paths, no `Exports/Exports`, original comment retained.
- Smoke test `sidebar excludes the resolved blank split destination` failed with **2 notes**, then passed with **1 note** after the fix, exercising the actual sidebar and bundle.
- `npm run check` **PASS**: 133/133 unit tests, 100/100 smoke assertions, typecheck and production build. Existing raw `reservedOutputPaths` tests and the feature test asserting absolute paths received by the gateway remain unchanged and green.
- Updated the changelog; no automatic cleanup, dependency/configuration changes, or other fixes. Remaining: record the implementation hash and final tracker status.
