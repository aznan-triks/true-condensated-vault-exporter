# VE-007 — Dataview : ne pas déformer ni vider silencieusement une requête

| | |
|---|---|
| **Priorité** | **P2** — contenu manquant ou faux dans un export présenté comme complet, sans aucun signal |
| **Type** | bug (erreur silencieuse) |
| **Preuve** | **Reproduit** (littéraux `WITHOUT ID`, 3 formes de `FROM`) + **déduit du code** |
| **Références** | `src/core/dataviewEngine.ts:61-75, 107-115, 674-684` · `CHANGELOG.md` 2.0.2 |
| **Dépend de** | — |
| **Bloque** | VE-016 (même fichier) |
| **Séance** | 1 |

## Constat

Deux déformations distinctes, dans la même fonction et avec le même effet — un résultat faux présenté comme valide.

**A. Les littéraux sont réécrits.** `parseDataviewQuery` retire `WITHOUT ID` du texte **entier** avant toute analyse (`l. 74-75`) :

```ts
const withoutId = /\bWITHOUT\s+ID\b/i.test(text);
const stripped = text.replace(/\bWITHOUT\s+ID\b/gi, ' ');
```

Observé :

| Requête | Effet |
|---|---|
| `TABLE title WHERE title = "WITHOUT ID"` | le littéral devient `" "` → plus aucun résultat |
| `TABLE title FROM "WITHOUT ID folder"` | la cible devient `"  folder"` → dossier introuvable |

**B. Les formes `FROM` non supportées produisent un résultat vide.** Toute valeur `FROM` qui ne commence pas par `#` est traitée comme un chemin de dossier (`l. 113-115`) :

| Requête | Sortie observée | Sortie attendue |
|---|---|---|
| `TABLE title FROM [[Some Note]]` | `*No results found.*` | bloc laissé visible |
| `TABLE title FROM outgoing([[Some Note]])` | `*No results found.*` | bloc laissé visible |
| `TABLE title FROM #tag AND "Folder"` | `*No results found.*` | bloc laissé visible |
| `TABLE title FROM "Folder"` | tableau (correct) | tableau |

L'export contient donc un tableau vide, indiscernable d'un vrai résultat vide, alors que le commentaire du fichier (`l. 61-66`) et le `CHANGELOG.md` 2.0.2 promettent : « Unsupported or malformed queries remain visible instead of broadening results. »

## Comportement actuel / attendu

- **Actuel** : la requête est modifiée avant d'être comprise (A), et une clause non comprise est acceptée comme un chemin (B). Dans les deux cas, le bloc est remplacé par un résultat qui ne correspond pas à la requête.
- **Attendu** : une requête que le moteur ne peut pas interpréter **fidèlement** laisse le bloc intact ; une requête qu'il interprète ne voit jamais ses littéraux réécrits.

## Cause racine

`parseDataviewQuery` traite le texte comme une suite de mots, pas comme une requête : la reconnaissance de `WITHOUT ID` se fait par expression régulière globale (sans état de chaîne), et la validation de `FROM` n'existe pas. Les deux défauts partagent la même cause : **aucune séparation entre la syntaxe et les valeurs**.

## Sites affectés

| Site | Rôle |
|---|---|
| `src/core/dataviewEngine.ts:74-75` | retrait global de `WITHOUT ID` |
| `src/core/dataviewEngine.ts:107-115` | acceptation de tout `FROM` non-`#` |
| `src/core/dataviewEngine.ts:674-684` | `renderDataviewBlocks` (politique « null ⇒ bloc conservé », déjà correcte) |
| `src/core/pipeline.ts:90` | appel dans `cleanNote` |
| `tests/core.test.ts` (Dataview) | cas à ajouter |

## Plan d'action

1. **Repérer `WITHOUT ID` hors des chaînes** : parcourir le texte caractère par caractère en suivant l'état `'` / `"` (et `\` d'échappement), remplacer l'occurrence par un espace uniquement hors chaîne, et retenir le booléen `showId`. Une fonction locale `stripWithoutIdOutsideStrings(text): { text: string; withoutId: boolean }` de ~15 lignes suffit ; ne pas utiliser de regex globale.
2. **Valider `FROM`** : neutraliser d'abord le contenu des chaînes, puis refuser (`return null`) si le reste contient `[[`, `(`, `)`, `,`, `\bAND\b` ou `\bOR\b` (insensible à la casse). Sinon, comportement actuel : tag si `#…`, dossier sinon.
3. **Conserver** `FROM ""` → `null` (bloc visible) : c'est la politique fail-fast, et une limitation documentée (tous les fichiers non supporté).
4. **Mettre à jour le commentaire de tête** pour énumérer exactement ce qui est supporté (`FROM "dossier"`, `FROM #tag`, colonnes, `WHERE`, `SORT`, `WITHOUT ID`) et ce qui ne l'est pas (liens, fonctions, unions, `FROM ""`).
5. **Ne pas** ajouter de log par bloc : le bloc visible est le signal ; un vault de documentation générerait des dizaines de messages.

## Test de non-régression

```ts
// A. les littéraux ne sont plus réécrits
expect(parseDataviewQuery('TABLE title\nWHERE title = "WITHOUT ID"')?.whereClauses)
  .toEqual(['title = "WITHOUT ID"']);
expect(parseDataviewQuery('TABLE title\nFROM "WITHOUT ID folder"')?.fromPath)
  .toBe('WITHOUT ID folder');
// … et la clause reste reconnue quand elle en est une
expect(parseDataviewQuery('TABLE title\nFROM "F"\nWITHOUT ID')?.showId).toBe(false);

// B. les FROM non supportés conservent le bloc
for (const q of ['TABLE title FROM [[A]]', 'TABLE title FROM outgoing([[A]])', 'TABLE title FROM #t AND "F"']) {
  expect(renderDataviewBlocks('```dataview\n' + q + '\n```', files)).toContain(q);
}
// les formes supportées continuent de s'évaluer
expect(renderDataviewBlocks('```dataview\nTABLE title FROM "Folder, Sub"\n```', files)).not.toContain('```dataview');
```

Avant correctif, les deux premiers cas A et les trois cas B échouent.

## Points d'impact

- `src/core/dataviewEngine.ts` uniquement (+ tests).
- Changement visible : certaines notes montreront le bloc de requête au lieu d'un tableau vide, et les requêtes filtrant sur un littéral `WITHOUT ID` retrouveront leurs résultats. À annoncer dans `CHANGELOG.md`.
- Aucun impact sur les requêtes supportées.

## Non-objectifs

- Implémenter les liens, fonctions ou unions de `FROM` (fonctionnalité ; le moteur n'a pas d'index de liens).
- Supporter `FROM ""`.
- Changer le rendu des requêtes valides sans résultat (`*No results found.*` reste correct dans ce cas).

## Critères d'acceptation

- Les littéraux contenant `WITHOUT ID` sont préservés ; la clause `WITHOUT ID` reste reconnue.
- Les trois formes non supportées laissent le bloc intact ; deux formes supportées produisent toujours un tableau.
- `npm run check` passe.

## Risques

- Un dossier dont le nom contient une parenthèse **non quotée** serait désormais refusé (bloc visible) : perte de rendu, pas de contenu. Documenté.
- Le parcours caractère par caractère doit gérer `\\"` : couvert par un test avec un littéral contenant un guillemet échappé.

## Journal d'exécution

### 2026-10-21 — `9ac9bd9`; documentation follow-up

- Baseline pull/check PASS (162 tests / 101 smoke); read the full plan, parser, clause/quote scanners, rendering fallback and pipeline call.
- Tests first, `faithful queries (VE-007)`: **8 failed / 3 passed**. Failures reproduce rewritten double-/single-quoted and escaped-quote literals, modified source/column names, and all three unsupported FROM forms becoming empty results. Positive quoted-folder-with-comma/parentheses/AND/OR and tag sources already rendered correctly; FROM "" stayed visible.
- Added local `stripWithoutIdOutsideStrings`, preserving quoted text/escapes while recognizing real directives. FROM validation masks quoted strings before rejecting link/function/union/comma syntax. The existing null/error fallback and valid empty-result output are unchanged; no per-block logging.
- All **11 tests pass**, including showId distinction and two supported sources still rendering tables. Updated module documentation and changelog to state the supported subset and quote requirement for syntax-looking folder names. `npm run check` PASS: **173/173 tests, 101/101 smoke**, typecheck/build green. Fence handling is left for VE-016.

- Implementation `9ac9bd9` pushed; tracker marked `fait`. All acceptance criteria met; remaining: none.
