// Recettes de Forge (déterministes par forge et par jour) et rendement en crédits réels.
import { FAMILIES, type Family, type Rarity } from '../types.ts';
import { rngFrom, weightedPick } from '../rng.ts';
import { FAMILY_INFO, FORGE, RARITY_ORDER, TIERS, type Tier } from './rules.ts';

export interface Recipe {
  tier: Tier;
  needs: Partial<Record<Family, number>>;
  fee: number;
  weight: number;
  level: number;
}

const familiesOfRarity = (r: Rarity): Family[] => FAMILIES.filter((f) => FAMILY_INFO[f].rarity === r);

/** Les 3 recettes du jour d'une Forge. `day` = 'YYYY-MM-DD' (Europe/Paris). */
export function recipesFor(secret: string, forgeId: string, theme: Family[], day: string): Recipe[] {
  return (Object.keys(TIERS) as Tier[]).map((tier) => {
    const rule = TIERS[tier];
    const rng = rngFrom(secret, 'recipe', forgeId, day, tier);
    const needs: Partial<Record<Family, number>> = {};
    const add = (f: Family, n = 1) => { needs[f] = (needs[f] ?? 0) + n; };
    for (const [rarity, count] of Object.entries(rule.byRarity) as [Rarity, number][]) {
      const fams = familiesOfRarity(rarity);
      // les familles du thème de la Forge pèsent ×3 dans le partage d'un même rang
      const weights = Object.fromEntries(fams.map((f) => [f, theme.includes(f) ? 3 : 1])) as Record<Family, number>;
      for (let i = 0; i < count; i++) add(weightedPick(rng, weights));
    }
    // une recette sur deux : un Common est remplacé par une famille du thème (si elle n'est pas plus rare que la recette)
    const maxRarity = Math.max(...(Object.keys(rule.byRarity) as Rarity[]).map((r) => RARITY_ORDER.indexOf(r)));
    const themed = theme.filter((f) => RARITY_ORDER.indexOf(FAMILY_INFO[f].rarity) <= maxRarity);
    if (themed.length && rng() < FORGE.themeSwapChance) {
      const common = (Object.keys(needs) as Family[]).find((f) => FAMILY_INFO[f].rarity === 'common' && !theme.includes(f));
      if (common) {
        needs[common]! -= 1;
        if (needs[common] === 0) delete needs[common];
        add(themed[Math.floor(rng() * themed.length)]!);
      }
    }
    return { tier, needs, fee: rule.fee, weight: rule.weight, level: rule.level };
  });
}

/** Ce qui manque au joueur pour une recette. */
export function missingFor(needs: Partial<Record<Family, number>>, inv: Partial<Record<Family, number>>): Partial<Record<Family, number>> {
  const out: Partial<Record<Family, number>> = {};
  for (const [f, n] of Object.entries(needs) as [Family, number][]) {
    const lack = n - (inv[f] ?? 0);
    if (lack > 0) out[f] = lack;
  }
  return out;
}

export const recipeSize = (needs: Partial<Record<Family, number>>): number =>
  Object.values(needs).reduce((s, n) => s + (n ?? 0), 0);

export interface PayoutInput {
  poolAvail: number;          // nUSD disponibles dans la poche (déjà moins les promesses)
  weight: number;
  playerDayUsed: number;      // nUSD reçus par le joueur sur 24 h glissantes
  globalDayUsed: number;      // nUSD octroyés depuis minuit (Europe/Paris)
  globalDayBase: number;      // valeur de la poche à minuit (base du cap global)
}
export interface Payout { amount: number; reason: 'ok' | 'player-cap' | 'global-cap' | 'below-min' }

/** Rendement réel d'une compilation : fraction géométrique de la poche, bornée par les caps. */
export function forgePayout(i: PayoutInput): Payout {
  const raw = Math.floor(i.poolAvail * FORGE.yieldPerWeight * i.weight);
  const playerLeft = Math.max(0, FORGE.capPlayerDay - i.playerDayUsed);
  const globalLeft = Math.max(0, Math.floor(i.globalDayBase * FORGE.capGlobalDayRatio) - i.globalDayUsed);
  let amount = raw;
  let reason: Payout['reason'] = 'ok';
  if (playerLeft < amount) { amount = playerLeft; reason = 'player-cap'; }
  if (globalLeft < amount) { amount = globalLeft; reason = 'global-cap'; }
  if (amount < FORGE.minPayout) return { amount: 0, reason: reason === 'ok' ? 'below-min' : reason };
  return { amount, reason };
}
