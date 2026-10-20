# VE-009 — Échec en cours d'écriture : dire ce qui a déjà été écrit

| | |
|---|---|
| **Priorité** | **P2** — l'utilisateur ne peut pas savoir dans quel état est son vault après un échec |
| **Type** | robustesse (gestion d'erreur) |
| **Preuve** | **Reproduit** (3ᵉ écriture en échec) |
| **Références** | `src/features/exportOrchestrator.ts:21-26, 179-205, 291-320` · `src/commands/registry.ts:125-162` (gestion des erreurs de commande) · `src/ui/ProgressPanel.ts:112-149` · `tools/mock-obsidian/run.cjs` (annulation) |
| **Dépend de** | VE-003 (même boucle d'écriture) |
| **Bloque** | VE-013 |
| **Séance** | 1 |

## Constat

Reproduction exécutée : gateway dont `writeFile` échoue sur `Vault export.md` (« disk full »), cible `['notebooklm', 'html', 'markdown']`.

Observé :

```
error: disk full
is ExportCancelledError: false
has partialResult: false
files actually written: [ 'Vault export - NotebookLM.txt', 'Vault export.html' ]
```

Deux fichiers ont été écrits, l'erreur remonte nue, l'UI affiche « Failed » sans dire combien ni lesquels. Un utilisateur qui relance ne sait pas si le ZIP ou les fichiers partiels sont cohérents.

Symétrie : l'**annulation** transporte correctement un `partialResult` (`l. 21-26, 200-205`), mais le smoke test accepte indifféremment « Cancelled » **ou** « Done » après un clic sur Cancel, donc ce chemin n'est pas réellement verrouillé.

## Comportement actuel / attendu

- **Actuel** : toute erreur d'écriture jette l'`ExportResult` accumulé. Les fichiers déjà écrits restent sur disque. Aucun décompte, aucun chemin fautif dans le message.
- **Attendu** : l'erreur porte le résultat partiel (fichiers, octets, durée) et le chemin en échec ; l'UI les affiche. Aucune suppression automatique (voir Non-objectifs).

## Cause racine

La boucle d'écriture (`l. 291-320`) n'est pas protégée : `written` est une variable locale, et la seule construction du résultat partiel (`snapshot()`) n'est utilisée que pour `ExportCancelledError`. Les erreurs des gateways (`writeFile`, `writeBinary`) remontent telles quelles, sans contexte.

Le contrat est donc asymétrique : annulation = résultat partiel ; échec = rien. C'est exactement l'inverse de l'usage : une annulation est un choix de l'utilisateur, un échec est un incident qui laisse des fichiers inconnus.

## Sites affectés

| Site | Rôle |
|---|---|
| `src/features/exportOrchestrator.ts:298-305` | écriture du ZIP |
| `src/features/exportOrchestrator.ts:307-320` | écriture des fichiers consolidés/split |
| `src/features/exportOrchestrator.ts:200-205` | `snapshot()` (à réutiliser) |
| `src/commands/registry.ts:125-162` | handlers des commandes d'export (`catch`, `Notice`, entrée d'historique) |
| `src/ui/ProgressPanel.ts:112-149` | `finish('error', …)` |
| `tools/mock-obsidian/run.cjs` | assertion d'annulation (à durcir) |

## Plan d'action

1. **Introduire une erreur typée** dans `exportOrchestrator.ts` :

   ```ts
   export class ExportFailedError extends Error {
     constructor(message: string, readonly partialResult: ExportResult, readonly failedPath?: string) { … }
   }
   ```

2. **Envelopper la phase d'écriture** (ZIP puis fichiers) dans un `try/catch` ; en cas d'erreur, lever
   `ExportFailedError('Export failed after writing ' + written.length + ' file(s): ' + message, snapshot(), path)`.
   Le message doit contenir le chemin fautif (passé par le `catch` autour de l'appel concerné).
3. **Ne pas** envelopper la construction du ZIP (`buildZip`) : elle échoue avant toute écriture, et une erreur nue y est correcte (pas de partiel).
4. **Adapter l'UI** : dans `src/commands/registry.ts`, la branche `else` du `catch` (`l. 149-155`) reconnaît `ExportFailedError`, renseigne `result` avec son `partialResult`, et passe `fileCount`/`bytes` à `ProgressPanel.finish('error', …)` ; le panneau et la `Notice` affichent « Failed · N files written ». Conséquence secondaire à corriger dans le même mouvement : l'entrée d'historique créée après le `catch` (`l. 157-164`) utilise `result?.written ?? []` ; sans cela, un échec est enregistré avec **0 fichier** alors que des fichiers existent.
5. **Durcir le smoke test** : après un clic sur Cancel, exiger le statut **Cancelled** (aujourd'hui `run.cjs` accepte `Cancelled` ou `Done`) et vérifier que le résumé mentionne les fichiers déjà écrits. C'est le seul test qui couvre le chemin UI d'annulation.
6. **Documenter** dans le commentaire de `runExports` : aucune restauration automatique ; les fichiers écrits avant l'échec restent, et l'utilisateur en est informé.

## Test de non-régression

Dans `tests/features.test.ts` :

```ts
const gateway: ExportGateway = {
  loadVaultFiles: async () => manyFiles,
  writeFile: async (p) => { if (p === 'Vault export.md') throw new Error('disk full'); },
  writeBinary: async () => {},
};
const error = await runExports(gateway, DEFAULT_SETTINGS, ['notebooklm', 'html', 'markdown'], () => {})
  .catch((e) => e);
expect(error).toBeInstanceOf(ExportFailedError);
expect(error.partialResult.written.map((w) => w.path)).toEqual([
  'Vault export - NotebookLM.txt', 'Vault export.html',
]);
expect(error.message).toContain('disk full');
expect(error.failedPath).toBe('Vault export.md');
// l'historique enregistré ne doit plus annoncer 0 fichier
```

Variante ZIP : échec de `writeBinary` → `written` vide, `failedPath` = chemin du ZIP.
Test d'annulation existant (`features.test.ts:230-260`) doit rester vert.

## Points d'impact

- `src/features/exportOrchestrator.ts` (classe + try/catch), `src/commands/registry.ts` (un `catch` + l'entrée d'historique), `src/ui/ProgressPanel.ts` (aucune signature changée si `FinishInfo` est réutilisé), `tools/mock-obsidian/run.cjs`.
- `ExportFailedError` est une nouvelle API publique du module : exporter depuis `exportOrchestrator.ts`, pas depuis `types.ts` (l'erreur est propre à l'orchestrateur).
- Aucun changement de format de sortie.

## Non-objectifs

- **Aucune suppression ni restauration des fichiers déjà écrits.** Un fichier de sortie peut avoir écrasé un fichier préexistant de l'utilisateur (hors sources, protégées par VE-001) ; le supprimer détruirait une donnée. On informe, on ne nettoie pas.
- Pas de reprise automatique ni de reprise partielle.
- Pas de transaction multi-fichiers (impossible avec l'API Obsidian).

## Critères d'acceptation

- L'erreur d'un échec en cours d'écriture expose `partialResult.written` (contenu exact des fichiers réellement écrits) et `failedPath`.
- L'UI affiche le nombre de fichiers écrits avant l'échec.
- Le smoke test échoue si l'annulation est signalée comme un succès.
- `npm run check` passe.

## Risques

- Changer le type d'erreur peut casser un appelant qui teste `error.constructor === Error` : aucun dans `src/`, et `instanceof Error` reste vrai.
- Le durcissement du smoke test peut révéler un vrai défaut du chemin d'annulation UI (c'est le but) ; s'il échoue, traiter le défaut, ne pas assouplir l'assertion.

## Journal d'exécution

### 2026-10-21 — implementation hash pending

- Baseline pull/check PASS (177 tests / 101 smoke); read the full plan, both write paths, snapshot, command handlers, panel finish contract and smoke cancellation path.
- Tests first: **3/3 feature regressions failed** on bare errors lacking partialResult/failedPath. They cover a failed third plain write (exact successful paths/UTF-8 bytes), failed ZIP before any output, and successful ZIP followed by a failed plain write. Smoke first failed three assertions: missing completed-file count in panel/Notice and empty history despite two files written.
- Added exported `ExportFailedError` with partialResult, failedPath and original cause. A small local write wrapper covers only the two gateway calls; ZIP construction stays outside it. Cancellation errors are not reclassified. Successful writes are recorded only after their awaited call completes. No output is deleted or restored.
- Command error handling now keeps the partial result, feeds counts/bytes/skipped/duration into the existing panel contract and history, and names completed files and failed path in the panel/Notice. No ProgressPanel signature change was needed.
- Hardened cancellation smoke with an actual Cancel-button click immediately after the first successful gateway write; it now **requires Cancelled, never Done**, and checks the one-file summary/history. This avoids the old timing race rather than weakening the assertion. Expected injected error logging is checked and only that expected entry is removed from console hygiene checks.
- `npm run check` PASS: **180/180 tests, 107/107 smoke** (six net new assertions), strict typecheck/build. All existing cancellation tests remain green; partial results match completed writes exactly.

- Remaining: record the green implementation hash and final tracker status.
