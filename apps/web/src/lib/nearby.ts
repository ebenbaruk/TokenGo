// Choix de l'action contextuelle (gros bouton) : la chose actionnable la plus proche dans son rayon,
// sinon la plus proche tout court avec la raison (« 47 m away — get a bit closer »).
import { ACTION_RADIUS_M, ACTION_ACC_BONUS_MAX_M, haversineM, type NodeView, type SpawnView, type WorldResponse } from '@tokengo/shared';
import type { Pos } from './store.ts';
import { fmtCountdown } from './format.ts';

export type Target =
  | { kind: 'spawn'; spawn: SpawnView; dist: number; radius: number }
  | { kind: 'relay' | 'market' | 'forge'; node: NodeView; dist: number; radius: number };

export interface Contextual {
  label: string;
  target: Target | null;
  inRange: boolean;
  reason: string | null;
}

const LABEL = { spawn: 'Catch', relay: 'Sync', market: 'Trade', forge: 'Compile' } as const;

export function radiusFor(kind: keyof typeof ACTION_RADIUS_M, pos: Pos): number {
  return ACTION_RADIUS_M[kind] + Math.min(pos.acc, ACTION_ACC_BONUS_MAX_M);
}

export function contextual(world: WorldResponse | null, pos: Pos | null, hidden: string[], inTransit: boolean): Contextual {
  if (!pos) return { label: 'Catch', target: null, inRange: false, reason: 'Finding you on the map…' };
  if (!world) return { label: 'Catch', target: null, inRange: false, reason: 'Loading the city…' };
  const now = Date.now();
  const hide = new Set(hidden);
  const targets: Target[] = [];
  for (const sp of world.spawns) {
    if (hide.has(sp.id) || sp.expiresAt <= now) continue;
    targets.push({ kind: 'spawn', spawn: sp, dist: haversineM(pos, sp), radius: radiusFor('spawn', pos) });
  }
  for (const n of world.nodes) {
    if (n.kind === 'relay' && (n.cooldownUntil ?? 0) > now) continue;
    targets.push({ kind: n.kind, node: n, dist: haversineM(pos, n), radius: radiusFor(n.kind, pos) });
  }
  if (targets.length === 0) return { label: 'Catch', target: null, inRange: false, reason: 'Nothing around — take a walk!' };
  // priorité dans le rayon : éclat > relais > marché > forge (le plus fugace d'abord), puis distance
  const prio = { spawn: 0, relay: 1, market: 2, forge: 3 };
  const inRange = targets.filter((t) => t.dist <= t.radius).sort((a, b) => prio[a.kind] - prio[b.kind] || a.dist - b.dist);
  if (inRange.length) {
    const t = inRange[0]!;
    if (inTransit && (t.kind === 'spawn' || t.kind === 'relay')) return { label: LABEL[t.kind], target: t, inRange: false, reason: 'In transit — catching paused' };
    return { label: LABEL[t.kind], target: t, inRange: true, reason: null };
  }
  // hors de portée : la cible de l'objectif en cours d'abord (le bouton et la barre d'objectif disent la même chose)
  const focus = world.objective?.target;
  const onFocus = focus ? targets.filter((x) => haversineM(focus, x.kind === 'spawn' ? x.spawn : x.node) < 25) : [];
  const t = (onFocus.length ? onFocus : targets).sort((a, b) => (a.dist - a.radius) - (b.dist - b.radius))[0]!;
  const away = Math.round(t.dist);
  return { label: LABEL[t.kind], target: t, inRange: false, reason: `${away} m away — get a bit closer` };
}

export function relayStatus(n: NodeView, now = Date.now()): string | null {
  const cd = (n.cooldownUntil ?? 0) - now;
  return cd > 0 ? `Relay recharging · ${fmtCountdown(cd)}` : null;
}
