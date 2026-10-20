# VE-001 — Empêcher une sortie d'écraser une note source

| | |
|---|---|
| **Priorité** | **P0** — perte de données irréversible dans le vault de l'utilisateur |
| **Type** | bug (intégrité des données) |
| **Preuve** | **Reproduit** (vault temporaire réel pour split et Markdown ; gateway factice pour le ZIP, écriture réelle déduite de `modifyBinary`) |
| **Références** | `src/features/exportOrchestrator.ts:95-134, 262-305` · `src/features/exportSplit.ts:33-45` · `src/obsidian/vaultGateway.ts:148-196` · `src/core/filter.ts:175-212` |
| **Dépend de** | — |
| **Bloque** | VE-004 (partage le détecteur de collision) |
| **Séance** | 1 |

## Constat

Une destination de sortie peut être **exactement** le chemin d'une note chargée. L'export réécrit alors la note avec son propre contenu nettoyé.

Reproduction exécutée :

1. Vault temporaire avec `Notes/A.md` contenant un frontmatter `status: keep-me`, un corps et un commentaire `%%secret%%`.
2. `splitMode: 'individual-files'`, `splitOutputFolder: ''`, `scopeRoot: ''`, cible `['split']`.
3. `runExports` via la vraie gateway.

Résultat observé : `Notes/A.md` est réécrit ; `status: keep-me` et `%%secret%%` ont **définitivement** disparu. Mêmes résultats avec `splitOutputFolder` égal à la racine de portée et avec `markdownOutputPath` pointant sur une note (vault réel) ; le cas `zipOutputPath` est reproduit avec un gateway factice, et `writeBinary` → `modifyBinary` (`vaultGateway.ts:190`) garantit la même conséquence en réel.

## Comportement actuel / attendu

- **Actuel** : la sortie écrase silencieusement la source. Sur une sortie absolue, `fs.promises.writeFile` écrase aussi (`vaultGateway.ts:149-153`) ; sur une sortie vault, `app.vault.modify` est appelé dès que le fichier existe (`l. 158-166`).
- **Attendu** : refus **avant la première écriture**, avec un message qui nomme la sortie et la note concernées, et aucun fichier modifié.

## Cause racine

Aucun contrôle ne compare l'ensemble des destinations calculées à l'ensemble des chemins sources chargés. Les garde-fous existants protègent uniquement les collisions **entre sorties** (`selectOutputs`, `exportOrchestrator.ts:114-132`). `reservedOutputPaths` agit sur l'**inclusion** (ce qui est lu), pas sur l'**écriture** : il ne peut pas empêcher une écriture, et il ne connaît de toute façon pas la liste des notes.

## Sites affectés

Toutes les écritures passent par deux appels, donc le contrôle doit couvrir les deux :

| Site | Chemin | Couvert par |
|---|---|---|
| ZIP | `exportOrchestrator.ts:301` | contrôle sur `zipPath` |
| Sorties consolidées + split | `exportOrchestrator.ts:316` | contrôle sur `plainOutputs` |
| Écriture absolue | `vaultGateway.ts:148-153, 181-185` | contrôle en amont (le seul endroit où les sources sont connues) |
| Écriture vault (`modify`/`modifyBinary`) | `vaultGateway.ts:156-196` | idem |
| Commande « clean export » | `src/main.ts:95` | nom suffixé ` (clean export).md`, exclu par `isFileIncluded` ; **aucun changement** |

La comparaison doit gérer les sorties **absolues situées dans le vault** (dossier externe sous la racine) : elles doivent être ramenées en chemin relatif avec `vaultRelativeOutputPath` avant comparaison. `ExportGateway` n'expose pas la racine du vault ; `ObsidianVaultGateway` l'a déjà (`getVaultBasePath`).

## Plan d'action

1. **Ajouter une méthode optionnelle à l'interface** `ExportGateway` : `getVaultBasePath?(): string | null` (`src/core/types.ts:291-306`). `ObsidianVaultGateway` l'implémente en déléguant à la méthode existante ; les gateways de test peuvent l'omettre (les sorties absolues ne sont alors pas comparées, les sorties relatives le sont).
2. **Construire la clé de comparaison** dans un helper local à `exportOrchestrator.ts` :
   `sourceKey(path)` = `vaultRelativeOutputPath(path, base) ?? canonicalOutputPath(path)` puis `toLowerCase()`.
   Le `toLowerCase` est volontaire : un export doit rester portable, et deux chemins qui ne diffèrent que par la casse sont ambigus sur macOS/Windows. Sur Linux, cela sur-refuse un cas rarissime — c'est un échec explicite, pas une perte.
3. **Contrôler, juste après `selectOutputs` et la validation de `zipPath` (avant la ligne 291)** : pour chaque `plainOutputs[i].out.path` et pour `zipPath`, si sa clé appartient à la clé d'une source, lever
   `Error('Output "' + out + '" would overwrite the note "' + source + '". Choose another output folder or name.')`.
   Aucune écriture ne doit avoir eu lieu (le ZIP est encore à ce stade non construit).
4. **Ne rien changer dans la gateway** : le contrôle en amont suffit ; ajouter un second garde-fou côté gateway demanderait de lui passer la liste des sources, pour un gain nul (toutes les écritures viennent d'`runExports`).
5. **Message et journal** : émettre un `onProgress({ stage: 'Validating outputs', … })` avant le contrôle, pour que le panneau explique l'échec.

## Test de non-régression

Dans `tests/features.test.ts`, avec `fakeGateway` :

- `files = [{ path: 'A.md', … }]`, `splitMode: 'individual-files'`, `splitOutputFolder: ''` → `runExports(..., ['split'])` **rejette** avec `would overwrite the note "A.md"`, et `written.size === 0`.
- `markdownOutputPath: 'A.md'` → même rejet ; `zipOutputPath: 'A.md'` → même rejet.
- Variante dossier externe sous la racine : `useExternalOutputFolder: true`, `externalOutputFolder: '<base>/Exports'`, `splitOutputFolder: ''`, note `Exports/A.md` → rejet (la clé absolue est ramenée en `Exports/A.md`).
- Cas **négatif** obligatoire : `splitOutputFolder: 'out'` → passe (aucune régression).

Avant correctif, le premier test écrit la note et ne rejette pas : il échoue donc bien pour la bonne raison.

## Points d'impact

- `src/core/types.ts` (interface), `src/features/exportOrchestrator.ts` (contrôle), `tests/features.test.ts` (4 tests), `tests/core.test.ts:729` (test `buildSplitFiles` avec destination vide) reste valide.
- Nouveau cas d'erreur visible par l'utilisateur → à documenter dans `CHANGELOG.md` et dans le message de la commande.
- Les gateways factices de `tests/features.test.ts` n'ont pas besoin de la nouvelle méthode optionnelle.

## Non-objectifs

- Ne pas changer la sémantique « destination split vide = racine de sortie » (documentée en 2.1.0) ; on la rend sûre, on ne la supprime pas.
- Ne pas détecter les collisions entre deux sorties (VE-004) ni les noms invalides sous Windows.
- Pas de sauvegarde/restauration de la note écrasée : le contrôle doit être préventif, pas curatif.

## Critères d'acceptation

- Aucun des quatre scénarios d'écrasement reproduits ne modifie un fichier source.
- Le message d'erreur contient le chemin de sortie **et** le chemin de la note.
- `npm run check` passe ; les 4 nouveaux tests échouent sur le code actuel et passent après.
- Aucun changement de comportement pour un export dont les destinations sont distinctes des sources (test négatif).

## Risques

- Sur-refus par `toLowerCase()` sur un vault Linux contenant `A.md` et `a.md` : message explicite, contournable en renommant. Acceptable et documenté.
- Un utilisateur qui utilisait sciemment ce comportement (exporter par-dessus une note) perd cette possibilité : c'est l'objet du correctif.
