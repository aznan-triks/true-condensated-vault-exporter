type: refacto
init: full
Terminé quand :
- `npm run check` vert ; nouveaux tests : pipeline unique, isolation core (aucun `from 'obsidian'` dans src/core), annulation.
- `grep -rn "renderDataviewBlocks(" src/` → 1 seul appel (pipeline partagé).
- `grep -rn "WoT\|World of Trois\|shortcut-targets" src/` → 0.
- `grep -rni "pdf" src/ package.json` → 0 (ou export PDF réel — choisi : retrait).
- `pythonRunner.ts` et `test.txt` absents.
- Commande « Annuler l'export » + bouton dans ProgressPanel ; annulation loguée comme info, pas erreur.
Périmètre — IN : core, features, registry, settings, types, tests.
Périmètre — OUT : refonte visuelle UI, publication GitHub, README/CHANGELOG (plan suivant).

## Audit (2026-09-28)
1. Pipeline de nettoyage dupliqué 4× (html/markdown/notebooklm formatters + exportSplit) — viole DRY ; HTML ignore `wikilinkFormat` (force 'clean-text', htmlFormatter.ts:148).
2. Fausses promesses : PDF annoncé (description, `pdfOutputPath`) mais aucun export PDF.
3. Code spécifique au vault perso : `'WoT'` en dur (exportSplit.ts:74), textes FR en dur ("CATEGORIE", "Racine"), DEFAULT_SETTINGS personnels.
4. Fallback Python : chemin parallèle qui ignore les cibles markdown, mappe html→script Trello ; doublon du moteur natif → à supprimer (YAGNI).
5. `exportSplit` écrit via `fs` direct (contourne le gateway, casse sur mobile) ; `exportSplitFiles` rend la commande « Export Split » silencieusement inopérante si false.
6. Pas d'annulation (backlog) ; `test.txt` parasite versionné ; `override settings` dans main.ts suspect.

## Phases
1. Core : `core/pipeline.ts` = `cleanNote(file, files, settings)` unique ; les 4 consommateurs l'utilisent ; HTML respecte `wikilinkFormat`.
2. Nettoyage : retrait Python, PDF, `exportSplitFiles`, `WoT`, test.txt ; DEFAULT_SETTINGS génériques (noms "Vault export.*", exclusions .obsidian/.trash/.git) ; groupement split = 1er dossier sous `scopeRoot`, libellés en anglais.
3. Écriture unique via gateway (`writeFile` gère absolu + vault) ; split passe par lui.
4. Annulation : `AbortSignal` de registry → orchestrator → boucles par fichier ; bouton Cancel dans ProgressPanel.
5. Tests (pipeline, isolation, annulation) + `npm run check` + maj NEXT_SESSION/CONTEXT, bump 1.1.0 (PATCH/MINOR : retrait de fonctions → 1.1.0).

## Écarts
- Formats consolidés regroupés dans un registre (`features/formats.ts`) : exportHtml/Markdown/NotebookLM supprimés (non prévu, simplification).
- Ajout réglages `documentTitle` et `yieldEvery` (libellé et cadence d'annulation hors code).
- Bug corrigé en passant : bloc de code HTML déclenché par un simple backtick.
- Libellés FR restants dans canvasParser/dataviewEngine : non traités.
- Pas d'essai dans Obsidian.
