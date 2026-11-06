// Réserve côté serveur : poches persistées, octroi avec vérification de l'invariant de solvabilité.
import {
  FORGE, RESERVE, RESERVE_PARTITION, commitments, initialPools, isSolvent, poolAvail, reserveHealth,
  type Pool, type Pools, type ReserveView,
} from '@tokengo/shared';
import { kvGet, kvSet } from '../db.ts';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { makeCipher, randomId } from './crypto.ts';

export const getPools = (ctx: Ctx): Pools => kvGet<Pools>(ctx.db, 'pools') ?? initialPools();
export const forgePaused = (ctx: Ctx): boolean => kvGet<boolean>(ctx.db, 'forge-paused') ?? false;

export function reserveView(ctx: Ctx): ReserveView {
  const p = getPools(ctx);
  return { mainAvailNusd: poolAvail(p.main), mainInitialNusd: p.main.allocated, health: reserveHealth(p.main), simulated: ctx.credits.simulated, forgePaused: forgePaused(ctx) };
}

/** Somme des octrois d'une poche depuis `since` (caps). */
export const grantedSince = (ctx: Ctx, since: number, where: { userId?: string; pool?: Pool } = {}): number => {
  const r = ctx.db.prepare(`SELECT COALESCE(SUM(amount_nusd), 0) s FROM grants WHERE at >= ? AND status != 'failed'
    ${where.userId ? 'AND user_id = @u' : ''} ${where.pool ? 'AND pool = @p' : ''}`.replace('@u', '?').replace('@p', '?'))
    .get(since, ...(where.userId ? [where.userId] : []), ...(where.pool ? [where.pool] : [])) as { s: number };
  return r.s;
};

let orgCache: { at: number; value: number } | null = null;
async function orgRemaining(ctx: Ctx, fresh = false): Promise<number> {
  if (!fresh && orgCache && ctx.now() - orgCache.at < 60_000) return orgCache.value;
  const value = await ctx.credits.orgRemaining();
  orgCache = { at: ctx.now(), value };
  return value;
}

/**
 * Octroie `amount` nUSD au joueur depuis une poche, sur sa clé API (création ou hausse de limite).
 * Ordre strict (Docs/07 §2) : invariant → grant pending → appel API → done.
 */
export async function grantCredits(ctx: Ctx, userId: string, pool: Pool, amount: number, compileId: string): Promise<{ grantId: string }> {
  const keys = ctx.db.prepare('SELECT user_id, nearai_key_id, limit_nusd, usage_nusd FROM api_keys').all() as
    { user_id: string; nearai_key_id: string; limit_nusd: number; usage_nusd: number }[];
  const pools = getPools(ctx);
  const npcRemaining = poolAvail(pools.npc);
  const existing = keys.find((k) => k.user_id === userId);
  const org = await orgRemaining(ctx, true);
  const input = { orgRemaining: org, keys: keys.map((k) => ({ limit: k.limit_nusd, usage: k.usage_nusd })), npcRemaining, safety: RESERVE_PARTITION.safety };
  if (!isSolvent(input, amount, !existing)) {
    ctx.bus.publish('reserve.alert', 'Forge cooling down — reserve too low', { commitments: commitments(input), org });
    fail('RESERVE_LOW', 'The Forge is cooling down — the city reserve is too low.', 409);
  }
  const grantId = randomId(10);
  const at = ctx.now();
  ctx.db.transaction(() => {
    ctx.db.prepare('INSERT INTO grants (id, at, user_id, pool, amount_nusd, compile_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(grantId, at, userId, pool, amount, compileId, 'pending');
    const p = getPools(ctx);
    p[pool].granted += amount;
    kvSet(ctx.db, 'pools', p);
  })();
  try {
    const cipher = makeCipher(ctx.cfg.MASTER_KEY, ctx.cfg.SESSION_SECRET);
    if (existing) {
      await ctx.credits.setLimit(existing.nearai_key_id, existing.limit_nusd + amount);
      ctx.db.prepare('UPDATE api_keys SET limit_nusd = limit_nusd + ? WHERE user_id = ?').run(amount, userId);
    } else {
      const k = await ctx.credits.createKey(`tg_${userId}`, amount);
      ctx.db.prepare('INSERT INTO api_keys (user_id, nearai_key_id, key_enc, key_prefix, limit_nusd, simulated) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, k.keyId, cipher.encrypt(k.key), k.prefix, amount, ctx.credits.simulated ? 1 : 0);
    }
    ctx.db.prepare("UPDATE grants SET status = 'done' WHERE id = ?").run(grantId);
  } catch (e) {
    // le burn est déjà fait : on garde l'octroi en « pending » (IOU rejouée par un job)
    ctx.db.prepare("UPDATE grants SET status = 'pending' WHERE id = ?").run(grantId);
    throw e;
  }
  return { grantId };
}

export const yieldInput = (ctx: Ctx, userId: string, pool: Pool) => {
  const pools = getPools(ctx);
  const dayStart = parisDayStart(ctx.now());
  const base = kvGet<{ day: number; base: number }>(ctx.db, `pool-day-base:${pool}`);
  const globalDayBase = base && base.day === dayStart ? base.base : poolAvail(pools[pool]);
  if (!base || base.day !== dayStart) kvSet(ctx.db, `pool-day-base:${pool}`, { day: dayStart, base: globalDayBase });
  return {
    poolAvail: poolAvail(pools[pool]),
    playerDayUsed: grantedSince(ctx, ctx.now() - 24 * 3600_000, { userId }),
    globalDayUsed: grantedSince(ctx, dayStart, { pool }),
    globalDayBase,
  };
};

/** Minuit Europe/Paris (ms) du jour contenant `t`. */
export function parisDayStart(t: number): number {
  const day = parisDay(t);
  // décalage Paris (UTC+1 ou +2) : on cherche le minuit local par essai
  for (const off of [1, 2]) {
    const guess = Date.parse(`${day}T00:00:00Z`) - off * 3600_000;
    if (parisDay(guess) === day && parisDay(guess - 1) !== day) return guess;
  }
  return Date.parse(`${day}T00:00:00Z`) - 3600_000;
}
export const parisDay = (t: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

export { FORGE };
