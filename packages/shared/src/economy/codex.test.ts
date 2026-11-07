// Codex (variantes) et Daily Route : tirages déterministes, priorités, bornes, indépendance à la ville.
import { describe, expect, it } from 'vitest';
import { mulberry32, rngFrom } from '../rng.ts';
import { haversineM } from '../geo.ts';
import { CODEX, DAILY_ROUTE, VARIANTS } from './rules.ts';
import { CODEX_SIZE, codexSummary, isNight, newTitle, placeShort, rollVariant, solarHour, variantName } from './codex.ts';
import { dailyRoute, routeLengthM, routeReward, routeStreak, type RouteCandidate } from './route.ts';
import { FAMILIES } from '../types.ts';

const fixed = (x: number) => () => x;

describe('variant rolls', () => {
  it('priority: shiny > overclocked > landmark > night > classic', () => {
    const base = { perfect: true, combo: 5, solarHour: 23, nearLandmark: true };
    expect(rollVariant({ ...base, rng: fixed(0) })).toBe('shiny');
    expect(rollVariant({ ...base, rng: fixed(0.5) })).toBe('overclocked');
    expect(rollVariant({ ...base, perfect: false, rng: fixed(0.5) })).toBe('landmark');
    expect(rollVariant({ ...base, combo: 2, rng: fixed(0.5) })).toBe('landmark');
    expect(rollVariant({ ...base, perfect: false, nearLandmark: false, rng: fixed(0.5) })).toBe('night');
    expect(rollVariant({ ...base, perfect: false, nearLandmark: false, solarHour: 12, rng: fixed(0.5) })).toBe('classic');
  });

  it('consumes exactly one draw and is deterministic for a seed', () => {
    let calls = 0;
    const rng = () => { calls++; return 0.9; };
    rollVariant({ rng, perfect: false, combo: 1, solarHour: 12, nearLandmark: false });
    expect(calls).toBe(1);
    const a = rollVariant({ rng: rngFrom('s', 'variant', 'u1', 'cell:1:0'), perfect: false, combo: 1, solarHour: 12, nearLandmark: false });
    const b = rollVariant({ rng: rngFrom('s', 'variant', 'u1', 'cell:1:0'), perfect: false, combo: 1, solarHour: 12, nearLandmark: false });
    expect(a).toBe(b);
  });

  it('shiny rate ≈ 1/40 over 20 000 seeded draws', () => {
    const rng = mulberry32(42);
    let shiny = 0;
    for (let i = 0; i < 20_000; i++) if (rollVariant({ rng, perfect: false, combo: 1, solarHour: 12, nearLandmark: false }) === 'shiny') shiny++;
    expect(shiny / 20_000).toBeGreaterThan(CODEX.shinyChance * 0.8);
    expect(shiny / 20_000).toBeLessThan(CODEX.shinyChance * 1.2);
  });

  it('solar hour follows longitude (any city), night is 21h–6h', () => {
    const noonUtc = Date.parse('2026-11-08T12:00:00Z');
    expect(solarHour(noonUtc, 0)).toBeCloseTo(12);
    expect(solarHour(noonUtc, 135)).toBeCloseTo(21); // Tokyo-ish : 21 h solaire
    expect(solarHour(noonUtc, -150)).toBeCloseTo(2);
    expect(isNight(21)).toBe(true);
    expect(isNight(5.9)).toBe(true);
    expect(isNight(6)).toBe(false);
    expect(isNight(20.9)).toBe(false);
  });

  it('names and places', () => {
    expect(variantName('claude', 'landmark', 'Louvre')).toBe('Louvre Claude');
    expect(variantName('gpt', 'shiny')).toBe('Shiny GPT');
    expect(variantName('deepseek', 'classic')).toBe('DeepSeek');
    expect(placeShort('Louvre — Pyramide')).toBe('Louvre');
    expect(placeShort('Station F')).toBe('Station F');
  });
});

describe('codex summary', () => {
  it('counts unique cells, ignores junk, unlocks titles', () => {
    expect(CODEX_SIZE).toBe(FAMILIES.length * VARIANTS.length);
    const s = codexSummary([
      { family: 'deepseek', variant: 'classic' }, { family: 'deepseek', variant: 'classic' },
      { family: 'qwen', variant: 'night' }, { family: 'claude', variant: 'shiny' },
      { family: 'nope' as 'qwen', variant: 'classic' },
    ]);
    expect(s.found).toBe(3);
    expect(s.pct).toBe(12);
    expect(s.byFamily.deepseek).toBe(1);
    expect(s.title).toBe('Shard Spotter');
    expect(newTitle(2, 3)).toBe('Shard Spotter');
    expect(newTitle(3, 4)).toBeNull();
    const all = codexSummary(FAMILIES.flatMap((family) => VARIANTS.map((variant) => ({ family, variant }))));
    expect(all.pct).toBe(100);
    expect(all.title).toBe('City Archivist');
  });
});

// ───── Daily Route ─────
/** Grille synthétique de lieux autour d'un centre quelconque (pas de Paris) : la route doit marcher partout. */
function grid(center: { lat: number; lng: number }, n = 9, stepM = 150): RouteCandidate[] {
  const out: RouteCandidate[] = [];
  const kinds = ['relay', 'relay', 'market', 'relay', 'forge'] as const;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const dx = (i - (n - 1) / 2) * stepM;
    const dy = (j - (n - 1) / 2) * stepM;
    out.push({
      id: `n${i}-${j}`, kind: kinds[(i * n + j) % kinds.length]!, name: `Place ${i}-${j}`,
      lat: center.lat + dy / 110_540, lng: center.lng + dx / (111_320 * Math.cos((center.lat * Math.PI) / 180)),
    });
  }
  return out;
}

describe('daily route', () => {
  const tokyo = { lat: 35.6595, lng: 139.7005 };
  const cands = grid(tokyo);

  it('is deterministic for (day, anchor) and independent of candidate order', () => {
    const a = dailyRoute('secret', '2026-11-08', 'anchor-1', tokyo, cands);
    const b = dailyRoute('secret', '2026-11-08', 'anchor-1', tokyo, [...cands].reverse());
    expect(a).not.toBeNull();
    expect(b!.map((s) => s.id)).toEqual(a!.map((s) => s.id));
  });

  it('changes with the day', () => {
    const days = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'].map((d) => dailyRoute('secret', d, 'anchor-1', tokyo, cands)!.map((s) => s.id).join());
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it('respects bounds: 3–5 stops, in radius, spaced, ≥ 1 market & relay, ≤ 1 forge', () => {
    for (let k = 0; k < 60; k++) {
      const r = dailyRoute('secret', `2026-12-${String((k % 28) + 1).padStart(2, '0')}`, `a${k}`, tokyo, cands)!;
      expect(r.length).toBeGreaterThanOrEqual(DAILY_ROUTE.stopsMin);
      expect(r.length).toBeLessThanOrEqual(DAILY_ROUTE.stopsMax);
      for (const s of r) expect(haversineM(tokyo, s)).toBeLessThanOrEqual(DAILY_ROUTE.radiusM);
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) expect(haversineM(r[i]!, r[j]!)).toBeGreaterThanOrEqual(DAILY_ROUTE.minSpacingM);
      expect(r.some((s) => s.kind === 'market')).toBe(true);
      expect(r.some((s) => s.kind === 'relay')).toBe(true);
      expect(r.filter((s) => s.kind === 'forge').length).toBeLessThanOrEqual(1);
      expect(routeLengthM(tokyo, r)).toBeLessThan(5000);
    }
  });

  it('returns null where the world is too empty', () => {
    expect(dailyRoute('secret', '2026-11-08', 'x', tokyo, cands.slice(0, 1))).toBeNull();
    expect(dailyRoute('secret', '2026-11-08', 'x', { lat: 0, lng: 0 }, cands)).toBeNull();
  });

  it('streak counts consecutive days ending today or yesterday', () => {
    expect(routeStreak([], '2026-11-08')).toBe(0);
    expect(routeStreak(['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-04'], '2026-11-08')).toBe(3);
    expect(routeStreak(['2026-11-07', '2026-11-06'], '2026-11-08')).toBe(2);
    expect(routeStreak(['2026-11-06'], '2026-11-08')).toBe(0);
    expect(routeStreak(['2026-03-01', '2026-02-28'], '2026-03-01')).toBe(2);
  });

  it('reward is bounded by the rules', () => {
    expect(routeReward(1)).toEqual({ xp: 200, flux: 60, shard: 'gemini' });
    expect(routeReward(2).flux).toBe(70);
    expect(routeReward(365).flux).toBe(DAILY_ROUTE.rewardFlux + DAILY_ROUTE.streakFluxMax);
  });
});
