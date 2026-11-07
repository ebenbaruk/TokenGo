// Remote Scout : batterie et plafond de vitesse (fonctions pures, partagées serveur / UI).
// Le serveur est autoritaire : il recalcule la batterie à chaque /api/move et refuse un vol impossible.
import { haversineM, type LatLng } from '../geo.ts';
import { SCOUT } from './rules.ts';

export interface ScoutState {
  battery: number;     // 0..100 (%), valeur à l'instant `at`
  at: number;          // ms epoch
  grounded: boolean;   // batterie vidée : au sol jusqu'à SCOUT.resumeAtPct
}

export const newScout = (now: number): ScoutState => ({ battery: SCOUT.batteryMax, at: now, grounded: false });

/** Recharge continue depuis `s.at` jusqu'à `now` (et fin de l'état « au sol » au seuil de reprise). */
export function scoutCharge(s: ScoutState, now: number): ScoutState {
  const dt = Math.max(0, now - s.at);
  const battery = Math.min(SCOUT.batteryMax, s.battery + (dt / 60_000) * SCOUT.rechargePerMin);
  return { battery, at: Math.max(now, s.at), grounded: s.grounded && battery < SCOUT.resumeAtPct };
}

/** Instant où le Scout pourra repartir (null s'il vole). */
export const scoutResumeAt = (s: ScoutState): number | null =>
  s.grounded ? s.at + Math.ceil(((SCOUT.resumeAtPct - s.battery) / SCOUT.rechargePerMin) * 60_000) : null;

/** Coût en batterie d'un trajet de `m` mètres (Dash : × dashMult). */
export const scoutCost = (m: number, dash: boolean): number =>
  m < SCOUT.freeHopM ? 0 : (m / 1000) * SCOUT.drainPerKm * (dash ? SCOUT.dashMult : 1);

export type ScoutRefusal = 'BATTERY_EMPTY' | 'HOP_TOO_LONG';
export type ScoutVerdict =
  | { ok: true; state: ScoutState; cost: number; dash: boolean; relaunch: boolean }
  | { ok: false; state: ScoutState; code: ScoutRefusal; cost: number };

/**
 * Vol de `last` (dernière position acceptée) vers `to` à l'instant `now`.
 * - Pas de position récente (nouvelle session) : relance libre.
 * - Plus vite que SCOUT.maxKmh = Dash : plus cher, et refusé au-delà de SCOUT.dashMaxM.
 * - Batterie insuffisante : refusé ; sous le seuil de reprise, le Scout est cloué au sol.
 */
export function scoutHop(s: ScoutState, last: (LatLng & { at: number }) | null, to: LatLng, now: number): ScoutVerdict {
  const st = scoutCharge(s, now);
  if (!last || now - last.at > SCOUT.relaunchAfterMs) return { ok: true, state: st, cost: 0, dash: false, relaunch: true };
  const d = haversineM(last, to);
  const dt = Math.max(1, now - last.at);
  const dash = d >= SCOUT.freeHopM && (d / dt) * 3600 > SCOUT.maxKmh;
  if (dash && d > SCOUT.dashMaxM) return { ok: false, state: st, code: 'HOP_TOO_LONG', cost: 0 };
  const cost = scoutCost(d, dash);
  if (cost === 0) return { ok: true, state: st, cost: 0, dash: false, relaunch: false };
  if (st.grounded || cost > st.battery) {
    return { ok: false, state: { ...st, grounded: st.grounded || st.battery < SCOUT.resumeAtPct }, code: 'BATTERY_EMPTY', cost };
  }
  const battery = st.battery - cost;
  return { ok: true, state: { ...st, battery, grounded: battery < 0.5 }, cost, dash, relaunch: false };
}
