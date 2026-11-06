// Jobs « crédits réels » (Docs/07 §2.3, Docs/03 §2) : usage des clés toutes les 10 min, révocation des clés hors limite.
import { RESERVE } from '@tokengo/shared';
import type { Ctx } from '../game/context.ts';
import type { NearAiCredits } from './provider.ts';

interface KeyRow { user_id: string; nearai_key_id: string; limit_nusd: number; usage_nusd: number }
const realKeys = (ctx: Ctx) =>
  ctx.db.prepare('SELECT user_id, nearai_key_id, limit_nusd, usage_nusd FROM api_keys WHERE simulated = 0 AND nearai_key_id IS NOT NULL').all() as KeyRow[];

/** Relit l'usage de toutes les clés (une liste triée par usage) → api_keys.usage_nusd. */
export async function refreshUsage(ctx: Ctx, credits: NearAiCredits): Promise<number> {
  const rows = realKeys(ctx);
  if (!rows.length) return 0;
  const usage = await credits.usage(rows.map((r) => r.nearai_key_id));
  const at = ctx.now();
  const upd = ctx.db.prepare('UPDATE api_keys SET usage_nusd = ?, usage_at = ? WHERE user_id = ?');
  ctx.db.transaction(() => { for (const r of rows) upd.run(Math.max(r.usage_nusd, usage[r.nearai_key_id] ?? 0), at, r.user_id); })();
  return rows.length;
}

/**
 * Toute clé dont l'usage dépasse sa limite + $0.10 est révoquée (dépassement a posteriori de NEAR AI).
 * La ligne est supprimée : la prochaine compilation recrée une clé neuve.
 */
export async function revokeOverLimit(ctx: Ctx, credits: NearAiCredits): Promise<string[]> {
  const over = realKeys(ctx).filter((r) => r.usage_nusd > r.limit_nusd + RESERVE.revokeOverLimitBy);
  const done: string[] = [];
  for (const r of over) {
    try {
      await credits.revoke(r.nearai_key_id);
      ctx.db.prepare('DELETE FROM api_keys WHERE user_id = ? AND nearai_key_id = ?').run(r.user_id, r.nearai_key_id);
      ctx.bus.publish('credits.revoked', 'Your API key went over its limit and was revoked. Your next compile creates a fresh one.', { keyId: r.nearai_key_id }, r.user_id);
      done.push(r.user_id);
    } catch { /* retenté au prochain passage */ }
  }
  return done;
}

/** Tâches périodiques à passer à startJobs (mode réel seulement). */
export const nearAiPeriodic = (ctx: Ctx, credits: NearAiCredits) => [{
  name: 'nearai-usage',
  everyMs: 10 * 60_000,
  run: async () => {
    await refreshUsage(ctx, credits);
    await revokeOverLimit(ctx, credits);
  },
}];
