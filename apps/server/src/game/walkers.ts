// Marcheurs visibles sur la carte : runners-agents (trajet exact) + joueurs réels (anonymisés : cellule H3 + décalage, sans nom).
import { gridDisk } from 'h3-js';
import { LIVING, anonymisedPosition, haversineM, legPosition, type WalkerView, type WalkersResponse } from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { cellOf } from './world.ts';
import { liveRunners, type RunnerState } from './runners.ts';
import { sha256hex } from './crypto.ts';
import { getUser, moveStateOf } from './players.ts';

const NOTE_FRESH_MS = 10 * 60_000;
const hash = (s: string) => parseInt(sha256hex(s).slice(0, 8), 16);

/** Étiquette d'un runner : sa dernière action récente, sinon où il va. */
function runnerNote(ctx: Ctx, st: RunnerState, now: number): string {
  if (st.note && now - st.note.at < NOTE_FRESH_MS) return `just ${st.note.text}`;
  if (st.intent === 'catch') return 'chasing a shard';
  const to = ctx.world.byId.get(st.to.nodeId);
  if (!to) return 'out for a walk';
  if (now >= st.arriveAt) return `at ${to.name}`;
  return `heading to ${to.name}`;
}

/** Joueurs réels vus dans les 3 dernières minutes autour de (lat, lng), hors `exceptUserId`. Jamais leur position exacte. */
export function playersNear(ctx: Ctx, exceptUserId: string | null, lat: number, lng: number, radiusM: number = LIVING.walkersRadiusM): WalkerView[] {
  const now = ctx.now();
  const cells = gridDisk(cellOf(lat, lng), Math.ceil(radiusM / 300) + 1);
  const rows = ctx.db.prepare(`SELECT id, seen_cell, seen_at FROM users WHERE is_agent = 0 AND deleted_at IS NULL AND seen_at > ?
    AND seen_cell IN (${cells.map(() => '?').join(',')}) ORDER BY seen_at DESC LIMIT 50`)
    .all(now - LIVING.playerSeenMs, ...cells) as { id: string; seen_cell: string; seen_at: number }[];
  const slot = Math.floor(now / LIVING.privacyWindowMs);
  const out: (WalkerView & { d: number })[] = [];
  for (const r of rows) {
    if (r.id === exceptUserId) continue;
    const p = anonymisedPosition(ctx.cfg.SESSION_SECRET, r.id, r.seen_cell, now);
    const d = haversineM({ lat, lng }, p);
    if (d > radiusM) continue;
    // id opaque, change toutes les 10 min : impossible de relier un marcheur à un compte ni de suivre son trajet de la journée
    out.push({ id: `p_${sha256hex(`${ctx.cfg.SESSION_SECRET}:walker:${r.id}:${slot}`).slice(0, 12)}`, kind: 'player', name: null, from: p, to: p,
      departAt: now, arriveAt: now, note: null, variant: 4, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, LIVING.playersMax).map(({ d: _d, ...w }) => w);
}

export function runnersNear(ctx: Ctx, lat: number, lng: number, radiusM: number = LIVING.walkersRadiusM): WalkerView[] {
  const now = ctx.now();
  const out: (WalkerView & { d: number })[] = [];
  for (const r of liveRunners(ctx)) {
    const p = legPosition(r.st, now);
    const d = haversineM({ lat, lng }, p);
    if (d > radiusM) continue;
    out.push({
      id: r.user_id, kind: 'runner', name: r.handle.replace(/^Runner·/, ''),
      from: { lat: r.st.from.lat, lng: r.st.from.lng }, to: { lat: r.st.to.lat, lng: r.st.to.lng },
      departAt: r.st.departAt, arriveAt: r.st.arriveAt, note: runnerNote(ctx, r.st, now), variant: hash(r.user_id) % 4, d,
    });
  }
  return out.sort((a, b) => a.d - b.d).map(({ d: _d, ...w }) => w);
}

/** GET /api/walkers : au plus 12 marcheurs (dont 5 joueurs réels au plus), les plus proches d'abord. */
export function walkersNear(ctx: Ctx, userId: string | null, lat: number, lng: number): WalkersResponse {
  // joueurs réels : seulement autour de la position serveur récente du demandeur (pas d'espionnage à distance par lat/lng)
  const u = userId ? getUser(ctx, userId) : undefined;
  const last = u ? moveStateOf(u).last : null;
  const here = !!last && ctx.now() - last.at <= LIVING.playerSeenMs && haversineM(last, { lat, lng }) <= LIVING.walkersRadiusM;
  const players = here ? playersNear(ctx, userId, last!.lat, last!.lng) : [];
  const runners = runnersNear(ctx, lat, lng).slice(0, LIVING.walkersMax - players.length);
  return { now: ctx.now(), walkers: [...runners, ...players] };
}

/** Compteurs pour le Pulse. */
export function walkerCounts(ctx: Ctx): { runners: number; players: number } {
  const now = ctx.now();
  const players = (ctx.db.prepare('SELECT COUNT(*) n FROM users WHERE is_agent = 0 AND deleted_at IS NULL AND seen_at > ?').get(now - LIVING.playerSeenMs) as { n: number }).n;
  return { runners: liveRunners(ctx).length, players };
}
