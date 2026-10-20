# VE-014 — Panneau de progression : intervalles orphelins et destruction à l'unload

| | |
|---|---|
| **Priorité** | **P3** — fuite lente (1 intervalle par panneau abandonné), sans impact visible immédiat |
| **Type** | ressource / cycle de vie |
| **Preuve** | **Déduit du code** (lecture, aucun profil UI) |
| **Références** | `src/ui/ProgressPanel.ts:38-41, 78, 112-149, 151-161` · `src/main.ts:129-131` |
| **Dépend de** | — |
| **Bloque** | — |
| **Séance** | 1 |

## Constat (lecture)

```ts
// ProgressPanel.ts:38-41
document.querySelectorAll('.ve-panel').forEach((el) => el.remove());
this.root = document.body.createDiv({ cls: 've-panel' });
```

Le constructeur supprime les panneaux existants **sans appeler `destroy()`**. Or chaque panneau démarre un intervalle d'une seconde (`l. 78`) qui n'est arrêté que par `finish()` (succès) ou `destroy()` (`l. 117-120, 151-159`). Le panneau retiré du DOM garde donc :

- son `setInterval` actif indéfiniment ;
- les références vers son DOM détaché et ses closures.

Déclencheur précis : seul un `success` programme la fermeture automatique (`l. 146-147`). Un export **en erreur** ou **annulé** laisse le panneau affiché ; l'export suivant le supprime sans le détruire. Chaque cycle « échec puis nouvel export » fuit un intervalle.

Second site : `main.onunload` annule l'export (`src/main.ts:129-131`) mais ne détruit pas le panneau ; un plugin désactivé laisse son intervalle et son DOM.

## Comportement actuel / attendu

- **Actuel** : un panneau évincé garde son intervalle d'une seconde jusqu'au rechargement d'Obsidian ; un panneau en erreur n'est jamais fermé, donc l'export suivant le fuit à coup sûr.
- **Attendu** : un seul panneau vivant à la fois, un seul intervalle actif, et plus aucun intervalle après désactivation du plugin.

## Cause racine

Le panneau n'a pas de propriétaire unique. Il se nettoie tout seul sur les chemins nominaux (`success`, clic sur ×, bouton « Open folder »), mais l'éviction par le constructeur suivant et l'unload du plugin ne passent pas par `destroy()`.

## Sites affectés

| Site | Rôle |
|---|---|
| `src/ui/ProgressPanel.ts:38-41` | éviction sans destruction |
| `src/ui/ProgressPanel.ts:78` | création de l'intervalle |
| `src/ui/ProgressPanel.ts:112-149` | `finish` (seul `success` ferme) |
| `src/ui/ProgressPanel.ts:151-161` | `destroy` |
| `src/main.ts:129-131` | `onunload` |
| Constructeurs | `src/main.ts` (commandes d'export), `src/ui/SidebarView.ts` |

## Plan d'action

1. **Ajouter un propriétaire statique** dans `ProgressPanel` :

   ```ts
   private static current: ProgressPanel | null = null;
   constructor(options) {
     ProgressPanel.current?.destroy();
     ProgressPanel.current = this;
     …
   }
   ```

   Remplacer le `querySelectorAll('.ve-panel').forEach(el => el.remove())` par cet appel. `destroy()` doit faire `if (ProgressPanel.current === this) ProgressPanel.current = null;`.
2. **Exposer une fonction de nettoyage** `destroyProgressPanel(): void` (ou une méthode statique `ProgressPanel.destroyCurrent()`), appelée par `main.onunload` avant/après `cancelRunningExport()`.
3. **Ne pas** changer la politique de fermeture automatique (succès seulement) ni l'UX du panneau.
4. **Vérifier** qu'un panneau détruit ne reçoit plus de `update` (le flux de progression est capturé dans la closure de la commande ; si `destroy()` est appelé, `update` doit devenir un no-op). Ajouter un booléen `destroyed` et un retour immédiat dans `update`, `finish` et `setStage` pour éviter de recréer du DOM après destruction — c'est le scénario réel : l'ancien export continue quelques millisecondes après l'éviction.

## Test de non-régression

Test unitaire avec jsdom (déjà utilisé par le smoke) :

```ts
const p1 = new ProgressPanel({ title: 'a' });
const spy = vi.spyOn(window, 'clearInterval');
const p2 = new ProgressPanel({ title: 'b' });
expect(spy).toHaveBeenCalled();                 // p1 détruit
expect(document.querySelectorAll('.ve-panel')).toHaveLength(1);
p2.destroy();
expect(document.querySelectorAll('.ve-panel')).toHaveLength(0);
p1.update({ stage: 'x', current: 1, total: 2 }); // ne doit rien recréer
expect(document.querySelectorAll('.ve-panel')).toHaveLength(0);
```

Et dans le smoke : provoquer un export en erreur puis un export réussi, vérifier qu'il ne reste qu'un panneau et que `window.setInterval` n'a pas accumulé d'intervalles (espion).

## Points d'impact

- `src/ui/ProgressPanel.ts`, `src/main.ts` (un appel).
- Aucun changement visuel : le comportement d'éviction est identique, seule la libération change.
- `tools/mock-obsidian/run.cjs` (nouvelle assertion) ; pas d'impact sur les tests existants.

## Non-objectifs

- Remplacer `setInterval` par `requestAnimationFrame` : inutile pour un compteur d'écoulé.
- Fermer automatiquement les panneaux en erreur (choix d'UX existant, conservé).
- Gérer plusieurs panneaux simultanés : le produit n'en veut qu'un.

## Critères d'acceptation

- Créer deux panneaux successifs laisse exactement un intervalle actif.
- `destroy()` puis un `update()` ne recrée aucun DOM.
- `onunload` ne laisse ni panneau ni intervalle.
- `npm run check` passe.

## Risques

- Un test qui crée plusieurs panneaux pour vérifier l'indépendance casserait : aucun test de ce type aujourd'hui.
- `destroy()` appelé deux fois doit rester idempotent (le code actuel retire `root`, ce qui est sans effet la seconde fois ; les timers sont déjà à `null`).
