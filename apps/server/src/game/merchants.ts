// Marchands côté serveur : persistance, jobs horaires, réflexion (fallback / LLM), vues.
import {
  FAMILIES, MERCHANT, applyDecision, applyStatus, createMerchant, driftP0, explainPrice, fallbackPolicy, haversineM,
  hourlyTick, initialP0, makeContract, merchantRng, mids, recipesFor, shardToken, FAMILY_INFO,
  type AgentDecision, type Family, type MerchantState, type MerchantView, type WorldNode,
} from '@tokengo/shared';
import { kvGet, kvSet } from '../db.ts';
import type { Ctx } from './context.ts';
import { merchantLedger } from './players.ts';
import { accountPrefix, merchantNearId } from '../chain/accounts.ts';
import { DEMO_START } from './world.ts';
import { greetingFor } from './lines.ts';
import { relationView } from './relations.ts';

export const HOUR = 3600_000;

export function getP0(ctx: Ctx): Record<Family, number> {
  return kvGet<Record<Family, number>>(ctx.db, 'p0') ?? initialP0();
}

/** Crée les marchands manquants (idempotent). Un marchand près du Louvre démarre en difficulté (démo faillite/sauvetage). */
export function seedMerchants(ctx: Ctx) {
  const markets = ctx.world.nodes.filter((n) => n.kind === 'market');
  const exists = ctx.db.prepare('SELECT 1 FROM merchants WHERE node_id = ?');
  const insert = ctx.db.prepare('INSERT INTO merchants (id, node_id, state, version) VALUES (?, ?, ?, 0)');
  const nearLouvre = markets
    .map((n) => ({ n, d: haversineM(DEMO_START, n) }))
    .filter((x) => x.d > 250 && x.d < 1200)
    .sort((a, b) => a.d - b.d)[0]?.n.id; // hors des 2 marchands de la démo (< 250 m), qui restent sains
  ctx.db.transaction(() => {
    for (const n of markets) {
      if (exists.get(n.id)) continue;
      const m = createMerchant(ctx.cfg.SPAWN_SECRET, n.id, n.affinities);
      if (n.id === nearLouvre && !kvGet(ctx.db, 'seeded-struggler')) {
        m.flux = MERCHANT.seededStrugglerFlux;
        m.status = 'closing';
        m.closingSince = ctx.now();
        kvSet(ctx.db, 'seeded-struggler', n.id);
      }
      insert.run(m.id, n.id, JSON.stringify(m));
      for (const f of FAMILIES) merchantLedger(ctx, m.id, 'mint', shardToken(f), m.stock[f], 'merchant-seed');
      merchantLedger(ctx, m.id, 'mint', 'flux', m.flux, 'merchant-seed');
    }
    if (!kvGet(ctx.db, 'p0')) kvSet(ctx.db, 'p0', initialP0());
  })();
}

export function getMerchant(ctx: Ctx, id: string): { m: MerchantState; version: number; node: WorldNode } | null {
  const r = ctx.db.prepare('SELECT state, version, node_id FROM merchants WHERE id = ?').get(id) as { state: string; version: number; node_id: string } | undefined;
  if (!r) return null;
  return { m: JSON.parse(r.state) as MerchantState, version: r.version, node: ctx.world.byId.get(r.node_id)! };
}

export function merchantByNode(ctx: Ctx, nodeId: string): MerchantState | null {
  const r = ctx.db.prepare('SELECT state FROM merchants WHERE node_id = ?').get(nodeId) as { state: string } | undefined;
  return r ? (JSON.parse(r.state) as MerchantState) : null;
}

export function saveMerchant(ctx: Ctx, m: MerchantState) {
  ctx.db.prepare('UPDATE merchants SET state = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(m), m.id);
}

export function allMerchants(ctx: Ctx): MerchantState[] {
  return (ctx.db.prepare('SELECT state FROM merchants').all() as { state: string }[]).map((r) => JSON.parse(r.state) as MerchantState);
}

function publishStatus(ctx: Ctx, m: MerchantState, kind: string) {
  const r = ctx.db.prepare('SELECT node_id FROM merchants WHERE id = ?').get(m.id) as { node_id: string } | undefined;
  const place = (r && ctx.world.byId.get(r.node_id)?.name) ?? '';
  if (kind === 'closing') ctx.bus.publish('merchant.closing', `${m.name} at ${place} is running out of Flux`, { merchantId: m.id });
  if (kind === 'closed') ctx.bus.publish('merchant.closed', `${m.name} at ${place} closed — needs an investor`, { merchantId: m.id });
  if (kind === 'reopened') ctx.bus.publish('merchant.reopened', `${m.name} at ${place} reopened`, { merchantId: m.id });
}

/** Tick horaire : chaque marchand, puis dérive du prix de référence, puis points de prix. */
export function runHourly(ctx: Ctx, at: number) {
  const p0 = getP0(ctx);
  ctx.db.transaction(() => {
    const ms = allMerchants(ctx);
    const updated: MerchantState[] = [];
    for (const m0 of ms) {
      const { m, events } = hourlyTick(m0, p0, at);
      for (const e of events) {
        if (e.kind === 'import') { merchantLedger(ctx, m.id, 'mint', shardToken(e.family), e.qty, 'import'); merchantLedger(ctx, m.id, 'burn', 'flux', e.cost, 'import'); }
        if (e.kind === 'export') { merchantLedger(ctx, m.id, 'burn', shardToken(e.family), e.qty, 'export'); merchantLedger(ctx, m.id, 'mint', 'flux', e.gain, 'export'); }
        if (e.kind === 'rent') merchantLedger(ctx, m.id, 'burn', 'flux', e.cost, 'rent');
        if (e.kind === 'closing' || e.kind === 'closed' || e.kind === 'reopened') publishStatus(ctx, m, e.kind);
      }
      saveMerchant(ctx, m);
      updated.push(m);
      ctx.db.prepare('INSERT OR REPLACE INTO price_ticks (merchant_id, at, mids) VALUES (?, ?, ?)')
        .run(m.id, at, JSON.stringify(Object.fromEntries(FAMILIES.map((f) => [f, Math.round(mids(p0, m)[f])]))));
    }
    const next = driftP0(p0, updated);
    kvSet(ctx.db, 'p0', next);
    ctx.db.prepare('INSERT OR REPLACE INTO ref_prices (at, p0) VALUES (?, ?)').run(at, JSON.stringify(next));
    ctx.db.prepare('DELETE FROM price_ticks WHERE at < ?').run(at - 8 * 24 * HOUR);
  })();
}

/** Demande des Forges dans un rayon de 2 km : familles exigées par les recettes du jour. */
export function forgeDemand(ctx: Ctx, node: WorldNode, day: string): Partial<Record<Family, number>> {
  const d: Partial<Record<Family, number>> = {};
  for (const f of ctx.world.forges) {
    if (haversineM(node, f) > 2000) continue;
    for (const r of recipesFor(ctx.cfg.SPAWN_SECRET, f.id, f.theme, day)) {
      for (const [fam, n] of Object.entries(r.needs) as [Family, number][]) d[fam] = (d[fam] ?? 0) + n / 6;
    }
  }
  return d;
}

export type Brain = (m: MerchantState, input: unknown) => Promise<{ raw: unknown; source: 'llm' } | null>;

/** Réflexion d'un marchand (toutes les 3 h) : décision bornée + nouveau contrat si besoin. */
export async function reflect(ctx: Ctx, merchantId: string, day: string, brain?: Brain) {
  const cur = getMerchant(ctx, merchantId);
  if (!cur || cur.m.status === 'closed') return;
  const demand = forgeDemand(ctx, cur.node, day);
  let decision: AgentDecision = fallbackPolicy(cur.m, demand);
  let source: 'llm' | 'fallback' = 'fallback';
  const input = { flux: cur.m.flux, stock: cur.m.stock, demand };
  if (brain) {
    try {
      const out = await brain(cur.m, input);
      if (out) {
        const { clampDecision } = await import('@tokengo/shared');
        decision = clampDecision(cur.m, out.raw);
        source = 'llm';
      }
    } catch { /* repli déterministe */ }
  }
  const now = ctx.now();
  ctx.db.transaction(() => {
    const fresh = getMerchant(ctx, merchantId)!.m; // relire : un trade a pu passer pendant l'appel LLM
    let m = applyDecision(fresh, decision);
    if (!m.contract && m.status === 'open') {
      m = { ...m, contract: makeContract(merchantRng(ctx.cfg.SPAWN_SECRET, m, now), m, getP0(ctx), now, decision.contract?.family) };
    }
    saveMerchant(ctx, m);
    ctx.db.prepare('INSERT INTO merchant_thoughts (merchant_id, at, input, output, applied, source) VALUES (?, ?, ?, ?, ?, ?)')
      .run(m.id, now, JSON.stringify(input), JSON.stringify(decision), JSON.stringify({ spread: m.spread, targetMult: m.targetMult }), source);
  })();
}

export function merchantView(ctx: Ctx, m: MerchantState, node: WorldNode, userId: string, opts: { patron: boolean; pos?: { lat: number; lng: number } }): MerchantView {
  const p0 = getP0(ctx);
  const now = ctx.now();
  const ticks = ctx.db.prepare('SELECT mids FROM price_ticks WHERE merchant_id = ? AND at > ? ORDER BY at').all(m.id, now - 24 * HOUR) as { mids: string }[];
  const trend24h: MerchantView['trend24h'] = {};
  for (const f of FAMILIES) trend24h[f] = ticks.map((t) => (JSON.parse(t.mids) as Record<Family, number>)[f]);
  const thought = ctx.db.prepare('SELECT at, output, source FROM merchant_thoughts WHERE merchant_id = ? ORDER BY at DESC LIMIT 1').get(m.id) as
    { at: number; output: string; source: 'llm' | 'fallback' } | undefined;
  let rescueView: MerchantView['rescue'] = null;
  if (m.status !== 'open') {
    const since = m.closingSince ?? 0;
    const rows = ctx.db.prepare(`SELECT u.handle, SUM(r.amount) total FROM rescues r JOIN users u ON u.id = r.user_id
      WHERE r.merchant_id = ? AND r.at >= ? GROUP BY r.user_id ORDER BY total DESC`).all(m.id, since) as { handle: string; total: number }[];
    rescueView = { needed: MERCHANT.reopenAt, raised: m.flux, patron: rows[0]?.handle ?? null, contributors: rows.length };
  }
  return {
    id: m.id, nodeId: node.id, name: m.name, archetype: m.archetype, specialty: m.specialty, status: m.status, flux: m.flux,
    lat: node.lat, lng: node.lng, place: node.name, mood: m.mood,
    greeting: greetingFor(m, userId, now),
    prices: FAMILIES.map((f) => explainPrice(p0[f], m, f, { patron: opts.patron })),
    trend24h,
    contract: m.contract && m.contract.expiresAt > now ? m.contract : null,
    rescue: rescueView,
    lastThought: thought ? { at: thought.at, text: (JSON.parse(thought.output) as AgentDecision).reasoning, source: thought.source } : null,
    bestKnown: bestKnown(ctx, userId, m.id, opts.pos ?? node),
    isPatron: opts.patron,
    walletUrl: ctx.cfg.NEAR_CONTRACT_ID ? `https://testnet.nearblocks.io/address/${merchantNearAccount(ctx, m.id)}` : null,
    relation: relationView(ctx, userId, m),
  };
}

export const merchantNearAccount = (ctx: Ctx, merchantId: string) =>
  merchantNearId(merchantId, ctx.cfg.NEAR_CONTRACT_ID ?? 'tokengo.testnet', accountPrefix(ctx.cfg));

/** Comparateur : meilleurs prix vus par le joueur chez d'autres marchands il y a < 2 h. */
function bestKnown(ctx: Ctx, userId: string, exceptId: string, pos: { lat: number; lng: number }): MerchantView['bestKnown'] {
  const rows = ctx.db.prepare('SELECT merchant_id, prices FROM price_seen WHERE user_id = ? AND at > ? AND merchant_id != ?')
    .all(userId, ctx.now() - 2 * HOUR, exceptId) as { merchant_id: string; prices: string }[];
  const out: MerchantView['bestKnown'] = {};
  for (const r of rows) {
    const cur = getMerchant(ctx, r.merchant_id);
    if (!cur) continue;
    const distanceM = Math.round(haversineM(pos, cur.node));
    const prices = JSON.parse(r.prices) as Record<Family, { buy: number | null; sell: number | null }>;
    for (const f of FAMILIES) {
      const p = prices[f];
      if (!p) continue;
      const slot = (out[f] ??= {});
      if (p.buy !== null && (!slot.buy || p.buy > slot.buy.price)) slot.buy = { price: p.buy, merchant: cur.m.name, distanceM };
      if (p.sell !== null && (!slot.sell || p.sell < slot.sell.price)) slot.sell = { price: p.sell, merchant: cur.m.name, distanceM };
    }
  }
  return out;
}

export function recordSeenPrices(ctx: Ctx, userId: string, view: MerchantView) {
  const prices = Object.fromEntries(view.prices.map((p) => [p.family, { buy: p.buy, sell: p.sell }]));
  ctx.db.prepare('INSERT OR REPLACE INTO price_seen (user_id, merchant_id, at, prices) VALUES (?, ?, ?, ?)').run(userId, view.id, ctx.now(), JSON.stringify(prices));
}

export { applyStatus, FAMILY_INFO };
