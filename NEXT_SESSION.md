# NEXT_SESSION — vault-exporter

## État courant
- Dépôt distant connecté : `aznan-triks/true-condensated-vault-exporter` (branche `main`).
- v1.1.0 commitée et synchronisée sur GitHub avec le compte `aznan-triks`.
- Scripts de synchronisation 1-clic créés : `sync.bat` (lanceur Windows double-clic) et `sync.ps1` (gestion auth `gh`, pull rebase, checks, commit, push).
- Installée le 2026-09-29 dans le coffre World of Trois (`C:/Users/Trois/Mon Drive/Trois/World of Trois/.obsidian/plugins/vault-exporter/`).
- Prochaine tâche prioritaire : essai réel dans ce coffre (checklist UI de `CONTEXT.md`).
- Init recommandé : light.

## Dernière session
- 2026-10-02 — connexion au dépôt GitHub `aznan-triks/true-condensated-vault-exporter`, configuration de la branche `main`, nettoyage de l'historique distant (retrait des fichiers accidentels uploadés via l'interface web), création des scripts de synchronisation 1-clic avec bascule automatique du compte `gh auth switch`.
- 2026-09-29 — refonte v1.1 selon `plans/PLAN_refonte_v1.1.md` : nettoyage unique partagé, formats en table, split via le gateway, annulation, réglages génériques, retrait PDF/Python. `npm run check` vert (25 tests).

## Écarts
- Pas testé dans Obsidian (aucune capture) : panneau, bouton Annuler, réglages.
- Split : les notes à la racine du coffre (Accueil, index…) vont désormais dans un seul `Root.txt` au lieu d'un fichier chacune.
- `canvasParser.ts` et `dataviewEngine.ts` gardent des libellés FR en dur (« Note liée », « Fichier ») — hors périmètre.

## Rappels actifs + Backlog
- Détection automatique des valeurs en dur / doublons : pas encore de contrôle (seule l'isolation des couches est testée).
