import { describe, expect, it } from 'vitest';
import { FAMILIES, type Family } from '../types.ts';
import { mulberry32 } from '../rng.ts';
import {
  applyDecision, applyMove, applyTrade, canActAt, catchXp, clampDecision, commitments, createMerchant, deliverContract,
  driftP0, equivalences, explainPrice, fallbackPolicy, forgePayout, hourlyTick, initialP0, initialPools, isSolvent,
  levelForXp, makeContract, missingFor, newMoveState, nextCombo, poolAvail, quote, recipesFor, rescue, reserveHealth,
  resolveCatch, spawnsForCell, familyWeights, unitBuyPrice, unitSellPrice,
  BASE_TARGET, FAMILY_INFO, FORGE, MERCHANT, P0_DRIFT, RESERVE, TIERS, usd, xpToNext, type MerchantState, type Quote,
} from './index.ts';

const SECRET = 'test-secret';
const p0 = initialP0();
const merchant = (patch: Partial<MerchantState> = {}): MerchantState => ({ ...createMerchant(SECRET, 'osm:node/1', ['gpt']), ...patch });

describe('pricing', () => {
  it('buy < sell, both positive integers', () => {
    const m = merchant();
    for (const f of FAMILIES) {
      const e = explainPrice(p0[f], m, f);
      expect(Number.isInteger(e.buy)).toBe(true);
      expect(Number.isInteger(e.sell)).toBe(true);
      expect(e.buy!).toBeLessThan(e.sell!);
      expect(e.buy!).toBeGreaterThan(0);
    }
  });

  it('price slides monotonically per unit', () => {
    const m = merchant({ flux: 1e9 });
    const q = quote(p0.gemini, m, 'sell', 'gemini', 10) as Quote;
    for (let i = 1; i < q.unitPrices.length; i++) expect(q.unitPrices[i]!).toBeLessThanOrEqual(q.unitPrices[i - 1]!);
    expect(q.unitPrices[0]!).toBeGreaterThan(q.unitPrices[9]!);
    const b = quote(p0.gemini, m, 'buy', 'gemini', Math.min(5, m.stock.gemini)) as Quote;
    for (let i = 1; i < b.unitPrices.length; i++) expect(b.unitPrices[i]!).toBeGreaterThanOrEqual(b.unitPrices[i - 1]!);
  });

  it('exploit: buying then selling back to the same merchant never profits', () => {
    const rng = mulberry32(7);
    for (let trial = 0; trial < 500; trial++) {
      const f = FAMILIES[trial % 5]!;
      const stock = 1 + Math.floor(rng() * 60);
      const m = merchant({ flux: 1e9, spread: 0.03 + rng() * 0.09, stock: { ...merchant().stock, [f]: stock } });
      for (const patron of [false, true]) {
        const qty = 1 + Math.floor(rng() * Math.min(stock, 5));
        const b = quote(p0[f], m, 'buy', f, qty, { patron }) as Quote;
        const after = applyTrade(m, b, 0);
        const s = quote(p0[f], after, 'sell', f, qty, { patron }) as Quote;
        expect(s.total).toBeLessThan(b.total);
      }
    }
  });

  it('closing merchants sell at a discount and do not buy', () => {
    const m = merchant({ status: 'closing', flux: 100 });
    expect(quote(p0.qwen, m, 'sell', 'qwen', 1)).toEqual({ error: 'NOT_BUYING' });
    expect(unitSellPrice(p0.qwen, m, 'qwen', 5)).toBeLessThan(unitSellPrice(p0.qwen, { ...m, status: 'open' }, 'qwen', 5));
  });

  it('refuses: closed, out of stock, merchant short on flux, contract lock, bad qty', () => {
    expect(quote(p0.gpt, merchant({ status: 'closed' }), 'buy', 'gpt', 1)).toEqual({ error: 'CLOSED' });
    expect(quote(p0.gpt, merchant({ stock: { ...merchant().stock, gpt: 0 } }), 'buy', 'gpt', 1)).toEqual({ error: 'OUT_OF_STOCK' });
    expect(quote(p0.claude, merchant({ flux: 10 }), 'sell', 'claude', 1)).toEqual({ error: 'MERCHANT_NO_FLUX' });
    const c = merchant({ contract: { id: 'c', family: 'gpt', qty: 2, reward: 100, expiresAt: 1e15 } });
    expect(quote(p0.gpt, c, 'buy', 'gpt', 1)).toEqual({ error: 'CONTRACT_LOCK' });
    expect(explainPrice(p0.gpt, c, 'gpt').sellBlocked).toBe('contract');
    expect(quote(p0.gpt, merchant(), 'buy', 'gpt', 0)).toEqual({ error: 'BAD_QTY' });
    expect(quote(p0.gpt, merchant(), 'buy', 'gpt', 1.5)).toEqual({ error: 'BAD_QTY' });
  });

  it('scarcity: an empty stock is pricier than a full one, bounded', () => {
    const m = merchant();
    expect(unitBuyPrice(p0.gpt, m, 'gpt', 0)).toBeGreaterThan(unitBuyPrice(p0.gpt, m, 'gpt', 20));
    expect(unitSellPrice(p0.gpt, m, 'gpt', 1)).toBeLessThanOrEqual(Math.ceil(p0.gpt * 3 * 1.12));
  });
});

describe('merchant life', () => {
  it('createMerchant is deterministic and within ranges', () => {
    const a = createMerchant(SECRET, 'osm:node/42', ['claude']);
    expect(createMerchant(SECRET, 'osm:node/42', ['claude'])).toEqual(a);
    expect(a.flux).toBeGreaterThanOrEqual(900);
    expect(a.flux).toBeLessThanOrEqual(2400);
    expect(a.baseTarget.claude).toBeGreaterThan(createMerchant(SECRET, 'osm:node/42', []).baseTarget.claude - 1);
  });

  it('imports when low, exports surplus, rent only if active', () => {
    const m = merchant({ stock: { deepseek: 0, qwen: 200, gemini: 5, gpt: 3, claude: 2 }, lastTradeAt: null, flux: 1000 });
    const { m: n, events } = hourlyTick(m, p0, 3600_000);
    expect(events.some((e) => e.kind === 'import' && e.family === 'deepseek')).toBe(true);
    expect(events.some((e) => e.kind === 'export' && e.family === 'qwen')).toBe(true);
    expect(events.some((e) => e.kind === 'rent')).toBe(false);
    expect(n.stock.qwen).toBeLessThan(200);
    const active = hourlyTick({ ...m, lastTradeAt: 3000_000 }, p0, 3600_000);
    expect(active.events.some((e) => e.kind === 'rent')).toBe(true);
  });

  it('bankruptcy: closing → closed after 2 h → rescue → reopened', () => {
    // stock = demande de base de la ville : ni export (qui renflouerait la caisse) ni import
    let m = merchant({ flux: 140, lastTradeAt: null, stock: { ...BASE_TARGET } });
    let r = hourlyTick(m, p0, 0);
    m = r.m;
    expect(m.status).toBe('closing');
    r = hourlyTick(m, p0, MERCHANT.closingGraceMs + 1);
    m = r.m;
    // l'import a pu dépenser un peu ; il reste < 150
    expect(m.status).toBe('closed');
    expect(quote(p0.gpt, m, 'buy', 'gpt', 1)).toEqual({ error: 'CLOSED' });
    expect(rescue(m, 10, 0)).toEqual({ error: 'BAD_AMOUNT' });
    const half = rescue(m, 200, 0);
    expect('m' in half && half.m.status).toBe('closed');
    const full = rescue('m' in half ? half.m : m, 600, 0);
    expect('m' in full && full.m.status).toBe('open');
    expect(rescue(merchant(), 100, 0)).toEqual({ error: 'NOT_STRUGGLING' });
  });

  it('contracts: reward above sell price, anti-farm lock, delivery pays', () => {
    const m = merchant({ flux: 5000 });
    const c = makeContract(mulberry32(1), m, p0, 0, 'gpt');
    expect(c.qty).toBeGreaterThanOrEqual(1);
    expect(c.qty).toBeLessThanOrEqual(5);
    expect(c.reward).toBeGreaterThanOrEqual(c.qty * unitSellPrice(p0.gpt, m, 'gpt', m.stock.gpt));
    const withC = { ...m, contract: c };
    const d = deliverContract(withC, 1);
    expect('reward' in d && d.reward).toBe(c.reward);
    expect('m' in d && d.m.stock.gpt).toBe(m.stock.gpt + c.qty);
    expect(deliverContract(withC, c.expiresAt + 1)).toEqual({ error: 'EXPIRED' });
  });

  it('P0 drift is bounded', () => {
    let p = initialP0();
    const flooded = Array.from({ length: 10 }, (_, i) => ({ ...createMerchant(SECRET, `n${i}`, []), stock: { deepseek: 1000, qwen: 1000, gemini: 1000, gpt: 1000, claude: 1000 } }));
    for (let i = 0; i < 500; i++) p = driftP0(p, flooded);
    for (const f of FAMILIES) expect(p[f]).toBeCloseTo(FAMILY_INFO[f].p0 * P0_DRIFT.minMult, 5);
  });
});

describe('agent clamps', () => {
  const m = merchant();
  it('bounds spread, multipliers (±30 %), qty, text', () => {
    const d = clampDecision(m, { spread: 5, targetMultipliers: { gpt: 100, claude: -3, qwen: 'x' }, contract: { family: 'gpt', qty: 99 }, mood: 'a'.repeat(500) + '<script>' });
    expect(d.spread).toBeLessThanOrEqual(0.12);
    expect(d.spread).toBeLessThanOrEqual(m.spread * 1.3 + 1e-9);
    expect(d.targetMult.gpt).toBeCloseTo(1.3);
    expect(d.targetMult.claude).toBeCloseTo(0.7);
    expect(d.targetMult.qwen).toBe(1);
    expect(d.contract).toEqual({ family: 'gpt', qty: 5 });
    expect(d.mood.length).toBeLessThanOrEqual(90);
    expect(d.mood).not.toContain('<');
  });
  it('garbage input → previous values', () => {
    for (const raw of [null, 'oops', 42, [], { contract: { family: 'bitcoin', qty: 1 } }]) {
      const d = clampDecision(m, raw);
      expect(d.spread).toBe(m.spread);
      expect(d.contract).toBeNull();
    }
  });
  it('fallback policy is valid and applicable', () => {
    const d = fallbackPolicy(m, { gpt: 2 });
    expect(d.targetMult.gpt).toBeGreaterThan(1);
    expect(applyDecision(m, d).spread).toBe(d.spread);
  });
});

describe('forge & reserve', () => {
  it('recipes are deterministic, sized per tier, themed', () => {
    const r = recipesFor(SECRET, 'forge:pantheon', ['claude'], '2026-11-07');
    expect(recipesFor(SECRET, 'forge:pantheon', ['claude'], '2026-11-07')).toEqual(r);
    const size = (n: Partial<Record<Family, number>>) => Object.values(n).reduce((s, x) => s + (x ?? 0), 0);
    expect(r.map((x) => size(x.needs))).toEqual([6, 8, 9]);
    expect(r[0]!.needs.claude ?? 0).toBe(0); // Spark ne peut pas exiger d'Epic
    expect(r[2]!.needs.claude).toBeGreaterThanOrEqual(2);
    expect(missingFor({ gpt: 2, qwen: 1 }, { gpt: 1, qwen: 3 })).toEqual({ gpt: 1 });
  });

  it('payout: geometric fraction, caps, min payout', () => {
    const full = forgePayout({ poolAvail: usd(4.5), weight: 1, playerDayUsed: 0, globalDayUsed: 0, globalDayBase: usd(4.5) });
    expect(full.amount).toBe(usd(0.018));
    expect(forgePayout({ poolAvail: usd(4.5), weight: 8, playerDayUsed: usd(0.2), globalDayUsed: 0, globalDayBase: usd(4.5) }))
      .toEqual({ amount: usd(0.05), reason: 'player-cap' });
    expect(forgePayout({ poolAvail: usd(0.1), weight: 1, playerDayUsed: 0, globalDayUsed: 0, globalDayBase: usd(4.5) }).reason).toBe('below-min');
    const globalCap = Math.floor(usd(4.5) * FORGE.capGlobalDayRatio);
    expect(forgePayout({ poolAvail: usd(4.5), weight: 3, playerDayUsed: 0, globalDayUsed: globalCap - usd(0.01), globalDayBase: usd(4.5) }).amount).toBe(usd(0.01));
  });

  it('pool never hits zero under repeated compiles (solvable by construction)', () => {
    const pools = initialPools();
    let used = 0;
    for (let i = 0; i < 10_000; i++) {
      const p = forgePayout({ poolAvail: poolAvail(pools.main), weight: 8, playerDayUsed: 0, globalDayUsed: 0, globalDayBase: 1e18 });
      pools.main.granted += p.amount;
      used += p.amount;
      expect(poolAvail(pools.main)).toBeGreaterThan(0);
    }
    expect(used).toBeLessThan(usd(4.5));
    expect(reserveHealth(pools.main)).toBe(RESERVE.healthMin);
  });

  it('solvency invariant: random grant/usage sequences never violate it', () => {
    const rng = mulberry32(99);
    for (let run = 0; run < 200; run++) {
      const org = usd(11.5);
      let state = { orgRemaining: org, keys: [] as { limit: number; usage: number }[], npcRemaining: usd(1), safety: usd(2.5) };
      for (let step = 0; step < 100; step++) {
        const r = rng();
        if (r < 0.5) {
          const amount = Math.floor(rng() * usd(0.3));
          const newKey = state.keys.length === 0 || rng() < 0.3;
          if (isSolvent(state, amount, newKey)) {
            if (newKey) state.keys.push({ limit: amount, usage: 0 });
            else state.keys[Math.floor(rng() * state.keys.length)]!.limit += amount;
          }
        } else if (state.keys.length) {
          // usage réel : débite l'org, ne dépasse la limite que de l'overshoot
          const k = state.keys[Math.floor(rng() * state.keys.length)]!;
          const spend = Math.min(Math.floor(rng() * usd(0.05)), k.limit + RESERVE.overshootPerKey - k.usage);
          if (spend > 0) { k.usage += spend; state = { ...state, orgRemaining: state.orgRemaining - spend }; }
        }
        // le pire cas (toutes les clés vidées + overshoot) reste payable
        const worst = state.keys.reduce((s, k) => s + Math.max(0, k.limit + RESERVE.overshootPerKey - k.usage), 0);
        expect(worst + state.npcRemaining + state.safety).toBeLessThanOrEqual(state.orgRemaining + 1);
        expect(commitments(state)).toBeLessThanOrEqual(state.orgRemaining + usd(0.05) * state.keys.length);
      }
    }
  });
});

describe('spawns', () => {
  const cell = '891fb466257ffff';
  it('deterministic for same secret/cell/window', () => {
    expect(spawnsForCell(SECRET, cell, 100, { richness: 3, affinities: [] }, 1)).toEqual(spawnsForCell(SECRET, cell, 100, { richness: 3, affinities: [] }, 1));
  });
  it('family distribution ≈ weights (± 2 %), affinity ×3, reserve health', () => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (let w = 0; w < 20_000; w++) {
      for (const s of spawnsForCell(SECRET, cell, w, { richness: 6, affinities: [] }, 1)) { counts[s.family] = (counts[s.family] ?? 0) + 1; total++; }
    }
    for (const f of FAMILIES) expect(Math.abs(counts[f]! / total - FAMILY_INFO[f].spawnWeight / 100)).toBeLessThan(0.02);
    expect(familyWeights(['gemini'], 1).gemini).toBe(FAMILY_INFO.gemini.spawnWeight * 3);
    expect(familyWeights([], 0.3).claude).toBeCloseTo(1.2);
    expect(total / 20_000).toBeGreaterThan(1.5); // λ = 2.3, plafonné à 3
  });
});

describe('progression & catch', () => {
  it('xp curve matches the spec', () => {
    expect(xpToNext(1)).toBe(100);
    expect(levelForXp(383).level).toBe(3);
    expect(levelForXp(382).level).toBe(2);
    expect(levelForXp(1703).level).toBe(5);
    expect(levelForXp(11_106).level).toBe(10);
  });
  it('combo', () => {
    expect(nextCombo(3, 0, 60_000)).toBe(4);
    expect(nextCombo(5, 0, 60_000)).toBe(5);
    expect(nextCombo(3, 0, 120_000)).toBe(1);
    expect(catchXp(true, 3)).toBe(19);
  });
  it('catch: perfect, good, flee, perfect cap', () => {
    const rng = mulberry32(3);
    expect(resolveCatch('deepseek', [0.01], rng, 0, 0).result).toBe('perfect');
    expect(resolveCatch('deepseek', [0.15], rng, 0, 0).result).toBe('good');
    expect(resolveCatch('deepseek', [0.9, 0.9, 0.9], rng, 0, 0).result).toBe('miss'); // common ne fuit jamais
    expect(resolveCatch('deepseek', [0.01], rng, 15, 30).result).toBe('good');
    let fled = 0;
    for (let i = 0; i < 1000; i++) if (resolveCatch('claude', [0.9], mulberry32(i), 0, 0).result === 'fled') fled++;
    expect(fled).toBeGreaterThan(220);
    expect(fled).toBeLessThan(380);
  });
});

describe('movement anti-cheat', () => {
  const louvre = { lat: 48.8611, lng: 2.3358 };
  it('walking accumulates proof of walk, no transit', () => {
    let s = newMoveState();
    let v;
    for (let i = 0; i < 40; i++) {
      v = applyMove(s, { lat: louvre.lat + i * 0.00005, lng: louvre.lng, acc: 10, at: i * 5000 }, false);
      s = v.state;
    }
    expect(v!.inTransit).toBe(false);
    expect(s.walkedM).toBeGreaterThan(200);
  });
  it('fast but plausible → in transit; teleport → suspicious + soft-lock', () => {
    let s = newMoveState();
    let v;
    for (let i = 0; i < 20; i++) { v = applyMove(s, { lat: louvre.lat + i * 0.0004, lng: louvre.lng, acc: 10, at: i * 3000 }, false); s = v.state; }
    expect(v!.inTransit).toBe(true);
    v = applyMove(s, { lat: louvre.lat + 0.05, lng: louvre.lng + 0.05, acc: 5, at: 61_000 }, false);
    expect(v.suspicious).toBe(true);
    expect(canActAt(v.state, 'spawn', { lat: louvre.lat + 0.05, lng: louvre.lng + 0.05 }, 62_000)).toEqual({ ok: false, code: 'SUSPICIOUS_MOVE' });
  });
  it('background return is plausible', () => {
    let s = applyMove(newMoveState(), { ...louvre, acc: 10, at: 0 }, false).state;
    const v = applyMove(s, { lat: louvre.lat + 0.03, lng: louvre.lng, acc: 10, at: 3600_000 }, false);
    expect(v.suspicious).toBe(false);
    s = v.state;
  });
  it('demo mode skips speed checks; action distance enforced; weak GPS ignored', () => {
    let v = applyMove(newMoveState(), { ...louvre, acc: 10, at: 0 }, true);
    v = applyMove(v.state, { lat: louvre.lat + 0.1, lng: louvre.lng, acc: 10, at: 1000 }, true);
    expect(v.suspicious).toBe(false);
    const here = { lat: louvre.lat + 0.1, lng: louvre.lng };
    expect(canActAt(v.state, 'spawn', here, 2000).ok).toBe(true);
    expect(canActAt(v.state, 'spawn', { lat: here.lat + 0.001, lng: here.lng }, 2000)).toMatchObject({ ok: false, code: 'TOO_FAR' });
    expect(canActAt(v.state, 'spawn', here, 60_000)).toEqual({ ok: false, code: 'NO_POSITION' });
    expect(applyMove(v.state, { ...here, acc: 120, at: 3000 }, false).ignored).toBe(true);
  });
});

describe('equivalences', () => {
  it('$0.02 ≈ 20k DeepSeek tokens', () => {
    const e = equivalences(usd(0.02));
    expect(e.tokens[0]!.tokens).toBeGreaterThan(19_000);
    expect(e.chats).toBe(13);
  });
});
void TIERS; void FORGE;
