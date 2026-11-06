// Spawns d'éclats : déterministes par (secret, cellule H3, fenêtre de 10 min). Personnels via catches(user, spawnId).
import { cellToLatLng } from 'h3-js';
import { FAMILIES, type Family } from '../types.ts';
import { poisson, rngFrom, weightedPick } from '../rng.ts';
import { offsetM } from '../geo.ts';
import {
  FAMILY_INFO, RESERVE_SENSITIVE, SPAWN_AFFINITY_MULT, SPAWN_BASE_LAMBDA, SPAWN_LAMBDA_PER_RICHNESS, SPAWN_MAX_PER_CELL,
  SPAWN_RADIUS_IN_CELL_M, SPAWN_WINDOW_MS,
} from './rules.ts';

export interface Spawn { id: string; family: Family; lat: number; lng: number; expiresAt: number }
export interface CellInfo { richness: number; affinities: Family[] }

export const spawnWindow = (now: number): number => Math.floor(now / SPAWN_WINDOW_MS);

/** Poids de chaque famille dans une cellule : base × affinité × santé de la Réserve pour les rares. */
export function familyWeights(affinities: Family[], health: number): Record<Family, number> {
  const w = {} as Record<Family, number>;
  for (const f of FAMILIES) {
    let x = FAMILY_INFO[f].spawnWeight;
    if (affinities.includes(f)) x *= SPAWN_AFFINITY_MULT;
    if (RESERVE_SENSITIVE.includes(f)) x *= health;
    w[f] = x;
  }
  return w;
}

export function spawnLambda(richness: number, mult = 1): number {
  return (SPAWN_BASE_LAMBDA + SPAWN_LAMBDA_PER_RICHNESS * Math.min(6, Math.max(0, richness))) * mult;
}

/** Éclats d'une cellule pour une fenêtre. `mult` = bonus (district gagnant, beacon). */
export function spawnsForCell(secret: string, cell: string, window: number, info: CellInfo, health: number, mult = 1): Spawn[] {
  const rng = rngFrom(secret, 'spawn', cell, window);
  const n = Math.min(SPAWN_MAX_PER_CELL, poisson(rng, spawnLambda(info.richness, mult)));
  const [lat, lng] = cellToLatLng(cell);
  const weights = familyWeights(info.affinities, health);
  const out: Spawn[] = [];
  for (let i = 0; i < n; i++) {
    const family = weightedPick(rng, weights);
    const r = SPAWN_RADIUS_IN_CELL_M * Math.sqrt(rng());
    const a = rng() * 2 * Math.PI;
    const p = offsetM({ lat, lng }, r * Math.cos(a), r * Math.sin(a));
    out.push({ id: `${cell}:${window}:${i}`, family, lat: p.lat, lng: p.lng, expiresAt: (window + 1) * SPAWN_WINDOW_MS });
  }
  return out;
}
