# VE-006 — Normalisation Unicode (NFC/NFD) des chemins comparés

| | |
|---|---|
| **Priorité** | **P2** — liens morts et exclusions de sécurité inopérantes sur les vaults macOS accentués |
| **Type** | bug (chemins / filtrage) |
| **Preuve** | **Reproduit en simulation** (chaînes NFD/NFC) + déduit du comportement macOS — voir « Limite de preuve » |
| **Références** | `src/core/filter.ts:29-41, 76, 100-170` · `src/core/wikilink.ts:45-66` |
| **Dépend de** | VE-002 (même fichier `filter.ts`) |
| **Bloque** | — |
| **Séance** | 1 |

## Constat

Exécuté avec les fonctions réelles :

```
buildLinkResolver([{ path: 'Notes/Cafe\u0301.md', … }])('Café')        → undefined
buildLinkResolver([{ path: 'Notes/Cafe\u0301.md', … }])('Cafe\u0301')  → 'Notes/Cafe\u0301.md'
normalizePath('Notes/Cafe\u0301.md') === normalizePath('Notes/Café.md') → false
```

Deux chaînes visuellement identiques (`é` précomposé U+00E9 vs `e` + accent combinant U+0301) sont traitées comme deux fichiers différents.

Conséquences, toutes silencieuses :

1. **Liens morts** : une note dont le nom sur disque est en NFD (HFS+, ou fichier créé par un autre outil) n'est pas retrouvée par un wikilink tapé en NFC. Le lien reste brut ou pointe vers une cible non résolue.
2. **Exclusions inopérantes** : `excludedFolders` / `excludedPrefixes` / `onlyFile` saisis en NFC ne correspondent pas aux chemins NFD. Un dossier censé être exclu peut être **exporté** (contenu privé), et `onlyFile` peut ne rien trouver.
3. **Protection des sorties** : `reservedOutputPaths` en NFC ne protège pas un chemin NFD → même boucle de réingestion que VE-002, par une autre cause.

## Comportement actuel / attendu

- **Actuel** : toutes les comparaisons sont des égalités de chaînes exactes ; aucune normalisation Unicode nulle part (`normalizePath` ne fait que des `/` et des `.`).
- **Attendu** : comparer les chemins sous une forme canonique (NFC) pour **toutes les décisions de correspondance**, sans changer les chaînes écrites sur disque.

## Cause racine

`normalizePath` (`filter.ts:29-41`) et `normalizeTarget` (`wikilink.ts:48-49`) normalisent les séparateurs, la casse et l'extension, mais pas la forme Unicode. Or la comparaison se fait entre **du texte saisi** (settings, liens) et **des noms provenant du disque**. Sur macOS, HFS+ stocke en NFD et APFS préserve la forme d'écriture ; un vault créé sur HFS+, restauré depuis une archive ou synchronisé depuis un autre outil peut donc contenir des noms NFD. Rien dans le plugin ne ramène les deux côtés à une forme commune.

## Sites affectés

| Site | Rôle |
|---|---|
| `src/core/filter.ts:76` (`normPath`) | base de **toutes** les comparaisons d'inclusion |
| `src/core/filter.ts:100-103` (`onlyPath`) | égalité exacte |
| `src/core/filter.ts:106-111` (`scopeRoot`) | préfixe de dossier |
| `src/core/filter.ts:114-120` (`reservedPaths`) | protection anti-réingestion |
| `src/core/filter.ts:123-131` (`excludedFiles`) | égalité / suffixe |
| `src/core/filter.ts:141-159` (`excludedFolders`) | égalité de parent / segment |
| `src/core/filter.ts:162-169` (`excludedPrefixes`) | préfixe de segment |
| `src/core/wikilink.ts:48-65` | clés et recherche du resolver |

`vaultRelativeOutputPath` (`outputTarget.ts`) n'est **pas** concerné : il compare deux chemins absolus issus de la même source (settings/OS), pas du texte saisi contre du disque.

## Plan d'action

1. **Ajouter une fonction de clé de comparaison** dans `filter.ts` (à côté de `normalizePath`, qu'elle réutilise) :

   ```ts
   /** Canonical form used for every path *comparison* (never for writing). */
   export function pathKey(value: string): string {
     return normalizePath(value).normalize('NFC');
   }
   ```

2. **Utiliser `pathKey` uniquement pour les valeurs comparées** dans `isFileIncluded` : `normPath`, `normOnly`, `normScope`, `normReserved`, `normExcluded`, `lowPrefix`. Les chaînes d'origine restent utilisées pour tout message ou retour (aucun ici, mais la règle vaut pour les futurs usages).
3. **Appliquer la même règle dans `wikilink.ts`** : `normalizeTarget` termine par `.normalize('NFC')`. Les valeurs retournées par le resolver restent `file.path` **non modifié** (c'est ce qui est écrit dans les liens de sortie).
4. **Ne pas** modifier `normalizePath` elle-même : elle sert aussi à construire des chemins de sortie (`buildSplitFiles`, `vaultGateway`) et changer sa sortie modifierait les noms écrits.
5. **Documenter** dans le commentaire de `pathKey` la raison (NFC vs NFD) et le fait que deux noms réellement distincts sur Linux (`é` et `e`+combinant) seront considérés identiques — c'est le comportement voulu pour un export.

## Test de non-régression

Dans `tests/core.test.ts` / `tests/gateway.test.ts` :

```ts
const nfd = 'Notes/Cafe\u0301.md';
const nfc = 'Notes/Café.md';
expect(buildLinkResolver([{ path: nfd, name: 'Cafe\u0301.md' }])('Café')).toBe(nfd);
expect(isFileIncluded('Notes/Cafe\u0301/inside.md', { …options, excludedFolders: ['Notes/Café'] })).toBe(false); // dossier NFD, filtre NFC
expect(isFileIncluded(nfd, { …options, reservedPaths: ['Notes/Café.md'] })).toBe(false);
expect(isFileIncluded('Notes/Cafe\u0301/inside.md', { …options, scopeRoot: 'Notes/Café' })).toBe(true);
// non-régression : deux noms réellement différents restent différents
expect(isFileIncluded('Notes/Cafe.md', { …options, excludedFiles: ['Notes/Café.md'] })).toBe(true);
```

Avant correctif, les trois premiers échouent (lien `undefined`, exclusion `true`, réservation `true`).

## Points d'impact

- `src/core/filter.ts` (une fonction + 6 normalisations), `src/core/wikilink.ts` (une ligne).
- Aucun changement de fichier écrit, de format ou de réglage.
- `tests/core.test.ts` (nouveaux cas), `tests/gateway.test.ts` (chargement depuis un vault).
- Léger coût CPU : `String.prototype.normalize` sur chaque chemin comparé. `isFileIncluded` est appelé une fois par fichier au chargement ; à 20 000 fichiers, coût estimé < 20 ms (à vérifier avec le script de mesure de VE-003, non bloquant).

## Limite de preuve

Le comportement de comparaison est **reproduit**. Le fait qu'un vault donné contienne réellement des noms NFD dépend de la machine (HFS+ vs APFS, origine des fichiers) et n'a pas été observé ici (Linux). Ce plan doit être présenté comme « corrige une classe de chemins, avérée sur macOS », pas comme « corrige un bug observé chez tous les utilisateurs ».

## Non-objectifs

- Normaliser les noms **écrits** (les sorties gardent la forme d'origine).
- Gérer les caractères visuellement identiques mais distincts (confusables, homoglyphes) : hors sujet.
- Modifier la casse (déjà traitée là où c'est nécessaire).

## Critères d'acceptation

- Les quatre tests ci-dessus passent ; le cas de non-régression aussi.
- Aucune écriture de fichier ne change de forme Unicode (test : le chemin produit pour une note NFD reste NFD).
- `npm run check` passe.

## Risques

- Sur Linux, deux notes `Café.md` (NFC) et `Cafe\u0301.md` (NFD) peuvent coexister ; elles seront traitées comme une seule pour les filtres. Cas extrêmement rare, et ambigu pour l'utilisateur lui-même ; documenté.
- Coût de `normalize` oublié sur un site de comparaison : le tableau des sites ci-dessus sert de checklist de revue.

## Journal d'exécution

### 2026-10-21 — `9780ac8`; documentation follow-up

- Baseline pull/check PASS (155 tests / 101 smoke); read the full plan and every listed filtering/resolver site.
- Tests first: **6 failed / 1 passed**. The four specified link/folder/reservation/scope regressions fail on NFC/NFD mismatches; additional coverage exercises onlyPath, excludedFiles and excludedPrefixes. The negative distinct-name/NFD-split-output test already passed. A real temporary-disk gateway regression failed to load an NFD path selected by an NFC scope.
- Added comparison-only `pathKey` and applied it to all seven inclusion decision sites. `normalizePath`, output construction, casing policy and original resolver return paths are unchanged. Resolver keys now normalize NFC. Comments document canonically equivalent Linux names sharing a comparison key.
- All **7 tests pass**, including original NFD link/output strings and the non-accented negative case. `npm run check` PASS: **162/162 tests, 101/101 smoke**, strict typecheck/build. Linux simulation/temporary files only, not a live macOS filesystem test; no normalization CPU target is claimed.

- Implementation `9780ac8` pushed; tracker marked `fait`. All acceptance criteria met; remaining: none.
