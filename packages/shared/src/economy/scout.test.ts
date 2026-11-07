import { describe, expect, it } from 'vitest';
import { offsetM } from '../geo.ts';
import { SCOUT } from './rules.ts';
import { newScout, scoutCharge, scoutCost, scoutHop, scoutResumeAt, type ScoutState } from './scout.ts';

const T0 = Date.parse('2026-11-08T10:00:00Z');
const A = { lat: 48.8611, lng: 2.3358 };
const fix = (p: { lat: number; lng: number }, at: number) => ({ ...p, at });

describe('Remote Scout — batterie', () => {
  it('se recharge en continu, plafonnée à 100 %', () => {
    const s: ScoutState = { battery: 20, at: T0, grounded: false };
    expect(scoutCharge(s, T0 + 60_000).battery).toBeCloseTo(20 + SCOUT.rechargePerMin);
    expect(scoutCharge(s, T0 + 3600_000).battery).toBe(100);
  });

  it('un vol à vitesse de croisière coûte drainPerKm par km', () => {
    const to = offsetM(A, 0, 250); // 250 m en 30 s = 30 km/h
    const v = scoutHop(newScout(T0), fix(A, T0), to, T0 + 30_000);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.dash).toBe(false);
    expect(v.cost).toBeCloseTo(0.25 * SCOUT.drainPerKm, 1);
    expect(v.state.battery).toBeCloseTo(100 - v.cost, 5);
  });

  it('plus vite que le plafond = Dash (× dashMult), refusé au-delà de dashMaxM', () => {
    const to = offsetM(A, 0, 1000);
    const v = scoutHop(newScout(T0), fix(A, T0), to, T0 + 3000);
    expect(v.ok && v.dash).toBe(true);
    if (v.ok) expect(v.cost).toBeCloseTo(SCOUT.drainPerKm * SCOUT.dashMult, 0);
    const far = scoutHop(newScout(T0), fix(A, T0), offsetM(A, 0, SCOUT.dashMaxM + 200), T0 + 3000);
    expect(far).toMatchObject({ ok: false, code: 'HOP_TOO_LONG' });
  });

  it("tremblote et position identique : gratuit", () => {
    const v = scoutHop({ battery: 0, at: T0, grounded: true }, fix(A, T0), offsetM(A, 1, 1), T0 + 1000);
    expect(v).toMatchObject({ ok: true, cost: 0 });
  });

  it('se vide, cloue le Scout au sol, puis repart au seuil de reprise', () => {
    let s = newScout(T0);
    let at = T0;
    let p = A;
    let last = fix(A, at);
    let refused = 0;
    // vole en ligne droite à 30 km/h (25 m / 3 s) jusqu'au refus
    for (let i = 0; i < 2000 && !refused; i++) {
      at += 3000;
      const to = offsetM(p, 25, 0);
      const v = scoutHop(s, last, to, at);
      s = v.state;
      if (!v.ok) { refused++; expect(v.code).toBe('BATTERY_EMPTY'); break; }
      p = to;
      last = fix(to, at);
    }
    expect(refused).toBe(1);
    expect(s.grounded).toBe(true);
    // pas de petit saut « gratuit » pendant la recharge : toujours au sol sous le seuil
    const resume = scoutResumeAt(s)!;
    expect(resume).toBeGreaterThan(at);
    expect(scoutHop(s, last, offsetM(p, 25, 0), resume - 2000)).toMatchObject({ ok: false, code: 'BATTERY_EMPTY' });
    const again = scoutHop(s, last, offsetM(p, 25, 0), resume + 1000);
    expect(again.ok).toBe(true);
    expect(again.state.grounded).toBe(false);
    // vol continu depuis le plein : ~14 min (boucle de démo de 5–10 min confortable)
    const minutes = (at - T0) / 60_000;
    expect(minutes).toBeGreaterThan(10);
    expect(minutes).toBeLessThan(20);
  });

  it("un Dash trop cher est refusé sans clouer au sol si la batterie n'est pas vide", () => {
    const s: ScoutState = { battery: 30, at: T0, grounded: false };
    const v = scoutHop(s, fix(A, T0), offsetM(A, 0, 1000), T0 + 3000);
    expect(v).toMatchObject({ ok: false, code: 'BATTERY_EMPTY' });
    expect(v.state.grounded).toBe(false);
  });

  it('relance libre sans position récente (nouvelle session)', () => {
    const far = { lat: 38.71, lng: -9.13 };
    expect(scoutHop(newScout(T0), null, far, T0)).toMatchObject({ ok: true, relaunch: true, cost: 0 });
    expect(scoutHop(newScout(T0), fix(A, T0), far, T0 + SCOUT.relaunchAfterMs + 1)).toMatchObject({ ok: true, relaunch: true });
    expect(scoutHop(newScout(T0), fix(A, T0), far, T0 + 60_000)).toMatchObject({ ok: false, code: 'HOP_TOO_LONG' });
  });

  it('coût nul sous freeHopM', () => {
    expect(scoutCost(SCOUT.freeHopM - 0.1, true)).toBe(0);
  });
});
