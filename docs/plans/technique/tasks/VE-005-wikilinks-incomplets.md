# VE-005 — Wikilinks : liens à ancre seule, pipes échappés, tailles d'embed

| | |
|---|---|
| **Priorité** | **P2** — contenu brut (`[[…]]`) laissé dans les exports, fréquent dans les notes d'index |
| **Type** | bug (rendu) |
| **Preuve** | **Reproduit** (transformations observées) |
| **Références** | `src/core/wikilink.ts:17, 95-140` · `src/core/pipeline.ts:98` · `src/ui/SidebarView.ts` (aperçus) · `CHANGELOG.md` 2.0.3 |
| **Dépend de** | — |
| **Bloque** | VE-006 (même fichier `wikilink.ts`) |
| **Séance** | 1 |

## Constat

Entrées exécutées et sorties observées :

| Entrée | Format | Sortie observée | Attendu |
|---|---|---|---|
| `[[#Sommaire]]` | tous | **inchangé** (0 lien extrait) | `Sommaire` / `[Sommaire](#sommaire)` |
| `[[Note#]]` | tous | **inchangé** | `Note` |
| `[[Note\|]]` | tous | **inchangé** | `Note` |
| `[[Note#Titre\|Alias]]` | markdown | `[Alias](Note.md#titre%5C)` | `[Alias](Note.md#titre)` |
| `[[Note\|Alias]]` | canonical-alias | `Note\ (Alias)` | `Note (Alias)` |
| `![[pic.png\|300]]` | markdown | `![300](Assets/pic.png)` | `![pic.png](Assets/pic.png)` |
| `![[pic.png\|300x200]]` | clean-text | `300x200` | `pic.png` |

## Comportement actuel / attendu

- **Actuel** : ces formes ne correspondent pas à l'expression régulière, ou produisent une cible polluée par un backslash, ou prennent la taille pour un texte alternatif. En `clean-text`, `[[#Sommaire]]` reste littéralement dans le texte exporté.
- **Attendu** : un lien Obsidian valide est toujours transformé ; une taille d'embed n'est jamais un texte affiché ; un pipe échappé (`\|`, syntaxe des tableaux) ne laisse pas de `\`.

## Cause racine

Une expression unique avec des groupes **obligatoires** (`src/core/wikilink.ts:17`) :

```
/!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g
```

- `([^\]|#]+)` exige au moins un caractère qui n'est ni `]`, `|` ni `#` : un lien réduit à une ancre (`[[#Titre]]`) ne peut pas correspondre ;
- `#([^\]|]+)` et `\|([^\]]+)` exigent au moins un caractère : `[[Note#]]` et `[[Note|]]` ne correspondent pas ;
- le backslash de `\|` (échappement de pipe dans un tableau Markdown, standard Obsidian) est capturé comme un caractère ordinaire de la cible ou de l'ancre ;
- `alias` est utilisé tel quel comme texte affiché (`l. 110, 115`), sans distinguer un alias d'une taille `N` ou `NxM`.

`extractWikilinks` (`l. 19-39`) utilise la même expression : la sidebar et l'export partagent donc les mêmes angles morts. Le corriger dans une seule des deux fonctions créerait une divergence pire que le bug.

## Sites affectés

- `src/core/wikilink.ts:17` — expression partagée.
- `src/core/wikilink.ts:19-39` — `extractWikilinks` (aperçus sidebar).
- `src/core/wikilink.ts:104-139` — `transformWikilinks`, branches `clean-text`, `canonical-alias`, `markdown`.
- `src/core/wikilink.ts:134` — génération d'ancre (`encodeURIComponent` sur la casse minuscule).
- `src/core/pipeline.ts:98` — appel via `applyToProse` (les blocs de code restent protégés : ne pas contourner ce point).
- Tests : `tests/core.test.ts` (section wikilinks), `tests/features.test.ts` (exports), smoke `tools/mock-obsidian/run.cjs` (contenu transformé).

## Plan d'action

1. **Rendre les groupes facultatifs** : `/!?\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g`. Vérifier qu'un `[[]]` vide (cible et ancre vides) reste **inchangé** (sinon on supprimerait du texte).
2. **Déséchapper le pipe** : après capture, retirer **un** `\` final de `target` et de `heading` (`value.replace(/\\$/, '')`). Ne pas faire un `replace` global : un backslash au milieu d'un nom de fichier est légal sur Linux.
3. **Lien à ancre seule** (`target === ''`, `heading` non vide) :
   - `clean-text` → `heading` ;
   - `canonical-alias` → `heading` ;
   - `markdown` → `[heading](#slug)` (destination vide = fichier courant) ; ne pas appeler le resolver pour une cible vide.
4. **Tailles d'embed** : si `isEmbed` et `alias` correspond à `/^\d+(?:x\d+)?$/`, ignorer l'alias pour l'affichage et utiliser le nom de fichier (`targetBasename`). Conserver la perte d'information (la largeur n'est pas réémise en Markdown standard) et la documenter dans le commentaire de fonction.
5. **Ne pas** réimplémenter la résolution Obsidian (chemins les plus courts, alias de dossiers) : hors périmètre, et VE-006 traite le seul cas qui produit des liens morts silencieux (Unicode).
6. **Factoriser la lecture** : une petite fonction `parseWikilink(match)` utilisée par `extractWikilinks` et `transformWikilinks`, pour que les deux ne puissent plus diverger.

## Test de non-régression

Table de cas dans `tests/core.test.ts` (avant/après) :

```ts
transformWikilinks('[[#Sommaire]]', 'clean-text')          // 'Sommaire'
transformWikilinks('[[#Sommaire]]', 'markdown')            // '[Sommaire](#sommaire)'
transformWikilinks('[[Note#]]', 'clean-text')              // 'Note'
transformWikilinks('[[Note|]]', 'clean-text')              // 'Note'
transformWikilinks('[[Note#Titre\\|Alias]]', 'markdown')   // '[Alias](Note.md#titre)'
transformWikilinks('![[pic.png|300]]', 'markdown')         // '![pic.png](Assets/pic.png)'
transformWikilinks('![[pic.png|300x200]]', 'clean-text')   // 'pic.png'
transformWikilinks('[[A|B|C]]', 'clean-text')              // comportement actuel conservé
expect(extractWikilinks('[[#A]] and [[B#]]')).toHaveLength(2)
```

Plus un test d'intégration : une note contenant `[[#Sommaire]]` ne doit plus produire `[[` dans aucune des quatre sorties (`clean-text`, `canonical-alias`, `markdown`, NotebookLM).

## Points d'impact

- `src/core/wikilink.ts` (une fonction + une expression), `tests/core.test.ts`.
- Les aperçus de la sidebar changent pour les liens à ancre seule (ils afficheront le titre au lieu du lien brut) — amélioration attendue.
- Aucun impact sur les blocs de code : le pipeline applique la transformation via `applyToProse` (`pipeline.ts:98`), à conserver.
- `CHANGELOG.md` 2.0.3 (« Embedded wikilinks keep their display text ») devient vrai aussi pour les embeds redimensionnés.

## Non-objectifs

- Résolution complète façon Obsidian (plus court chemin, alias de dossier, liens ambigus) — seulement un point de soupçon documenté dans l'audit.
- Rendu des transclusions (`![[Note]]` reste un lien, décision 2.0.3).
- Syntaxe `![[img|300]]` réémise dans le Markdown de sortie (non standard).

## Critères d'acceptation

- Les 7 cas du tableau sont corrigés ; le cas `[[]]` reste inchangé.
- `extractWikilinks` et `transformWikilinks` reconnaissent exactement le même ensemble d'entrées (test croisé).
- Aucun `[[` brut ne subsiste dans une sortie pour une note qui ne contient que les formes testées.
- `npm run check` passe.

## Risques

- L'expression assouplie pourrait capturer des séquences qui n'étaient pas des liens (`a[[b`), mais l'ancre `]]` reste obligatoire. Les tests existants sur les liens malformés le vérifieront.
- Le retrait du `\` final modifie un nom de fichier se terminant réellement par `\` — impossible sous Windows, très rare ailleurs ; à documenter dans le commentaire.
