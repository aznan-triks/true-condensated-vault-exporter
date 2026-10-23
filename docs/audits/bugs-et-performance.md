Implementation status: see [docs/plans/technique/README.md](../plans/technique/README.md).

# Audit technique — bugs et performance

**Projet** : `true-condensated-vault-exporter` (plugin Obsidian `vault-exporter` 2.1.0, `isDesktopOnly: true`, `minAppVersion` 1.7.2)
**Date** : 2026-10-20
**Nature** : audit **en lecture seule**. Aucun fichier source, style, dépendance, configuration ou donnée n'a été modifié. Ce document et les plans associés sont les seuls ajouts au dépôt.
**Périmètre** : `src/` (intégralité), `tests/`, `tools/mock-obsidian/`, configuration de build, workflow de release, dépendances.
**Plans** : `docs/plans/technique/tasks/VE-001…VE-017` (un fichier par cause racine).

---

## 1. Baseline mesurée

Environnement : Node **v22.22.3**, npm **10.9.8**, Linux, dépôt propre (`0eab6d7`), `node_modules` installé par `npm ci` (96 paquets, 3,8 s).

| Étape | Commande | Résultat | Durée |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | **PASS** | 3,4 s |
| Tests unitaires | `npx vitest run` | **PASS**, 124/124, 4 fichiers | 2,87 s |
| Build | `node esbuild.config.mjs production` | **PASS** | 0,13 s |
| Smoke (mock Obsidian) | `npm run smoke` | **PASS**, 99 assertions | 2,45 s |
| Pipeline complet | `npm run check` | **PASS** | 7,7 s |
| Lint | — | **ABSENT** (aucune configuration ni script ESLint/Prettier) | — |
| Couverture | — | **ABSENTE** (aucune configuration de couverture, aucun seuil) | — |
| Audit dépendances (prod) | `npm audit --omit=dev` | **0 vulnérabilité** | — |
| Audit dépendances (complet) | `npm audit` | **1 high, dev uniquement** : `source-map-js` ≤ 1.2.1 → 1.2.2 | — |

Aucun échec préexistant. Un seul point de baseline est dégradé : **aucun lint**, donc aucune barrière automatique sur le style, les variables inutilisées ou les motifs dangereux. Le typecheck strict (`strict`, `noUncheckedIndexedAccess`) compense partiellement ; un contrôle ponctuel `tsc --noUnusedLocals --noUnusedParameters` passe (aucun symbole mort).

**Dépendances** : `source-map-js` 1.0.0–1.2.1, déni de service par boucle d'événements via des offsets de sections indexées, CVSS 7.5, corrigé en 1.2.2 ([GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), consulté le 2026-10-20). Dépendance **de développement** (chaîne esbuild/Vitest), absente du bundle livré et du runtime Obsidian : risque nul pour l'utilisateur, dérive de documentation uniquement (`NEXT_SESSION.md` annonce « zero vulnerabilities »).

---

## 2. Méthode et honnêteté des preuves

| Niveau | Signification |
|---|---|
| **Reproduit** | exécuté sur ce dépôt (vault temporaire réel ou gateway factice), résultat observé |
| **Déduit du code** | lecture + raisonnement sur un chemin d'exécution précis, non exécuté |
| **Soupçon** | indice, non vérifié, méthode de vérification fournie — jamais présenté comme un bug |

Ce qui a réellement été **exécuté** : baseline complète ; suite de reproduction jetable dans `/tmp/ve-audit` (scripts `esbuild` jetables + 3 tests Vitest avec gateway réel sur vault temporaire) ; profils mémoire et chronométrages ci-dessous. Ce qui n'a été que **lu** : `dom-helpers.cjs`, `electron-mock.cjs`, la fin de `obsidian-mock.cjs`. Aucune mesure n'a été faite dans Obsidian lui-même : tous les chiffres viennent de Node 22 hors application (voir § 8).

Les scripts de reproduction ont été supprimés après usage ; chaque plan décrit le test à réintroduire.

---

## 3. Synthèse des findings

| ID | Priorité | Type | Preuve | Résumé | Plan |
|---|---|---|---|---|---|
| VE-001 | **P0** | bug (perte de données) | Reproduit | Une sortie peut écraser une note source (frontmatter et commentaires perdus) | [VE-001](../plans/technique/tasks/VE-001-collision-sorties-sources.md) |
| VE-002 | **P1** | bug (boucle de rétroaction) | Reproduit | La réservation des sorties est fausse : `Exports/Exports/…` ré-ingéré à chaque session | [VE-002](../plans/technique/tasks/VE-002-reservation-destinations.md) |
| VE-003 | **P1** | performance | Mesuré | Export split : 33,6 s *avant la première écriture* pour 8 000 notes (quadratique) | [VE-003](../plans/technique/tasks/VE-003-split-quadratique.md) |
| VE-004 | P3 | robustesse | Reproduit | Collisions de noms de sortie bloquantes et opaques ; caractères invalides non assainis | [VE-004](../plans/technique/tasks/VE-004-collisions-noms-sortie.md) |
| VE-005 | P2 | bug (rendu) | Reproduit | Wikilinks non reconnus : `[[#Titre]]`, `[[Note#]]`, `[[Note\|Alias]]`, `![[img\|300]]` | [VE-005](../plans/technique/tasks/VE-005-wikilinks-incomplets.md) |
| VE-006 | P2 | bug (chemins, macOS) | Reproduit (simulation) | Aucune normalisation NFC/NFD : liens et filtres accentués échouent | [VE-006](../plans/technique/tasks/VE-006-normalisation-unicode.md) |
| VE-007 | P2 | bug (erreur silencieuse) | Reproduit | Dataview : requête déformée par `WITHOUT ID` ou vidée par un `FROM` non supporté | [VE-007](../plans/technique/tasks/VE-007-dataview-echec-silencieux.md) |
| VE-008 | P2 | bug (état) | Reproduit | Settings non figés : modification en cours d'export → sortie mixte | [VE-008](../plans/technique/tasks/VE-008-snapshot-settings.md) |
| VE-009 | P2 | robustesse | Reproduit | Échec partiel : fichiers déjà écrits, `written` perdu, aucun compte rendu | [VE-009](../plans/technique/tasks/VE-009-echec-partiel.md) |
| VE-010 | P2 | bug (configuration) | Reproduit | `ignoredProperties` n'agit pas sur Category/Order/Status/Tags | [VE-010](../plans/technique/tasks/VE-010-ignored-properties.md) |
| VE-011 | P3 | bug (rendu) | Reproduit | HTML : `~~~`, fences longues et code indenté mal rendus | [VE-011](../plans/technique/tasks/VE-011-html-fences.md) |
| VE-012 | P2 | bug (rendu) | Reproduit | Markdown : un `]` dans un titre casse le lien du sommaire | [VE-012](../plans/technique/tasks/VE-012-markdown-echappement.md) |
| VE-013 | P3 | performance (mémoire) | Mesuré | Toutes les sorties retenues simultanément : 2,2 Go de RSS pour 154 Mo de corpus | [VE-013](../plans/technique/tasks/VE-013-memoire-sorties.md) |
| VE-014 | P3 | ressource | Déduit | `ProgressPanel` : intervalles orphelins quand un panneau est remplacé | [VE-014](../plans/technique/tasks/VE-014-progress-panel-timer.md) |
| VE-015 | P3 | process | Déduit | Release publiée sans exécuter les tests ni le smoke | [VE-015](../plans/technique/tasks/VE-015-release-sans-tests.md) |
| VE-016 | P3 | bug (rendu) | Reproduit | Dataview exécuté à l'intérieur d'un fence de code | [VE-016](../plans/technique/tasks/VE-016-dataview-dans-fence.md) |
| VE-017 | P3 | performance (UI) | Déduit + mesuré | Sauvegarde à chaque frappe d'un `data.json` gonflé par l'historique (7,7 Mo mesurés) | [VE-017](../plans/technique/tasks/VE-017-settings-frappe.md) |

---

## 4. Diagnostic

### 4.1 Perte de données : une sortie peut écraser une note source (VE-001)

**Reproduit**, vault temporaire réel, `ObsidianVaultGateway` :

- `splitMode: 'individual-files'`, `splitOutputFolder: ''`, `scopeRoot: ''` : le chemin de sortie est calculé comme le chemin de la note elle-même (`relativeToFolder` renvoie `Notes/A.md`, `joinPath('', …)` le conserve). La sortie **est** donc la note source. Après export, le frontmatter `status: keep-me` et le commentaire `%%secret%%` ont disparu du fichier source.
- Même résultat avec `splitOutputFolder` égal à la racine de portée, et avec `markdownOutputPath` pointant sur une note existante (vault réel). Le cas `zipOutputPath` a été reproduit avec un gateway factice ; côté réel, `writeBinary` appelle `modifyBinary` dès que le fichier existe (`vaultGateway.ts:190`) — donc même conséquence, par lecture.

**Cause racine** : aucun contrôle ne compare l'ensemble des destinations calculées à l'ensemble des chemins sources chargés. `reservedOutputPaths` (`src/core/filter.ts:183`) n'agit que sur **l'inclusion** (ce qui est lu), jamais sur **l'écriture**. Côté gateway, `writeFile` fait `app.vault.modify(existing, content)` dès que le fichier existe (`src/obsidian/vaultGateway.ts:158-166`), et `writeBinary` de même (`modifyBinary`, l. 190) ; un chemin absolu écrit directement avec `fs.promises.writeFile` (l. 149-153, 181-185). Aucune de ces quatre branches ne vérifie que la cible est une source.

Le garde-fou existant (`validateOutputPath`, `selectOutputs`) protège uniquement les collisions **entre sorties**. Il détecte `Exports/` comme dossier, mais pas « cette sortie est une note que je viens de lire ».

**Portée** : le mode split en fichiers individuels est le plus exposé (il recopie l'arborescence) ; les formats consolidés et le ZIP le sont dès qu'un utilisateur nomme sa sortie comme une note. La fonctionnalité « destination split vide = racine de sortie » a été introduite en 2.1.0 (`CHANGELOG.md`, section 2.1.0) : c'est une régression récente, pas un cas théorique.

**Plan** : VE-001 (P0), à traiter avant tout le reste.

### 4.2 Boucle de rétroaction : la réservation des sorties est fausse (VE-002)

**Reproduit** (vault réel, deux gateway successifs pour simuler la réindexation d'Obsidian) :

1. `useExternalOutputFolder: true`, `externalOutputFolder: <vault>/Exports`, split individuel, destination split vide → run 1 écrit `Exports/Notes/A.md`. 2 fichiers `.md` dans le vault.
2. Réindexation (nouvelle gateway), run 2 → les fichiers `.md` passent de 2 à 3, avec `Exports/Exports/Notes/A.md`.

**Cause racine**, en deux temps :

1. `runExports` résout les destinations une fois (`src/features/exportOrchestrator.ts:169` → `resolveOutputSettings`, `src/core/outputTarget.ts:108`), puis passe ces settings **déjà résolus** au gateway (`exportOrchestrator.ts:208`).
2. `vaultGateway.loadVaultFiles` les repasse à `reservedOutputPaths` (`src/obsidian/vaultGateway.ts:40`), qui **re-résout** chaque destination (`src/core/filter.ts:205` → `resolveOutputPath`). Or `resolveOutputPath` n'est pas idempotent : un chemin absolu est réduit à son dernier segment (`outputTarget.ts:96-100`) puis re-préfixé. `…/Exports` devient `…/Exports/Exports`, donc l'ensemble réservé est `Exports/Exports` — le dossier réellement écrit n'est jamais protégé.

Le `CHANGELOG.md` 2.1.0 affirme exactement le contraire : « Outputs written back inside the vault are protected from re-export again, even when they come from an absolute path or an external folder that lives under the vault root. » C'est une **garantie documentée qui ne tient pas**, et le mécanisme est celui qui devait la faire tenir.

Pourquoi les tests ne l'ont pas vu : `tests/gateway.test.ts:219-231` vérifie la protection en appelant `loadVaultFiles` avec des settings **bruts**, alors que la production l'appelle avec des settings **résolus**. Les deux formes ne sont équivalentes que tant que la re-résolution est sans effet — précisément ce qui est faux ici.

**Sites divergents de la même logique** : `resolveOutputSettings` (résolution) et `reservedOutputPaths` (réservation) sont deux implémentations de « où vont les sorties ». `SidebarView.ts:105` appelle la seconde avec des settings **bruts** alors que le gateway l'appelle avec des settings **résolus** : les deux ne peuvent pas être corrects en même temps. C'est la cause commune de plusieurs symptômes : croissance des exports, réservation du mauvais dossier, et aperçu de la sidebar qui ne calcule pas le même ensemble que le gateway.

Détail qui rend le bug sélectif : les destinations **consolidées** survivent à la re-résolution par coïncidence (leur dernier segment est déjà leur nom de fichier, donc le chemin reconstruit est identique), tandis que le **dossier split** perd son parent. D'où l'observation : seuls les miroirs split prolifèrent.

Une destination split vide est ignorée avant résolution (`filter.ts:203`), donc jamais réservée. Ce cas est voulu (« racine de sortie ») et ne peut pas être réservé sans exclure tout le vault : c'est VE-001 qui le protège en refusant l'écrasement. Le plan VE-002 ne change donc pas cette sémantique.

**Plan** : VE-002 (P1), juste après VE-001 (le garde-fou de VE-001 rend l'écrasement fatal ; VE-002 évite que ce garde-fou se déclenche sur les sorties de la veille).

### 4.3 Performance : l'export split est quadratique (VE-003)

**Mesuré**, gateway factice (aucune E/S), `targets: ['split']`, `individual-files` :

| Notes | Durée totale (timers réels) | Sans les `setTimeout` | Dont **avant la première écriture** |
|---|---|---|---|
| 2 000 | 4,55 s | 2,22 s | 2,20 s |
| 4 000 | 13,3 s | 8,44 s | 8,41 s |
| 8 000 | 44,1 s | 33,7 s | **33,6 s** |
| 16 000 | 153,1 s | — | — |

Référence : le même corpus en cible `markdown` seule prend **37 / 40 / 116 ms** (2 k / 4 k / 8 k). Le coût n'est donc ni la lecture, ni le nettoyage, ni l'écriture : il est **avant la première écriture**, dans la construction et la validation des sorties. Doublement à chaque doublement de taille → O(n²) avec une très grosse constante.

**Cause racine** : `selectOutputs` (`src/features/exportOrchestrator.ts:95-134`) vérifie l'overlap de chaque sortie contre **toutes** les précédentes (`l. 125-129`), et chaque comparaison appelle `pathsOverlap` → deux `canonicalOutputPath` (découpage, réassemblage, regex). À 8 000 fichiers : ~32 millions de comparaisons, ~1 µs chacune.

**Second site, même chemin** : `buildSplitFiles` (`src/features/exportSplit.ts:53`) reconstruit le tableau du groupe à chaque note (`groups.set(group, [...(groups.get(group) ?? []), note])`) : 59 / 608 / 5 353 ms à 8 k / 16 k / 32 k. Négligeable aujourd'hui devant `selectOutputs`, mais devient le premier coût après correction. Même plan, même séance.

**Cible** : `selectOutputs` en O(n log n) (tri + comparaison au voisin immédiat) et ajout en O(1) ; **< 2 s à 16 000 notes**, contre 153 s.

**Hors périmètre mesuré** : le `yieldToUi()` par fichier écrit (1 ms × n) coûte ~16 s à 16 000 fichiers. Réductible en n'yieldant que tous les K fichiers ; à ne faire qu'après mesure de la latence d'annulation (voir plan).

### 4.4 Noms de sortie : collisions et caractères invalides (VE-004)

**Reproduit** (gateway factice, `runExports`, cible `['split']`) :

| Cas | Résultat observé |
|---|---|
| mode groupé, dossiers `A?B` et `A_B` | **échec** : `Output path conflict: out/A_B.txt is used by more than one export.` Aucune écriture. |
| mode individuel, `X.md` + `X.canvas` | **échec** : `Output path conflict: out/X.md is used by more than one export.` Aucune écriture. |
| mode individuel, note `Q?&.md` | écrit tel quel : `out/Q?&.md` |

**Conclusion honnête** : il n'y a **pas** d'écrasement silencieux — le garde-fou `selectOutputs` fait son travail et échoue avant écriture. Ce sont deux défauts de robustesse, pas de perte de données :

1. **Message opaque et blocage évitable.** L'erreur nomme le chemin cible mais pas les deux notes responsables. L'utilisateur doit deviner laquelle renommer, et une paire parfaitement prévisible (`X.md` + `X.canvas`, qui peuvent coexister dans Obsidian) bloque **tout** l'export.
2. **Aucune sanitisation en mode individuel.** Le chemin est recopié tel quel (`exportSplit.ts:41-43`). Sous Windows, un nom contenant `?`, `:`, `*`, `"`, `<`, `>`, `|` fait échouer l'écriture en cours d'export (et laisse des fichiers partiels, cf. VE-009) ; sous Linux/macOS il est créé, donc l'export n'est pas portable. En mode groupé, `safeName` (`l. 61`) assainit mais de façon non injective, ce qui **crée** la collision du premier cas.

Priorité revue à la baisse (**P3**) : le comportement est sûr, seule l'ergonomie et la portabilité sont en cause.

### 4.5 Rendu Markdown/HTML : wikilinks (VE-005)

**Reproduit** (`transformWikilinks`, `src/core/wikilink.ts:104`) :

| Entrée | Sortie observée | Attendu |
|---|---|---|
| `[[#Titre]]` | inchangé (aucun match) | `Titre` / `[Titre](Note.md#titre)` |
| `[[Note#]]`, `[[Note\|]]` | inchangés | `Note` |
| `[[Note#Titre\|Alias]]` (tableau) | `[Alias](Note.md#titre%5C)` | `[Alias](Note.md#titre)` |
| `![[pic.png\|300]]` | `![300](Assets/pic.png)` | `![pic.png](Assets/pic.png)` (ou largeur conservée) |
| `[[Note\|Alias]]` en `canonical-alias` | `Note\ (Alias)` | `Note (Alias)` |

**Cause racine** : une expression unique avec des groupes **obligatoires** (`src/core/wikilink.ts:17`) — `([^\]|#]+)` interdit un lien réduit à une ancre, et les groupes `#…` / `|…` exigent au moins un caractère. Le backslash d'échappement de tableau (`\|`) est traité comme séparateur d'alias, laissant un `\` final dans la cible ou l'ancre. La taille d'embed (`|300`, `|300x200`) est prise pour un texte alternatif.

**Sites** : `extractWikilinks` (aperçus de la sidebar, `SidebarView.ts`), `transformWikilinks` (les trois formats), `buildLinkResolver` (résolution), et les tests `tests/core.test.ts` (section wikilinks). Un correctif partiel sur un seul des deux points d'entrée laisserait la sidebar et l'export divergents.

**Cohérence documentaire** : 2.0.3 annonce « Embedded wikilinks keep their display text » ; avec `|300`, le texte affiché devient `300`, donc le nom du fichier disparaît.

**Plan** : VE-005 (P2).

### 4.6 Chemins et Unicode (VE-006)

**Reproduit en simulation** (chaînes NFD/NFC, mêmes règles que le resolver) :

- `buildLinkResolver([{ path: 'Notes/Cafe\u0301.md' }])('Café')` → **`undefined`** ; la même cible en NFD (`Cafe\u0301`) se résout.
- `normalizePath(NFD) !== normalizePath(NFC)` : aucune normalisation Unicode nulle part.

**Cause racine** : toutes les comparaisons de chemins sont des comparaisons de chaînes exactes (`src/core/filter.ts:29-41`, `src/core/wikilink.ts:48-49`). Le problème n'est pas le stockage (Obsidian renvoie toujours la même forme pour un fichier donné) mais la **rencontre entre du texte saisi** (settings, liens) **et des noms sur disque**. Sur macOS, HFS+ stocke en NFD et APFS préserve la forme d'écriture : un vault créé sur HFS+, ou dont les noms viennent d'un autre outil, produit des chemins NFD que les liens NFC tapés par l'utilisateur ne retrouvent pas.

**Impact** : liens morts dans l'export ; et surtout `excludedFolders` / `onlyFile` / `scopeRoot` saisis en NFC ne correspondent pas aux chemins NFD → un dossier censé être exclu peut être exporté (fuite de contenu privé), ou une portée valide peut ne rien trouver.

**Statut de preuve** : le comportement de comparaison est **reproduit** ; le fait que le vault concerné soit effectivement en NFD dépend de la machine et n'a pas été observé ici (Linux). À marquer comme tel dans la revue.

**Plan** : VE-006 (P2).

### 4.7 Dataview (VE-007, VE-016)

**Reproduit** :

- `TABLE title FROM [[Some Note]]`, `FROM outgoing([[Some Note]])`, `FROM #tag AND "Folder"` → **`*No results found.*`**. Ces formes ne sont pas supportées ; elles devraient laisser le bloc visible.
- `WHERE title = "WITHOUT ID"` → le littéral devient `" "` ; `FROM "WITHOUT ID folder"` → `"  folder"`. Cause : `stripWithoutId` retire les mots `WITHOUT ID` partout dans le texte, y compris dans les chaînes (`src/core/dataviewEngine.ts:74-75`).
- Un bloc de requête placé **à l'intérieur d'un fence de code** (par exemple une fence `markdown` de quatre backticks contenant un exemple `dataview`) est **exécuté** et remplace le texte par un tableau : le code d'exemple est corrompu. Cause : `DATAVIEW_BLOCK_REGEX` (`dataviewEngine.ts:672`) opère ligne à ligne sans suivi de fence, alors que `splitContentSegments` (`src/core/markdownClean.ts:28-70`) sait déjà faire ce suivi et n'est pas utilisé ici.

**Cause racine de VE-007**, deux points dans la même fonction :

1. `WITHOUT ID` est retiré du texte **entier** par une expression globale (`l. 74-75`), sans état de chaîne : les littéraux sont réécrits.
2. `parseDataviewQuery` accepte **n'importe quelle** valeur `FROM` non-`#` comme chemin de dossier (`l. 113-115`) ; une forme non supportée ne produit pas `null` (bloc conservé) mais une requête valide qui ne peut rien trouver.

Les deux violent le même contrat, écrit dans le commentaire du fichier (l. 61-66) et dans le `CHANGELOG` 2.0.2 : « Unsupported or malformed queries remain visible ». Une requête doit être comprise **fidèlement** ou laissée intacte.

**Non-bugs / limitations à documenter** : `FROM ""` (tous les fichiers) est rejeté et le bloc reste visible — comportement *fail-fast* correct, simple limitation de couverture. Les clauses `GROUP BY`, `FLATTEN`, `LIMIT` sont déjà traitées correctement.

**Plan** : VE-007 (P2) pour les deux points, puis VE-016 (P3, fences dans le même fichier).

### 4.8 État, cycle de vie, erreurs (VE-008, VE-009, VE-014)

- **VE-008, settings non figés — reproduit.** En modifiant `wikilinkFormat` via le callback de progression après 3 notes (`yieldEvery: 1`), les 3 premières notes sont converties et les 9 suivantes gardent `[[Target]]` dans **le même fichier**. Cause : `resolveOutputSettings` renvoie **le même objet** quand le dossier externe est désactivé (`outputTarget.ts:109`), et `createExportContext` le stocke par référence (`pipeline.ts:65`) ; `cleanNote` le relit à chaque note (`pipeline.ts:90,98`). Le bug n'existe pas quand le dossier externe est actif (l'objet est alors copié) — ce qui rend le symptôme dépendant d'un réglage sans lien.
- **VE-009, échec partiel — reproduit.** `writeFile` échoue sur le 3ᵉ fichier : `Vault export - NotebookLM.txt` et `Vault export.html` sont déjà écrits, l'erreur remonte sans `partialResult` (`exportOrchestrator.ts:307-320`), donc l'UI affiche « échec » sans dire ce qui a été produit — et l'entrée d'historique créée ensuite (`src/commands/registry.ts:157-164`) enregistre `files: []`, c'est-à-dire **0 fichier** alors que deux existent. À l'inverse, l'annulation porte bien `partialResult` (`l. 21-26, 200-205`), mais le smoke test accepte « annulation **ou** succès » (`tools/mock-obsidian/run.cjs`), donc le chemin d'annulation UI n'est pas réellement verrouillé.
- **VE-014, panneau de progression — déduit.** Le constructeur supprime tous les `.ve-panel` existants (`src/ui/ProgressPanel.ts:39`) sans appeler `destroy()` : l'intervalle de 1 s du panneau précédent (`l. 78`) survit, orphelin, avec son DOM détaché. Un panneau en erreur n'est jamais auto-fermé (seul `success` programme la fermeture, `l. 146`), donc chaque export raté suivi d'un nouvel export fuit un intervalle. `main.onunload` annule l'export mais ne détruit pas le panneau (`src/main.ts:129-131`).

### 4.9 Configuration, tests, release (VE-015, VE-017)

- **Tests trompeurs — déduit.** Outre le test d'annulation qui accepte `Cancelled` ou `Done`, `tests/gateway.test.ts:214` s'intitule « reports the vault base path and maps it back from an external output folder » mais n'assert que `getVaultBasePath()` ; le mapping lui-même est couvert ailleurs (`tests/core.test.ts`). Aucun plan : renommer ou compléter le test lors d'une prochaine modification de ce fichier.
- **Release sans tests — déduit.** `.github/workflows/release.yml` exécute `npm ci` puis `npm run build` (qui ne fait que `tsc --noEmit` + esbuild), vérifie la version du manifeste, puis publie avec `gh release upload … --clobber`. **Aucun `vitest`, aucun `smoke`** avant publication. Le `check` local existe et passe : la barrière existe mais n'est pas branchée là où elle compte. Second point : `--clobber` écrase silencieusement des assets déjà publiés.
- **Settings enregistrés à chaque frappe — déduit + composants mesurés.** Tous les champs utilisent `text.onChange` → `saveSettings()` (`src/settings/SettingsTab.ts`, 20+ occurrences), qui écrit **tout** `data.json` (settings + historique) et rafraîchit la sidebar. Deux facteurs se cumulent : (a) aucune temporisation ; (b) l'historique conserve **tous** les chemins écrits (`src/features/exportHistory.ts:13,26-36`), soit ~1,9 Mo pour 5 exports de 8 000 fichiers et **~7,7 Mo pour 5 exports de 32 000 fichiers** (mesuré) ; `JSON.stringify` seul coûte 39 ms à cette taille, et la prévisualisation de portée ~87 ms (filtre sur 20 000 chemins). Un `customCss` volumineux aggrave encore l'écriture. L'interface ne se contente pas de ralentir : elle réécrit un fichier de plusieurs mégaoctets à chaque caractère.

### 4.10 Sécurité

- **Assainissement des URL correct** (`htmlFormatter.ts:23-30`) : `javascript:`, `vbscript:`, `data:` (hors images) sont rejetés, y compris avec caractères de contrôle intercalés ; tout le contenu est échappé avant rendu (`escapeHtml`), les ancres sont générées, pas recopiées. Aucune injection HTML trouvée.
- **Traversée de chemin** : les sorties relatives contenant `..` sont rejetées deux fois (validation `exportOrchestrator.ts:78-80`, puis `normalizeVaultTarget`, `vaultGateway.ts:16-24`). Les chemins absolus sont acceptés **par conception**.
- **Divergence de plateforme (P4, non planifié)** : `isAbsoluteOutputPath` (regex, `outputTarget.ts:21-23`) et `path.isAbsolute` (sémantique OS, `vaultGateway.ts:148,181`) ne sont pas d'accord pour `C:/…` sur Linux/macOS : la validation le traite comme absolu, l'écriture comme relatif au vault. Effet : un dossier littéralement nommé `C:` dans le vault. Rare, sans perte de données.
- **CSS personnalisé** : injecté dans `<style>` sans échappement de `</style>`. C'est du CSS fourni par l'utilisateur pour son propre export (auto-injection), pas une frontière de confiance. P4, aucun plan.
- Aucun secret, aucune requête réseau, aucun `eval` dans le bundle ; `main.js` (90 683 octets, 158 lignes) ne charge que des modules internes (`fs`, `path`, `zlib`) et l'API Obsidian.

### 4.11 Points mineurs examinés, non planifiés (P4)

| Point | Observation | Pourquoi aucun plan |
|---|---|---|
| Jeton de stash `\u0001N\u0001` (`htmlFormatter.ts:51,83`) | un caractère U+0001 présent dans une note pourrait être remplacé par le contenu du stash (injection de balise) | nécessite un caractère de contrôle invisible dans le source ; correctif = jeton aléatoire par rendu, à faire si le renderer est retouché (VE-011) |
| Nœuds de canvas invalides (`canvasParser.ts:60`) | `filter(isCanvasNode)` écarte silencieusement un nœud mal formé ; l'export du canvas est partiel | canvas corrompu uniquement ; les cas JSON invalide / tableau vide affichent déjà un texte explicite |
| `sanitizeHistory` et dates corrompues (`exportHistory.ts:40-41`) | `NaN` accepté (`typeof NaN === 'number'`) → « Invalid Date » / « 0s » | `data.json` modifié à la main uniquement |
| Stats de la sidebar en échec (`SidebarView.ts:133`) | `stats = null` sans message | information secondaire, aucun impact sur l'export |
| Archive > 4 Go (`zip.ts:149-153`) | les offsets et le central directory sont vérifiés, mais la taille **totale** peut dépasser 4 Go si le central directory suit un offset proche de la limite | limite ZIP32 de 4 Go, hors usage réel (les bundles mesurés font quelques Mo) |
| `VaultPathSuggest` sans limite (`VaultPathSuggest.ts:17-20`) | toutes les suggestions sont rendues ; le mock en crée une par résultat | **soupçon** : comportement de la vraie `AbstractInputSuggest` inconnu, non mesuré (voir § 8.7) |
| Résolution d'un wikilink ambigu (`wikilink.ts:53-55`) | premier fichier rencontré, pas le chemin le plus court d'Obsidian | **soupçon**, non reproduit (voir § 8.7) |

---

## 5. Optimisations mesurées — et celles qu'on ne fera pas

| Chemin | Mesure | Décision |
|---|---|---|
| `selectOutputs` + split | 33,6 s avant écriture à 8 k notes | **VE-003**, O(n²) → O(n log n) |
| `buildSplitFiles` | 5,35 s à 32 k notes | inclus dans VE-003 (devient le premier coût après correction) |
| Rétention mémoire toutes sorties | 154 Mo bruts → 634 Mo de sorties, 2 243 Mo de RSS | **VE-013** (P3, gros vaults seulement) |
| ZIP 120 Mo incompressible | 252 Mo d'`ArrayBuffer`, RSS 577 Mo | inclus dans VE-013 (copie inutile dans `writeBinary`, `vaultGateway.ts:179-180` ; la copie finale de `concat` dans `zip.ts` reste inévitable) |
| Dataview, densité réaliste (1 requête / 50 notes) | 2 000 notes : 150 ms (base 131 ms) ; 10 000 notes / 200 requêtes : 1 074 ms | **Rien à optimiser.** Le surcoût est de 19 ms à 2 000 notes. Seule une requête dans *chaque* note atteint 0,97 s (2 000 notes) et 13,1 s (5 000 notes, mesure distincte sur un corpus de 4 Ko) — scénario artificiel, non planifié. |
| `isFileIncluded` sur 20 000 chemins | 87 ms | **Rien à optimiser** (une fois par rafraîchissement, pas par note). |
| `crc32` / encodage UTF-8 | 360 ms pour 120 Mo ; 561 ms pour 318 Mo | **Rien à optimiser** ; le double encodage de `utf8ByteLength` (l. 48-50, appelé l. 317) est signalé dans VE-013 comme étape facultative, gain ~0,5 s sur 300 Mo. |
| Recherche plein texte dans le HTML exporté | 500 documents / 9,2 Mo : 62 ms par frappe (jsdom), 3 ms avec cache | **Non planifié** : mesure hors navigateur, le coût réel est plus faible et ne dure que pendant la saisie dans le champ de recherche. Une mise en cache des `textContent` (une ligne, 20× plus rapide en jsdom) pourra être ajoutée si un besoin réel est confirmé dans un navigateur ; aucun plan tant que ce n'est pas mesuré en conditions réelles. |
| `getAllFrontmatterKeys`, tri des entrées ZIP | < 10 ms | Rien à optimiser. |

---

## 6. Divergences de logique équivalente (à traiter avec les plans cités)

1. **Deux résolveurs de destinations** : `resolveOutputSettings` (composition) et `reservedOutputPaths` (re-résolution ad hoc), appelés avec des entrées de formes différentes → VE-002.
2. **Trois analyseurs de fences** : `splitContentSegments` (correct, `markdownClean.ts:28`) et les détections locales par regex/`startsWith` de `dataviewEngine.ts:672`, `htmlFormatter.ts:142` (rendu) et `htmlFormatter.ts:269` (sommaire) → VE-016, VE-011.
3. **Trois dérivations de noms/ancres** : `slugify` (HTML), `generateAnchor` (Markdown), `safeName` (split). Elles n'ont pas le même contrat (ancres uniques vs noms de fichiers) : ne pas les fusionner, mais chacune doit être injective dans son domaine → VE-004, VE-012.
4. **Deux traitements des métadonnées** : `visibleMetadata` filtre les clés personnalisées mais pas les champs intégrés ; le split recopie le frontmatter brut sans filtrage. Le second est un choix assumé (copie fidèle, contrôlée par `stripFrontmatter`) ; le premier est le bug VE-010.

---

## 7. Ordre recommandé

1. **VE-001** (P0) — écrasement des sources.
2. **VE-002** (P1) — réservation des destinations (après VE-001 : même zone, et VE-001 rend l'écrasement fatal).
3. **VE-003** (P1) — split quadratique (après VE-001 : même fonction `selectOutputs`).
4. **VE-005** (P2) — wikilinks.
5. **VE-006** (P2) — Unicode (après VE-002 pour `filter.ts`, après VE-005 pour `wikilink.ts`).
6. **VE-007** (P2) — Dataview : échec silencieux.
7. **VE-008** (P2) — snapshot des settings (après VE-002 : même ligne d'initialisation).
8. **VE-009** (P2) — échec partiel (après VE-003 : même boucle d'écriture).
9. **VE-010** (P2) — `ignoredProperties`.
10. **VE-012** (P2) — échappement Markdown.
11. **VE-004** (P3) — noms de sortie (après VE-001 : détecteur partagé).
12. **VE-011** (P3) — fences HTML.
13. **VE-013** (P3) — mémoire (après VE-009 : même phase d'écriture).
14. **VE-014** (P3) — panneau de progression.
15. **VE-015** (P3) — release.
16. **VE-016** (P3) — Dataview dans les fences (après VE-007 : même fichier).
17. **VE-017** (P3) — persistance des settings.

**Écart justifié à l'ordre par défaut** : VE-003 (performance) est placé avant les bugs P2. L'ordre par défaut réserve les optimisations pour la fin, mais ici la mesure est sans ambiguïté (153 s → cible < 2 s), le chemin est le plus courant (`split`, `all`), et le correctif est local et testable. Les autres optimisations (VE-013, VE-017) restent après les bugs.

Chaque plan tient en une séance d'agent. Les plans qui touchent les mêmes lignes sont ordonnés explicitement : `VE-002 → VE-008`, `VE-001 → VE-003 → VE-009 → VE-013`, `VE-007 → VE-016`, `VE-002 → VE-006`, `VE-005 → VE-006`.

## 8. Limites de cet audit / ce qui n'a pas été vérifié

1. **Aucune mesure dans Obsidian** : tous les temps et la mémoire viennent de Node 22 hors Electron. Les ordres de grandeur et les complexités sont fiables ; les valeurs absolues en application seront plus basses pour le CPU et plus hautes pour l'empreinte mémoire (rendu, cache Obsidian).
2. **macOS/Windows non testés** : VE-006 (NFD) et VE-004 (noms invalides Windows) sont établis par simulation et par lecture, pas sur ces systèmes.
3. **UI non instrumentée** : VE-014 (fuite d'intervalle) et VE-017 (frappe) sont déduits du code et de mesures de composants, pas d'un profil de l'application.
4. **Mobile** : sans objet, `manifest.json` déclare `isDesktopOnly: true`.
5. **Historique Git inexploitable** : un seul commit de fusion ; `git blame` ne peut pas dater les régressions. L'analyse s'appuie sur `CHANGELOG.md`, qui documente précisément les deux fonctionnalités les plus fragiles (dossier externe en 2.1.0, historique en 2.0.4).
6. **Non lus** : `tools/mock-obsidian/dom-helpers.cjs`, `electron-mock.cjs`, et la fin de `obsidian-mock.cjs`. Ils ne contiennent pas de logique de production ; le risque résiduel est une **fausse couverture** (tests qui valident le mock plutôt que le comportement), non évaluée au-delà des deux cas signalés en § 4.9.
7. **Pas de soupçons promus en bugs** : deux points restent explicitement non vérifiés — (a) `VaultPathSuggest` renvoie toutes les suggestions sans limite (`src/ui/VaultPathSuggest.ts:17-20`) ; à 20 000 chemins, coût de rendu inconnu dans le DOM Obsidian. (b) La résolution d'un wikilink ambigu par nom de base choisit le premier fichier rencontré (`wikilink.ts:53-55`), alors qu'Obsidian privilégie le chemin le plus court : liens potentiellement faux, non reproduit. Méthode de vérification : vault avec deux `Index.md` et un lien `[[Index]]` ; profiler l'ouverture du champ de portée sur un vault de 20 000 notes.
8. **Aucun test de charge réel** : les corpus sont synthétiques (Lorem ipsum), ce qui sous-estime la compression ZIP et surestime la similarité des contenus.

---

## 9. Risques de l'audit lui-même

- Les correctifs proposés touchent des invariants de chemins : VE-001/VE-002 peuvent transformer des exports silencieusement incorrects en **erreurs visibles**. C'est voulu (fail-fast), mais c'est un changement de comportement à annoncer dans le `CHANGELOG`.
- VE-003 modifie l'ordre de comparaison des sorties : toute différence de résultat (par exemple deux sorties qui se chevauchaient sans être détectées) doit être traitée comme un test à ajouter, pas comme un détail.
- VE-013 (mémoire) est le plan au meilleur rapport gain/risque le plus faible : il ne faut l'ouvrir que si un utilisateur signale des OOM ou des ralentissements sur un très gros vault.
