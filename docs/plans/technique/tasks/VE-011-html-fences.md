# VE-011 — Rendu HTML : fences `~~~`, fences longues et code indenté

| | |
|---|---|
| **Priorité** | **P3** — code mal rendu dans un export de lecture, sans perte de contenu |
| **Type** | bug (rendu) |
| **Preuve** | **Reproduit** |
| **Références** | `src/core/htmlFormatter.ts:136-159, 183-193` · `src/core/markdownClean.ts:19-70` |
| **Dépend de** | — |
| **Bloque** | — |
| **Séance** | 1 |

## Constat

`simpleMarkdownToHtml` exécuté sur :

```
    # not a heading
    code line

~~~js
const x = 1;
~~~
```

produit :

```html
<h1 id="not-a-heading">not a heading</h1>
<p>    code line</p>
<p>~~~js</p>
<p>const x = 1;</p>
<p>~~~</p>
```

Trois défauts dans ce seul exemple : le code indenté de 4 espaces devient un titre, les fences `~~~` (valides en Markdown) ne sont pas reconnues, et les lignes de code indentées ne sont pas regroupées.

Défauts supplémentaires observés :

- `<pre><code class="language-"></code></pre>` pour une fence sans langage (classe vide inutile) ;
- une fence de 4 backticks est fermée par une ligne de 3 backticks (le parseur ne suit pas la longueur) ;
- l'ouverture est détectée après `trim()`, donc `    ```js` (4 espaces, normalement du code indenté) ouvre un bloc de code.

## Comportement actuel / attendu

- **Actuel** : détection par `trimmed.startsWith('```')` (`l. 142`), fermeture par la même condition sans suivre le marqueur ; aucune gestion de `~~~` ; aucun bloc indenté.
- **Attendu** : même famille de règles que `splitContentSegments` (déjà correct dans `markdownClean.ts:19-70`) — marqueur identique (caractère et longueur minimale), indentation ≤ 3 espaces, et code indenté de 4 espaces reconnu.

## Cause racine

Le formateur HTML possède **son propre** analyseur de blocs, indépendant de `splitContentSegments`, et cet analyseur ne modélise pas l'état d'une fence (caractère, longueur). C'est la divergence signalée en § 6.2 de l'audit ; ici elle produit trois erreurs distinctes mais une seule cause.

## Sites affectés

- `src/core/htmlFormatter.ts:136-159` — détection/fermeture des fences.
- `src/core/htmlFormatter.ts:183-193` — titres (une ligne de code indenté ne doit pas y arriver).
- `src/core/htmlFormatter.ts:221-260` — listes/paragraphes (alimentation du même état de bloc).
- `src/core/htmlFormatter.ts:96-118` — `createHeadingId` (pas de changement, mais un titre issu de code ne doit plus l'appeler).
- `src/core/htmlFormatter.ts:269-292` — `collectHeadings` (sommaire de note) : même détection naïve (`line.startsWith('~~~')` non géré, `inCode` basculé par n'importe quelle ligne commençant par trois backticks, y compris une fence plus longue). Des titres situés dans un bloc `~~~` apparaissent donc dans le sommaire. **Même cause, même séance** : réutiliser la même règle d'ouverture/fermeture (marqueur + longueur) dans cette fonction.

`simpleMarkdownToHtml` n'est utilisé que par `formatForHtml` : l'impact est limité à la cible HTML.

## Plan d'action

1. **Suivre l'état de la fence** : `let fence: { char: '`' | '~', length: number } | null = null`.
   - Ouverture : sur `line` (pas `trimmed`), si `/^ {0,3}(`{3,}|~{3,})(.*)$/`. Enregistrer le caractère et la longueur.
   - Fermeture : uniquement si la ligne ne contient que le même caractère, au moins `length` fois, avec des espaces finaux : `new RegExp('^ {0,3}' + char + '{' + length + ',}[ \\t]*$')`.
   - Ne pas fermer sur une fence d'un autre caractère ni plus courte.
2. **Supprimer la classe vide** : n'émettre `class="language-X"` que si `lang` est non vide.
3. **Code indenté** : après une ligne vide, si une ligne commence par 4 espaces (ou une tabulation), ouvrir un `<pre><code>` et consommer les lignes indentées ou vides jusqu'à la première ligne non indentée non vide. Les lignes de code indentées sont émises via `escapeHtml(rawLine)` **sans** `trim()`. Ne pas ouvrir de bloc si la première ligne indentée commence par un marqueur de liste (`-`, `*`, `+`, `1.`) : c'est une liste indentée, pas du code.
4. **Ne pas** réutiliser `splitContentSegments` directement : il ne gère pas les blocs indentés et son découpage est fait pour les transformations prose ; l'utiliser ici demanderait de réécrire toute la boucle à états. La duplication est assumée pour cette séance ; la commenter explicitement pour que la prochaine divergence soit visible (voir Non-objectifs).
5. **Ne pas toucher** aux titres, listes, tableaux, callouts : le correctif se limite aux trois états ci-dessus.

## Test de non-régression

Tests unitaires sur `simpleMarkdownToHtml` (nouveaux, dans `tests/core.test.ts`) :

```ts
expect(simpleMarkdownToHtml('~~~js\nconst x = 1;\n~~~')).toContain('<pre><code class="language-js">');
expect(simpleMarkdownToHtml('~~~\nx\n~~~')).not.toContain('language-');
expect(simpleMarkdownToHtml('    # not a heading')).toContain('<pre><code>');
expect(simpleMarkdownToHtml('    # not a heading')).not.toContain('<h1');
expect(simpleMarkdownToHtml('````md\n```js\nx\n```\n````')).toContain('```js'); // fence interne littérale
expect(simpleMarkdownToHtml('> quote\n\n| a | b |\n| - | - |\n| 1 | 2 |')).toContain('<blockquote');
```

Les quatre premiers échouent avant correctif.

## Points d'impact

- `src/core/htmlFormatter.ts` uniquement (+ tests).
- L'export HTML peut changer d'aspect pour les notes contenant du code ; le contenu, lui, est identique.
- Aucun impact sur les ancres, le sommaire, la recherche, ni le thème.

## Non-objectifs

- CommonMark complet (références, listes imbriquées, HTML inline) : hors périmètre.
- Unifier les trois analyseurs de blocs (HTML, Dataview, `splitContentSegments`) : refonte sans gain utilisateur, et contraire à « plus petite modification complète ». La divergence est documentée.
- Modifier `splitContentSegments` (utilisé par le pipeline de nettoyage).

## Critères d'acceptation

- Les six assertions ci-dessus passent.
- Aucun titre n'est généré à partir de code indenté.
- Une fence de 4 backticks n'est pas fermée par 3 backticks.
- `npm run check` passe.

## Risques

- La détection de code indenté peut avaler une liste indentée de 4 espaces (Markdown ambigu). Règle retenue : uniquement après une ligne vide et sans marqueur de liste en début de contenu (`-`, `*`, `1.`). À couvrir par un test (`    - item` reste une liste si elle suit un paragraphe).
- Le changement est visible dans le HTML exporté : le mentionner dans `CHANGELOG.md`.

## Journal d'exécution

### 2026-10-21 — implementation hash pending

- Baseline pull/check PASS (203 tests / 107 smoke); read full plan and both HTML scans, heading-ID allocation and prose cleaner scanner.
- Tests first: **6 failed / 1 passed**. Tilde fences, empty language classes, indented headings, short/mismatched closers, four-space openers and note-TOC filtering failed. Existing quote/table/list behavior was already correct.
- Shared local HTML rules track a matching marker/minimum-length closer and at most three opening spaces; four spaces/tabs after a blank line (or at document start) form escaped, grouped, untrimmed code. Empty language classes are omitted. Indented list markers do not start code.
- Applied the same fence and indentation exclusions to `collectHeadings`, not only rendering; code no longer consumes heading IDs or appears in the note TOC. Anchor generation, heading/list/table/callout rendering itself and the prose cleaner are unchanged. Duplication with the cleaner is explicitly documented rather than a cross-parser rewrite.
- All **7 tests pass**, covering all six required assertions plus literal nested/other-marker fences, tabs, safe escaping, list retention and consolidated TOC exclusions. `npm run check` PASS: **210/210 tests, 107/107 smoke**, typecheck/build. The intended TOC change is code exclusion only (despite the plan's generic "no TOC impact" note).

- Remaining: record the green implementation hash and final tracker status.
