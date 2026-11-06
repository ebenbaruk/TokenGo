// Mini-jeu « Lock-on » : paramètres par rareté et jugement des taps (côté serveur).
import type { Family } from '../types.ts';
import type { Rng } from '../rng.ts';
import { CATCH, FAMILY_INFO } from './rules.ts';

export interface CatchParams { ringMs: number; perfectPct: number; goodPct: number; tries: number }
export const catchParams = (f: Family): CatchParams => {
  const r = FAMILY_INFO[f].rarity;
  return { ringMs: CATCH.ringMs[r], perfectPct: CATCH.perfectWindow[r], goodPct: CATCH.goodWindow[r], tries: CATCH.maxTries };
};

export type TapQuality = 'perfect' | 'good' | 'miss';
/** offsetPct = écart relatif entre l'anneau et la cible au moment du tap (0 = parfait). */
export function judgeTap(offsetPct: number, p: CatchParams): TapQuality {
  const o = Math.abs(offsetPct);
  if (!Number.isFinite(o)) return 'miss';
  if (o <= p.perfectPct) return 'perfect';
  if (o <= p.goodPct) return 'good';
  return 'miss';
}

export type CatchResult = { result: 'perfect' | 'good'; bonus: boolean } | { result: 'fled' | 'miss' };

/**
 * Résout une tentative : le premier tap réussi capture ; chaque raté peut faire fuir l'éclat.
 * `recentPerfects` = nb de perfect parmi les 30 dernières captures : au-delà du plafond, perfect → good (silencieusement).
 */
export function resolveCatch(f: Family, offsets: number[], rng: Rng, recentPerfects: number, recentCount: number): CatchResult {
  const p = catchParams(f);
  const flee = CATCH.fleeAfterMiss[FAMILY_INFO[f].rarity];
  for (const o of offsets.slice(0, p.tries)) {
    const q = judgeTap(o, p);
    if (q === 'miss') {
      if (rng() < flee) return { result: 'fled' };
      continue;
    }
    const capped = recentCount >= 5 && recentPerfects / Math.max(1, Math.min(recentCount, CATCH.perfectCapWindow)) >= CATCH.perfectCapRatio;
    if (q === 'perfect' && !capped) return { result: 'perfect', bonus: rng() < CATCH.perfectBonusChance };
    return { result: 'good', bonus: false };
  }
  return { result: 'miss' };
}
