# CONTEXTE PROJET : vault-exporter

> Dernière mise à jour : 2026-09-29 (refonte v1.1). Règles communes : D:/IA/projets/METHODE.md (non recopiées ici).

## Nature

Plugin Obsidian (TypeScript) qui exporte un coffre (ou un sous-dossier) vers plusieurs formats : texte consolidé NotebookLM, HTML, Markdown consolidé, fichiers "split". Moteur 100 % TypeScript (mode Python retiré en v1.1). Projet jeune (commit initial 2026-09-16), non publié, pas de dépôt distant configuré.

**v1.1.0 (2026-09-29)** : refonte livrée, voir `CHANGELOG.md`.

## Commandes

- Tout vérifier : `npm run check` (typecheck + vitest + build production). Réécrit `main.js` (gitignoré).
- Vérifier avant tout « terminé » : `npm run check`. Couvre : types, tests du cœur, de l'orchestrateur (annulation, cibles) et des couches (describe `architecture`). Manquant : recherche des valeurs en dur et des doublons.
- Version : `grep version manifest.json`.

## Architecture

| Dossier | Rôle |
|---|---|
| `src/core/` | Logique pure (parsing, formatage, filtrage) — aucun import `obsidian` |
| `src/obsidian/vaultGateway.ts` | Seule couche qui touche l'API Obsidian ; implémente `ExportGateway` (lecture + toute écriture) |
| `src/core/pipeline.ts` | Nettoyage unique d'une note (`cleanNote`), partagé par tous les formats |
| `src/features/` | `formats.ts` (registre des formats consolidés), `exportSplit.ts`, `exportOrchestrator.ts` (charge, nettoie une fois, écrit ; annulable) |
| `src/commands/registry.ts` | `EXPORT_COMMANDS` — source unique pilotant Command Palette + UI |
| `src/settings/SettingsTab.ts` | Onglet de réglages |
| `src/ui/` | `SidebarView`, `ProgressPanel`, `VaultPathSuggest` |

Tests : `tests/core.test.ts` (Vitest).

- Couches et droits : `core/` n'importe ni `obsidian` ni `features/` (invariant déclaré en tête de `src/core/types.ts`) ; `obsidian/vaultGateway.ts` seul lecteur du coffre ; `features/` sans import `obsidian` (constaté le 2026-09-29) ; `commands/`, `settings/`, `ui/` peuvent importer `obsidian`.
- Contrôle des couches : automatique, describe `architecture` de `tests/core.test.ts` (dans `npm run check`).
- Points d'extension : nouveau format consolidé = un formateur dans `src/core/` + une entrée dans `CONSOLIDATED_FORMATS` (`src/features/formats.ts`) + une entrée dans `EXPORT_COMMANDS` (`src/commands/registry.ts`, source unique de la Command Palette et de l'UI) ; un réglage = un champ de `ExporterSettings` + un contrôle dans `SettingsTab.ts`.
- Config : `ExporterSettings`/`DEFAULT_SETTINGS` dans `src/core/types.ts` (source unique de vérité), rendus dans `src/settings/SettingsTab.ts`.
- Carte : le tableau ci-dessus ; `grep -rn "<mot>" src/` avant de créer une fonction.

## Livraison

- Compte GitHub requis : `aznan-triks` (déduit du champ `author` de `manifest.json`/`package.json`, cohérent avec les autres projets publics du même auteur). Remote origin configuré : `https://github.com/aznan-triks/true-condensated-vault-exporter.git` (branche `main`).
- Script de synchronisation 1-clic : `sync.bat` / `sync.ps1`.
- Avant toute action git : `gh auth status`, basculer avec `gh auth switch --hostname github.com --user aznan-triks` si besoin — le switch ne tient pas durablement entre les push, revérifier avant **chaque** push.
- Versioning : MINEUR = nouvelle commande d'export ou format de sortie ; PATCH = fix/refacto/UI mineur.

## Pièges

- ⚠️ Réglages obsolètes → `mergeSettings` ne garde que les clés de `DEFAULT_SETTINGS` ; renommer un réglage = perte de la valeur enregistrée, prévoir une migration (2026-09-29).
- ⚠️ Boucle longue sans pause → l'interface gèle et Annuler ne répond pas ; céder la main (`yieldEvery`) dans toute nouvelle boucle par note (2026-09-29).

## Checklist UI (après tout changement visuel)

```
□ Sidebar (ExporterSidebarView) s'ouvre/se ferme correctement
□ ProgressPanel affiche la progression et le log pendant un export réel
□ Onglet de réglages : tous les champs sauvegardent et se rechargent correctement
□ Thème dark/light d'Obsidian s'applique correctement
```

⚠️ Aucune coche sans preuve visuelle montrée à l'utilisateur (capture d'écran dans Obsidian), sauf dispense explicite.
