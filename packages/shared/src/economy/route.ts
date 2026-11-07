// Daily Route : choix déterministe des arrêts du jour et série de jours (fonctions pures, indépendantes de la ville).
import type { NodeKind } from '../types.ts';
import { haversineM, type LatLng } from '../geo.ts';
import { randInt, rngFrom } from '../rng.ts';
import { DAILY_ROUTE } from './rules.ts';

export interface RouteCandidate extends LatLng { id: string; kind: NodeKind; name: string }

/**
 * Arrêts de la route du jour autour de `center` (centre du quartier), parmi des nœuds génériques du monde.
 * Même (secret, jour, ancre) ⇒ même route, quel que soit l'ordre des candidats. null s'il n'y a pas assez de lieux.
 * Au moins un marchand et un relais quand il y en a ; une forge au plus ; arrêts espacés ;
 * ordre = plus proche voisin depuis le centre (boucle).
 */
export function dailyRoute(secret: string, day: string, anchor: string, center: LatLng, candidates: RouteCandidate[]): RouteCandidate[] | null {
  const pool = candidates
    .filter((c) => haversineM(center, c) <= DAILY_ROUTE.radiusM)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rng = rngFrom(secret, 'route', day, anchor);
  const want = randInt(rng, DAILY_ROUTE.stopsMin, DAILY_ROUTE.stopsMax);
  for (let i = pool.length - 1; i > 0; i--) { // mélange déterministe (Fisher-Yates)
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const picked: RouteCandidate[] = [];
  const fits = (c: RouteCandidate) => picked.every((p) => p.id !== c.id && haversineM(p, c) >= DAILY_ROUTE.minSpacingM)
    && !(c.kind === 'forge' && picked.some((p) => p.kind === 'forge'));
  const take = (kind: NodeKind) => {
    const c = pool.find((x) => x.kind === kind && fits(x));
    if (c) picked.push(c);
  };
  take('market');
  take('relay');
  for (const c of pool) {
    if (picked.length >= want) break;
    if (fits(c)) picked.push(c);
  }
  if (picked.length < DAILY_ROUTE.stopsMin) return null;
  const out: RouteCandidate[] = [];
  let cur: LatLng = center;
  const left = [...picked];
  while (left.length) {
    left.sort((a, b) => haversineM(cur, a) - haversineM(cur, b));
    const next = left.shift()!;
    out.push(next);
    cur = next;
  }
  return out;
}

/** Longueur de la boucle centre → arrêts → centre (m). */
export const routeLengthM = (center: LatLng, stops: LatLng[]): number => {
  const pts = [center, ...stops, center];
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversineM(pts[i - 1]!, pts[i]!);
  return d;
};

const prevDay = (day: string): string => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Série : jours consécutifs terminés, en finissant aujourd'hui (ou hier si aujourd'hui n'est pas encore fait). */
export function routeStreak(completedDays: string[], today: string): number {
  const set = new Set(completedDays);
  let d = set.has(today) ? today : prevDay(today);
  let n = 0;
  while (set.has(d)) { n++; d = prevDay(d); }
  return n;
}

/** Récompense de fin de route (bornée par DAILY_ROUTE) ; `streak` = série en comptant aujourd'hui. */
export function routeReward(streak: number): { xp: number; flux: number; shard: typeof DAILY_ROUTE.rewardShard } {
  const bonus = Math.min(DAILY_ROUTE.streakFluxMax, DAILY_ROUTE.streakFluxPerDay * Math.max(0, streak - 1));
  return { xp: DAILY_ROUTE.rewardXp, flux: DAILY_ROUTE.rewardFlux + bonus, shard: DAILY_ROUTE.rewardShard };
}
