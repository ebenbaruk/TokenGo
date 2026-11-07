// Relation joueur ↔ marchand : réputation (habitué, marchandages), bouderie, séances du jour (Docs/03 §5 bis).
import { HAGGLE, clampRep, traitOf, type MerchantState, type MerchantView } from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { parisDay, parisDayStart } from './reserve.ts';

export interface Relation { rep: number; regularDay: string | null; sourUntil: number | null }

export function relationOf(ctx: Ctx, userId: string, merchantId: string): Relation {
  const r = ctx.db.prepare('SELECT rep, regular_day, sour_until FROM merchant_relations WHERE user_id = ? AND merchant_id = ?').get(userId, merchantId) as
    { rep: number; regular_day: string | null; sour_until: number | null } | undefined;
  return { rep: r?.rep ?? 0, regularDay: r?.regular_day ?? null, sourUntil: r?.sour_until ?? null };
}

function save(ctx: Ctx, userId: string, merchantId: string, rel: Relation) {
  ctx.db.prepare(`INSERT INTO merchant_relations (user_id, merchant_id, rep, regular_day, sour_until, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, merchant_id) DO UPDATE SET rep = excluded.rep, regular_day = excluded.regular_day, sour_until = excluded.sour_until, updated_at = excluded.updated_at`)
    .run(userId, merchantId, clampRep(rel.rep), rel.regularDay, rel.sourUntil, ctx.now());
}

/** Change la réputation (bornée). */
export function bumpRep(ctx: Ctx, userId: string, merchantId: string, delta: number) {
  const rel = relationOf(ctx, userId, merchantId);
  save(ctx, userId, merchantId, { ...rel, rep: rel.rep + delta });
}

/** Un trade chez ce marchand : +1 la première fois de la journée (on devient un habitué jour après jour). */
export function noteRegular(ctx: Ctx, userId: string, merchantId: string) {
  const day = parisDay(ctx.now());
  const rel = relationOf(ctx, userId, merchantId);
  if (rel.regularDay === day) return;
  save(ctx, userId, merchantId, { ...rel, rep: rel.rep + HAGGLE.repPerRegularDay, regularDay: day });
}

/** Marchandage raté : réputation −2 et bouderie 20 min. */
export function sour(ctx: Ctx, userId: string, merchantId: string) {
  const rel = relationOf(ctx, userId, merchantId);
  save(ctx, userId, merchantId, { ...rel, rep: rel.rep + HAGGLE.repPerSour, sourUntil: ctx.now() + HAGGLE.sourMs });
}

export const isSoured = (ctx: Ctx, userId: string, merchantId: string): boolean =>
  (relationOf(ctx, userId, merchantId).sourUntil ?? 0) > ctx.now();

/** Séances restantes aujourd'hui chez ce marchand (min des limites par marchand et par joueur). */
export function hagglesLeft(ctx: Ctx, userId: string, merchantId: string): { left: number; perMerchant: number; perPlayer: number } {
  const since = parisDayStart(ctx.now());
  const all = (ctx.db.prepare('SELECT COUNT(*) n FROM haggles WHERE user_id = ? AND at >= ?').get(userId, since) as { n: number }).n;
  const here = (ctx.db.prepare('SELECT COUNT(*) n FROM haggles WHERE user_id = ? AND merchant_id = ? AND at >= ?').get(userId, merchantId, since) as { n: number }).n;
  const perMerchant = Math.max(0, HAGGLE.perMerchantDay - here);
  const perPlayer = Math.max(0, HAGGLE.perPlayerDay - all);
  return { left: Math.min(perMerchant, perPlayer), perMerchant, perPlayer };
}

export function relationView(ctx: Ctx, userId: string, m: MerchantState): MerchantView['relation'] {
  const rel = relationOf(ctx, userId, m.id);
  const now = ctx.now();
  return { rep: rel.rep, trait: traitOf(m.archetype), sourUntil: rel.sourUntil && rel.sourUntil > now ? rel.sourUntil : null, hagglesLeft: hagglesLeft(ctx, userId, m.id).left };
}
