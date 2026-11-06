// City Pulse : ticker, Paris Shard Index, réserve, santé des marchands.
import { FAMILIES, type Family, type PulseEvent, type PulseResponse } from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { allMerchants } from './merchants.ts';
import { reserveView } from './reserve.ts';

export function pulseView(ctx: Ctx): PulseResponse {
  const events = (ctx.db.prepare('SELECT id, at, kind, text, data FROM events ORDER BY id DESC LIMIT 40').all() as
    { id: number; at: number; kind: string; text: string; data: string | null }[])
    .map((e): PulseEvent => ({ id: e.id, at: e.at, kind: e.kind, text: e.text, ...(e.data ? { data: JSON.parse(e.data) as Record<string, unknown> } : {}) }));
  const ticks = ctx.db.prepare('SELECT p0 FROM ref_prices WHERE at > ? ORDER BY at').all(ctx.now() - 7 * 24 * 3600_000) as { p0: string }[];
  const index = Object.fromEntries(FAMILIES.map((f) => [f, ticks.map((t) => Math.round((JSON.parse(t.p0) as Record<Family, number>)[f] * 10) / 10)])) as Record<Family, number[]>;
  const merchants = { open: 0, closing: 0, closed: 0 };
  for (const m of allMerchants(ctx)) merchants[m.status]++;
  return { events, index, reserve: reserveView(ctx), merchants };
}
