# VE-015 — Release : exécuter les tests avant de publier

| | |
|---|---|
| **Priorité** | **P3** — la barrière existe localement mais n'est pas branchée là où elle compte |
| **Type** | process / configuration |
| **Preuve** | **Déduit** (lecture du workflow et des scripts) |
| **Références** | `.github/workflows/release.yml` · `package.json:9-15` |
| **Dépend de** | — |
| **Bloque** | — |
| **Séance** | 1 |

## Constat (lecture)

Le workflow de release :

1. `actions/checkout@v4` (une première fois, uniquement pour lire le tag) ;
2. `actions/checkout@v4` avec `ref: ${{ steps.tag.outputs.tag }}` ;
3. `setup-node@v4` (Node **20**) puis `npm ci` ;
4. `npm run build` — soit `tsc --noEmit && node esbuild.config.mjs production` ;
5. vérification `manifest.version` ↔ tag ;
6. `gh release create`/`gh release upload main.js manifest.json styles.css --clobber`.

**Aucune exécution de `vitest` ni de `npm run smoke`.** Un tag peut donc publier un bundle dont les 124 tests unitaires et les 99 assertions de smoke échouent. Le `--clobber` écrase en outre silencieusement des assets déjà publiés.

## Comportement actuel / attendu

- **Actuel** : `npm run build` (typecheck + esbuild) est la seule vérification ; les 124 tests unitaires et le smoke ne sont jamais exécutés avant publication, et `--clobber` écrase les assets existants.
- **Attendu** : un tag `v*` ne publie que si la suite complète (`npm run check`) passe sur le commit taggé ; ré-attacher des assets est une opération explicite, pas un effet de bord.

## Cause racine

Le pipeline local `npm run check` (typecheck + tests + build + smoke, 7,7 s mesurées) a été créé après le workflow, et le workflow n'a jamais été mis à jour pour l'appeler. La ressemblance entre `npm run build` et le début de `check` (le typecheck) donne l'illusion d'une vérification.

## Sites affectés

- `.github/workflows/release.yml` (unique site).
- `package.json` : aucun changement nécessaire (`check` existe).

## Plan d'action

1. **Insérer une étape de vérification après `Install` et avant `Build`** :

   ```yaml
   - name: Verify
     run: npm run check
   ```

   `check` refait le typecheck et le build : c'est 0,13 s de build en double, sans conséquence. Ne pas découper en `npm test && npm run smoke` pour éviter que le workflow et le script local divergent — le workflow doit appeler **la** porte d'entrée.
2. **Remplacer `--clobber`** par une vérification explicite :
   - par défaut, si un asset existe déjà pour ce tag, **échouer** avec `::error::asset already exists; re-run with overwrite=true` ;
   - ajouter une entrée `workflow_dispatch` booléenne `overwrite` (défaut `false`) qui réintroduit `--clobber` quand elle est vraie.
   Le cas d'usage documenté (ré-attacher des assets manquants) devient explicite au lieu d'être implicite.
3. **Aligner Node sur la baseline** : passer `node-version` de `20` à `22` (la version sur laquelle les mesures et `npm ci` ont été validés). Si Node 20 doit rester la cible minimale, ajouter une matrice `[20, 22]` — mais ne pas laisser une version non testée devenir la seule version de publication.
4. **Facultatif** : supprimer le premier `checkout` en calculant le tag depuis `github.ref` / `inputs.tag` sans lire le dépôt. Gain : un checkout complet (~2 s). À ne faire que si l'étape 1 est déjà validée.
5. **Ne pas** ajouter de lint dans ce plan : aucun outil n'est configuré (constat d'audit). Si un lint est ajouté plus tard, il devra entrer dans `check`, pas dans le workflow.

## Test de non-régression

- `act` n'est pas disponible dans l'environnement d'audit ; la vérification se fait par :
  1. exécution locale de `npm run check` (doit passer, 7,7 s) ;
  2. `gh workflow view Release` après merge pour vérifier la syntaxe ;
  3. un `workflow_dispatch` sur un tag de pré-release, avec un job volontairement cassé (test unitaire forcé en échec) → la publication doit être bloquée. C'est le seul test qui prouve la barrière ; il se fait une fois, manuellement.
- Test du `--clobber` : relancer le workflow sur un tag dont les assets existent → échec attendu sans `overwrite`.

## Points d'impact

- Durée de release : +8 s environ.
- Aucun impact sur le plugin livré.
- Documentation : `CONTEXT.md`/`README.md` si les procédures de release y sont décrites (vérifier avant d'écrire).
- Le workflow reste le seul endroit où `npm ci` est exécuté : aucune dépendance nouvelle.

## Non-objectifs

- Ajouter un lint ou une couverture (décision d'outillage, hors audit).
- Signer les artefacts, publier sur un registre, ou changer le mécanisme de release.
- Modifier `package.json` ou les scripts.

## Critères d'acceptation

- Un échec de `vitest` (ou du smoke) sur le commit taggé empêche `gh release upload`.
- Un second passage sans `overwrite=true` échoue avec un message explicite au lieu d'écraser.
- La release nominale reste possible en une commande (`git tag vX && git push --tags`).
- Le YAML est valide (`gh workflow view`).

## Risques

- Le workflow tourne avec Node 22 désormais : si une dépendance de build n'y fonctionne pas, la release échoue. C'est préférable à publier un bundle non testé ; un test local `npm ci && npm run check` sur Node 22 (déjà fait dans l'audit) couvre ce point.
- Le nouveau comportement « échouer si l'asset existe » peut surprendre lors d'un republish : le message doit indiquer l'option `overwrite`.
