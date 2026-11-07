// Missions du jour (Docs/13 §7) : tirage des 3 missions, progression, réclamation. Fonctions pures ; constantes dans rules.ts.
import type { Rng } from '../rng.ts';
import { MISSION_CATALOG, MISSION_KINDS, MISSIONS, type MissionKind } from './rules.ts';

export interface MissionDrawOpts {
  arenaUnlocked: boolean;   // niveau suffisant pour l'Arène : sinon pas de mission de combat (le Décodage reste possible)
  raidActive: boolean;      // un raid Rogue est en cours : la mission « raid » peut sortir
}

/** Missions éligibles aujourd'hui pour ce joueur. */
export function eligibleMissions(opts: MissionDrawOpts): MissionKind[] {
  return MISSION_KINDS.filter((k) => {
    const n = MISSION_CATALOG[k].needs;
    return !n || (n === 'arena' && opts.arenaUnlocked) || (n === 'raid' && opts.raidActive);
  });
}

/**
 * Tire 3 missions distinctes : la 1re dans le groupe « arena » (Arène / Décodage), les 2 autres dans le reste,
 * en évitant deux missions du même groupe tant que c'est possible (journée variée).
 */
export function drawMissions(rng: Rng, opts: MissionDrawOpts): MissionKind[] {
  const pool = eligibleMissions(opts);
  const take = (from: MissionKind[]): MissionKind => from[Math.floor(rng() * from.length)]!;
  const first = take(pool.filter((k) => MISSION_CATALOG[k].group === 'arena'));
  const out: MissionKind[] = [first];
  while (out.length < MISSIONS.perDay) {
    const left = pool.filter((k) => !out.includes(k));
    const fresh = left.filter((k) => !out.some((o) => MISSION_CATALOG[o].group === MISSION_CATALOG[k].group));
    out.push(take(fresh.length ? fresh : left));
  }
  return out;
}

export interface MissionState { kind: MissionKind; progress: number; goal: number; done: boolean; claimed: boolean }

/** État d'une mission à partir de son compteur du jour (borné à l'objectif). */
export function missionState(kind: MissionKind, count: number, claimed: boolean): MissionState {
  const goal = MISSION_CATALOG[kind].goal;
  const progress = Math.max(0, Math.min(goal, Math.floor(count)));
  return { kind, progress, goal, done: progress >= goal, claimed };
}

export type ClaimCheck = { ok: true; chest: boolean } | { ok: false; error: 'NOT_TODAY' | 'NOT_DONE' | 'ALREADY_CLAIMED' };

/** Peut-on réclamer `kind` ? `chest` = cette réclamation complète les 3 (coffre à verser s'il ne l'a pas été). */
export function checkClaim(missions: readonly MissionState[], kind: MissionKind): ClaimCheck {
  const m = missions.find((x) => x.kind === kind);
  if (!m) return { ok: false, error: 'NOT_TODAY' };
  if (m.claimed) return { ok: false, error: 'ALREADY_CLAIMED' };
  if (!m.done) return { ok: false, error: 'NOT_DONE' };
  return { ok: true, chest: missions.every((x) => x.kind === kind || x.claimed) };
}

/** Récompenses (bornées par MISSIONS) : par mission, et coffre des 3. */
export const missionReward = () => ({ xp: MISSIONS.rewardXp, flux: MISSIONS.rewardFlux });
export const chestReward = () => ({ flux: MISSIONS.chestFlux, shard: MISSIONS.chestShard });

/** Plafond de ce que les missions peuvent verser par jour et par joueur (pour les tests d'invariant). */
export const missionsDailyMax = () => ({
  xp: MISSIONS.perDay * MISSIONS.rewardXp,
  flux: MISSIONS.perDay * MISSIONS.rewardFlux + MISSIONS.chestFlux,
  shards: 1,
});
