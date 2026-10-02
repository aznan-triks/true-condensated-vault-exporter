# Vault Exporter

Plugin Obsidian pour exporter un coffre (ou un sous-dossier, ou un tag) en formats de consommation directe :

| Format | À quoi ça sert |
|---|---|
| **NotebookLM (texte consolidé)** | Source unique pour NotebookLM : notes nettoyées, métadonnées, délimiteurs de documents |
| **HTML** | Document autonome et stylisé : table des matières à 2 niveaux, thème clair/sombre auto, callouts, tables, listes de tâches, CSS personnalisable |
| **Markdown consolidé** | Un seul fichier unifié avec sommaire ancré |
| **Split** | Un `.txt` par dossier (groupé) ou un `.md` par note (miroir du coffre) |
| **ZIP bundle** | Tous les formats précédents compressés dans un seul `.zip` — un fichier à envoyer, un zip à uploader |

## Fonctionnalités clés

- **Multi-cibles en un clic** : cochez n'importe quelle combinaison de formats dans la sidebar, lancez l'export. Annulable à tout moment.
- **Aperçu du périmètre en direct** : la sidebar affiche le nombre de notes/canvases (et le poids) réellement exportés, mis à jour à chaque changement de réglage.
- **Historique des exports** : les 5 derniers runs (cibles, date, fichiers, taille, résultat).
- **Périmètre flexible** : racine de scope, dossier exclus, fichiers exclus, préfixes exclus, **et filtre par tag** (`scopeTag`).
- **Dataview in-mémoire** : les blocs Dataview (TABLE/LIST) sont évalués contre le coffre et rendus en markdown statique — sans le plugin Dataview à destination. `WHERE` accepte `and`/`or`, parenthèses, `=`, `!=`, `>`, `<`, `>=`, `<=`, `in (…)`, `like "wild*card"`, `contains`/`startswith`/`endswith`.
- **Wikilinks** : 4 modes (texte propre, `[[bruts]]` conservés, `Lien (Alias)`, markdown résolu vers les vrais chemins du coffre).
- **Canvases** : les `.canvas` sont convertis en texte lisible (ordre visuel haut→bas, groupes en sections).
- **Anti boucle de ré-export** : les sorties précédentes (fichiers consolidés, ZIP, dossier split) sont automatiquement exclus du périmètre — exporter deux fois n'ingère pas la première sortie.
- **Robustesse** : lectures parallèles, note illisible = skip + rapport (pas d'arrêt total), écritures asynchrones, annulation propre par `AbortSignal`.
- **100 % TypeScript**, moteur pur testable : 59 tests unitaires, aucune dépendance runtime.

## Installation

1. `npm install && npm run build` (produit `main.js`).
2. Copier le dossier du plugin (ou un lien symbolique vers le dépôt) dans `<coffre>/.obsidian/plugins/vault-exporter/`.
3. Activer « Vault Exporter » dans Réglages → Plugins communautaires.
4. Ouvrir la sidebar (icône `file-up` dans la ruban) ou la palette de commandes.

## Commandes

| Commande | Action |
|---|---|
| Run all exports | Tous les formats consolidés + split |
| Export for NotebookLM (consolidated text) | Un seul fichier texte consolidé |
| Export as consolidated Markdown | Un seul fichier markdown unifié |
| Export as HTML document | Un document HTML autonome |
| Export split files | Fichiers par dossier ou par note |
| Export everything as ZIP bundle | Un `.zip` contenant tout |
| Cancel running export | Interrompt l'export en cours |

## Réglages (extraits)

- **Document Title** : titre des exports consolidés.
- **Scope Root / Scope Tag** : restreindre l'export à un dossier *et/ou* à un tag.
- **Excluded Folders / Files / Prefixes** : listes noires avec autocomplétion.
- **Chemins de sortie** : chaque format a son chemin (vault-relatif ou absolu, desktop).
- **Split** : mode groupé par dossier ou miroir 1:1 ; dossier de destination.
- **Markdown Processing** : canvases, frontmatter, Dataview, format des wikilinks, propriétés ignorées.
- **Advanced** : CSS custom pour l'HTML (`--ve-bg`, `--ve-accent`, …), cadence d'UI (`yieldEvery`).

## Développement

```bash
npm install
npm run dev      # esbuild en watch
npm run check    # typecheck + vitest + build production
npm run test     # vitest seul
```

Architecture : voir `CONTEXT.md`. En bref —

- `src/core/` : logique pure (aucun import `obsidian`), testée directement ;
- `src/obsidian/` : seule couche qui touche l'API Obsidian et Node (`fs`, `zlib`) ;
- `src/features/` : orchestrateur, formats, split, historique ;
- `src/ui/`, `src/settings/`, `src/commands/` : interface.

Ajouter un format consolidé = 1 formateur dans `src/core/` + 1 entrée dans `CONSOLIDATED_FORMATS` (`src/features/formats.ts`) + 1 commande dans `EXPORT_COMMANDS` (`src/commands/registry.ts`, source unique de la palette et de la sidebar).

## Notes

- Plugin **desktop uniquement** (`isDesktopOnly`) : l'écriture vers des chemins absolus et le « Open folder » utilisent Electron.
- Les liens markdown sont relatifs à la racine du coffre (utile si le fichier consolidé est à la racine).
- Le ZIP est écrit avec le `zlib` Node (deflate) ; les très petites entrées sont stockées telles quelles.
