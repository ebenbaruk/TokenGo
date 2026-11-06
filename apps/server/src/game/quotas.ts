// Quotas journaliers (Docs/08 §4) : 400 captures, 200 syncs, 60 compiles par jour de Paris → RATE_LIMITED.
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { parisDay, parisDayStart } from './reserve.ts';

export const DAILY_QUOTA = { catch: 400, sync: 200, compile: 60 } as const;
export type QuotaKind = keyof typeof DAILY_QUOTA;

/** Utilisation du jour. Captures et compilations se comptent dans leurs tables ; les syncs ont un compteur dédié. */
export function quotaUsed(ctx: Ctx, userId: string, kind: QuotaKind): number {
  const now = ctx.now();
  if (kind === 'catch') {
    return (ctx.db.prepare('SELECT COUNT(*) n FROM catches WHERE user_id = ? AND at >= ?').get(userId, parisDayStart(now)) as { n: number }).n;
  }
  if (kind === 'compile') {
    return (ctx.db.prepare('SELECT COUNT(*) n FROM compiles WHERE user_id = ? AND at >= ?').get(userId, parisDayStart(now)) as { n: number }).n;
  }
  const r = ctx.db.prepare('SELECT n FROM daily_counts WHERE user_id = ? AND day = ? AND kind = ?').get(userId, parisDay(now), kind) as { n: number } | undefined;
  return r?.n ?? 0;
}

export function assertQuota(ctx: Ctx, userId: string, kind: QuotaKind) {
  if (quotaUsed(ctx, userId, kind) >= DAILY_QUOTA[kind]) {
    fail('RATE_LIMITED', 'Daily limit reached — the city needs a rest. Come back tomorrow!', 429, { quota: kind, limit: DAILY_QUOTA[kind] });
  }
}

/** Incrémente un compteur dédié (syncs). */
export function bumpQuota(ctx: Ctx, userId: string, kind: QuotaKind) {
  ctx.db.prepare(`INSERT INTO daily_counts (user_id, day, kind, n) VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id, day, kind) DO UPDATE SET n = n + 1`).run(userId, parisDay(ctx.now()), kind);
}
