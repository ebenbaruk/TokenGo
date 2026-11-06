// Simulateur d'économie (Docs/03 §10) : boucle à pas fixe (10 min de jeu), N bots, marchands pilotés par les vraies règles.
// Pur et compatible navigateur (Web Worker de l'Economy Lab) : aucun import node, monde passé en entrée, déterministe à graine égale.
// Toutes les valeurs passent par les fonctions de règles (quote/applyTrade/hourlyTick/driftP0/forgePayout…), jamais recodées ici.
import { FAMILIES, type Family, type WorldNode } from '../types.ts';
import { mulberry32, poisson, randInt, weightedPick, type Rng } from '../rng.ts';
import { haversineM } from '../geo.ts';
import * as R from './rules.ts';
import { FAMILY_INFO, MERCHANT, RELAY, usd, type Tier } from './rules.ts';
import { applyTrade, quote, unitBuyPrice, unitSellPrice, midAt, type MerchantState, type Quote } from './pricing.ts';
import { createMerchant, deliverContract, driftP0, hourlyTick, initialP0, makeContract, rescue, type MerchantEvent } from './market.ts';
import { applyDecision, fallbackPolicy } from './agent.ts';
import { forgePayout, missingFor, recipesFor, recipeSize, type Recipe } from './forge.ts';
import { initialPools, poolAvail, reserveHealth, type Pools } from './reserve.ts';
import { familyWeights, spawnLambda } from './spawns.ts';
import { resolveCatch } from './catch.ts';

// ───────────────────────────── Paramètres ─────────────────────────────
export const STEP_MS = 10 * 60_000;
export const STEPS_PER_HOUR = 6;
export const STEPS_PER_DAY = 144;
/** t = 0 du simulateur = minuit à Paris (UTC+1 en novembre), jour 1 du jugement. */
const BASE_MS = Date.UTC(2026, 10, 15, 23, 0, 0);
const BASE_DAY_UTC = Date.UTC(2026, 10, 16);

export type BotKind = 'walker' | 'arbitrageur' | 'forger' | 'patron' | 'flooder';
export const BOT_KINDS: readonly BotKind[] = ['walker', 'arbitrageur', 'forger', 'patron', 'flooder'];
export type Scenario = 'baseline' | 'flood-deepseek' | 'reserve-refill' | 'everyone-aura';
export const SCENARIOS: readonly Scenario[] = ['baseline', 'flood-deepseek', 'reserve-refill', 'everyone-aura'];

/** Comportement des bots (propre au simulateur, pas des règles du jeu). */
export const SIM_BOT = {
  walkKmh: 5,
  hopMaxM: 450,              // un walker va de nœud en nœud à ≤ 450 m
  avgHopM: 180,              // distance « normale » entre deux nœuds (normalise les captures)
  catchFraction: 0.5,        // part des éclats d'une cellule qu'un joueur attrape en la traversant (≈ 20 captures/h)
  tapSpread: 0.35,           // écart des taps du mini-jeu : uniforme dans ±35 % (≈ 92 % de captures Common)
  sessionsPerDay: 2,
  sessionSteps: 4,           // 2 sessions de 40 min par jour et par joueur
  sellAtShards: 6,           // un walker va vendre dès qu'il porte 6 éclats
  startFlux: { walker: 50, arbitrageur: 400, forger: 150, patron: 200, flooder: 100 } as Record<BotKind, number>,
  homeRadiusM: 2000,
  arbRadiusM: 1500,
  arbMaxUnits: 10,
  arbMinProfit: 4,
  patronRadiusM: 2000,
  patronKeep: 60,
  prismShare: 0.4,           // part des forgerons qui visent Prism (les autres Spark)
  forgeDemandRadiusM: 2000,
  floodFamily: 'deepseek' as Family,
  floodStartDay: 1,          // le flood commence au 2e jour (on voit la cassure)
  floodCatchMult: 4,
  floodSellAt: 10,
  floodShare: 0.15,
};
export type SimBotParams = typeof SIM_BOT;

export const DEFAULT_MIX: Record<BotKind, number> = { walker: 0.5, arbitrageur: 0.2, forger: 0.2, patron: 0.1, flooder: 0 };

// ───────────────────────────── Surcharge des règles (expériences) ─────────────────────────────
/** Surcharge temporaire de constantes de rules.ts (Economy Lab / réglage). rules.ts n'est jamais modifié. */
export interface RulesOverride {
  PRICING?: Partial<typeof R.PRICING>;
  MERCHANT?: Partial<typeof R.MERCHANT>;
  FORGE?: Partial<typeof R.FORGE>;
  RELAY?: Partial<typeof R.RELAY>;
  P0_DRIFT?: Partial<typeof R.P0_DRIFT>;
  CONTRACT?: Partial<typeof R.CONTRACT>;
  BASE_TARGET?: Partial<Record<Family, number>>;
  TIERS?: Partial<Record<Tier, R.TierRule>>;
  INITIAL_TREASURY?: readonly [number, number];
  INITIAL_STOCK_RATIO?: readonly [number, number];
}
const OVERRIDABLE = {
  PRICING: R.PRICING, MERCHANT: R.MERCHANT, FORGE: R.FORGE, RELAY: R.RELAY, P0_DRIFT: R.P0_DRIFT, CONTRACT: R.CONTRACT,
  BASE_TARGET: R.BASE_TARGET, TIERS: R.TIERS, INITIAL_TREASURY: R.INITIAL_TREASURY, INITIAL_STOCK_RATIO: R.INITIAL_STOCK_RATIO,
} as unknown as Record<string, Record<string, unknown>>;

/** Exécute fn avec les constantes surchargées, puis restaure (même en cas d'erreur). */
export function withRules<T>(o: RulesOverride | undefined, fn: () => T): T {
  if (!o) return fn();
  const saved: [Record<string, unknown>, Record<string, unknown>][] = [];
  for (const [k, patch] of Object.entries(o)) {
    const target = OVERRIDABLE[k];
    if (!target || !patch) continue;
    saved.push([target, { ...target }]);
    Object.assign(target, patch);
  }
  try {
    return fn();
  } finally {
    for (const [t, s] of saved) Object.assign(t, s);
  }
}

// ───────────────────────────── Types publics ─────────────────────────────
export interface WorldLike {
  nodes: WorldNode[];
  cells: Record<string, { richness: number; affinities: Family[] }>;
}

export interface SimOptions {
  world: WorldLike;
  days: number;
  players: number;
  seed: number;
  scenario?: Scenario;
  mix?: Partial<Record<BotKind, number>>;
  bot?: Partial<SimBotParams>;
  rulesOverride?: RulesOverride;
  /** État de départ des marchands (copie de Paris pour le Lab). Par défaut : createMerchant sur chaque nœud market. */
  initialMerchants?: MerchantState[];
  onProgress?: (fraction: number, snap: SimSnapshot) => void;
}

export interface SeriesPoint {
  hour: number;
  p0: Record<Family, number>;
  avgMid: Record<Family, number>;
  medianMid: Record<Family, number>;
  fluxPlayers: number;
  fluxMerchants: number;
  mainPoolAvail: number;     // nUSD
  payoutsCum: number;        // nUSD
  reserveHealth: number;
  open: number;
  closing: number;
  closed: number;
}

export interface SimEvent {
  hour: number;              // heures depuis le début
  day: number;               // 1..days
  hourOfDay: number;
  kind: 'closing' | 'closed' | 'reopened' | 'rescued' | 'reserve-refill' | 'flood-start';
  merchantId?: string;
  merchantName?: string;
  detail?: string;
}

export interface HealthCheck { name: string; value: number; display: string; target: string; pass: boolean }

export interface SimTotals {
  catches: number; syncs: number; relayFlux: number;
  shardsSold: number; fluxPaidByMerchants: number; shardsBought: number; fluxPaidToMerchants: number;
  contractsDelivered: number; contractRewards: number;
  compiles: number; compilesPaid: number; feesBurned: number; shardsBurned: number; payouts: number;
  imports: number; importFlux: number; exports: number; exportFlux: number; rent: number;
  rescues: number; rescueFlux: number;
}

export interface SimResult {
  scenario: Scenario;
  days: number;
  players: number;
  seed: number;
  mix: Record<BotKind, number>;
  merchants: number;
  series: SeriesPoint[];
  events: SimEvent[];
  health: HealthCheck[];
  totals: SimTotals;
  fluxPlayersDaily: number[];
  finalP0: Record<Family, number>;
  finalAvgMid: Record<Family, number>;
  seededStruggler: string | null;
}

export interface SimSnapshot {
  step: number;
  hour: number;
  done: boolean;
  p0: Record<Family, number>;
  reserveHealth: number;
  mainPoolAvail: number;
  payoutsCum: number;
  last: SeriesPoint | undefined;
  merchants: { id: string; name: string; lat: number; lng: number; status: MerchantState['status']; flux: number }[];
  bots: { lat: number; lng: number; kind: BotKind; flux: number; shards: number }[];
}

export interface Sim {
  readonly totalSteps: number;
  readonly stepIndex: number;
  readonly done: boolean;
  step(): void;
  /** Avance de n pas (ou jusqu'à la fin). */
  run(steps?: number): void;
  snapshot(): SimSnapshot;
  result(): SimResult;
}

// ───────────────────────────── Interne ─────────────────────────────
type Action = 'visit' | 'sell' | 'shop' | 'compile' | 'arb' | 'rescue';
interface Travel { to: number; left: number; dist: number; action: Action }
interface Bot {
  kind: BotKind;
  node: number;
  home: number;
  prev: number;
  flux: number;
  inv: Record<Family, number>;
  travel: Travel | null;
  active: Uint8Array;
  lastSync: Map<number, number>;
  payouts: { at: number; amount: number }[];
  tier: Tier;
  forge: number;             // index dans forges[]
  shopAfter: number;         // pas à partir duquel il peut retourner faire ses courses
  patronUntil: Map<number, number>;
}
interface Near { i: number; d: number }

const famRecord = (fn: (f: Family) => number): Record<Family, number> =>
  Object.fromEntries(FAMILIES.map((f) => [f, fn(f)])) as Record<Family, number>;
const zeroInv = () => famRecord(() => 0);
const invSize = (inv: Record<Family, number>) => FAMILIES.reduce((s, f) => s + inv[f], 0);
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const dayString = (day: number) => new Date(BASE_DAY_UTC + day * 86_400_000).toISOString().slice(0, 10);

function scenarioMix(s: Scenario, bot: SimBotParams): Record<BotKind, number> {
  if (s === 'flood-deepseek') return { ...DEFAULT_MIX, walker: DEFAULT_MIX.walker - bot.floodShare, flooder: bot.floodShare };
  if (s === 'everyone-aura') return { walker: 0.3, arbitrageur: 0.1, forger: 0.6, patron: 0, flooder: 0 };
  return { ...DEFAULT_MIX };
}

/** Crée une simulation pas-à-pas (l'UI anime en appelant step()/snapshot()). */
export function createSim(opts: SimOptions): Sim {
  return withRules(opts.rulesOverride, () => buildSim(opts));
}

function buildSim(opts: SimOptions): Sim {
  const scenario = opts.scenario ?? 'baseline';
  const bp: SimBotParams = { ...SIM_BOT, ...opts.bot };
  const mix: Record<BotKind, number> = { ...scenarioMix(scenario, bp), ...opts.mix };
  const rng: Rng = mulberry32(opts.seed);
  const secret = `sim:${opts.seed}`;
  const days = Math.max(1, Math.floor(opts.days));
  const totalSteps = days * STEPS_PER_DAY;
  const stepM = (bp.walkKmh * 1000 * STEP_MS) / 3600_000;
  const nodes = opts.world.nodes;
  const cells = opts.world.cells;
  const N = nodes.length;

  // ── Index spatial (une fois) ──
  const marketNodes: number[] = [];
  const forgeNodes: number[] = [];
  for (let i = 0; i < N; i++) {
    if (nodes[i]!.kind === 'market') marketNodes.push(i);
    else if (nodes[i]!.kind === 'forge') forgeNodes.push(i);
  }
  const merchantOfNode = new Int32Array(N).fill(-1);
  marketNodes.forEach((n, mi) => { merchantOfNode[n] = mi; });
  const dist = (a: number, b: number) => haversineM(nodes[a]!, nodes[b]!);
  const neighbors: Near[][] = [];
  const marketsByDist: Near[][] = []; // tous les marchands, triés par distance
  const nearestForge = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const all: Near[] = [];
    for (let j = 0; j < N; j++) if (j !== i) all.push({ i: j, d: dist(i, j) });
    let nb = all.filter((x) => x.d <= bp.hopMaxM);
    if (nb.length < 3) nb = [...all].sort((a, b) => a.d - b.d).slice(0, 4);
    neighbors.push(nb);
    marketsByDist.push(marketNodes.map((n, mi) => ({ i: mi, d: n === i ? 0 : dist(i, n) })).sort((a, b) => a.d - b.d));
    let bf = 0;
    let bd = Infinity;
    forgeNodes.forEach((fn, fi) => { const d = dist(i, fn); if (d < bd) { bd = d; bf = fi; } });
    nearestForge[i] = bf;
  }
  const arbNear: Near[][] = marketNodes.map((n) => marketsByDist[n]!.filter((x) => x.d > 0 && x.d <= bp.arbRadiusM));
  const closePairs: [number, number][] = [];
  for (let a = 0; a < marketNodes.length; a++) {
    for (const x of marketsByDist[marketNodes[a]!]!) if (x.i > a && x.d <= 1000) closePairs.push([a, x.i]);
  }

  // ── Marchands ──
  let merchants: MerchantState[] = opts.initialMerchants
    ? opts.initialMerchants.map((m) => ({ ...m, stock: { ...m.stock }, targetMult: { ...m.targetMult } }))
    : marketNodes.map((n) => createMerchant(secret, nodes[n]!.id, nodes[n]!.affinities));
  let seededStruggler: string | null = null;
  let seededIdx = -1;
  const louvre = forgeNodes.find((n) => nodes[n]!.id === 'forge:louvre') ?? forgeNodes[0];
  if (!opts.initialMerchants && louvre !== undefined && merchants.length > 0) {
    seededIdx = marketsByDist[louvre]![0]!.i;
    const m = merchants[seededIdx]!;
    merchants[seededIdx] = { ...m, flux: MERCHANT.seededStrugglerFlux, status: 'closing', closingSince: BASE_MS };
    seededStruggler = m.name;
  }
  let p0 = initialP0();
  const pools: Pools = initialPools();

  // ── Bots ──
  const kinds: BotKind[] = [];
  for (const k of BOT_KINDS) for (let i = 0; i < Math.round((mix[k] ?? 0) * opts.players); i++) kinds.push(k);
  while (kinds.length < opts.players) kinds.push('walker');
  kinds.length = opts.players;
  const bots: Bot[] = kinds.map((kind) => {
    const start = kind === 'arbitrageur' ? marketNodes[Math.floor(rng() * marketNodes.length)]! : Math.floor(rng() * N);
    return {
      kind, node: start, home: start, prev: -1, flux: bp.startFlux[kind], inv: zeroInv(), travel: null,
      active: new Uint8Array(STEPS_PER_DAY), lastSync: new Map(), payouts: [],
      tier: scenario === 'everyone-aura' ? 'aura' : rng() < bp.prismShare ? 'prism' : 'spark',
      forge: nearestForge[start]!, shopAfter: 0, patronUntil: new Map(),
    };
  });

  // ── État dynamique ──
  let stepIdx = 0;
  let health = reserveHealth(pools.main);
  let recipes: Recipe[][] = [];
  let demand: Partial<Record<Family, number>>[] = [];
  let globalDayUsed = 0;
  let globalDayBase = poolAvail(pools.main);
  let payoutsCum = 0;
  let order: number[] = bots.map((_, i) => i);
  const series: SeriesPoint[] = [];
  const events: SimEvent[] = [];
  const fluxPlayersDaily: number[] = [];
  const struggled = new Set<number>();
  let maxClosedFrac = 0;
  const gapSamples: number[] = [];
  const ratioSamples: number[] = [];
  const ratioInitSamples: number[] = [];
  const totals: SimTotals = {
    catches: 0, syncs: 0, relayFlux: 0, shardsSold: 0, fluxPaidByMerchants: 0, shardsBought: 0, fluxPaidToMerchants: 0,
    contractsDelivered: 0, contractRewards: 0, compiles: 0, compilesPaid: 0, feesBurned: 0, shardsBurned: 0, payouts: 0,
    imports: 0, importFlux: 0, exports: 0, exportFlux: 0, rent: 0, rescues: 0, rescueFlux: 0,
  };
  const weightCache = new Map<string, Record<Family, number>>();
  const weightsFor = (aff: Family[]) => {
    const k = aff.join(',');
    let w = weightCache.get(k);
    if (!w) { w = familyWeights(aff, health); weightCache.set(k, w); }
    return w;
  };

  const nowOf = (s: number) => BASE_MS + s * STEP_MS;
  const pushEvent = (kind: SimEvent['kind'], mi?: number, detail?: string) => {
    const hour = Math.floor(stepIdx / STEPS_PER_HOUR);
    const m = mi === undefined ? undefined : merchants[mi];
    events.push({
      hour, day: Math.floor(hour / 24) + 1, hourOfDay: hour % 24, kind,
      ...(m ? { merchantId: m.id, merchantName: m.name } : {}), ...(detail ? { detail } : {}),
    });
  };
  const recordMerchantEvents = (mi: number, evs: MerchantEvent[]) => {
    for (const e of evs) {
      if (e.kind === 'import') { totals.imports += e.qty; totals.importFlux += e.cost; }
      else if (e.kind === 'export') { totals.exports += e.qty; totals.exportFlux += e.gain; }
      else if (e.kind === 'rent') totals.rent += e.cost;
      else if (e.kind === 'closing' || e.kind === 'closed' || e.kind === 'reopened') {
        pushEvent(e.kind, mi);
        if (e.kind !== 'reopened') struggled.add(mi);
      }
    }
  };

  // ── Journée ──
  function dayStart(day: number) {
    if (scenario === 'reserve-refill' && day === 1) {
      pools.main.allocated += usd(5);
      health = reserveHealth(pools.main);
      weightCache.clear();
      pushEvent('reserve-refill', undefined, '+$5 Main pool');
    }
    if (scenario === 'flood-deepseek' && day === bp.floodStartDay) pushEvent('flood-start', undefined, `${FAMILY_INFO[bp.floodFamily].name} flood`);
    fluxPlayersDaily.push(bots.reduce((s, b) => s + b.flux, 0));
    globalDayUsed = 0;
    globalDayBase = poolAvail(pools.main);
    const ds = dayString(day);
    recipes = forgeNodes.map((n) => recipesFor(secret, nodes[n]!.id, nodes[n]!.affinities, ds));
    demand = marketNodes.map((n) => {
      const d: Partial<Record<Family, number>> = {};
      forgeNodes.forEach((fn, fi) => {
        if (dist(n, fn) > bp.forgeDemandRadiusM) return;
        for (const r of recipes[fi]!) for (const [f, q] of Object.entries(r.needs) as [Family, number][]) d[f] = (d[f] ?? 0) + q / 3;
      });
      return d;
    });
    for (const b of bots) {
      b.active.fill(0);
      const sessions = b.kind === 'flooder' ? bp.sessionsPerDay * 2 : bp.sessionsPerDay;
      for (let s = 0; s < sessions; s++) {
        const start = randInt(rng, 8 * STEPS_PER_HOUR, 22 * STEPS_PER_HOUR - bp.sessionSteps);
        for (let k = 0; k < bp.sessionSteps; k++) b.active[start + k] = 1;
      }
    }
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
  }

  // ── Marchands : jobs ──
  function reflect(now: number) {
    merchants = merchants.map((m, mi) => {
      if (m.status !== 'open') return m;
      const d = fallbackPolicy(m, demand[mi]);
      let next = applyDecision(m, d);
      if (!next.contract && d.contract) next = { ...next, contract: makeContract(rng, next, p0, now, d.contract.family) };
      return next;
    });
  }

  function hourly(now: number) {
    merchants = merchants.map((m, mi) => {
      const r = hourlyTick(m, p0, now);
      recordMerchantEvents(mi, r.events);
      return r.m;
    });
    p0 = driftP0(p0, merchants);
    health = reserveHealth(pools.main);
    weightCache.clear();
    const pt = point();
    series.push(pt);
    const n = merchants.length || 1;
    maxClosedFrac = Math.max(maxClosedFrac, pt.closed / n);
    merchants.forEach((m, mi) => { if (m.status !== 'open') struggled.add(mi); });
    const hour = pt.hour;
    if (hour > (days * 24) / 2) {
      for (const f of FAMILIES) {
        ratioSamples.push(pt.avgMid[f] / pt.p0[f]);
        ratioInitSamples.push(pt.avgMid[f] / FAMILY_INFO[f].p0);
      }
      if (hour % 6 === 0) gapSamples.push(priceGap());
    }
  }

  function priceGap(): number {
    const gaps: number[] = [];
    for (const [a, b] of closePairs) {
      const ma = merchants[a]!;
      const mb = merchants[b]!;
      if (ma.status === 'closed' || mb.status === 'closed') continue;
      for (const f of FAMILIES) {
        const x = midAt(p0[f], ma, f, ma.stock[f]);
        const y = midAt(p0[f], mb, f, mb.stock[f]);
        gaps.push(Math.abs(x - y) / ((x + y) / 2));
      }
    }
    return median(gaps);
  }

  function point(): SeriesPoint {
    const live = merchants.filter((m) => m.status !== 'closed');
    const avgMid = famRecord(() => 0);
    const medianMid = famRecord(() => 0);
    for (const f of FAMILIES) {
      const v = live.map((m) => midAt(p0[f], m, f, m.stock[f]));
      avgMid[f] = v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
      medianMid[f] = median(v);
    }
    return {
      hour: Math.floor(stepIdx / STEPS_PER_HOUR),
      p0: { ...p0 }, avgMid, medianMid,
      fluxPlayers: bots.reduce((s, b) => s + b.flux, 0),
      fluxMerchants: merchants.reduce((s, m) => s + m.flux, 0),
      mainPoolAvail: poolAvail(pools.main), payoutsCum, reserveHealth: health,
      open: merchants.filter((m) => m.status === 'open').length,
      closing: merchants.filter((m) => m.status === 'closing').length,
      closed: merchants.filter((m) => m.status === 'closed').length,
    };
  }

  // ── Actions des bots ──
  const patronOpt = (b: Bot, mi: number, now: number) => ({ patron: (b.patronUntil.get(mi) ?? 0) > now });

  /** Vend l'inventaire (au-delà de `keep`) au marchand mi. Livre d'abord son contrat si possible. */
  function sellAll(b: Bot, mi: number, now: number, keep: Partial<Record<Family, number>> = {}) {
    let m = merchants[mi]!;
    if (m.status !== 'open') return;
    const c = m.contract;
    if (c && b.inv[c.family] - (keep[c.family] ?? 0) >= c.qty) {
      const r = deliverContract(m, now);
      if (!('error' in r)) {
        m = r.m;
        b.inv[c.family] -= c.qty;
        b.flux += r.reward;
        totals.contractsDelivered++;
        totals.contractRewards += r.reward;
      }
    }
    const opt = patronOpt(b, mi, now);
    for (const f of FAMILIES) {
      let q = Math.min(50, b.inv[f] - (keep[f] ?? 0));
      while (q > 0) {
        const res = quote(p0[f], m, 'sell', f, q, opt);
        if ('error' in res) {
          if (res.error === 'MERCHANT_NO_FLUX') { q = Math.floor(q / 2); continue; }
          q = 0;
          break;
        }
        m = applyTrade(m, res, now);
        b.inv[f] -= q;
        b.flux += res.total;
        totals.shardsSold += q;
        totals.fluxPaidByMerchants += res.total;
        break;
      }
    }
    merchants[mi] = m;
  }

  /** Achète jusqu'à qty éclats f sans dépasser maxSpend. */
  function buy(b: Bot, mi: number, f: Family, qty: number, maxSpend: number, now: number): number {
    let m = merchants[mi]!;
    let q = Math.min(qty, m.stock[f], 50);
    while (q > 0) {
      const res = quote(p0[f], m, 'buy', f, q, patronOpt(b, mi, now));
      if ('error' in res) return 0;
      if (res.total > maxSpend || res.total > b.flux) { q--; continue; }
      m = applyTrade(m, res as Quote, now);
      merchants[mi] = m;
      b.inv[f] += q;
      b.flux -= res.total;
      totals.shardsBought += q;
      totals.fluxPaidToMerchants += res.total;
      return q;
    }
    return 0;
  }

  function visit(b: Bot, d: number, now: number) {
    const node = nodes[b.node]!;
    if (node.kind === 'relay' && b.kind !== 'arbitrageur') {
      const last = b.lastSync.get(b.node);
      if (last === undefined || now - last >= RELAY.cooldownMs) {
        b.lastSync.set(b.node, now);
        const gain = randInt(rng, RELAY.fluxMin, RELAY.fluxMax);
        b.flux += gain;
        totals.syncs++;
        totals.relayFlux += gain;
        if (rng() < RELAY.shardChance) { b.inv[weightedPick(rng, weightsFor(node.affinities))]++; totals.catches++; }
      }
    }
    const cell = cells[node.h3] ?? { richness: 0, affinities: node.affinities };
    const flooding = b.kind === 'flooder' && Math.floor(stepIdx / STEPS_PER_DAY) >= bp.floodStartDay;
    let lambda = spawnLambda(cell.richness) * bp.catchFraction * Math.min(3, Math.max(0.3, d / bp.avgHopM));
    if (flooding) lambda *= bp.floodCatchMult;
    let n = 0;
    while (lambda > 4) { n += poisson(rng, 4); lambda -= 4; }
    n += poisson(rng, lambda);
    const w = weightsFor(cell.affinities);
    for (let k = 0; k < n; k++) {
      const f = flooding ? bp.floodFamily : weightedPick(rng, w);
      const tap = () => (rng() * 2 - 1) * bp.tapSpread;
      const r = resolveCatch(f, [tap(), tap(), tap()], rng, 0, 0);
      if (r.result === 'perfect' || r.result === 'good') {
        const got = 1 + (r.result === 'perfect' && r.bonus ? 1 : 0);
        b.inv[f] += got;
        totals.catches += got;
      }
    }
  }

  function hop(b: Bot): Travel | null {
    const nb = neighbors[b.node]!;
    if (nb.length === 0) return null;
    const home = nodes[b.home]!;
    if (haversineM(nodes[b.node]!, home) > bp.homeRadiusM) {
      let best = nb[0]!;
      let bd = Infinity;
      for (const x of nb) { const d = haversineM(nodes[x.i]!, home); if (d < bd) { bd = d; best = x; } }
      return { to: best.i, left: best.d, dist: best.d, action: 'visit' };
    }
    const now = nowOf(stepIdx);
    let total = 0;
    const ws = nb.map((x) => {
      let w = 1;
      if (x.i === b.prev) w = 0.1;
      else if (nodes[x.i]!.kind === 'relay') {
        const last = b.lastSync.get(x.i);
        if (last === undefined || now - last >= RELAY.cooldownMs) w = 3;
      }
      total += w;
      return w;
    });
    let r = rng() * total;
    for (let k = 0; k < nb.length; k++) {
      r -= ws[k]!;
      if (r < 0) return { to: nb[k]!.i, left: nb[k]!.d, dist: nb[k]!.d, action: 'visit' };
    }
    const last = nb[nb.length - 1]!;
    return { to: last.i, left: last.d, dist: last.d, action: 'visit' };
  }

  const goMarket = (b: Bot, mi: number, action: Action): Travel => {
    const to = marketNodes[mi]!;
    const d = to === b.node ? 0 : dist(b.node, to);
    return { to, left: Math.max(60, d), dist: d, action }; // ≥ 60 m : le temps de l'échange
  };
  const nearestOpen = (b: Bot): number => {
    for (const x of marketsByDist[b.node]!) if (merchants[x.i]!.status === 'open') return x.i;
    return -1;
  };

  function recipeOf(b: Bot): Recipe {
    return recipes[b.forge]!.find((r) => r.tier === b.tier)!;
  }

  function plan(b: Bot): Travel | null {
    const now = nowOf(stepIdx);
    const day = Math.floor(stepIdx / STEPS_PER_DAY);
    switch (b.kind) {
      case 'arbitrageur': {
        if (merchantOfNode[b.node]! >= 0) {
          const near = arbNear[merchantOfNode[b.node]!]!;
          if (near.length) return goMarket(b, near[Math.floor(rng() * near.length)]!.i, 'arb');
        }
        const mi = nearestOpen(b);
        return mi >= 0 ? goMarket(b, mi, 'arb') : null;
      }
      case 'forger': {
        const r = recipeOf(b);
        const miss = missingFor(r.needs, b.inv);
        const nMiss = recipeSize(miss);
        const surplus = FAMILIES.reduce((s, f) => s + Math.max(0, b.inv[f] - (r.needs[f] ?? 0)), 0);
        if (nMiss === 0 && b.flux >= r.fee) {
          const to = forgeNodes[b.forge]!;
          const d = dist(b.node, to);
          return { to, left: Math.max(60, d), dist: d, action: 'compile' };
        }
        if (stepIdx >= b.shopAfter) {
          const est = (Object.entries(miss) as [Family, number][]).reduce((s, [f, q]) => s + q * p0[f] * 1.3, 0);
          const canBuy = nMiss > 0 && nMiss <= 4 && b.flux >= r.fee + est;
          if (canBuy || surplus >= 8 || (nMiss === 0 && surplus > 0)) {
            let best = -1;
            let bs = -Infinity;
            let seen = 0;
            for (const x of marketsByDist[b.node]!) {
              const m = merchants[x.i]!;
              if (m.status !== 'open') continue;
              let s = -x.d / 500;
              for (const [f, q] of Object.entries(miss) as [Family, number][]) {
                if (!(m.contract && m.contract.family === f)) s += Math.min(q, m.stock[f]);
              }
              if (s > bs) { bs = s; best = x.i; }
              if (++seen >= 6) break;
            }
            if (best >= 0) return goMarket(b, best, 'shop');
          }
        }
        return hop(b);
      }
      case 'patron': {
        if (b.flux >= MERCHANT.rescueMin + bp.patronKeep) {
          for (const x of marketsByDist[b.node]!) {
            if (x.d > bp.patronRadiusM) break;
            if (merchants[x.i]!.status !== 'open') return goMarket(b, x.i, 'rescue');
          }
        }
        break;
      }
      case 'flooder': {
        if (day >= bp.floodStartDay && b.inv[bp.floodFamily] >= bp.floodSellAt) {
          // le marchand voisin qui paie le mieux la famille inondée
          let best = -1;
          let bpx = 0;
          let seen = 0;
          for (const x of marketsByDist[b.node]!) {
            if (x.d > bp.arbRadiusM && best >= 0) break;
            const m = merchants[x.i]!;
            if (m.status !== 'open') continue;
            const p = unitBuyPrice(p0[bp.floodFamily], m, bp.floodFamily, m.stock[bp.floodFamily]);
            if (p > bpx && m.flux >= p) { bpx = p; best = x.i; }
            if (++seen >= 12) break;
          }
          if (best >= 0) return goMarket(b, best, 'sell');
        }
        break;
      }
      default:
        break;
    }
    // walker (et patron/flooder par défaut)
    if (invSize(b.inv) >= bp.sellAtShards) {
      const mi = nearestOpen(b);
      if (mi >= 0 && marketNodes[mi] !== b.node) return goMarket(b, mi, 'sell');
    }
    void now;
    return hop(b);
  }

  function arbitrage(b: Bot, now: number) {
    const i = merchantOfNode[b.node]!;
    if (i < 0) return;
    if (invSize(b.inv) > 0) sellAll(b, i, now);
    const mi = merchants[i]!;
    if (mi.status === 'closed') return;
    let best: { j: number; f: Family; k: number; score: number } | null = null;
    for (const f of FAMILIES) {
      if (mi.contract && mi.contract.family === f) continue;
      if (mi.stock[f] <= 0) continue;
      for (const x of arbNear[i]!) {
        const mj = merchants[x.i]!;
        if (mj.status !== 'open') continue;
        let profit = 0;
        let k = 0;
        let sI = mi.stock[f];
        let sJ = mj.stock[f];
        let spend = 0;
        let fluxJ = mj.flux;
        while (k < bp.arbMaxUnits && sI > 0) {
          const ps = unitSellPrice(p0[f], mi, f, sI);
          const pb = unitBuyPrice(p0[f], mj, f, sJ);
          if (pb <= ps || spend + ps > b.flux || fluxJ < pb) break;
          profit += pb - ps; spend += ps; fluxJ -= pb; sI--; sJ++; k++;
        }
        const score = profit - (2 * x.d) / 1000;
        if (k > 0 && profit >= bp.arbMinProfit && (!best || score > best.score)) best = { j: x.i, f, k, score };
      }
    }
    if (best && buy(b, i, best.f, best.k, b.flux, now) > 0) b.travel = goMarket(b, best.j, 'arb');
  }

  function shop(b: Bot, mi: number, now: number) {
    const r = recipeOf(b);
    sellAll(b, mi, now, r.needs);
    const miss = missingFor(r.needs, b.inv);
    for (const [f, q] of Object.entries(miss) as [Family, number][]) buy(b, mi, f, q, b.flux - r.fee, now);
    b.shopAfter = stepIdx + 2;
  }

  function compile(b: Bot, now: number) {
    const r = recipeOf(b);
    if (recipeSize(missingFor(r.needs, b.inv)) > 0 || b.flux < r.fee) return;
    for (const [f, q] of Object.entries(r.needs) as [Family, number][]) b.inv[f] -= q;
    b.flux -= r.fee;
    b.payouts = b.payouts.filter((p) => now - p.at < 24 * 3600_000);
    const p = forgePayout({
      poolAvail: poolAvail(pools.main), weight: r.weight,
      playerDayUsed: b.payouts.reduce((s, x) => s + x.amount, 0), globalDayUsed, globalDayBase,
    });
    totals.compiles++;
    totals.feesBurned += r.fee;
    totals.shardsBurned += recipeSize(r.needs);
    if (p.amount > 0) {
      pools.main.granted += p.amount;
      globalDayUsed += p.amount;
      payoutsCum += p.amount;
      totals.payouts += p.amount;
      totals.compilesPaid++;
      b.payouts.push({ at: now, amount: p.amount });
    }
  }

  function doRescue(b: Bot, mi: number, now: number) {
    const m = merchants[mi]!;
    if (m.status === 'open') return;
    const amount = Math.min(b.flux - bp.patronKeep, Math.max(MERCHANT.rescueMin, MERCHANT.reopenAt - m.flux));
    if (amount < MERCHANT.rescueMin) return;
    const r = rescue(m, amount, now);
    if ('error' in r) return;
    merchants[mi] = r.m;
    b.flux -= amount;
    totals.rescues++;
    totals.rescueFlux += amount;
    b.patronUntil.set(mi, now + MERCHANT.patronPerkMs);
    pushEvent('rescued', mi, `+${amount} ƒ`);
    if (r.events.some((e) => e.kind === 'reopened')) pushEvent('reopened', mi);
  }

  function act(b: Bot, action: Action, d: number, now: number) {
    const mi = merchantOfNode[b.node]!;
    switch (action) {
      case 'visit': visit(b, d, now); break;
      case 'sell': if (mi >= 0) sellAll(b, mi, now); break;
      case 'shop': if (mi >= 0) shop(b, mi, now); break;
      case 'arb': arbitrage(b, now); break;
      case 'compile': compile(b, now); break;
      case 'rescue': if (mi >= 0) doRescue(b, mi, now); break;
    }
  }

  function botStep(b: Bot, now: number) {
    let budget = stepM;
    let guard = 0;
    while (budget > 0 && guard++ < 30) {
      if (!b.travel) b.travel = plan(b);
      const t = b.travel;
      if (!t) break;
      if (t.left > budget) { t.left -= budget; break; }
      budget -= t.left;
      b.prev = b.node;
      b.node = t.to;
      b.travel = null;
      act(b, t.action, t.dist, now);
    }
  }

  function step() {
    if (stepIdx >= totalSteps) return;
    withRules(opts.rulesOverride, () => {
      const sod = stepIdx % STEPS_PER_DAY;
      if (sod === 0) dayStart(stepIdx / STEPS_PER_DAY);
      const now = nowOf(stepIdx);
      for (const i of order) {
        const b = bots[i]!;
        if (b.active[sod]) botStep(b, now);
      }
      stepIdx++;
      const end = nowOf(stepIdx);
      if (stepIdx % STEPS_PER_HOUR === 0) hourly(end);
      if (stepIdx % (STEPS_PER_HOUR * 3) === 0) reflect(end);
      if (stepIdx === totalSteps) fluxPlayersDaily.push(bots.reduce((s, b) => s + b.flux, 0));
    });
  }

  // état initial : 1re réflexion (contrats) + point t = 0
  reflect(BASE_MS);
  series.push(point());

  function snapshot(): SimSnapshot {
    return {
      step: stepIdx, hour: stepIdx / STEPS_PER_HOUR, done: stepIdx >= totalSteps, p0: { ...p0 }, reserveHealth: health,
      mainPoolAvail: poolAvail(pools.main), payoutsCum, last: series[series.length - 1],
      merchants: merchants.map((m, mi) => ({
        id: m.id, name: m.name, lat: nodes[marketNodes[mi]!]!.lat, lng: nodes[marketNodes[mi]!]!.lng, status: m.status, flux: m.flux,
      })),
      bots: bots.map((b) => ({ lat: nodes[b.node]!.lat, lng: nodes[b.node]!.lng, kind: b.kind, flux: b.flux, shards: invSize(b.inv) })),
    };
  }

  function result(): SimResult {
    const last = series[series.length - 1]!;
    return {
      scenario, days, players: opts.players, seed: opts.seed, mix, merchants: merchants.length,
      series, events, totals, fluxPlayersDaily, finalP0: { ...p0 }, finalAvgMid: last.avgMid, seededStruggler,
      health: healthChecks({
        fluxPlayersDaily, ratioSamples, ratioInitSamples, gapSamples,
        struggled: [...struggled].filter((i) => i !== seededIdx).length, merchants: merchants.length, maxClosedFrac,
      }),
    };
  }

  return {
    totalSteps,
    get stepIndex() { return stepIdx; },
    get done() { return stepIdx >= totalSteps; },
    step,
    run(n = Infinity) { for (let k = 0; k < n && stepIdx < totalSteps; k++) step(); },
    snapshot,
    result,
  };
}

// ───────────────────────────── Cibles de santé (Docs/03 §8) ─────────────────────────────
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)} %`;

export function healthChecks(i: {
  fluxPlayersDaily: number[]; ratioSamples: number[]; ratioInitSamples: number[]; gapSamples: number[];
  struggled: number; merchants: number; maxClosedFrac: number;
}): HealthCheck[] {
  const F = i.fluxPlayersDaily;
  const days = F.length - 1;
  const from = Math.floor(days / 2);
  const a = F[from] ?? 0;
  const b = F[days] ?? 0;
  const growth = a > 0 && days > from ? (b / a) ** (1 / (days - from)) - 1 : 0;
  const rMin = i.ratioSamples.length ? Math.min(...i.ratioSamples) : 1;
  const rMax = i.ratioSamples.length ? Math.max(...i.ratioSamples) : 1;
  const r0Min = i.ratioInitSamples.length ? Math.min(...i.ratioInitSamples) : 1;
  const r0Max = i.ratioInitSamples.length ? Math.max(...i.ratioInitSamples) : 1;
  const gap = i.gapSamples.length ? i.gapSamples.reduce((s, x) => s + x, 0) / i.gapSamples.length : 0;
  const struggling = i.merchants ? i.struggled / i.merchants : 0;
  return [
    { name: 'Player Flux growth / day (steady state)', value: growth, display: pct(growth), target: '< 5 %', pass: growth < 0.05 },
    {
      name: 'Avg merchant mid / P0', value: Math.max(rMax / 1.8, 0.6 / rMin), display: `${rMin.toFixed(2)}–${rMax.toFixed(2)} (vs P0₀ ${r0Min.toFixed(2)}–${r0Max.toFixed(2)})`,
      target: '0.6–1.8', pass: rMin >= 0.6 && rMax <= 1.8,
    },
    { name: 'Median price gap, merchants < 1 km', value: gap, display: pct(gap), target: '≥ 15 %', pass: gap >= 0.15 },
    { name: 'Merchants that struggled (excl. seeded)', value: struggling, display: `${pct(struggling)} (${i.struggled}/${i.merchants})`, target: '≥ 10 %', pass: struggling >= 0.1 },
    { name: 'Max share closed at once', value: i.maxClosedFrac, display: pct(i.maxClosedFrac), target: '≤ 30 %', pass: i.maxClosedFrac <= 0.3 },
  ];
}

/** Simulation complète (CLI, tests, Web Worker). */
export function simulate(opts: SimOptions): SimResult {
  const sim = createSim(opts);
  const chunk = STEPS_PER_DAY / 4;
  while (!sim.done) {
    sim.run(chunk);
    opts.onProgress?.(sim.stepIndex / sim.totalSteps, sim.snapshot());
  }
  return sim.result();
}
