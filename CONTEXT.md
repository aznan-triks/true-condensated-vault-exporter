# CONTEXTE PROJET : vault-exporter

> Dernière mise à jour : 2026-10-02 (refonte v2.0). Règles communes : D:/IA/projets/METHODE.md (non recopiées ici).

## Nature

Plugin Obsidian (TypeScript) qui exporte un coffre (ou un sous-dossier, ou un tag) vers plusieurs formats : texte consolidé NotebookLM, HTML, Markdown consolidé, fichiers "split", et **bundle ZIP unique**. Moteur 100 % TypeScript, zéro dépendance runtime. Desktop-only.

**v2.0.0 (2026-10-02)** : ZIP, multi-cibles, aperçu d'historique, tag scope, Dataview expressions, HTML réécrit, canvas en ordre de lecture, anti ré-export. Voir `CHANGELOG.md`.

## Commandes

- Tout vérifier : `npm run check` (typecheck + vitest + build production). Réécrit `main.js` (gitignoré).
- Version : `grep version manifest.json`.

## Architecture

| Dossier | Rôle |
|---|---|
| `src/core/` | Logique pure — aucun import `obsidian`. `types.ts` (settings + `ParsedFile` + gateway), `pipeline.ts` (`parseVault`/`cleanNote`/`createExportContext`), `filter.ts` (inclusion + chemins réservés), `wikilink.ts` (+ `buildLinkResolver`), `dataviewEngine.ts` (évaluateur d'expressions WHERE), `canvasParser.ts` (ordre visuel + groupes), `frontmatter.ts`, `markdownClean.ts`, formateurs (`htmlFormatter` avec `renderInline`/TOC 2 niveaux, `markdownFormatter`, `notebooklmFormatter`), `zip.ts` (CRC32 + build ZIP deflate via `zlib` externe) |
| `src/obsidian/` | Seule couche qui touche l'API Obsidian/Node : `vaultGateway.ts` (lecture parallèle batch 8, tag filter, écritures texte/binaire async, `getVaultFilesInfo`, `revealOutput`), `appSetting.ts` (cast `app.setting` interne), `obsidian-internal.d.ts` (augmentations de types : `Shell`, `SettingTab.id`) |
| `src/features/` | `exportOrchestrator.ts` (`runExports` multi-cibles → `ExportResult`, ZIP), `formats.ts` (registre des formats consolidés), `exportSplit.ts`, `exportHistory.ts` (persistance + formatage) |
| `src/commands/registry.ts` | `EXPORT_COMMANDS` — source unique pilotant Command Palette + sidebar ; `executeTargets`, `isExportRunning`, `UiContext` |
| `src/ui/` | `SidebarView` (stats de scope, multi-cibles, historique), `ProgressPanel` (log, annulation, récap + Open folder), `VaultPathSuggest` |
| `src/settings/SettingsTab.ts` | Onglet de réglages (dont Advanced : `customCss`, `yieldEvery`) |

Tests : `tests/core.test.ts` + `tests/features.test.ts` (Vitest, 59 tests).

- Couches et droits : `core/` n'importe ni `obsidian` ni `features/` (invariant déclaré en tête de `src/core/types.ts`) ; `obsidian/vaultGateway.ts` seul lecteur du coffre ; `features/` sans import `obsidian` (constaté 2026-09-29).
- Contrôle des couches : automatique, describe `architecture` de `tests/core.test.ts` (dans `npm run check`).
- Points d'extension : nouveau format consolidé = un formateur dans `src/core/` + une entrée dans `CONSOLIDATED_FORMATS` + une entrée dans `EXPORT_COMMANDS` ; un réglage = un champ de `ExporterSettings` + `DEFAULT_SETTINGS` + un contrôle dans `SettingsTab.ts`.
- Config : `ExporterSettings`/`DEFAULT_SETTINGS` dans `src/core/types.ts` (source unique), rendus dans `SettingsTab.ts`.
- Persistance : `saveData` stocke `{ settings, history }` ; `loadSettings` accepte aussi l'ancien format (objet settings nu) — `main.ts`.
- Carte : le tableau ci-dessus ; `grep -rn "<mot>" src/` avant de créer une fonction.

## Pièges

- ⚠️ Réglages obsolètes → `mergeSettings` ne garde que les clés de `DEFAULT_SETTINGS` ; renommer un réglage = perte de la valeur enregistrée, prévoir une migration.
- ⚠️ Boucle longue sans pause → l'interface gèle et Annuler ne répond pas ; céder la main (`yieldEvery`) dans toute nouvelle boucle par note.
- ⚠️ Sorties de l'export → toujours passer par `reservedOutputPaths(settings)` dans `isFileIncluded` pour éviter la boucle de ré-export ; ne jamais filtrer les sorties « à la main » dans l'orchestrateur.
- ⚠️ Binaire (ZIP) → jamais `writeFile` (corruption UTF-8) ; toujours `writeBinary` (gateway), et `vault.createBinary/modifyBinary` prennent un `ArrayBuffer` (copier depuis `Uint8Array`).
- ⚠️ APIs Obsidian internes (`Shell`, `app.setting`, `SettingTab.id`) → non typées dans le d.ts : les casts vivent dans `src/obsidian/` (`obsidian-internal.d.ts`, `appSetting.ts`) ; garder `Platform.isMobile` en garde-fou.
- ⚠️ `zlib`/`fs`/`path` dans `core`/`obsidian` → externes au bundle (`esbuild.config.mjs`) : OK dans Electron (desktop-only) et dans les tests Node, interdit partout ailleurs.
- ⚠️ Le d.ts d'`obsidian` installé est plus récent que `minAppVersion` — vérifier les APIs dans `node_modules/obsidian/obsidian.d.ts` avant d'utiliser une nouvelle méthode.

## Checklist UI (après tout changement visuel)

```
□ Sidebar (ExporterSidebarView) s'ouvre/se ferme, stats à jour après réglage
□ ProgressPanel affiche la progression, le log, le récap + Open folder pendant/après un export réel
□ Onglet de réglages : tous les champs sauvegardent et se rechargent (dont customCss, yieldEvery, scopeTag, zipOutputPath)
□ Thème dark/light du navigateur s'applique à l'HTML exporté
```

⚠️ Aucune coche sans preuve visuelle montrée à l'utilisateur (capture d'écran dans Obsidian), sauf dispense explicite.
