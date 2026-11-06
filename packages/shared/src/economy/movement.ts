// Anti-triche de mouvement (fonctions pures) : transit, sauts suspects, distance d'action, proof of walk.
import { haversineM, type LatLng } from '../geo.ts';
import { ACTION_ACC_BONUS_MAX_M, ACTION_RADIUS_M, MOVE } from './rules.ts';

export interface Fix extends LatLng { acc: number; at: number }
export interface MoveState {
  last: Fix | null;
  recent: Fix[];                 // fixes acceptés des 60 dernières secondes (moyenne glissante)
  walkedM: number;
  suspiciousUntil: number;       // soft-lock des actions
  jumps: number[];               // horodatages des sauts suspects (24 h)
}
export const newMoveState = (): MoveState => ({ last: null, recent: [], walkedM: 0, suspiciousUntil: 0, jumps: [] });

export interface MoveVerdict {
  state: MoveState;
  inTransit: boolean;
  ignored: boolean;              // précision trop faible
  suspicious: boolean;           // saut suspect → soft-lock
  flagged: boolean;              // ≥ 3 sauts en 24 h
  speedKmh: number;
}

const kmh = (m: number, ms: number) => (ms <= 0 ? Infinity : (m / ms) * 3600);

/** Traite une nouvelle position. `demo` : pas de contrôle de vitesse (tap-to-walk, jumps). */
export function applyMove(s: MoveState, fix: Fix, demo: boolean): MoveVerdict {
  const state: MoveState = { ...s, recent: [...s.recent], jumps: s.jumps.filter((t) => fix.at - t < 24 * 3600_000) };
  if (fix.acc > MOVE.ignoreAccuracyAboveM) {
    return { state, inTransit: false, ignored: true, suspicious: false, flagged: false, speedKmh: 0 };
  }
  let suspicious = false;
  let speed = 0;
  if (state.last) {
    const d = haversineM(state.last, fix);
    const dt = fix.at - state.last.at;
    speed = kmh(d, dt);
    if (!demo && speed > MOVE.suspiciousKmh && d > MOVE.suspiciousMinDistM) {
      const plausible = kmh(d, dt) <= MOVE.plausibleReturnKmh;
      if (!plausible) {
        suspicious = true;
        state.suspiciousUntil = fix.at + MOVE.suspiciousCooldownMs;
        state.jumps.push(fix.at);
      }
    }
    if (!demo && speed <= MOVE.walkMaxKmh && fix.acc <= MOVE.walkMaxAccM && dt > 0) {
      // plafond : pas plus que 6 km/h de temps réel crédité (marche rapide)
      state.walkedM += Math.min(d, (dt / 3600_000) * 6000);
    }
  }
  state.last = fix;
  state.recent = [...state.recent.filter((f) => fix.at - f.at <= MOVE.transitWindowMs), fix];
  let inTransit = false;
  if (!demo && state.recent.length >= 2 && !suspicious) {
    const first = state.recent[0]!;
    let dist = 0;
    for (let i = 1; i < state.recent.length; i++) dist += haversineM(state.recent[i - 1]!, state.recent[i]!);
    const span = fix.at - first.at;
    inTransit = span >= 10_000 && kmh(dist, span) > MOVE.transitKmh && kmh(dist, span) <= MOVE.suspiciousKmh;
  }
  if (suspicious) state.recent = [fix];
  return { state, inTransit, ignored: false, suspicious, flagged: state.jumps.length >= MOVE.flagAfterJumpsPerDay, speedKmh: speed };
}

export type ActionTarget = keyof typeof ACTION_RADIUS_M;
/** Distance d'action tolérée : rayon + min(précision, 20 m). */
export const actionRadius = (target: ActionTarget, acc: number): number =>
  ACTION_RADIUS_M[target] + Math.min(Math.max(0, acc), ACTION_ACC_BONUS_MAX_M);

export function canActAt(s: MoveState, target: ActionTarget, at: LatLng, now: number):
  { ok: true; distance: number } | { ok: false; code: 'NO_POSITION' | 'SUSPICIOUS_MOVE' | 'TOO_FAR'; distance?: number } {
  if (!s.last || now - s.last.at > 30_000) return { ok: false, code: 'NO_POSITION' };
  if (now < s.suspiciousUntil) return { ok: false, code: 'SUSPICIOUS_MOVE' };
  const distance = haversineM(s.last, at);
  if (distance > actionRadius(target, s.last.acc)) return { ok: false, code: 'TOO_FAR', distance };
  return { ok: true, distance };
}
