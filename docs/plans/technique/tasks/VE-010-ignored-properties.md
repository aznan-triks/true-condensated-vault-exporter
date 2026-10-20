# VE-010 — `ignoredProperties` doit aussi masquer les champs intégrés

| | |
|---|---|
| **Priorité** | **P2** — un réglage documenté ne fait pas ce qu'il dit ; peut exposer des métadonnées que l'utilisateur croit masquées |
| **Type** | bug (configuration) + dérive documentation |
| **Preuve** | **Reproduit** (4 champs intégrés, 3 sorties) |
| **Références** | `src/core/pipeline.ts:111-127` · `src/settings/SettingsTab.ts:327-338` · `src/core/types.ts:94, 152` |
| **Dépend de** | — |
| **Bloque** | — |
| **Séance** | 1 |

## Constat

Reproduction exécutée : settings avec `ignoredProperties` contenant `category`, `order`, `status`, `tags` (et `cssclasses` par défaut), note avec ces quatre propriétés en frontmatter.

`visibleMetadata(note, settings)` retourne :

```
[ ['Category','Cat'], ['Order','1'], ['Status','done'], ['Tags','alpha'] ]
```

et la sortie NotebookLM contient les lignes `Category: Cat`, `Order: 1`, `Status: done`, `Tags: alpha`. Les mêmes paires alimentent le Markdown et le HTML.

## Comportement actuel / attendu

- **Actuel** : le filtre `ignored` (`pipeline.ts:122`) n'est appliqué qu'aux clés **personnalisées** (`meta.custom`). Les quatre champs intégrés sont ajoutés avant, sans condition (`l. 118-121`).
- **Attendu** : le réglage s'applique à **toutes** les propriétés YAML exportées en métadonnées, y compris celles que le parseur extrait dans des champs dédiés.

## Cause racine

Deux chemins de lecture des métadonnées dans la même fonction : un chemin typé (`meta.category`, `meta.order`, `meta.status`, `meta.tags`) puis un chemin générique (`meta.custom`) auquel seul le second applique le filtre. Le libellé du réglage — « YAML properties omitted from exported metadata » — et la description (`SettingsTab.ts:330`) ne distinguent pas les deux.

## Sites affectés

| Site | Effet |
|---|---|
| `src/core/pipeline.ts:112-127` (`visibleMetadata`) | **source unique** du bug ; tous les formats en dépendent |
| `src/core/notebooklmFormatter.ts` | en-tête de document (`Category: …`, etc.) |
| `src/core/markdownFormatter.ts:45-52` | bloc `> [!INFO] Metadata` |
| `src/core/htmlFormatter.ts` | bloc de métadonnées |
| `src/settings/SettingsTab.ts:327-338` | libellé et description du réglage |
| `src/features/exportSplit.ts:38-40` | **hors périmètre** : recopie le frontmatter brut (voir Non-objectifs) |
| `tests/core.test.ts`, `tests/features.test.ts` | tests de métadonnées à compléter |

## Plan d'action

1. **Construire `ignored` avant les champs intégrés** et filtrer chaque paire par son libellé :

   ```ts
   const ignored = new Set(settings.ignoredProperties.map((p) => p.toLowerCase()));
   const add = (label: string, value: string) => {
     if (!ignored.has(label.toLowerCase())) pairs.push([label, value]);
   };
   if (meta.category) add('Category', meta.category);
   if (meta.order) add('Order', meta.order);
   if (meta.status) add('Status', meta.status);
   if (meta.tags.length > 0) add('Tags', meta.tags.join(', '));
   for (const [k, v] of Object.entries(meta.custom)) {
     if (!ignored.has(k.toLowerCase()) && v !== undefined && v !== '') {
       pairs.push([k, Array.isArray(v) ? v.join(', ') : String(v)]);
     }
   }
   ```

2. **Accepter aussi les alias YAML usuels** : `tag` → Tags, `categories`/`category` → Category. À décider explicitement : le plus simple est de tester le libellé **et** une liste courte de clés sources (`tag`, `tags`, `category`, `categories`, `status`, `order`). Sans cela, un utilisateur qui écrit `tag` dans le réglage ne verra pas de changement, alors qu'Obsidian traite `tag` comme `tags`.
3. **Mettre à jour la description du réglage** (dans le plan, pas dans cette séance) pour préciser : « champs YAML affichés dans l'en-tête des exports consolidés ; le mode split conserve le frontmatter d'origine sauf si `stripFrontmatter` est activé. »
4. **Ne pas** filtrer le frontmatter brut du mode split : c'est une copie fidèle de la note, contrôlée par `stripFrontmatter` (`exportSplit.ts:38-40`). Le dire dans la doc évite une fausse attente.

## Test de non-régression

Dans `tests/core.test.ts` ou `tests/features.test.ts` :

```ts
const settings = { ...DEFAULT_SETTINGS, ignoredProperties: ['category', 'order', 'status', 'tags'] };
expect(visibleMetadata(note, settings)).toEqual([]);                       // aujourd'hui : 4 paires
// avec un champ personnalisé non ignoré
expect(visibleMetadata(noteWithExtra, settings).map(([k]) => k)).toEqual(['Auteur']);
// sorties
expect(formatForNotebookLM([note], settings, 'now')).not.toContain('Status:');
expect(formatForMarkdown([note], settings, 'now')).not.toContain('**Status**');
```

Cas de non-régression : sans réglage, les quatre paires restent présentes (test existant à conserver).

## Points d'impact

- `src/core/pipeline.ts` uniquement pour le comportement ; les trois formateurs n'ont pas à changer.
- Tests de métadonnées dans `tests/core.test.ts` / `tests/features.test.ts`.
- Documentation : `README.md` l. 59 (mention générique) reste valable ; seule la description du réglage gagne une précision.
- Aucun changement de format de fichier ni de schéma de settings.

## Non-objectifs

- Filtrer le frontmatter du mode split (choix assumé, documenté).
- Masquer les métadonnées par défaut (`Category`/`Status` restent visibles tant que l'utilisateur ne les ignore pas).
- Changer la casse ou l'ordre d'affichage des paires.

## Critères d'acceptation

- Avec les quatre clés ignorées, `visibleMetadata` retourne `[]` et aucune des trois sorties ne contient ces libellés.
- Sans réglage, la sortie est identique à aujourd'hui (test de non-régression).
- La description du réglage mentionne la limite du mode split.
- `npm run check` passe.

## Risques

- Un utilisateur qui a mis `tags` dans `ignoredProperties` pour une autre raison verra ses tags disparaître des métadonnées (c'est le comportement demandé, mais c'est un changement visible) → à noter dans `CHANGELOG.md`.
- Les alias (`tag`/`categories`) doivent rester une liste fermée : sinon on réintroduit une divergence entre le réglage et le parseur.

## Journal d'exécution

### 2026-10-21 — `d34e657`; documentation follow-up

- Baseline pull/check PASS (180 tests / 107 smoke); read the full plan, visibleMetadata and all three formatter consumers, settings description, type comment, split raw-copy branch and YAML parser alias cases.
- Tests first: **5 failed / 2 passed**. Canonical/case-insensitive/alias lists failed to hide the four built-ins; custom-only metadata and consolidated-label assertions failed too. Exact default pair order/values and verbatim split frontmatter were already correct and remain so.
- Built-in and custom pairs now pass through the same visibility decision. Explicit closed aliases: `tag → tags`, `categories/categorie → category`, `ordre → order`, `statut → status`; canonical keys remain case-insensitive. No parser, label/order or formatter changes.
- Updated the setting description, type comment and README **now**, as required by the user's documentation rules and the plan's acceptance criteria (the action step's parenthetical delay is not followed). Individual split raw frontmatter is deliberately not filtered; Strip Frontmatter remains its control.
- All **7 tests pass**, proving four hidden built-ins across all consolidated formats, retained custom fields, unchanged default metadata and intact split YAML. `npm run check` PASS: **187/187 tests, 107/107 smoke**, typecheck/build. No settings schema or dependency change.

- Implementation `d34e657` pushed; tracker marked `fait`. All acceptance criteria met; remaining: none.
