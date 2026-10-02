# NEXT_SESSION — vault-exporter

## État courant
- v1.1.0 (refonte) livrée sur disque le 2026-09-29, **non commitée** (commit à valider par l'utilisateur). Pas de dépôt distant.
- Installée le 2026-09-29 dans le coffre World of Trois (`C:/Users/Trois/Mon Drive/Trois/World of Trois/.obsidian/plugins/vault-exporter/`) ; ancienne version sauvegardée dans `_backup_wot_plugin_2026-09-29/` (gitignoré). Réglages du coffre complétés : titre, nom du Markdown, `splitGroupFolder` = `WoT`.
- Prochaine tâche prioritaire : essai réel dans ce coffre (checklist UI de `CONTEXT.md`), puis commit.
- Init recommandé : light.

## Dernière session
- 2026-09-29 — refonte v1.1 selon `plans/PLAN_refonte_v1.1.md` : nettoyage unique partagé, formats en table, split via le gateway, annulation, réglages génériques, retrait PDF/Python. `npm run check` vert (24 tests, dont annulation et isolation des couches).

## Écarts
- Pas testé dans Obsidian (aucune capture) : panneau, bouton Annuler, réglages.
- Split : les notes à la racine du coffre (Accueil, index…) vont désormais dans un seul `Root.txt` au lieu d'un fichier chacune.
- `canvasParser.ts` et `dataviewEngine.ts` gardent des libellés FR en dur (« Note liée », « Fichier ») — hors périmètre.
- Pas de README.

## Rappels actifs + Backlog
- Décider si/quand publier (repo `aznan-triks/vault-exporter`).
- Détection automatique des valeurs en dur / doublons : pas encore de contrôle (seule l'isolation des couches est testée).
