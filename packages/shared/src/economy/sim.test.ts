import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FAMILIES } from '../types.ts';
import { PRICING } from './rules.ts';
import { createSim, simulate, withRules, type SimResult, type WorldLike } from './sim.ts';

const world = JSON.parse(readFileSync(new URL('../../../../data/world/paris.json', import.meta.url), 'utf8')) as WorldLike;

const finite = (x: number) => Number.isFinite(x);

describe('economy simulator', () => {
  it('is deterministic: same seed → identical result', () => {
    const a = simulate({ world, days: 2, players: 60, seed: 7 });
    const b = simulate({ world, days: 2, players: 60, seed: 7 });
    expect(b).toEqual(a);
    const c = simulate({ world, days: 2, players: 60, seed: 8 });
    expect(c.totals).not.toEqual(a.totals);
  });

  it('step-wise API matches simulate()', () => {
    const sim = createSim({ world, days: 1, players: 40, seed: 3 });
    while (!sim.done) sim.step();
    expect(sim.result()).toEqual(simulate({ world, days: 1, players: 40, seed: 3 }));
    expect(sim.snapshot().done).toBe(true);
  });

  let week: SimResult;
  it('7 days × 200 bots runs fast (< 10 s)', () => {
    const t0 = performance.now();
    let snapsOk = true;
    week = simulate({
      world, days: 7, players: 200, seed: 42,
      onProgress: (_, s) => {
        for (const m of s.merchants) if (m.flux < 0 || FAMILIES.some((f) => m.stock[f] < 0 || !Number.isInteger(m.stock[f]))) snapsOk = false;
        for (const b of s.bots) if (b.flux < 0 || b.shards < 0) snapsOk = false;
      },
    });
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(snapsOk).toBe(true);
  });

  it('7 days × 200 bots: no NaN, no price ≤ 0, no negative flux', () => {
    expect(week.series.length).toBe(7 * 24 + 1);
    for (const p of week.series) {
      for (const f of FAMILIES) {
        expect(p.p0[f]).toBeGreaterThan(0);
        expect(finite(p.avgMid[f]) && finite(p.medianMid[f])).toBe(true);
        if (p.closed < week.merchants) expect(p.avgMid[f]).toBeGreaterThan(0);
      }
      expect(p.fluxPlayers).toBeGreaterThanOrEqual(0);
      expect(p.fluxMerchants).toBeGreaterThanOrEqual(0);
      expect(p.mainPoolAvail).toBeGreaterThan(0);
      expect(p.open + p.closing + p.closed).toBe(week.merchants);
    }
    for (const v of Object.values(week.totals)) expect(finite(v) && v >= 0).toBe(true);
    for (const h of week.health) expect(finite(h.value)).toBe(true);
    // la poche Main décroît mais ne peut pas tomber à zéro, et le cap global (10 %/jour) tient
    expect(week.totals.payouts).toBeLessThanOrEqual(week.series[0]!.mainPoolAvail * (1 - 0.9 ** 7) + 1);
  });

  it('baseline (seed 42, 7 days): every health check of Docs/03 §8 passes', () => {
    const failed = week.health.filter((h) => !h.pass).map((h) => `${h.name}: ${h.display} (target ${h.target})`);
    expect(failed).toEqual([]);
  });

  it('flood-deepseek: DeepSeek prices fall and merchants struggle', () => {
    const base = simulate({ world, days: 4, players: 200, seed: 11 });
    const flood = simulate({ world, days: 4, players: 200, seed: 11, scenario: 'flood-deepseek' });
    const start = flood.series[24]!; // le flood commence au jour 2
    const end = flood.series[flood.series.length - 1]!;
    expect(end.avgMid.deepseek).toBeLessThan(start.avgMid.deepseek);
    expect(end.p0.deepseek).toBeLessThan(start.p0.deepseek);
    expect(flood.totals.shardsSold).toBeGreaterThan(base.totals.shardsSold);
    const struggling = new Set(flood.events.filter((e) => e.kind === 'closing' && e.merchantName !== flood.seededStruggler).map((e) => e.merchantId));
    expect(struggling.size).toBeGreaterThanOrEqual(1);
  });

  it('reserve-refill raises the Main pool on day 2', () => {
    const r = simulate({ world, days: 2, players: 50, seed: 5, scenario: 'reserve-refill' });
    expect(r.events.some((e) => e.kind === 'reserve-refill' && e.day === 2)).toBe(true);
    expect(r.series[25]!.mainPoolAvail).toBeGreaterThan(r.series[23]!.mainPoolAvail);
  });

  it('rulesOverride applies during the run and is restored afterwards', () => {
    const before = PRICING.alpha;
    const a = simulate({ world, days: 1, players: 30, seed: 2 });
    const b = simulate({ world, days: 1, players: 30, seed: 2, rulesOverride: { PRICING: { alpha: 1.2 } } });
    expect(PRICING.alpha).toBe(before);
    expect(b.series.at(-1)!.avgMid).not.toEqual(a.series.at(-1)!.avgMid);
    expect(() => withRules({ PRICING: { alpha: 9 } }, () => { throw new Error('boom'); })).toThrow('boom');
    expect(PRICING.alpha).toBe(before);
  });
});
