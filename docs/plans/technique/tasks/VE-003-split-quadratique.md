# VE-003 — Export split quadratique : validation des collisions et regroupement

| | |
|---|---|
| **Priorité** | **P1** — 153 s mesurées pour 16 000 notes, sur le chemin le plus courant (`split`, `all`) |
| **Type** | performance (algorithme) |
| **Preuve** | **Mesuré** (gateway factice, aucun I/O, Node 22) |
| **Références** | `src/features/exportOrchestrator.ts:95-134` · `src/features/exportSplit.ts:47-63` |
| **Dépend de** | VE-001 (même fonction `selectOutputs`) |
| **Bloque** | VE-009 (boucle d'écriture), VE-013 |
| **Séance** | 1 |

## Constat — mesure de départ

Gateway factice (`writeFile` vide), `targets: ['split']`, `splitMode: 'individual-files'`. Le tableau « sans timers » remplace le `setTimeout(0)` de `yieldToUi` par une résolution immédiate, uniquement dans le script de mesure jetable, pour isoler l'algorithmique.

| Notes | Total (timers réels) | Sans timers | Dont **avant la 1ʳᵉ écriture** |
|---|---|---|---|
| 2 000 | 4,55 s | 2,22 s | 2,20 s |
| 4 000 | 13,31 s | 8,44 s | 8,41 s |
| 8 000 | 44,13 s | 33,68 s | **33,57 s** |
| 16 000 | 153,12 s | — | — |

Référence : cible `markdown` seule sur le même corpus = **37 / 40 / 116 ms** (2 k / 4 k / 8 k). Le coût est donc dans la préparation, pas dans la lecture ni l'écriture. ×3,8 puis ×4,0 quand la taille double → O(n²).

`buildSplitFiles` seul, mesuré séparément : 59 / 608 / 5 353 ms à 8 k / 16 k / 32 k (O(n²) également, constante bien plus faible).

## Comportement actuel / attendu

- **Actuel** : la préparation de l'export (validation des collisions) est quadratique ; à 16 000 notes elle dure plus de deux minutes, dont 99 % avant la première écriture.
- **Cible** : `selectOutputs` et `buildSplitFiles` en O(n log n) ou mieux ; **< 2 s au total pour 16 000 fichiers** contre 153 s, sans changer le résultat (mêmes erreurs de conflit, mêmes contenus).
- **Contrainte** : la détection d'overlap doit rester **exacte** (aucun conflit manqué), y compris entre un dossier et un fichier qu'il contient.

## Cause racine

1. `selectOutputs` (`exportOrchestrator.ts:114-132`) compare chaque sortie à **toutes** les précédentes (`for (const [otherPath, other] of seen)` à l'intérieur de la boucle), et chaque comparaison appelle `pathsOverlap` → deux `canonicalOutputPath` (découpage de chaîne, réassemblage, regex). À 8 000 sorties : ~32 M de comparaisons × ~1 µs = 33 s. C'est **la** cause du temps mesuré.
2. `buildSplitFiles` (`exportSplit.ts:53`) recopie le tableau de groupe à chaque note : `groups.set(group, [...(groups.get(group) ?? []), note])`. Somme des copies quadratique par groupe.

## Sites affectés

- `exportOrchestrator.ts:114-132` — boucle de déduplication + overlap (cause principale).
- `exportOrchestrator.ts:89-93` — `pathsOverlap` (à conserver pour le contrôle ZIP ↔ sorties, qui ne porte que sur peu d'éléments).
- `exportSplit.ts:47-63` — regroupement par dossier (cause secondaire).
- `exportOrchestrator.ts:301-320` — `yieldToUi()` par fichier écrit (~1 ms × n : ~16 s à 16 k). **Hors du correctif principal**, voir étape 4.
- `tests/features.test.ts:295-309` — tests de conflits de chemins à conserver verts.

## Plan d'action

1. **Remplacer la boucle par un index d'ancêtres** (O(n · profondeur)), dans `selectOutputs` :
   - `seen` (Map chemin canonique → sortie) reste pour l'égalité exacte ;
   - `ancestors` (Set des préfixes de dossiers de toutes les sorties déjà vues) : pour chaque nouvelle clé `k`, si `ancestors.has(k)` → `k` est un dossier déjà utilisé par une sortie → conflit ; sinon, pour chaque préfixe `p` de `k` (segments successifs joints par `/`), si `seen.has(p)` → `p` est une sortie déjà écrite, `k` est dedans → conflit ; ajouter tous les préfixes de `k` à `ancestors`, puis `seen.set(k, item)`.
   - Le message d'erreur actuel (`'Output paths overlap: ' + other + ' and ' + item + '.'`) doit être conservé mot pour mot : un test de `features.test.ts` peut s'y appuyer ; vérifier avant de changer.
   - Preuve d'équivalence : `a` et `b` se chevauchent si et seulement si l'un est un préfixe-dossier strict de l'autre. L'ensemble `ancestors` contient exactement tous les préfixes-dossiers des sorties déjà vues, donc les deux directions sont couvertes.
2. **Regroupement en O(1)** : `const list = groups.get(group); if (list) list.push(note); else groups.set(group, [note]);`
3. **Vérifier l'ordre de sortie** : l'itération d'une `Map` est stable (ordre d'insertion) ; le remplacement ne doit pas changer l'ordre des fichiers produits. Le test de non-régression doit comparer la liste complète des `path` avant/après sur un petit corpus.
4. **Facultatif, après mesure** : ne plus `yieldToUi()` après *chaque* fichier mais tous les `yieldEvery` fichiers (valeur déjà utilisée pour le nettoyage), en gardant `checkCancelled` à chaque fichier. Gain attendu ~14 s à 16 k fichiers. **Condition** : mesurer la latence d'annulation (clic → arrêt) et ne retenir que si elle reste < 1 s. Si le gain n'est pas mesuré en conditions réelles, ne pas l'inclure.
5. **Ne pas** ajouter de cache de `canonicalOutputPath` : avec l'index d'ancêtres, le nombre d'appels devient linéaire ; un cache serait de la complexité sans gain mesurable.

## Test de non-régression

**Correction** (obligatoire, avant/après) :

- `selectOutputs` (via `runExports`) avec `htmlOutputPath: 'same.md'` + `markdownOutputPath: 'same.md'` → `Output path conflict` (existant, doit rester).
- `zipOutputPath: 'Vault export.html'` → `overlaps another selected output` (existant).
- Nouveaux cas : `a.md` + `a/b.md` → overlap ; `a/b.md` + `a.md` (ordre inverse) → overlap ; `a.md` + `ab.md` → **pas** de conflit ; `a/b.md` + `a/c.md` → pas de conflit ; `A.md` + `a.md` → pas de conflit (casse significative, comportement actuel conservé).
- Un test de liste complète des chemins produits sur 50 notes réparties dans 5 dossiers (ordre inchangé).

**Preuve de gain** (script jetable, non commité) : même harnais que la mesure de départ, n = 2 000 / 4 000 / 8 000 / 16 000 ; consigner les temps dans la PR. Critère : 16 000 < 2 s, et courbe ~n log n.

## Points d'impact

- `exportOrchestrator.ts` et `exportSplit.ts` uniquement ; aucun changement de format de sortie.
- `buildSplitFiles` est aussi utilisé par les tests (`core.test.ts:700-745`) : ces tests passent sans modification.
- Mémoire : l'index d'ancêtres ajoute O(n · profondeur) chaînes, négligeable devant les 16 k contenus.

## Non-objectifs

- Ne pas paralléliser les écritures : l'API Obsidian n'est pas thread-safe et l'ordre des écritures est visible dans l'UI.
- Ne pas compresser les sorties split (hors sujet).
- Ne pas changer la limite des 65 535 entrées ZIP.

## Critères d'acceptation

- 16 000 notes, cible split : < 2 s (contre 153 s), mesuré par le même script.
- Tous les tests de conflit existants et nouveaux passent.
- Aucune différence dans la liste ordonnée des fichiers produits sur un corpus de contrôle.
- `npm run check` passe.

## Risques

- Une erreur d'index (préfixe sans séparateur) manquerait un conflit : les cas `a.md`/`ab.md` et `a/b.md`/`a.md` verrouillent les deux directions.
- Le `yield` par lot (étape 4) peut dégrader la réactivité du bouton Cancel : condition mesurée, sinon abandon.
