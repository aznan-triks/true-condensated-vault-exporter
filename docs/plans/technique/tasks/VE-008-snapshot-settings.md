# VE-008 — Figer les settings au début de l'export

| | |
|---|---|
| **Priorité** | **P2** — sortie incohérente (deux règles de rendu dans un même fichier) si un réglage change pendant l'export |
| **Type** | bug (état partagé) |
| **Preuve** | **Reproduit** (mutation simulée en cours d'export) + **déduit du code** pour le chemin UI |
| **Références** | `src/core/outputTarget.ts:108-122` (l. 109) · `src/core/pipeline.ts:59-66, 90, 98` · `src/features/exportOrchestrator.ts:169, 274-276` |
| **Dépend de** | VE-002 (même ligne d'initialisation de `runExports`) |
| **Bloque** | — |
| **Séance** | 1 |

## Constat

Reproduction exécutée : `yieldEvery: 1`, cible `['markdown']`, callback de progression qui remplace `wikilinkFormat` (`markdown` → `keep-wikilink`) après la 3ᵉ note. Résultat dans **le même fichier** `Vault export.md` : les notes 0 à 2 sont converties (`[Target](Target.md)`), les notes 3 à 11 conservent `[[Target]]`.

Le callback de progression simule une modification provenant de l'onglet Réglages (celui-ci reste accessible pendant qu'un export tourne dans le panneau de progression). Le chemin UI exact n'a pas été instrumenté ; le mécanisme, lui, est démontré.

## Comportement actuel / attendu

- **Actuel** : `runExports` ne copie pas les settings. `resolveOutputSettings` retourne **le même objet** quand le dossier externe est désactivé (`outputTarget.ts:109`), et `createExportContext` le stocke par référence (`pipeline.ts:65`). Chaque note relit `settings.renderDataview` et `settings.wikilinkFormat` (`pipeline.ts:90,98`), chaque formateur relit le reste.
- **Attendu** : une exécution utilise un instantané immuable, de la première note au dernier fichier.

## Cause racine

Absence d'instantané : l'objet de settings est partagé entre l'UI (qui le mute en place via `plugin.settings.x = …`) et le moteur d'export (qui le lit en boucle). Le fait que le bug n'apparaisse **pas** quand le dossier externe est actif (l'objet est alors copié par `{ ...settings }`) rend le symptôme dépendant d'un réglage sans rapport — c'est ce qui le rend difficile à croire et à reproduire.

## Sites affectés

| Site | Lecture |
|---|---|
| `src/features/exportOrchestrator.ts:169` | point de résolution (à copier) |
| `src/features/exportOrchestrator.ts:274-276` | `consolidatedOutputs` / `buildSplitFiles` |
| `src/core/pipeline.ts:59-66` | `createExportContext` stocke la référence |
| `src/core/pipeline.ts:69-107` | `cleanNote` relit les settings à chaque note |
| `src/core/markdownFormatter.ts`, `htmlFormatter.ts`, `notebooklmFormatter.ts` | relecture au rendu |
| `src/settings/SettingsTab.ts` (20+ `onChange`) | écrit `plugin.settings` en place |

## Plan d'action

1. **Copier profondément une seule fois**, au début de `runExports` :

   ```ts
   const settings: ExporterSettings = structuredClone(resolveOutputSettings(rawSettings));
   ```

   `structuredClone` est disponible dans Electron 28 (Obsidian 1.7.2) et dans Node 22 (tests). Si une cible plus ancienne doit être supportée, remplacer par une copie explicite champ par champ — mais **pas** `JSON.parse(JSON.stringify())` (perte de `undefined`, coût inutile).
2. **Ne pas modifier `resolveOutputSettings`** pour qu'il copie : il est aussi appelé par la sidebar pour un aperçu, où l'identité de l'objet n'a pas d'importance, mais où une copie par appel serait du bruit. Le point unique est `runExports`.
3. **Vérifier qu'aucun code ne dépend de l'identité** : `settings === plugin.settings` n'est utilisé nulle part dans `src/` (vérifié). Les tableaux (`excludedFolders`, `ignoredProperties`, `lastSelectedTargets`) sont copiés par `structuredClone` — c'est le point important, car une mutation en place du tableau échapperait à une copie superficielle.
4. **Ne pas geler l'objet** (`Object.freeze`) : la copie suffit, et un gel profond n'apporterait qu'un mode d'échec supplémentaire.

## Test de non-régression

Dans `tests/features.test.ts` :

```ts
const { gateway, written } = fakeGateway(manyFiles);
const raw = { ...DEFAULT_SETTINGS, yieldEvery: 1 };
await runExports(gateway, raw, ['markdown'], (p) => {
  if (p.stage === 'Cleaning notes' && p.current === 3) {
    raw.wikilinkFormat = 'keep-wikilink';
    raw.ignoredProperties.push('status');
  }
});
const text = written.get('Vault export.md')!;
expect(text.match(/\[\[Target\]\]/g) ?? []).toHaveLength(0); // toutes converties
expect(raw.wikilinkFormat).toBe('keep-wikilink');            // la source n'est pas modifiée par l'export
```

Second test : mutation du **tableau** `ignoredProperties` en place (push) → la sortie ne change pas non plus (ce que ne garantirait pas une copie `{...settings}`).

## Points d'impact

- `src/features/exportOrchestrator.ts` (une ligne).
- Les tests existants qui passent un objet settings et le réutilisent ne sont pas affectés.
- `SidebarView` continue d'utiliser les settings vivants pour son aperçu (comportement voulu).
- Aucun impact sur les performances mesurables (une copie de quelques tableaux par export).

## Non-objectifs

- Verrouiller l'édition des réglages pendant un export (changement d'UX inutile).
- Recharger ou invalider un export en cours quand un réglage change.
- Corriger les écritures `saveSettings` à chaque frappe (VE-017).

## Critères d'acceptation

- Le test de mutation en cours d'export produit une sortie uniforme.
- `raw` n'est pas modifié par `runExports`.
- `npm run check` passe.

## Risques

- Un futur appelant qui comptait sur l'identité de l'objet serait cassé : aucun aujourd'hui, et le contrat devient plus strict (bon sens).
- `structuredClone` échoue sur des valeurs non clonables (fonctions, `Symbol`) : `ExporterSettings` ne contient que des types primitifs et des tableaux de chaînes. Un test de chargement des settings suffit à le garantir.
