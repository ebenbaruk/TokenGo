// Marchandage : bornes prouvées par tirages (style property-based, déterministe).
import { describe, expect, it } from 'vitest';
import { FAMILIES, type Family } from '../types.ts';
import { mulberry32, randInt, type Rng } from '../rng.ts';
import { HAGGLE, PRICING } from './rules.ts';
import { applyTrade, quote, type MerchantState, type Quote, type Side } from './pricing.ts';
import { createMerchant } from './market.ts';
import {
  HAGGLE_CARDS, cardEffect, haggledQuote, maxBp, motivation, playCard, souredQuote, startHaggle, traitOf,
  type HaggleSituation, type HaggleTrait,
} from './haggle.ts';

const P0: Record<Family, number> = { deepseek: 10, qwen: 14, gemini: 26, gpt: 48, claude: 95 };

/** Marchand aléatoire : stock, marge, cibles et statut tirés (dont les cas extrêmes : spécialité, marge mini, stock vide). */
function randomMerchant(rng: Rng, i: number): MerchantState {
  const fam = FAMILIES[i % FAMILIES.length]!;
  const m = createMerchant('fuzz', `osm:node/${i}`, rng() < 0.5 ? [fam] : []);
  for (const f of FAMILIES) m.stock[f] = randInt(rng, 0, Math.round(m.baseTarget[f] * 3));
  m.spread = rng() < 0.3 ? PRICING.spreadMin : PRICING.spreadMin + rng() * (PRICING.spreadMax - PRICING.spreadMin);
  m.flux = randInt(rng, 200, 50_000);
  m.status = rng() < 0.15 ? 'closing' : 'open';
  for (const f of FAMILIES) m.targetMult[f] = 0.5 + rng() * 1.5;
  return m;
}
const p0Of = (rng: Rng) => Object.fromEntries(FAMILIES.map((f) => [f, P0[f] * (0.6 + rng() * 0.8)])) as Record<Family, number>;

describe('haggle bounds (fuzz)', () => {
  it('a haggled total is never worse than list, never more than 8 % off; units add up', () => {
    const rng = mulberry32(1);
    let checked = 0;
    for (let i = 0; i < 3000; i++) {
      const m = randomMerchant(rng, i);
      const p0 = p0Of(rng);
      const f = FAMILIES[randInt(rng, 0, 4)]!;
      const side: Side = rng() < 0.5 ? 'buy' : 'sell';
      const patron = rng() < 0.2;
      const q = quote(p0[f], m, side, f, randInt(rng, 1, 12), { patron });
      if ('error' in q) continue;
      const bp = randInt(rng, -2000, 5000); // même une offre hors bornes ne passe pas
      const h = haggledQuote(p0[f], m, q, bp);
      expect(h.unitPrices).toHaveLength(q.unitPrices.length);
      for (const p of h.unitPrices) expect(Number.isInteger(p) && p >= 1).toBe(true);
      if (side === 'buy') {
        expect(h.total).toBeLessThanOrEqual(q.total);
        expect(h.total).toBeGreaterThanOrEqual(Math.ceil(q.total * (1 - HAGGLE.maxPct)));
      } else {
        expect(h.total).toBeGreaterThanOrEqual(q.total);
        expect(h.total).toBeLessThanOrEqual(Math.floor(q.total * (1 + HAGGLE.maxPct)));
      }
      if (bp <= 0) expect(h.total).toBe(q.total);
      expect(h.total).toBe(h.unitPrices.reduce((a, b) => a + b, 0));
      checked++;
    }
    expect(checked).toBeGreaterThan(1500);
  });

  it('no round trip: buy-then-sell or sell-then-buy at one merchant always loses, whatever the haggles', () => {
    const rng = mulberry32(2);
    let trips = 0;
    for (let i = 0; i < 3000; i++) {
      const m0 = randomMerchant(rng, i);
      m0.status = 'open';
      const p0 = p0Of(rng);
      const f = FAMILIES[randInt(rng, 0, 4)]!;
      const patron = rng() < 0.3;
      const qty = randInt(rng, 1, 10);
      const first: Side = rng() < 0.5 ? 'buy' : 'sell';
      const q1 = quote(p0[f], m0, first, f, qty, { patron });
      if ('error' in q1) continue;
      const h1 = haggledQuote(p0[f], m0, q1, randInt(rng, 0, 800));
      const m1 = applyTrade(m0, h1, 0);
      const q2 = quote(p0[f], m1, first === 'buy' ? 'sell' : 'buy', f, qty, { patron });
      if ('error' in q2) continue;
      const h2 = haggledQuote(p0[f], m1, q2, randInt(rng, 0, 800));
      const net = first === 'buy' ? h2.total - h1.total : h1.total - h2.total;
      expect(net, `${f} qty ${qty} first ${first}`).toBeLessThan(0);
      trips++;
    }
    expect(trips).toBeGreaterThan(1000);
  });

  it('no closed loop of haggled trades at one merchant yields profit (random walks back to the starting inventory)', () => {
    const rng = mulberry32(3);
    let loops = 0;
    for (let i = 0; i < 800; i++) {
      let m = randomMerchant(rng, i);
      m.status = 'open';
      m.flux = 1_000_000;
      const p0 = p0Of(rng);
      const f = FAMILIES[randInt(rng, 0, 4)]!;
      const patron = rng() < 0.3;
      let held = 0; // éclats achetés (net) au marchand
      let flux = 0;
      let trades = 0;
      const steps = randInt(rng, 2, 12);
      const doTrade = (side: Side, qty: number) => {
        const q = quote(p0[f], m, side, f, qty, { patron });
        if ('error' in q) return false;
        const h: Quote = haggledQuote(p0[f], m, q, randInt(rng, 0, 800));
        m = applyTrade(m, h, 0);
        held += side === 'buy' ? qty : -qty;
        flux += side === 'buy' ? -h.total : h.total;
        trades++;
        return true;
      };
      for (let k = 0; k < steps; k++) doTrade(rng() < 0.5 ? 'buy' : 'sell', randInt(rng, 1, 6));
      // retour à l'inventaire de départ
      if (held > 0 && !doTrade('sell', held)) continue;
      if (held < 0 && !doTrade('buy', -held)) continue;
      if (trades === 0) continue;
      expect(held).toBe(0);
      expect(flux).toBeLessThan(0);
      loops++;
    }
    expect(loops).toBeGreaterThan(300);
  });

  it('cheap shards still leave room to haggle (4 DeepSeek at list price)', () => {
    const m = createMerchant('fuzz', 'osm:node/7', []);
    m.stock.deepseek = Math.round(m.baseTarget.deepseek);
    m.spread = 0.05;
    const q = quote(10, m, 'buy', 'deepseek', 4);
    if ('error' in q) throw new Error(q.error);
    expect(haggledQuote(10, m, q, maxBp(0)).total).toBeLessThan(q.total);
  });

  it('a soured quote is never better for the player', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 1000; i++) {
      const m = randomMerchant(rng, i);
      const f = FAMILIES[randInt(rng, 0, 4)]!;
      const side: Side = rng() < 0.5 ? 'buy' : 'sell';
      const q = quote(P0[f], m, side, f, randInt(rng, 1, 8));
      if ('error' in q) continue;
      const s = souredQuote(q);
      if (side === 'buy') expect(s.total).toBeGreaterThanOrEqual(q.total);
      else expect(s.total).toBeLessThanOrEqual(q.total);
    }
  });
});

describe('haggle card game', () => {
  const sit = (o: Partial<HaggleSituation> = {}): HaggleSituation => ({
    trait: 'greedy', rep: 0, side: 'buy', qty: 4, need: 0, desperate: false, base: 20, rival: null, ...o,
  });

  it('offer cap grows with reputation and never exceeds 8 %', () => {
    expect(maxBp(-5)).toBe(500);
    expect(maxBp(0)).toBe(500);
    expect(maxBp(5)).toBe(650);
    expect(maxBp(10)).toBe(800);
    expect(maxBp(1000)).toBe(800);
  });

  it('random play never leaves the bounds; finished sessions refuse cards', () => {
    const rng = mulberry32(5);
    const traits: HaggleTrait[] = ['greedy', 'friendly', 'proud'];
    for (let i = 0; i < 4000; i++) {
      const rep = randInt(rng, -5, 10);
      const s0 = sit({
        trait: traits[i % 3]!, rep, side: rng() < 0.5 ? 'buy' : 'sell', qty: randInt(rng, 3, 12), need: Math.round(rng() * 100) / 100, desperate: rng() < 0.2,
        rival: rng() < 0.6 ? { merchant: 'Bao', place: 'Café', claimed: 18, real: rng() < 0.2 ? null : randInt(rng, 10, 30) } : null,
      });
      let st = startHaggle(rng, s0);
      expect(st.hand).toHaveLength(HAGGLE.handSize);
      expect(st.hand[0]).toBe(s0.rival ? 'rival' : 'bluff');
      for (let k = 0; k < 6; k++) {
        const card = rng() < 0.9 && st.hand.length ? st.hand[randInt(rng, 0, st.hand.length - 1)]! : HAGGLE_CARDS[randInt(rng, 0, HAGGLE_CARDS.length - 1)]!;
        const r = playCard(rng, st, card, s0);
        if ('error' in r) {
          expect(st.phase !== 'open' || !st.hand.includes(card)).toBe(true);
          continue;
        }
        st = r.state;
        expect(st.bp).toBeGreaterThanOrEqual(0);
        expect(st.bp).toBeLessThanOrEqual(maxBp(rep));
        expect(st.patience).toBeGreaterThanOrEqual(0);
        expect(st.patience).toBeLessThanOrEqual(HAGGLE.patienceMax);
        expect(new Set(st.used).size).toBe(st.used.length); // une carte ne sert qu'une fois
        if (st.phase === 'sour' || st.phase === 'walked') expect(st.bp).toBe(0);
        if (st.phase !== 'open') expect(st.hand).toEqual([]);
      }
      expect(st.used.length).toBeLessThanOrEqual(HAGGLE.rounds);
    }
  });

  it('the rival card rewards true knowledge and punishes stale or wrong notes', () => {
    const truth = cardEffect('rival', sit({ base: 20, rival: { merchant: 'Bao', place: 'Café', claimed: 17, real: 17 } }));
    expect(truth.event).toBe('rival-true');
    expect(truth.deltaBp).toBeGreaterThanOrEqual(200);
    const wrong = cardEffect('rival', sit({ base: 20, rival: { merchant: 'Bao', place: 'Café', claimed: 17, real: 22 } }));
    expect(wrong.event).toBe('rival-false');
    expect(wrong.deltaBp).toBe(0);
    expect(wrong.deltaPatience).toBeLessThan(0);
    // côté vente : le rival doit PAYER plus
    expect(cardEffect('rival', sit({ side: 'sell', base: 20, rival: { merchant: 'B', place: 'P', claimed: 23, real: 23 } })).event).toBe('rival-true');
  });

  it('persona and state matter: proud hates lowballs, a desperate merchant takes them', () => {
    expect(cardEffect('lowball', sit({ trait: 'proud' })).deltaPatience).toBe(-3);
    expect(cardEffect('lowball', sit({ trait: 'proud', desperate: true })).event).toBe('lowball-good');
    expect(cardEffect('compliment', sit({ trait: 'greedy' })).deltaBp).toBe(0);
    expect(cardEffect('compliment', sit({ trait: 'friendly' })).deltaBp).toBeGreaterThan(0);
    expect(cardEffect('regular', sit({ rep: 0 })).event).toBe('regular-doubt');
    expect(cardEffect('regular', sit({ rep: 4 })).event).toBe('regular-good');
    expect(cardEffect('walk', sit({ need: 0 })).phase).toBe('walked');
    expect(cardEffect('walk', sit({ need: 0.6 })).phase).toBe('final');
    expect(traitOf('grandma')).toBe('friendly');
    expect(traitOf('purist')).toBe('proud');
    expect(traitOf('unknown')).toBe('proud');
  });

  it('a proud merchant loses patience on a caught bluff + lowball → sour, offer reset', () => {
    const s0 = sit({ trait: 'proud' });
    let st = startHaggle(mulberry32(9), s0);
    expect(st.patience).toBe(2);
    const r = playCard(mulberry32(9), st, 'bluff', s0);
    if ('error' in r) throw new Error(r.error);
    st = r.state;
    expect(st.phase).toBe('sour');
    expect(r.outcome.event).toBe('sour');
    expect(st.bp).toBe(0);
  });

  it('motivation: overstock pushes to sell, shortage to buy', () => {
    const m = createMerchant('fuzz', 'osm:node/1', []);
    m.stock.deepseek = Math.round(m.baseTarget.deepseek * 2);
    expect(motivation(m, 'buy', 'deepseek').need).toBe(1);
    expect(motivation(m, 'sell', 'deepseek').need).toBe(0);
    m.stock.deepseek = 0;
    expect(motivation(m, 'sell', 'deepseek').need).toBe(1);
  });
});
