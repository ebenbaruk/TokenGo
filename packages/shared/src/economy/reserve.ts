// Réserve réelle : poches, santé, invariant de solvabilité. Fonctions pures, montants en nUSD.
import { RESERVE, RESERVE_PARTITION, type Pool } from './rules.ts';

export interface PoolState { allocated: number; granted: number }
export type Pools = Record<Pool, PoolState>;

export const initialPools = (): Pools =>
  Object.fromEntries((Object.keys(RESERVE_PARTITION) as Pool[]).map((p) => [p, { allocated: RESERVE_PARTITION[p], granted: 0 }])) as Pools;

export const poolAvail = (p: PoolState): number => Math.max(0, p.allocated - p.granted);

/** Santé h = clamp(disponible / alloué, 0.3, 1) : pilote la rareté des éclats GPT/Claude. */
export function reserveHealth(main: PoolState): number {
  if (main.allocated <= 0) return RESERVE.healthMin;
  return Math.min(1, Math.max(RESERVE.healthMin, poolAvail(main) / main.allocated));
}

export interface KeyExposure { limit: number; usage: number }
export interface SolvencyInput {
  orgRemaining: number;       // solde réel de l'organisation NEAR AI (nUSD)
  keys: KeyExposure[];        // clés joueurs actives
  npcRemaining: number;       // budget restant du cerveau des marchands
  safety: number;             // marge de sécurité
}

/** Engagement total : ce que le jeu doit pouvoir payer à tout instant. */
export function commitments(i: Omit<SolvencyInput, 'orgRemaining'>): number {
  const keysOwed = i.keys.reduce((s, k) => s + Math.max(0, k.limit - k.usage), 0);
  return keysOwed + RESERVE.overshootPerKey * i.keys.length + i.npcRemaining + i.safety;
}

/** Invariant : Σ(limite − usage) + overshoot × clés + PNJ + marge ≤ solde org. `extra` = octroi envisagé. */
export function isSolvent(i: SolvencyInput, extra = 0, newKey = false): boolean {
  const c = commitments(i) + extra + (newKey ? RESERVE.overshootPerKey : 0);
  return c <= i.orgRemaining;
}
