# VE-012 — Markdown : échapper les libellés du sommaire

| | |
|---|---|
| **Priorité** | **P2** — le sommaire du format principal casse pour tout titre contenant `[` ou `]` |
| **Type** | bug (rendu) |
| **Preuve** | **Reproduit** |
| **Références** | `src/core/markdownFormatter.ts:34-43` · `src/core/wikilink.ts:68-70` (`escapeMarkdownLabel`) |
| **Dépend de** | — |
| **Bloque** | — |
| **Séance** | 1 |

## Constat

Avec une note nommée `A]B.md`, la ligne de sommaire produite est :

```
1. [A]B](#ab-0) <small>*(A.md)*</small>
```

Le lien s'arrête à `[A]`, le reste devient du texte. Reproduction identique avec `[` dans le titre (le lien ne s'ouvre pas) et avec un titre contenant les deux.

La ligne de titre de section (`## 1. A]B <a id="ab-0"></a>`) reste correcte : le problème est limité aux libellés de lien, donc au sommaire. Le corps de la note n'est pas concerné.

## Comportement actuel / attendu

- **Actuel** : `title` et `note.path` sont concaténés sans échappement dans une construction de lien Markdown (`markdownFormatter.ts:36`).
- **Attendu** : un titre contenant `[`, `]` ou `\` produit un lien valide, dont le libellé est le titre exact.

## Cause racine

Le formateur Markdown construit à la main `[libellé](cible)` sans appliquer la fonction d'échappement qui existe déjà pour les wikilinks (`escapeMarkdownLabel`, `wikilink.ts:68-70` : `\` → `\\`, `[` → `\[`, `]` → `\]`). Deux constructions de liens Markdown dans le projet, une seule protégée.

## Sites affectés

| Site | Problème |
|---|---|
| `src/core/markdownFormatter.ts:36` | ligne de sommaire : `title` non échappé, `note.path` non échappé dans `<small>` |
| `src/core/markdownFormatter.ts:42` | titre de section : pas de lien, pas de bug ; à laisser tel quel |
| `src/core/wikilink.ts:68-70` | la fonction d'échappement à réutiliser (actuellement privée) |
| `src/core/wikilink.ts:130-135` | seul autre constructeur de lien, déjà protégé |

## Plan d'action

1. **Exporter `escapeMarkdownLabel`** depuis `wikilink.ts` (une ligne : `export function …`). C'est le seul changement dans ce fichier ; ne pas déplacer la fonction (VE-005 et VE-006 le modifient déjà).
2. **L'utiliser dans le sommaire** :

   ```ts
   parts.push((i + 1) + '. [' + escapeMarkdownLabel(title) + '](#' + generateAnchor(title, i) + ') <small>*(' + escapeMarkdownLabel(note.path) + ')*</small>');
   ```

   L'ancre n'a pas besoin d'échappement : `generateAnchor` ne conserve que `\w`, espaces et `-` (`markdownFormatter.ts:9-15`), puis convertit les espaces en `-`.
3. **Ne pas échapper le titre de section** (`l. 42`) : il n'est pas dans un lien, et l'échapper afficherait des backslashes dans le document. C'est une asymétrie volontaire, à commenter d'une ligne pour éviter qu'un futur « nettoyage » ne l'uniformise.
4. **Ne pas** changer `generateAnchor` : il est déjà injectif grâce à l'index (`-` + i), et modifier son slug casserait les liens existants des exports déjà partagés.

## Test de non-régression

Dans `tests/core.test.ts` (ou `features.test.ts` selon l'organisation existante) :

```ts
const out = formatForMarkdown([note('A]B'), note('[Draft] Titre'), note('C\\D')], DEFAULT_SETTINGS, 'now');
expect(out).toContain('[A\\]B](#ab-0)');
expect(out).toContain('[\\[Draft\\] Titre](#draft-titre-1)');
expect(out).toContain('[C\\\\D](#cd-2)');
// le titre de section reste lisible, sans backslash
expect(out).toContain('## 1. A]B <a id="ab-0"></a>');
```

Avant correctif, les trois premières assertions échouent.

## Points d'impact

- `src/core/markdownFormatter.ts` (une ligne), `src/core/wikilink.ts` (visibilité d'une fonction).
- Sortie visible : les libellés du sommaire contiennent des `\` dans le fichier `.md`, rendus comme les caractères d'origine par Obsidian/GitHub. Aucun impact sur le texte affiché.
- Aucun impact sur `notebooklmFormatter` ni `htmlFormatter` (HTML échappe déjà, `l. 400-413`).
- `tests/core.test.ts` : un test existant peut comparer la ligne exacte du sommaire ; à mettre à jour avec la forme échappée.

## Non-objectifs

- Échapper les `*` et `_` du chemin dans `<small>` : un `_` dans une emphase est littéral, et un `*` dans un nom de fichier est impossible sous Windows. Documenter la limite.
- Réécrire le format de sommaire (numérotation, ancres, `small`).
- Unifier `generateAnchor` et `slugify` (contrats différents : ancres Markdown vs ids HTML).

## Critères d'acceptation

- Les titres contenant `[`, `]` ou `\` produisent un lien de sommaire valide (test par expression régulière de lien).
- Le titre de section reste identique à aujourd'hui.
- `npm run check` passe.

## Risques

- Double échappement si un titre contient déjà `\[` : `escapeMarkdownLabel` échappe d'abord `\`, donc le résultat est correct (`\\\[`), mais un test dédié est nécessaire.
- Un outil tiers qui analysait la ligne de sommaire sans comprendre les échappements verra des backslashes : c'est du Markdown standard.
