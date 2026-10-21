# VE-016 — Dataview : ne pas exécuter les blocs qui sont dans du code

| | |
|---|---|
| **Priorité** | **P3** — corrompt les exemples de code, situation rare mais silencieuse |
| **Type** | bug (rendu) |
| **Preuve** | **Reproduit** |
| **Références** | `src/core/dataviewEngine.ts:672-685` · `src/core/markdownClean.ts:19-70` · `src/core/pipeline.ts:90` |
| **Dépend de** | VE-007 (même fichier) |
| **Bloque** | — |
| **Séance** | 1 |

## Constat

Note contenant :

````
How to write a query:

````markdown
| File | title |
| --- | --- |
| [[Guide.md|Guide]] |  |

````
````

Sortie observée : le contenu du fence `markdown` est **remplacé** par un tableau Dataview (le bloc interne a été exécuté). Le texte d'exemple — précisément ce que la note cherche à documenter — disparaît.

## Comportement actuel / attendu

- **Actuel** : `DATAVIEW_BLOCK_REGEX = /^ {0,3}```dataview\r?\n([\s\S]*?)^ {0,3}```/gm` (l. 672) est appliqué à tout le corps, sans savoir qu'un fence l'englobe. Toute ligne ```dataview commençant en colonne 0-3 est exécutée, où qu'elle soit.
- **Attendu** : seuls les blocs `dataview` de premier niveau sont exécutés ; tout ce qui se trouve dans un autre fence (3 ou 4 backticks, `~~~`, inline code) reste littéral.

## Cause racine

Le moteur Dataview possède **sa propre** détection de blocs par expression régulière, alors que `splitContentSegments` (`markdownClean.ts:28-70`) implémente déjà un analyseur de fences correct (marqueur, longueur, indentation, fences non fermées) et est utilisé pour les wikilinks et les commentaires. C'est la divergence § 6.2 de l'audit.

## Sites affectés

- `src/core/dataviewEngine.ts:672-685` (unique site).
- `src/core/pipeline.ts:90` (appel) : l'ordre avec les autres transformations ne change pas.
- Tests `tests/core.test.ts` (section Dataview) ; smoke (contenu transformé).

## Plan d'action

1. **Remplacer le `replace` global** par un parcours des segments :

   ```ts
   export function renderDataviewBlocks(content: string, files: ParsedFile[]): string {
     return splitContentSegments(content).map((segment) => {
       if (!segment.code) return segment.text;
       const lines = segment.text.split('\n');
       const open = /^ {0,3}(`{3,})\s*dataview\s*$/i.exec(lines[0] ?? '');
       const close = /^ {0,3}`{3,}\s*$/.test(lines[lines.length - 1] ?? '');
       if (!open || !close || lines.length < 3) return segment.text;   // autre fence, ou non fermé
       const parsed = parseDataviewQuery(lines.slice(1, -1).join('\n'));
       if (!parsed) return segment.text;                               // politique existante : bloc visible
       try {
         return evaluateDataviewQuery(parsed, files);
       } catch (error) {
         if (error instanceof DataviewQueryError) return segment.text;
         throw error;
       }
     }).join('');
   }
   ```

2. **Conserver** : la politique « requête non analysable ⇒ bloc inchangé » (VE-007 la renforce), le traitement des fences non fermées (inchangé, non exécuté), et l'acceptation d'une fence plus longue que 3 backticks pour un vrai bloc Dataview (Obsidian accepte ` ````dataview `).
3. **Ne pas** utiliser `applyToProse` : il classe *tous* les fences comme code, donc ignorerait aussi les vrais blocs `dataview`. Le parcours ci-dessus est le seul qui distingue « fence dataview de premier niveau » de « fence quelconque ».
4. **Retirer** `DATAVIEW_BLOCK_REGEX` (devenu inutile) et le commentaire qui s'y rapporte ; ne pas laisser une seconde détection dormante.

## Test de non-régression

```ts
const body = '````markdown\n```dataview\nTABLE status FROM "F"\n```\n````';
expect(renderDataviewBlocks(body, files)).toBe(body);        // avant : tableau injecté

const top = '```dataview\nTABLE status FROM "F"\n```';
expect(renderDataviewBlocks(top, files)).not.toContain('```dataview');   // toujours exécuté

const inline = 'Use ` ```dataview ` in a note.';
expect(renderDataviewBlocks(inline, files)).toBe(inline);

const unclosed = '```dataview\nTABLE status FROM "F"';
expect(renderDataviewBlocks(unclosed, files)).toBe(unclosed);            // comportement conservé
```

Le premier test échoue avant correctif.

## Points d'impact

- `src/core/dataviewEngine.ts` uniquement (plus tests).
- Coût : `splitContentSegments` parcourt le corps une fois de plus par note. Mesure attendue : quelques ms sur 10 000 notes (le pipeline appelle déjà ce parcours pour les wikilinks et les commentaires). À vérifier avec le script de VE-003 (non bloquant).
- Aucun changement pour les notes sans fence Dataview.

## Non-objectifs

- Rendre Dataview dans les blocs `dataviewjs` (non supporté aujourd'hui, dangerous par nature).
- Changer le rendu des requêtes valides.
- Unifier l'analyseur HTML et l'analyseur Dataview (voir VE-011).

## Critères d'acceptation

- Le bloc dans un fence `markdown` reste intact.
- Les trois autres cas se comportent comme avant.
- `DATAVIEW_BLOCK_REGEX` n'existe plus.
- `npm run check` passe.

## Risques

- Une fence dont la ligne de fermeture contient des espaces après les backticks est acceptée (`[ \t]*$`) : conforme à `splitContentSegments`, qui fait de même.
- Un bloc Dataview collé à un autre fence (sans ligne vide) peut être classé différemment : couvrir par un test avant de considérer le correctif terminé.

## Journal d'exécution

### 2026-10-21 — `f20c2a4`; documentation follow-up

- Baseline pull/check PASS (244 tests / 112 smoke); read the full plan, complete block renderer, shared prose/fence scanner, pipeline order and existing fallback tests.
- Tests first: **7 failed / 7 passed**. Nested four-/three-backtick and tilde examples were executed; valid long openings were not; adjacent fences and full-pipeline protection failed. Triple top-level, inline, unclosed, dataviewjs, four-space and unsupported controls already passed. New production-bundle smoke also failed on the nested example.
- Replaced the global block regex with `splitContentSegments` classification, executing only a closed top-level Dataview backtick fence. Removed `DATAVIEW_BLOCK_REGEX`. Existing parse/evaluation fallback and unexpected-error behavior are unchanged; no `applyToProse` misuse, pipeline reordering or HTML/scanner refactor.
- Two necessary implementation clarifications are covered rather than copied from the pseudocode: the closing run must be at least the opening length (a final triple does not close an unterminated quadruple), and the shared scanner assumes LF closers. A new CRLF-followed-by-prose regression failed against the naïve reuse. A local LF projection maps bounds back to original bytes, preserving CRLF/mixed literal/unsupported segments without changing the shared cleaner or normalizing fallback output.
- All **16 new tests** and the smoke pass, including the required four scenarios, adjacent fences, long/indented openings, minimum-length closers, unsupported/CRLF fallback, mixed endings and full cleaning. `npm run check` PASS: **260/260 tests across 6 files, 113/113 smoke**, typecheck/build.
- Nonblocking isolated scan measurement: 10,000 ordinary prose/inline-code bodies, one identical before/after sweep, **3.35 → 26.20 ms** (about +22.85 ms total); every result remained identical. This is the extra Dataview classification stage, not a new end-to-end VE-003 throughput claim. Disposable script/bundle/measurement JSON removed. No dependency/configuration changes or DataviewJS execution.

- Implementation `f20c2a4` pushed; tracker marked `fait`. All acceptance criteria met; remaining: none.
