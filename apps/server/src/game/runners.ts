// Runners-agents (Docs/03 §8 bis) : 24 joueurs PNJ persistants qui font vivre le marché réel de Paris.
// Ils marchent (5 km/h) entre de vrais nœuds et n'agissent qu'une fois « arrivés », via les VRAIES fonctions de jeu
// (distance, cooldowns, quotas, prix, Pulse, ops on-chain) ; seul le mini-jeu est court-circuité (capture « good »).
// Ils ne reçoivent jamais de crédits (forge.ts / reserve.ts refusent tout octroi à is_agent) et leurs trades sont plafonnés par heure.
import {
  FAMILIES, FAMILY_INFO, MERCHANT, TIERS, haversineM, missingFor, newMoveState, recipesFor, rngFrom, xpForLevel,
  type Family, type MoveState, type Rng, type RunnerView, type Side, type Tier, type WorldNode,
} from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { GameError } from './context.ts';
import { credit, getUser, inventory, levelOf, moveStateOf, type UserRow } from './players.ts';
import { agentCatch, relaySync, visibleSpawns } from './actions.ts';
import { deliver, executeTrade, makeQuote, rescue, viewMerchant } from './market.ts';
import { compile } from './forge.ts';
import { getP0, merchantByNode } from './merchants.ts';
import { DEMO_START, nodesNear } from './world.ts';
import { parisDay } from './reserve.ts';
import { accountPrefix } from '../chain/accounts.ts';

export type RunnerProfile = 'walker' | 'arbitrageur' | 'forger' | 'flooder';

export const RUNNER = {
  walkMps: 5000 / 3600,           // 5 km/h
  tickMinMs: 60_000,              // chaque runner agit toutes les 60–90 s
  tickJitterMs: 30_000,
  loopMs: 10_000,                 // la boucle regarde qui est dû toutes les 10 s
  perLoop: 6,
  catchRadiusM: 100,              // un runner fait un petit détour pour un éclat à ≤ 100 m
  hopMaxM: 450,
  homeRadiusM: 2000,
  marketRadiusM: 1500,
  tradesPerHour: 40,              // plafond horaire de trades, tous runners confondus
  maxQtyPerTrade: 8,
  arbMinProfit: 4,
  patronKeep: 60,
  shopCooldownMs: 20 * 60_000,
  visibleRadiusM: 1200,
  aliveWithinMs: 5 * 60_000,      // un runner dont la boucle s'est arrêtée disparaît de la carte
} as const;

const PROFILE: Record<RunnerProfile, { level: number; flux: number; catches: number; sellAt: number; maxBuy: number; tier: Tier }> = {
  walker: { level: 4, flux: 80, catches: 2, sellAt: 6, maxBuy: 2, tier: 'spark' },
  arbitrageur: { level: 6, flux: 400, catches: 1, sellAt: 99, maxBuy: 0, tier: 'spark' },
  forger: { level: 7, flux: 250, catches: 2, sellAt: 8, maxBuy: 4, tier: 'prism' },
  flooder: { level: 3, flux: 60, catches: 4, sellAt: 10, maxBuy: 0, tier: 'spark' },
};
const CYCLE: RunnerProfile[] = ['walker', 'arbitrageur', 'walker', 'forger', 'walker', 'arbitrageur', 'forger', 'flooder'];
export const RUNNER_NAMES = [
  'Nadia', 'Hugo', 'Lina', 'Malik', 'Chloe', 'Yanis', 'Sofia', 'Theo', 'Ines', 'Lucas', 'Amira', 'Jules',
  'Zoe', 'Karim', 'Lea', 'Noah', 'Sarah', 'Adam', 'Maya', 'Leo', 'Camille', 'Sami', 'Elsa', 'Omar',
] as const;

type Intent = 'visit' | 'market' | 'compile' | 'rescue';
interface Pt { lat: number; lng: number }
export interface RunnerState {
  home: string;
  forgeId: string;
  from: Pt;
  to: Pt & { nodeId: string };
  departAt: number;
  arriveAt: number;
  intent: Intent;
  cost: Partial<Record<Family, number>>;   // arbitrageur : prix unitaire payé
  shopAfter: number;
}
interface RunnerRow { user_id: string; profile: RunnerProfile; state: string; next_at: number }

export const runnerId = (name: string) => `runner_${name.toLowerCase()}`;
const runnerIds = (n: number) => RUNNER_NAMES.slice(0, Math.min(n, RUNNER_NAMES.length)).map(runnerId);

export function positionAt(st: RunnerState, now: number): Pt {
  if (now >= st.arriveAt || st.arriveAt <= st.departAt) return { lat: st.to.lat, lng: st.to.lng };
  const k = Math.max(0, (now - st.departAt) / (st.arriveAt - st.departAt));
  return { lat: st.from.lat + (st.to.lat - st.from.lat) * k, lng: st.from.lng + (st.to.lng - st.from.lng) * k };
}

const legTo = (from: Pt, node: WorldNode, now: number, intent: Intent, st: RunnerState): RunnerState => ({
  ...st, from, to: { lat: node.lat, lng: node.lng, nodeId: node.id }, departAt: now,
  arriveAt: now + Math.round(haversineM(from, node) / RUNNER.walkMps * 1000), intent,
});

// ───────────────────────────── Création ─────────────────────────────

/** Crée les runners manquants (idempotent). Domiciles : un tiers autour du Louvre (la démo), le reste dans Paris centre. */
export function seedRunners(ctx: Ctx, n: number): string[] {
  const ids = runnerIds(n);
  const now = ctx.now();
  const center = { lat: 48.8566, lng: 2.3522 };
  const candidates = ctx.world.nodes.filter((x) => x.kind !== 'forge');
  const nearLouvre = candidates.filter((x) => haversineM(DEMO_START, x) < 900);
  const central = candidates.filter((x) => haversineM(center, x) < 4000);
  const contract = ctx.cfg.NEAR_CONTRACT_ID ?? 'tokengo.testnet';
  const prefix = accountPrefix(ctx.cfg);
  ctx.db.transaction(() => {
    ids.forEach((id, i) => {
      if (ctx.db.prepare('SELECT 1 FROM runners WHERE user_id = ?').get(id)) return;
      const name = RUNNER_NAMES[i]!;
      const profile = CYCLE[i % CYCLE.length]!;
      const p = PROFILE[profile];
      const rng = rngFrom(ctx.cfg.SPAWN_SECRET, 'runner-home', name);
      const pool = i % 3 === 0 && nearLouvre.length ? nearLouvre : central.length ? central : candidates;
      const home = pool[Math.floor(rng() * pool.length)]!;
      const forge = [...ctx.world.forges].sort((a, b) => haversineM(home, a) - haversineM(home, b))[0]!;
      if (!ctx.db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) {
        const tutorial = JSON.stringify({ caught: true, synced: true, traded: true, firstCompile: true, playground: true });
        ctx.db.prepare(`INSERT INTO users (id, kind, handle, mode, xp, district, tutorial, created_at, is_agent) VALUES (?, 'guest', ?, 'gps', ?, ?, ?, ?, 1)`)
          .run(id, `Runner·${name}`, xpForLevel(p.level), home.district || null, tutorial, now);
        credit(ctx, id, 'flux', p.flux, 'runner-seed');
        // compte NEAR lisible (r-<nom>.tokengo.testnet) au lieu de p-<id>
        ctx.db.prepare("INSERT OR IGNORE INTO near_accounts (account_id, owner, status) VALUES (?, ?, 'mapped')")
          .run(`${prefix}r-${name.toLowerCase()}.${contract}`, `user:${id}`);
      }
      const at = { lat: home.lat, lng: home.lng };
      const st: RunnerState = {
        home: home.id, forgeId: forge.id, from: at, to: { ...at, nodeId: home.id }, departAt: now, arriveAt: now,
        intent: 'visit', cost: {}, shopAfter: 0,
      };
      // étalement : les 24 runners se répartissent sur un cycle de ~75 s
      ctx.db.prepare('INSERT INTO runners (user_id, profile, state, next_at) VALUES (?, ?, ?, ?)')
        .run(id, profile, JSON.stringify(st), now + Math.round((i * 75_000) / ids.length));
    });
  })();
  return ids;
}

// ───────────────────────────── Vue carte ─────────────────────────────

export function runnersNear(ctx: Ctx, lat: number, lng: number, radiusM: number = RUNNER.visibleRadiusM): RunnerView[] {
  const now = ctx.now();
  const rows = ctx.db.prepare('SELECT r.user_id, r.state, u.handle FROM runners r JOIN users u ON u.id = r.user_id WHERE r.next_at > ?')
    .all(now - RUNNER.aliveWithinMs) as { user_id: string; state: string; handle: string }[];
  const out: RunnerView[] = [];
  for (const r of rows) {
    const p = positionAt(JSON.parse(r.state) as RunnerState, now);
    if (haversineM({ lat, lng }, p) <= radiusM) out.push({ id: r.user_id, handle: r.handle, lat: round6(p.lat), lng: round6(p.lng) });
  }
  return out;
}
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export const activeRunnerCount = (ctx: Ctx): number =>
  (ctx.db.prepare('SELECT COUNT(*) n FROM runners WHERE next_at > ?').get(ctx.now() - RUNNER.aliveWithinMs) as { n: number }).n;

// ───────────────────────────── Boucle ─────────────────────────────

/** Trades des runners sur l'heure glissante (plafond global). */
export const agentTradesLastHour = (ctx: Ctx): number =>
  (ctx.db.prepare('SELECT COUNT(*) n FROM trades t JOIN users u ON u.id = t.user_id WHERE u.is_agent = 1 AND t.at > ?').get(ctx.now() - 3600_000) as { n: number }).n;

/** Place le runner à un point (position « acceptée » maintenant, précision 5 m) : les contrôles de distance du jeu s'appliquent ensuite. */
function place(ctx: Ctx, u: UserRow, p: Pt) {
  const prev = moveStateOf(u);
  const fix = { lat: p.lat, lng: p.lng, acc: 5, at: ctx.now() };
  const walked = prev.last ? Math.round(haversineM(prev.last, p)) : 0;
  const state: MoveState = { ...newMoveState(), walkedM: prev.walkedM + walked, last: fix, recent: [fix] };
  ctx.db.prepare('UPDATE users SET move_state = ?, walked_m = walked_m + ?, in_transit = 0 WHERE id = ?').run(JSON.stringify(state), walked, u.id);
}

/** Exécute une action de jeu ; les refus normaux (cooldown, trop loin, plus de stock…) sont silencieux. */
async function attempt<T>(fn: () => T | Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GameError) return null;
    console.error('[runners]', (e as Error).message);
    return null;
  }
}

interface Turn { ctx: Ctx; id: string; profile: RunnerProfile; st: RunnerState; rng: Rng; trades: number }
const user = (t: Turn) => getUser(t.ctx, t.id)!;

async function trade(t: Turn, merchantId: string, side: Side, family: Family, qty: number): Promise<number | null> {
  if (qty <= 0 || t.trades >= RUNNER.tradesPerHour) return null;
  let q = Math.min(qty, RUNNER.maxQtyPerTrade);
  while (q > 0) {
    try {
      const quote = makeQuote(t.ctx, t.id, merchantId, { side, family, qty: q });
      const r = executeTrade(t.ctx, t.id, merchantId, quote.quoteId);
      t.trades++;
      return r.total / r.qty;
    } catch (e) {
      if (!(e instanceof GameError)) { console.error('[runners]', (e as Error).message); return null; }
      if (e.code === 'MERCHANT_NO_FLUX' || e.code === 'OUT_OF_STOCK' || e.code === 'INSUFFICIENT') { q = Math.floor(q / 2); continue; }
      return null;
    }
  }
  return null;
}

const recipeOf = (t: Turn): { needs: Partial<Record<Family, number>>; fee: number; tier: Tier } => {
  const f = t.ctx.world.forges.find((x) => x.id === t.st.forgeId)!;
  const tier = PROFILE[t.profile].tier;
  const r = recipesFor(t.ctx.cfg.SPAWN_SECRET, f.id, f.theme, parisDay(t.ctx.now())).find((x) => x.tier === tier)!;
  return { needs: r.needs, fee: r.fee, tier };
};

/** Au marché : sauvetage, contrat, ventes du surplus, achats (recette ou arbitrage). */
async function atMarket(t: Turn, node: WorldNode) {
  const { ctx, id } = t;
  const m = merchantByNode(ctx, node.id);
  if (!m) return;
  let inv = inventory(ctx, id);
  if (m.status !== 'open') {
    if (levelOf(user(t)) >= 6 && inv.flux >= MERCHANT.rescueMin + RUNNER.patronKeep) {
      const amount = Math.max(MERCHANT.rescueMin, Math.min(150, inv.flux - RUNNER.patronKeep));
      await attempt(() => rescue(ctx, id, m.id, amount));
    }
    return;
  }
  const keep: Partial<Record<Family, number>> = t.profile === 'walker' || t.profile === 'forger' ? recipeOf(t).needs : {};
  const c = m.contract && m.contract.expiresAt > ctx.now() ? m.contract : null;
  if (c && inv.shards[c.family] - (keep[c.family] ?? 0) >= c.qty) await attempt(() => deliver(ctx, id, m.id));

  if (t.profile === 'arbitrageur') {
    const view = await attempt(() => viewMerchant(ctx, id, m.id)); // enregistre aussi les prix vus (comparateur)
    if (!view) return;
    inv = inventory(ctx, id);
    for (const p of view.prices) {
      const have = inv.shards[p.family];
      const paid = t.st.cost[p.family];
      if (have > 0 && p.buy !== null && (paid === undefined || p.buy >= paid + 2)) {
        if (await trade(t, m.id, 'sell', p.family, have)) delete t.st.cost[p.family];
      }
    }
    // achète ce qu'un voisin connu reprend plus cher
    const best = view.prices
      .map((p) => ({ p, gain: (view.bestKnown[p.family]?.buy?.price ?? 0) - (p.sell ?? Infinity) }))
      .filter((x) => x.gain >= RUNNER.arbMinProfit && x.p.sell !== null)
      .sort((a, b) => b.gain - a.gain)[0];
    if (best) {
      const flux = inventory(ctx, id).flux;
      const qty = Math.min(6, Math.floor((flux * 0.5) / best.p.sell!));
      const unit = await trade(t, m.id, 'buy', best.p.family, qty);
      if (unit) t.st.cost[best.p.family] = unit;
    }
    return;
  }
  // walker / forger / flooder : vendre le surplus…
  inv = inventory(ctx, id);
  for (const f of FAMILIES) {
    const surplus = inv.shards[f] - (keep[f] ?? 0);
    if (surplus > 0) await trade(t, m.id, 'sell', f, surplus);
  }
  // … puis acheter ce qui manque à la recette (dans la limite du profil)
  const p = PROFILE[t.profile];
  if (p.maxBuy > 0) {
    const r = recipeOf(t);
    const miss = missingFor(r.needs, inventory(ctx, id).shards);
    const n = Object.values(miss).reduce((s, x) => s + (x ?? 0), 0);
    if (n > 0 && n <= p.maxBuy) {
      for (const [f, q] of Object.entries(miss) as [Family, number][]) {
        const p0 = getP0(ctx)[f];
        if (inventory(ctx, id).flux >= r.fee + p0 * q * 1.4) await trade(t, m.id, 'buy', f, q);
      }
    }
  }
  t.st.shopAfter = ctx.now() + RUNNER.shopCooldownMs;
}

async function atForge(t: Turn) {
  const { ctx, id } = t;
  const r = recipeOf(t);
  if (levelOf(user(t)) < TIERS[r.tier].level) return;
  const res = await attempt(() => compile(ctx, id, t.st.forgeId, r.tier));
  if (res) {
    const f = ctx.world.byId.get(t.st.forgeId)!;
    ctx.bus.publish('compile', `${user(t).handle} compiled ${r.tier[0]!.toUpperCase()}${r.tier.slice(1)} at ${f.name} · burn + XP only`,
      { forgeId: f.id, tier: r.tier, payout: 0, agent: true });
  }
}

/** Prochaine destination selon le profil (inspiré des bots de sim.ts). */
function plan(t: Turn, pos: Pt): RunnerState {
  const { ctx, st, rng } = t;
  const now = ctx.now();
  const u = user(t);
  const inv = inventory(ctx, t.id);
  const hereId = st.to.nodeId;
  const markets = (radius: number) => nodesNear(ctx.world, pos.lat, pos.lng, radius)
    .filter((n) => n.kind === 'market' && n.id !== hereId)
    .map((n) => ({ n, m: merchantByNode(ctx, n.id), d: haversineM(pos, n) }))
    .filter((x) => x.m)
    .sort((a, b) => a.d - b.d);
  const nearestOpen = () => markets(RUNNER.marketRadiusM).find((x) => x.m!.status === 'open')?.n;

  // patron : un marchand en difficulté pas loin et de quoi l'aider
  if ((t.profile === 'arbitrageur' || t.profile === 'forger') && levelOf(u) >= 6 && inv.flux >= MERCHANT.rescueMin + RUNNER.patronKeep && rng() < 0.5) {
    const s = markets(RUNNER.homeRadiusM).find((x) => x.m!.status !== 'open');
    if (s) return legTo(pos, s.n, now, 'rescue', st);
  }
  if (t.profile === 'arbitrageur') {
    const ms = markets(RUNNER.marketRadiusM).filter((x) => x.m!.status === 'open');
    if (ms.length) return legTo(pos, ms[Math.floor(rng() * Math.min(ms.length, 8))]!.n, now, 'market', st);
  }
  const p = PROFILE[t.profile];
  const total = FAMILIES.reduce((s, f) => s + inv.shards[f], 0);
  if (t.profile === 'flooder') {
    if (total >= p.sellAt) { const n = nearestOpen(); if (n) return legTo(pos, n, now, 'market', st); }
  } else if (t.profile !== 'arbitrageur') {
    const r = recipeOf(t);
    const miss = missingFor(r.needs, inv.shards);
    const nMiss = Object.values(miss).reduce((s, x) => s + (x ?? 0), 0);
    const surplus = FAMILIES.reduce((s, f) => s + Math.max(0, inv.shards[f] - (r.needs[f] ?? 0)), 0);
    if (nMiss === 0 && inv.flux >= r.fee && levelOf(u) >= TIERS[r.tier].level) {
      return legTo(pos, ctx.world.byId.get(st.forgeId)!, now, 'compile', st);
    }
    const est = (Object.entries(miss) as [Family, number][]).reduce((s, [f, q]) => s + q * FAMILY_INFO[f].p0 * 1.4, 0);
    if (now >= st.shopAfter && (surplus >= p.sellAt || (nMiss > 0 && nMiss <= p.maxBuy && inv.flux >= r.fee + est))) {
      const n = nearestOpen();
      if (n) return legTo(pos, n, now, 'market', st);
    }
  }
  return hop(t, pos);
}

/** Balade de nœud en nœud (≤ 450 m), relais prêts favorisés, retour vers le domicile au-delà de 2 km. */
function hop(t: Turn, pos: Pt): RunnerState {
  const { ctx, st, rng } = t;
  const now = ctx.now();
  let nb = nodesNear(ctx.world, pos.lat, pos.lng, RUNNER.hopMaxM).filter((n) => n.id !== st.to.nodeId && n.kind !== 'forge');
  if (!nb.length) nb = nodesNear(ctx.world, pos.lat, pos.lng, 1200).filter((n) => n.id !== st.to.nodeId && n.kind !== 'forge');
  const home = ctx.world.byId.get(st.home)!;
  if (!nb.length) return legTo(pos, home, now, 'visit', st);
  if (haversineM(pos, home) > RUNNER.homeRadiusM) {
    const best = [...nb].sort((a, b) => haversineM(a, home) - haversineM(b, home))[0]!;
    return legTo(pos, best, now, 'visit', st);
  }
  const synced = new Set((ctx.db.prepare('SELECT node_id FROM relay_syncs WHERE user_id = ? AND at > ?').all(t.id, now - 5 * 60_000) as { node_id: string }[]).map((r) => r.node_id));
  const ws = nb.map((n) => (n.kind === 'relay' && !synced.has(n.id) ? 3 : 1));
  let r = rng() * ws.reduce((s, w) => s + w, 0);
  for (let i = 0; i < nb.length; i++) {
    r -= ws[i]!;
    if (r < 0) return legTo(pos, nb[i]!, now, 'visit', st);
  }
  return legTo(pos, nb[nb.length - 1]!, now, 'visit', st);
}

/** Un tour d'un runner : arrivé → agit au nœud ; captures autour de lui ; nouvelle destination. */
export async function stepRunner(ctx: Ctx, row: RunnerRow, tradesSoFar: number): Promise<number> {
  const now = ctx.now();
  const t: Turn = { ctx, id: row.user_id, profile: row.profile, st: JSON.parse(row.state) as RunnerState, rng: rngFrom(ctx.cfg.SPAWN_SECRET, 'runner', row.user_id, now), trades: tradesSoFar };
  if (!getUser(ctx, t.id)) return t.trades;
  const arrived = now >= t.st.arriveAt;
  let pos = positionAt(t.st, now);
  if (arrived) {
    const node = ctx.world.byId.get(t.st.to.nodeId);
    place(ctx, user(t), pos);
    if (node?.kind === 'relay') await attempt(() => relaySync(ctx, t.id, node.id));
    if (node?.kind === 'market') await atMarket(t, node);
    if (node?.kind === 'forge' && t.st.intent === 'compile') await atForge(t);
  }
  // petits détours pour les éclats proches (contrôles de distance réels : on se place sur l'éclat)
  const spawns = visibleSpawns(ctx, user(t), pos.lat, pos.lng)
    .filter((s) => haversineM(pos, s) <= RUNNER.catchRadiusM)
    .sort((a, b) => haversineM(pos, a) - haversineM(pos, b))
    .slice(0, PROFILE[t.profile].catches);
  for (const s of spawns) {
    place(ctx, user(t), s);
    if (await attempt(() => agentCatch(ctx, t.id, s.id))) pos = { lat: s.lat, lng: s.lng };
  }
  if (arrived) t.st = plan(t, pos);
  else if (spawns.length) t.st = legTo(pos, ctx.world.byId.get(t.st.to.nodeId) ?? ctx.world.byId.get(t.st.home)!, now, t.st.intent, t.st);
  const next = now + RUNNER.tickMinMs + Math.floor(t.rng() * RUNNER.tickJitterMs);
  ctx.db.prepare('UPDATE runners SET state = ?, next_at = ? WHERE user_id = ?').run(JSON.stringify(t.st), next, t.id);
  return t.trades;
}

/** Une passe de la boucle : les runners dus (au plus `perLoop`). Renvoie le nombre de runners joués. */
export async function runnerTick(ctx: Ctx, n: number): Promise<number> {
  const ids = runnerIds(n);
  if (!ids.length) return 0;
  const rows = ctx.db.prepare(`SELECT user_id, profile, state, next_at FROM runners WHERE next_at <= ? AND user_id IN (${ids.map(() => '?').join(',')})
    ORDER BY next_at LIMIT ?`).all(ctx.now(), ...ids, RUNNER.perLoop) as RunnerRow[];
  let trades = agentTradesLastHour(ctx);
  for (const r of rows) trades = await stepRunner(ctx, r, trades);
  return rows.length;
}

/** Démarre les runners (RUNNERS=0 : rien). Renvoie la fonction d'arrêt. */
export function startRunners(ctx: Ctx, n: number): () => void {
  if (n <= 0) return () => {};
  seedRunners(ctx, n);
  let busy = false;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try { await runnerTick(ctx, n); } catch (e) { console.error('[runners]', (e as Error).message); } finally { busy = false; }
  };
  const timer = setInterval(() => void loop(), RUNNER.loopMs);
  void loop();
  return () => clearInterval(timer);
}

