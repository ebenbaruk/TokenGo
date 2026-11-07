// Événements de ville : bornes, effets prix (passant par explainPrice/quote), grève, vague bonus, tirage déterministe.
import { describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { FAMILIES } from '../types.ts';
import {
  CITY_EVENT, CITY_EVENTS, EVENT_ZONES, H3_RES, SPAWN_WINDOW_MS, applyTrade, createMerchant, drawCityEvent, eventGapMs, eventPriceEffect,
  eventSpawnsForCell, eventStrikes, eventTitle, eventEffectText, explainPrice, initialP0, makeCityEvent, quote, type Quote,
} from './index.ts';
import { offsetM } from '../geo.ts';

const SECRET = 'test-secret';
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const louvre = EVENT_ZONES.find((z) => z.id === 'louvre')!;
const p0 = initialP0();
const m = { ...createMerchant(SECRET, 'osm:node/1', ['gpt']), flux: 1e6 };

describe('city events: bounded definitions', () => {
  it('every rule stays inside the hard bounds of CITY_EVENT', () => {
    for (const r of Object.values(CITY_EVENTS)) {
      if (r.priceMult !== undefined) {
        expect(r.priceMult).toBeGreaterThanOrEqual(CITY_EVENT.priceMultMin);
        expect(r.priceMult).toBeLessThanOrEqual(CITY_EVENT.priceMultMax);
      }
      if (r.extraSpawnChance !== undefined) expect(r.extraSpawnChance).toBeLessThanOrEqual(CITY_EVENT.extraSpawnMax);
      expect(r.durationMs).toBeLessThanOrEqual(CITY_EVENT.durationMaxMs);
    }
  });

  it('makeCityEvent clamps duration and rejects a family the rule does not allow', () => {
    const e = makeCityEvent(1, { kind: 'flash_crash', family: 'claude', zone: 'louvre', startsAt: T0, durationMs: 10 * 3600_000 });
    expect(e.family).toBe('deepseek'); // Claude n'est pas « crashable » : repli sur la 1re famille autorisée
    expect(e.endsAt - e.startsAt).toBe(CITY_EVENT.durationMaxMs);
    expect(e.priceMult).toBe(0.6);
    expect(() => makeCityEvent(2, { kind: 'nope' as never, zone: 'louvre', startsAt: T0 })).toThrow();
    expect(makeCityEvent(3, { kind: 'strike', zone: 'opera', startsAt: T0 }).family).toBeNull();
  });

  it('draws are deterministic and gaps stay within 2–4 h', () => {
    expect(drawCityEvent(SECRET, 7, T0)).toEqual(drawCityEvent(SECRET, 7, T0));
    const kinds = new Set(Array.from({ length: 60 }, (_, i) => drawCityEvent(SECRET, i, T0).kind));
    expect(kinds.size).toBe(4);
    for (let i = 0; i < 50; i++) {
      const g = eventGapMs(SECRET, i);
      expect(g).toBeGreaterThanOrEqual(CITY_EVENT.gapMinMs);
      expect(g).toBeLessThanOrEqual(CITY_EVENT.gapMaxMs);
    }
    expect(eventTitle({ kind: 'flash_crash', zoneName: 'Châtelet' })).toBe('Flash crash at Châtelet');
    expect(eventEffectText({ kind: 'flash_crash', family: 'deepseek', priceMult: 0.6 })).toBe('DeepSeek prices −40%');
  });
});

describe('city events: price effects flow through explainPrice / quote', () => {
  const crash = makeCityEvent(1, { kind: 'flash_crash', family: 'deepseek', zone: 'louvre', startsAt: T0 });
  const inside = offsetM(louvre, 100, 0);
  const outside = offsetM(louvre, 2000, 0);

  it('applies only to that family, inside the zone, while active', () => {
    expect(eventPriceEffect(crash, 'deepseek', inside, T0 + 60_000)).toEqual({ label: 'Flash crash at the Louvre', mult: 0.6 });
    expect(eventPriceEffect(crash, 'qwen', inside, T0 + 60_000)).toBeNull();
    expect(eventPriceEffect(crash, 'deepseek', outside, T0 + 60_000)).toBeNull();
    expect(eventPriceEffect(crash, 'deepseek', inside, crash.endsAt)).toBeNull();
    expect(eventPriceEffect(crash, 'deepseek', inside, T0 - 1)).toBeNull();
  });

  it('crash lowers both prices by ~40 % and the explanation names the event', () => {
    const event = eventPriceEffect(crash, 'deepseek', inside, T0 + 1)!;
    const base = explainPrice(p0.deepseek, m, 'deepseek');
    const ev = explainPrice(p0.deepseek, m, 'deepseek', { event });
    expect(ev.event).toEqual({ label: 'Flash crash at the Louvre', mult: 0.6 });
    expect(ev.p0).toBe(base.p0); // P0 affiché = avant l'événement
    expect(ev.sell!).toBeLessThan(base.sell! * 0.7);
    expect(ev.buy!).toBeLessThan(base.buy! * 0.7);
  });

  it('anti round-trip still holds during an event (buy then sell back always loses)', () => {
    for (const kind of ['flash_crash', 'hype'] as const) {
      for (const f of FAMILIES) {
        const e = makeCityEvent(1, { kind, family: f, zone: 'louvre', startsAt: T0 });
        const event = eventPriceEffect(e, f, inside, T0 + 1);
        const opts = event ? { event } : {};
        const b = quote(p0[f], m, 'buy', f, 2, opts) as Quote;
        const back = quote(p0[f], applyTrade(m, b, T0), 'sell', f, 2, opts) as Quote;
        expect(back.total).toBeLessThan(b.total);
      }
    }
  });

  it('strike: merchants in the zone buy but do not sell', () => {
    const strike = makeCityEvent(2, { kind: 'strike', zone: 'louvre', startsAt: T0 });
    const on = eventStrikes(strike, inside, T0 + 1);
    expect(on).toBe(true);
    expect(eventStrikes(strike, outside, T0 + 1)).toBe(false);
    expect(quote(p0.qwen, m, 'buy', 'qwen', 1, { strike: on })).toEqual({ error: 'STRIKE' });
    expect('error' in quote(p0.qwen, m, 'sell', 'qwen', 1, { strike: on })).toBe(false);
    const e = explainPrice(p0.qwen, m, 'qwen', { strike: on });
    expect(e.sell).toBeNull();
    expect(e.sellBlocked).toBe('strike');
    expect(e.buy).not.toBeNull();
  });
});

describe('city events: gold rush bonus wave', () => {
  const rush = makeCityEvent(5, { kind: 'gold_rush', family: 'claude', zone: 'louvre', startsAt: T0 });
  const w = Math.floor((T0 + 60_000) / SPAWN_WINDOW_MS);
  const cellsIn = Array.from({ length: 40 }, (_, i) => latLngToCell(offsetM(louvre, (i % 8) * 70 - 250, Math.floor(i / 8) * 70 - 150).lat, offsetM(louvre, (i % 8) * 70 - 250, 0).lng, H3_RES));

  it('spawns only the rush family, with distinct ids, inside the zone and only during the event', () => {
    const all = [...new Set(cellsIn)].flatMap((c) => eventSpawnsForCell(SECRET, rush, c, w));
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.family).toBe('claude');
      expect(s.id).toMatch(/:e5$/);
      expect(s.expiresAt).toBeLessThanOrEqual(rush.endsAt);
    }
    const far = latLngToCell(48.89, 2.25, H3_RES);
    expect(eventSpawnsForCell(SECRET, rush, far, w)).toEqual([]);
    expect([...new Set(cellsIn)].flatMap((c) => eventSpawnsForCell(SECRET, rush, c, Math.floor(rush.endsAt / SPAWN_WINDOW_MS) + 1))).toEqual([]);
    // déterministe : le serveur peut recalculer l'éclat à partir de son id
    expect(eventSpawnsForCell(SECRET, rush, cellsIn[0]!, w)).toEqual(eventSpawnsForCell(SECRET, rush, cellsIn[0]!, w));
  });
});
