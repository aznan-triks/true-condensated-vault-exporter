# VE-004 — Noms de fichiers de sortie : collisions bloquantes et noms invalides

| | |
|---|---|
| **Priorité** | **P3** — aucun écrasement (le garde-fou fonctionne), mais erreur opaque et export bloqué ; portabilité Windows |
| **Type** | robustesse / ergonomie |
| **Preuve** | **Reproduit** (3 cas) |
| **Références** | `src/features/exportSplit.ts:36-63` · `src/features/exportOrchestrator.ts:114-132` |
| **Dépend de** | VE-001 (le détecteur de collision peut être partagé) |
| **Bloque** | — |
| **Séance** | 1 |

## Constat

Reproductions exécutées avec `runExports` sur un gateway factice :

1. **Mode groupé, sanitisation non injective** : dossiers `A?B` et `A_B` → `safeName` (`exportSplit.ts:61`) remplace `?` par `_` → les deux produisent `out/A_B.txt`. Résultat : **échec** `Output path conflict: out/A_B.txt is used by more than one export.` — aucune écriture, donc aucune perte, mais l'erreur ne dit pas quelles notes sont en cause.
2. **Mode individuel, `.canvas` → `.md`** : `X.md` et `X.canvas` produisent tous deux `out/X.md` (`exportSplit.ts:41-43`) → même échec, alors que ces deux fichiers coexistent légitimement dans Obsidian.
3. **Mode individuel, aucun assainissement** : une note `Q?&.md` produit `out/Q?&.md`, écrit tel quel. Sous Windows, l'écriture échouerait **en cours** d'export (fichiers partiels, cf. VE-009) ; sous Linux/macOS, le fichier est créé, mais l'export n'est pas portable.

Correctif de constat par rapport à l'hypothèse initiale : **il n'y a pas d'écrasement silencieux**. `selectOutputs` (`exportOrchestrator.ts:114-132`) détecte les doublons de chemin et échoue avant la première écriture. Le défaut est donc l'inverse d'une perte de données : un blocage complet pour une ambiguïté prévisible, avec un message inexploitable.

## Comportement actuel / attendu

- **Actuel** : l'export entier échoue sur `Output path conflict: <chemin>` ; l'utilisateur ne sait pas quelles notes renommer. Les caractères interdits sous Windows passent jusqu'à l'écriture.
- **Attendu** : message nommant les deux sources (note ou dossier) et le chemin cible ; chemins assainis de façon déterministe pour être valides sur les trois systèmes.

## Cause racine

La dérivation chemin source → chemin de sortie n'est ni injective ni validée :

- mode individuel : `rel = relativeToFolder(note.path, scopeRoot) ?? note.path`, puis `.replace(/\.canvas$/i, '.md')` — aucune transformation des caractères interdits, et le remplacement d'extension crée des collisions ;
- mode groupé : `safeName = group.replace(/[<>:"/\\|?*]/g, '_') + '.txt'` — transformation non injective (`A?B` et `A_B` → `A_B`) ;
- aucune vérification d'unicité après dérivation.

Le contrôle `selectOutputs` (`exportOrchestrator.ts:114-132`) détecte bien deux sorties de même chemin, mais seulement si leurs **contenus diffèrent** (`if (previous.out.content === item.out.content) continue;`) et il s'exécute sur les chemins déjà construits : il lève `Output path conflict` dans le cas 1 ou 2, mais seulement pour les cibles demandées ensemble. Il ne fournit ni la source responsable, ni un contrôle dans `buildSplitFiles` — et le message ne dit pas quelles notes sont en cause. Surtout, il ne détecte pas les noms **invalides**.

## Sites affectés

- `src/features/exportSplit.ts:36-45` — mode individuel (dérivation + extension).
- `src/features/exportSplit.ts:47-63` — mode groupé (`safeName`).
- `src/features/exportOrchestrator.ts:114-132` — déduplication (à conserver pour les conflits **entre** formats).
- `tests/core.test.ts:700-745` — tests de `buildSplitFiles` (chemins attendus).
- `src/main.ts:95` — commande « clean export » : nom dérivé d'un seul fichier, pas concernée.

## Plan d'action

1. **Extraire un helper de nommage** local à `exportSplit.ts` : `safeSegment(segment)` qui remplace les caractères interdits par `_` et supprime les points/espaces finaux. Caractères : `<>:"/\\|?*` et `\u0000-\u001F`. Appliquer **segment par segment** sur `rel` en mode individuel (pour ne pas casser l'arborescence) et à `group` en mode groupé.
2. **Détecter les collisions après dérivation**, dans `buildSplitFiles`, avant de retourner (c'est là que les sources sont connues) :
   - clé = `canonicalOutputPath(path).toLowerCase()` (cohérent avec VE-001 : un export doit rester portable) ;
   - `Map<string, { path, source }>` ; en cas de doublon, lever
     `Error('Two split outputs would be written to "' + path + '": "' + firstSource + '" and "' + source + '". Rename one note or folder, or use another split mode.')`
   - `source` = `note.path` en mode individuel, `'folder "' + group + '"'` en mode groupé.
   - Cette erreur se produit **avant** `selectOutputs` ; le message existant de `selectOutputs` reste le filet de sécurité pour les conflits entre formats.
3. **Noms réservés Windows** (recommandé, 3 lignes) : si un segment, sans extension, est `CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]` (insensible à la casse), préfixer par `_`. Sinon l'écriture échoue sous Windows avec un message Obsidian peu compréhensible.
4. **Ne pas** renommer automatiquement en cas de collision (`A_B (2).txt`) : cela masquerait une ambiguïté de contenu et compliquerait la correspondance note ↔ sortie. L'erreur explicite, mais **nommée**, est le comportement attendu (fail-fast).
5. **Conserver** `selectOutputs` pour les conflits entre un fichier split et un fichier consolidé : il reste la seule garde inter-formats.

## Test de non-régression

Dans `tests/core.test.ts` (section split) :

- mode groupé `['A?B/x.md', 'A_B/y.md']` → `buildSplitFiles` **lève** et le message contient `A?B` et `A_B`.
- mode individuel `['X.md', 'X.canvas']` → lève et le message contient les deux chemins sources.
- `runExports` sur ces corpus : `written.size === 0` (l'échec reste préventif).
- mode individuel `['Q&A?.md']` → chemin produit `out/Q_A_.md` (ou équivalent stable), et **plus aucun** caractère `?`/`:`/`*`/`|`/`"`/`<`/`>` dans le chemin.
- mode individuel `['CON.md']` → segment préfixé (`_CON.md`).
- **Non-régression** : `['A.md', 'B/C.md']` → deux chemins inchangés, aucune exception ; un test compare la liste exacte pour un corpus de 10 notes.
- Vérifier que `tests/core.test.ts:700-745` reste vert (les noms utilisés n'ont pas de caractère spécial).

## Points d'impact

- `src/features/exportSplit.ts` uniquement (plus les tests).
- Changement visible : un export qui « réussissait » en écrasant silencieusement échoue maintenant avec un message. À annoncer dans `CHANGELOG.md`.
- `selectOutputs` n'est pas modifié dans ce plan (voir VE-003).

## Non-objectifs

- Ne pas changer le format des noms par défaut (`Note.md` reste `Note.md`).
- Ne pas traiter la casse des systèmes de fichiers au-delà du contrôle de collision (la clé `toLowerCase` sert uniquement à détecter).
- Ne pas normaliser l'Unicode des noms (VE-006 concerne les comparaisons, pas l'écriture).

## Critères d'acceptation

- Les trois cas reproduits lèvent une erreur **avant** toute écriture ; pour les deux collisions, les deux sources sont nommées.
- Aucun chemin produit ne contient de caractère interdit sous Windows.
- Un corpus sans collision produit exactement les mêmes chemins qu'aujourd'hui.
- `npm run check` passe.

## Risques

- Deux notes qui ne différaient que par `.canvas`/`.md` ne peuvent plus être exportées ensemble en mode individuel : c'est le prix de l'absence de perte silencieuse ; l'utilisateur peut changer de mode ou renommer.
- Le préfixage `_CON` change un nom de fichier rare ; documenté dans le message de release.

## Journal d'exécution

### 2026-10-21 — `82f8652`; documentation follow-up

- Baseline pull/check PASS (192 tests / 107 smoke); read full plan, both split naming branches, inter-format guard and clean-export command (unchanged).
- Tests first: **10 failed / 1 passed**. Failures reproduce missing source-aware collisions in grouped/individual/case-only cases (including identical bodies), illegal/control/trailing characters, reserved device names, and opaque run-level errors. A safe ten-note ordered corpus already passed.
- Added local segment sanitization for both modes and a destination map keyed by portable case-insensitive paths. Collisions always fail before returning split outputs, with both quoted source notes/folders and the target, even if bodies match; no numbered automatic renaming. Reserved CON/PRN/AUX/NUL/COM1–9/LPT1–9 stems are prefixed. Empty sanitized segments use `_`. Original Unicode and configured destination roots are not rewritten.
- Clarified two inconsistent examples by following the ordered action steps: illegal generated characters are **sanitized**, not rejected (the acceptance sentence saying all three examples throw conflicts with step 1/tests); `&` is legal and retained, so `Q&A?.md → Q&A_.md`. Actual collisions still reject. Group labels use readable `folder "name"` formatting rather than nested quote pairs.
- All **11 tests pass**; run-level fixtures assert zero text/binary writes and both source names. Existing inter-format safety/order/NFD tests remain unchanged and green. `npm run check` PASS: **203/203 tests, 107/107 smoke**, typecheck/build. Behavior intentionally stricter for case-only/equal-body collisions; documented in changelog.

- Implementation `82f8652` pushed; tracker marked `fait`. All acceptance criteria met; remaining: none.
