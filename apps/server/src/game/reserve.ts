// Réserve côté serveur : poches persistées, octroi avec vérification de l'invariant de solvabilité.
import {
  FORGE, RESERVE, RESERVE_PARTITION, commitments, initialPools, isSolvent, poolAvail, reserveHealth,
  type Pool, type Pools, type ReserveView, type SolvencyInput,
} from '@tokengo/shared';
import { kvGet, kvSet } from '../db.ts';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { makeCipher, randomId } from './crypto.ts';
import { withLock } from './lock.ts';

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
export async function orgRemaining(ctx: Ctx, fresh = false): Promise<number> {
  if (!fresh && orgCache && ctx.now() - orgCache.at < 60_000) return orgCache.value;
  const value = await ctx.credits.orgRemaining();
  orgCache = { at: ctx.now(), value };
  return value;
}

interface KeyRow { user_id: string; nearai_key_id: string; limit_nusd: number; usage_nusd: number }

/**
 * Entrée de l'invariant : clés existantes + octrois en attente ou réservés (IOU), comptés comme exposition
 * (sur la clé du joueur si elle existe, sinon comme une future clé). `exceptGrant` : l'octroi en cours de vérification.
 */
export function solvencyInput(ctx: Ctx, org: number, exceptGrant = ''): SolvencyInput {
  const keys = ctx.db.prepare('SELECT user_id, nearai_key_id, limit_nusd, usage_nusd FROM api_keys').all() as KeyRow[];
  const pending = ctx.db.prepare("SELECT user_id, SUM(amount_nusd) s FROM grants WHERE status IN ('pending', 'reserved') AND id != ? GROUP BY user_id")
    .all(exceptGrant) as { user_id: string; s: number }[];
  const exposure = new Map(keys.map((k) => [k.user_id, { limit: k.limit_nusd, usage: k.usage_nusd }]));
  for (const p of pending) {
    const e = exposure.get(p.user_id);
    if (e) e.limit += p.s;
    else exposure.set(p.user_id, { limit: p.s, usage: 0 });
  }
  return { orgRemaining: org, keys: [...exposure.values()], npcRemaining: poolAvail(getPools(ctx).npc), safety: RESERVE_PARTITION.safety };
}

/** État de l'invariant pour /healthz (solde org en cache ≤ 60 s). */
export async function invariantStatus(ctx: Ctx): Promise<{ ok: boolean; orgRemainingNusd: number | null; commitmentsNusd: number }> {
  let org: number | null = null;
  try { org = await orgRemaining(ctx); } catch { /* fournisseur injoignable */ }
  const input = solvencyInput(ctx, org ?? 0);
  return { ok: org !== null && isSolvent(input), orgRemainingNusd: org, commitmentsNusd: commitments(input) };
}

/** Verrou par joueur autour de sa clé API (octrois, reprise IOU, suppression de compte). */
export const withGrantLock = <T>(userId: string, fn: () => Promise<T>) => withLock(`grant:${userId}`, fn);

/**
 * Appel au fournisseur, sérialisé par joueur. Cible = somme des octrois « done » du joueur + celui-ci (valeur absolue,
 * donc rejouable et sans mise à jour perdue) ; la clé n'est créée qu'une fois (re-vérifiée sous le verrou).
 * Renvoie false si l'octroi n'est plus à régler (déjà fait, ou compte supprimé).
 */
async function applyGrant(ctx: Ctx, userId: string, grantId: string): Promise<boolean> {
  return withGrantLock(userId, async () => {
    const g = ctx.db.prepare('SELECT status, amount_nusd FROM grants WHERE id = ?').get(grantId) as { status: string; amount_nusd: number } | undefined;
    if (!g || g.status !== 'pending') return false;
    const u = ctx.db.prepare('SELECT deleted_at FROM users WHERE id = ?').get(userId) as { deleted_at: number | null } | undefined;
    if (!u || u.deleted_at !== null) return false;
    const done = (ctx.db.prepare("SELECT COALESCE(SUM(amount_nusd), 0) s FROM grants WHERE user_id = ? AND status = 'done'").get(userId) as { s: number }).s;
    const target = done + g.amount_nusd;
    ctx.db.prepare('UPDATE grants SET target_nusd = ?, tries = tries + 1 WHERE id = ?').run(target, grantId);
    const existing = ctx.db.prepare('SELECT nearai_key_id FROM api_keys WHERE user_id = ?').get(userId) as { nearai_key_id: string } | undefined;
    if (existing) {
      await ctx.credits.setLimit(existing.nearai_key_id, target);
      ctx.db.prepare('UPDATE api_keys SET limit_nusd = ? WHERE user_id = ?').run(target, userId);
    } else {
      const cipher = makeCipher(ctx.cfg.MASTER_KEY, ctx.cfg.SESSION_SECRET);
      const k = await ctx.credits.createKey(`tg_${userId}`, target);
      ctx.db.prepare('INSERT INTO api_keys (user_id, nearai_key_id, key_enc, key_prefix, limit_nusd, simulated) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, k.keyId, cipher.encrypt(k.key), k.prefix, target, ctx.credits.simulated ? 1 : 0);
    }
    ctx.db.prepare("UPDATE grants SET status = 'done', last_error = NULL WHERE id = ?").run(grantId);
    return true;
  });
}

/** Octrois dont l'appel API est en cours (le job de reprise ne les touche pas). */
const inFlight = new Set<string>();

/**
 * Réserve un octroi (synchrone, à appeler dans la transaction du burn) : ligne « reserved » + poche débitée, pour que
 * les caps calculés par les compilations concurrentes la voient tout de suite.
 */
export function reserveGrant(ctx: Ctx, userId: string, pool: Pool, amount: number, compileId: string): string {
  const u = ctx.db.prepare('SELECT is_agent FROM users WHERE id = ?').get(userId) as { is_agent: number } | undefined;
  if (!u || u.is_agent) fail('FORBIDDEN', 'Runner-agents never receive credits.', 403);
  const grantId = randomId(10);
  ctx.db.transaction(() => {
    ctx.db.prepare('INSERT INTO grants (id, at, user_id, pool, amount_nusd, compile_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(grantId, ctx.now(), userId, pool, amount, compileId, 'reserved');
    const p = getPools(ctx);
    p[pool].granted += amount;
    kvSet(ctx.db, 'pools', p);
  })();
  return grantId;
}

/** Annule une réservation (invariant refusé, solde injoignable) : la ligne disparaît, la poche est recréditée. */
function releaseGrant(ctx: Ctx, grantId: string) {
  ctx.db.transaction(() => {
    const g = ctx.db.prepare("SELECT pool, amount_nusd FROM grants WHERE id = ? AND status = 'reserved'").get(grantId) as { pool: Pool; amount_nusd: number } | undefined;
    if (!g) return;
    ctx.db.prepare('DELETE FROM grants WHERE id = ?').run(grantId);
    const p = getPools(ctx);
    p[g.pool].granted -= g.amount_nusd;
    kvSet(ctx.db, 'pools', p);
  })();
}

/**
 * Règle un octroi réservé. Ordre strict (Docs/07 §2) : invariant → pending → appel API → done.
 * Invariant refusé : réservation annulée → RESERVE_LOW. Échec de l'appel : l'octroi reste « pending »
 * (IOU rejouée par retryPendingGrants) → GameError GRANT_PENDING.
 */
export async function settleGrant(ctx: Ctx, grantId: string): Promise<{ grantId: string }> {
  const g = ctx.db.prepare("SELECT user_id, amount_nusd FROM grants WHERE id = ? AND status = 'reserved'").get(grantId) as { user_id: string; amount_nusd: number } | undefined;
  if (!g) return fail('NOT_FOUND', 'Unknown grant.', 404);
  const { user_id: userId, amount_nusd: amount } = g;
  inFlight.add(grantId);
  try {
    let org: number;
    try {
      org = await orgRemaining(ctx, true);
    } catch (e) {
      releaseGrant(ctx, grantId);
      throw e;
    }
    const hasKey = !!ctx.db.prepare('SELECT 1 FROM api_keys WHERE user_id = ?').get(userId);
    const hasPending = !!ctx.db.prepare("SELECT 1 FROM grants WHERE user_id = ? AND status IN ('pending', 'reserved') AND id != ?").get(userId, grantId);
    const input = solvencyInput(ctx, org, grantId);
    if (!isSolvent(input, amount, !hasKey && !hasPending)) {
      releaseGrant(ctx, grantId);
      ctx.bus.publish('reserve.alert', 'Forge cooling down — reserve too low', { commitments: commitments(input), org });
      fail('RESERVE_LOW', 'The Forge is cooling down — the city reserve is too low.', 409);
    }
    ctx.db.prepare("UPDATE grants SET status = 'pending' WHERE id = ?").run(grantId);
    try {
      await applyGrant(ctx, userId, grantId);
    } catch (e) {
      // le burn est déjà fait : on garde l'octroi en « pending » (IOU rejouée par un job toutes les 2 min)
      ctx.db.prepare('UPDATE grants SET last_error = ? WHERE id = ?').run(String((e as Error).message).slice(0, 300), grantId);
      fail('GRANT_PENDING', 'Credit pending — your credits will land in a few minutes.', 202, { grantId });
    }
  } finally {
    inFlight.delete(grantId);
  }
  return { grantId };
}

/** Octroie `amount` nUSD au joueur depuis une poche, sur sa clé API (réservation puis règlement). */
export async function grantCredits(ctx: Ctx, userId: string, pool: Pool, amount: number, compileId: string): Promise<{ grantId: string }> {
  return settleGrant(ctx, reserveGrant(ctx, userId, pool, amount, compileId));
}

export const PENDING_RETRY = { everyMs: 2 * 60_000, minAgeMs: 30_000, batch: 20 };

/** Job IOU : rejoue les octrois « pending » de plus de 30 s des comptes actifs (idempotent : limite absolue). Renvoie le nombre réglés. */
export async function retryPendingGrants(ctx: Ctx): Promise<number> {
  // réservations orphelines (crash entre la réservation et l'octroi) : le burn est fait, on les rejoue comme des IOU
  ctx.db.prepare("UPDATE grants SET status = 'pending' WHERE status = 'reserved' AND at < ?").run(ctx.now() - 5 * 60_000);
  const rows = ctx.db.prepare(`SELECT g.id, g.user_id, g.amount_nusd, g.compile_id FROM grants g JOIN users u ON u.id = g.user_id
    WHERE g.status = 'pending' AND g.at < ? AND u.deleted_at IS NULL ORDER BY g.at LIMIT ?`)
    .all(ctx.now() - PENDING_RETRY.minAgeMs, PENDING_RETRY.batch) as { id: string; user_id: string; amount_nusd: number; compile_id: string }[];
  let done = 0;
  for (const g of rows) {
    if (inFlight.has(g.id)) continue;
    inFlight.add(g.id);
    try {
      if (!(await applyGrant(ctx, g.user_id, g.id))) continue;
      ctx.db.prepare("UPDATE compiles SET status = 'granted', payout_nusd = ? WHERE id = ?").run(g.amount_nusd, g.compile_id);
      ctx.bus.publish('grant.done', `Your pending credits just landed · +$${(g.amount_nusd / 1e9).toFixed(3)}`, { grantId: g.id, amountNusd: g.amount_nusd }, g.user_id);
      done++;
    } catch (e) {
      ctx.db.prepare('UPDATE grants SET last_error = ? WHERE id = ?').run(String((e as Error).message).slice(0, 300), g.id);
    } finally {
      inFlight.delete(g.id);
    }
  }
  return done;
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
