// Codex (variantes cosmétiques des captures) et Daily Route. Tout est décidé ici, côté serveur ;
// les tirages et la sélection des arrêts sont des fonctions pures de packages/shared (codex.ts, route.ts).
import { cellToLatLng, latLngToCell } from 'h3-js';
import {
  ACTION_ACC_BONUS_MAX_M, ACTION_RADIUS_M, CODEX, DAILY_ROUTE, FAMILIES, VARIANTS, VARIANT_HINT, codexSummary, dailyRoute, haversineM,
  newTitle, placeShort, rngFrom, rollVariant, routeLengthM, routeReward, routeStreak, shardToken, solarHour, variantName,
  type CatchCodex, type CodexView, type DailyRouteView, type Family, type LatLng, type RouteCandidate, type RouteCheckin, type SpawnView,
  type Variant,
} from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { addXp, credit, meView, type UserRow } from './players.ts';
import { nodesNear } from './world.ts';
import { parisDay } from './reserve.ts';

// ───── Codex ─────

/** Monument (Forge) le plus proche à ≤ CODEX.landmarkRadiusM, sinon null. */
function landmarkNear(ctx: Ctx, p: LatLng): string | null {
  let best: { d: number; name: string } | null = null;
  for (const f of ctx.world.forges) {
    const d = haversineM(p, f);
    if (d <= CODEX.landmarkRadiusM && (!best || d < best.d)) best = { d, name: f.name };
  }
  return best ? placeShort(best.name) : null;
}

const codexRows = (ctx: Ctx, userId: string) =>
  ctx.db.prepare('SELECT family, variant, first_at, count, place FROM codex WHERE user_id = ?').all(userId) as
    { family: Family; variant: Variant; first_at: number; count: number; place: string | null }[];

/**
 * Tire et enregistre la variante d'une capture réussie (à appeler dans la transaction de la capture).
 * Cosmétique : l'inventaire reste `shard:<famille>` ; seule une petite XP de découverte (une fois par case) est créditée.
 */
export function recordCatchVariant(ctx: Ctx, userId: string, spawn: SpawnView, perfect: boolean, combo: number, now: number, shinyMult = 1): CatchCodex {
  const isTut = spawn.id.startsWith('tut:');
  const place = landmarkNear(ctx, spawn);
  const variant: Variant = isTut ? 'classic' : rollVariant({
    rng: rngFrom(ctx.cfg.SPAWN_SECRET, 'variant', userId, spawn.id),
    perfect, combo, solarHour: solarHour(now, spawn.lng), nearLandmark: place !== null, shinyMult,
  });
  const before = (ctx.db.prepare('SELECT COUNT(*) n FROM codex WHERE user_id = ?').get(userId) as { n: number }).n;
  const prev = ctx.db.prepare('SELECT place FROM codex WHERE user_id = ? AND family = ? AND variant = ?').get(userId, spawn.family, variant) as { place: string | null } | undefined;
  if (prev) ctx.db.prepare('UPDATE codex SET count = count + 1 WHERE user_id = ? AND family = ? AND variant = ?').run(userId, spawn.family, variant);
  else ctx.db.prepare('INSERT INTO codex (user_id, family, variant, first_at, count, place) VALUES (?, ?, ?, ?, 1, ?)')
    .run(userId, spawn.family, variant, now, variant === 'landmark' ? place : null);
  ctx.db.prepare('UPDATE catches SET variant = ? WHERE user_id = ? AND spawn_id = ?').run(variant, userId, spawn.id);
  const isNew = !prev;
  const found = before + (isNew ? 1 : 0);
  const shownPlace = variant === 'landmark' ? place : null;
  return {
    variant, name: variantName(spawn.family, variant, shownPlace), place: shownPlace,
    isNew, found, total: FAMILIES.length * VARIANTS.length, newTitle: isNew ? newTitle(before, found) : null, xp: isNew ? CODEX.xpNewEntry : 0,
  };
}

export function codexView(ctx: Ctx, userId: string): CodexView {
  const rows = codexRows(ctx, userId);
  const by = new Map(rows.map((r) => [`${r.family}:${r.variant}`, r]));
  const sum = codexSummary(rows);
  const entries = FAMILIES.flatMap((family) => VARIANTS.map((variant) => {
    const r = by.get(`${family}:${variant}`);
    return {
      family, variant, found: !!r, name: r ? variantName(family, variant, r.place) : '???', hint: VARIANT_HINT[variant],
      count: r?.count ?? 0, firstAt: r?.first_at ?? null, place: r?.place ?? null,
    };
  }));
  const u = ctx.db.prepare('SELECT best_combo FROM users WHERE id = ?').get(userId) as { best_combo: number };
  const c = ctx.db.prepare(`SELECT COUNT(*) n, SUM(quality = 'perfect') p FROM catches WHERE user_id = ? AND quality != 'fled'`).get(userId) as { n: number; p: number | null };
  const days = completedDays(ctx, userId);
  return {
    entries, found: sum.found, total: sum.total, pct: sum.pct, byFamily: sum.byFamily, titles: sum.titles, title: sum.title,
    records: { bestCombo: u.best_combo, catches: c.n, perfects: c.p ?? 0, routesDone: days.length, routeStreak: routeStreak(days, parisDay(ctx.now())) },
  };
}

// ───── Daily Route ─────

interface RouteRow { user_id: string; day: string; anchor: string; stops: string; done: string; created_at: number; completed_at: number | null }
type StoredStop = RouteCandidate;

const completedDays = (ctx: Ctx, userId: string): string[] =>
  (ctx.db.prepare('SELECT day FROM daily_routes WHERE user_id = ? AND completed_at IS NOT NULL ORDER BY day DESC LIMIT 400').all(userId) as { day: string }[]).map((r) => r.day);

const anchorCenter = (anchor: string): LatLng => { const [lat, lng] = cellToLatLng(anchor); return { lat, lng }; };

/** Calcule la route du jour autour d'une position, à partir des nœuds génériques du monde (null s'il n'y en a pas assez). */
export function planRoute(ctx: Ctx, day: string, p: LatLng): { anchor: string; stops: StoredStop[] } | null {
  const anchor = latLngToCell(p.lat, p.lng, DAILY_ROUTE.anchorRes);
  const center = anchorCenter(anchor);
  const candidates = nodesNear(ctx.world, center.lat, center.lng, DAILY_ROUTE.radiusM)
    .map((n) => ({ id: n.id, kind: n.kind, name: n.name, lat: n.lat, lng: n.lng }));
  const stops = dailyRoute(ctx.cfg.SPAWN_SECRET, day, anchor, center, candidates);
  return stops ? { anchor, stops } : null;
}

function viewOf(ctx: Ctx, row: RouteRow): DailyRouteView {
  const stops = JSON.parse(row.stops) as StoredStop[];
  const done = new Set(JSON.parse(row.done) as string[]);
  const days = completedDays(ctx, row.user_id);
  const streak = routeStreak(days, row.day);
  return {
    day: row.day,
    stops: stops.map((s) => ({ ...s, done: done.has(s.id) })),
    done: stops.filter((s) => done.has(s.id)).length,
    total: stops.length,
    lengthM: Math.round(routeLengthM(anchorCenter(row.anchor), stops)),
    completedAt: row.completed_at,
    // récompense annoncée = celle qu'on toucherait en finissant aujourd'hui (série + 1 si pas encore finie)
    reward: routeReward(row.completed_at ? streak : streak + 1),
    streak,
  };
}

/** Route du jour du joueur, créée à la demande autour de sa dernière position serveur (jamais d'une position fournie par le client). */
export function routeFor(ctx: Ctx, u: UserRow, last: LatLng | null): DailyRouteView | null {
  const day = parisDay(ctx.now());
  let row = ctx.db.prepare('SELECT * FROM daily_routes WHERE user_id = ? AND day = ?').get(u.id, day) as RouteRow | undefined;
  if (row && last && !row.completed_at && (JSON.parse(row.done) as string[]).length === 0
    && haversineM(last, anchorCenter(row.anchor)) > DAILY_ROUTE.reanchorM) {
    // route pas commencée, joueur parti loin : on la refait autour de lui
    const plan = planRoute(ctx, day, last);
    if (plan) {
      ctx.db.prepare('UPDATE daily_routes SET anchor = ?, stops = ?, created_at = ? WHERE user_id = ? AND day = ?')
        .run(plan.anchor, JSON.stringify(plan.stops), ctx.now(), u.id, day);
      row = { ...row, anchor: plan.anchor, stops: JSON.stringify(plan.stops) };
    }
  }
  if (!row) {
    if (!last) return null;
    const plan = planRoute(ctx, day, last);
    if (!plan) return null;
    ctx.db.prepare('INSERT OR IGNORE INTO daily_routes (user_id, day, anchor, stops, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(u.id, day, plan.anchor, JSON.stringify(plan.stops), ctx.now());
    row = ctx.db.prepare('SELECT * FROM daily_routes WHERE user_id = ? AND day = ?').get(u.id, day) as RouteRow;
  }
  return viewOf(ctx, row);
}

/**
 * Valide les arrêts atteints par une position acceptée (appelé par /api/move, hors saut suspect / transit).
 * Termine la route et crédite la récompense bornée (une fois par jour, transaction).
 */
export function routeCheckin(ctx: Ctx, userId: string, fix: LatLng & { acc: number }): RouteCheckin | undefined {
  const day = parisDay(ctx.now());
  return ctx.db.transaction((): RouteCheckin | undefined => {
    const row = ctx.db.prepare('SELECT * FROM daily_routes WHERE user_id = ? AND day = ?').get(userId, day) as RouteRow | undefined;
    if (!row || row.completed_at) return undefined;
    const stops = JSON.parse(row.stops) as StoredStop[];
    const done = new Set(JSON.parse(row.done) as string[]);
    const bonus = Math.min(Math.max(0, fix.acc), ACTION_ACC_BONUS_MAX_M);
    const hit = stops.filter((s) => !done.has(s.id) && haversineM(fix, s) <= ACTION_RADIUS_M[s.kind] + bonus).map((s) => s.id);
    if (!hit.length) return undefined;
    for (const id of hit) done.add(id);
    const completed = stops.every((s) => done.has(s.id));
    const now = ctx.now();
    ctx.db.prepare('UPDATE daily_routes SET done = ?, completed_at = ? WHERE user_id = ? AND day = ?')
      .run(JSON.stringify([...done]), completed ? now : null, userId, day);
    let reward: RouteCheckin['reward'] = null;
    let levelUp: number | null = null;
    const streak = routeStreak(completedDays(ctx, userId), day);
    if (completed) {
      reward = routeReward(streak);
      credit(ctx, userId, 'flux', reward.flux, `route:${day}`);
      credit(ctx, userId, shardToken(reward.shard), 1, `route:${day}`);
      levelUp = addXp(ctx, userId, reward.xp);
      ctx.bus.publish('route.done', `A runner finished today’s Daily Route (${stops.length} stops)`, { stops: stops.length });
    }
    return {
      stopIds: hit, done: stops.filter((s) => done.has(s.id)).length, total: stops.length, completed, reward, streak, levelUp,
      me: completed ? meView(ctx, userId) : null,
    };
  })();
}
