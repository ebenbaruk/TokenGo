// Actions de la boucle 30 s / 5 min : déplacement, monde visible, capture, sync de relais.
import { gridDisk } from 'h3-js';
import {
  CATCH, FAMILY_INFO, RELAY, XP, applyMove, canActAt, catchParams, catchXp, haversineM, missingFor, nextCombo, offsetM,
  randInt, recipesFor, resolveCatch, rngFrom, shardToken, spawnWindow, spawnsForCell, weightedPick, familyWeights,
  type ActionTarget, type CatchResolveResponse, type CatchStartResponse, type Family, type MoveRequest, type MoveResponse,
  type NodeView, type Objective, type SpawnView, type SyncResponse, type WorldResponse,
} from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { addXp, credit, getUser, inventory, levelOf, markTutorial, meView, moveStateOf, tutorialOf, type UserRow } from './players.ts';
import { cellInfo, cellOf, nodesNear } from './world.ts';
import { merchantByNode } from './merchants.ts';
import { getPools, reserveView } from './reserve.ts';
import { parisDay } from './reserve.ts';
import { reserveHealth } from '@tokengo/shared';

const TUTORIAL_SPAWN = (userId: string) => `tut:${userId}`;

export function move(ctx: Ctx, userId: string, req: MoveRequest): MoveResponse {
  const u = getUser(ctx, userId)!;
  const now = ctx.now();
  const v = applyMove(moveStateOf(u), { lat: req.lat, lng: req.lng, acc: req.acc, at: now }, u.mode === 'demo');
  const walked = Math.round(v.state.walkedM);
  const flags = JSON.parse(u.flags) as Record<string, unknown>;
  if (v.flagged && !flags.flagged) {
    flags.flagged = now;
    ctx.db.prepare('UPDATE users SET flags = ? WHERE id = ?').run(JSON.stringify(flags), userId);
  }
  // l'éclat garanti du tutoriel apparaît à 20 m de la première position connue
  const tut = u.tut_lat === null && !v.ignored ? offsetM(req, 0, 20) : null;
  ctx.db.prepare(`UPDATE users SET move_state = ?, walked_m = ?, in_transit = ? ${tut ? ', tut_lat = ?, tut_lng = ?' : ''} WHERE id = ?`)
    .run(JSON.stringify(v.state), walked, v.inTransit ? 1 : 0, ...(tut ? [tut.lat, tut.lng] : []), userId);
  return { ok: true, inTransit: v.inTransit, ignored: v.ignored, suspicious: v.suspicious, walkedM: walked };
}

/** Vérifie qu'un joueur peut agir sur une cible (position récente, pas en transit, assez près). */
export function assertCanAct(ctx: Ctx, u: UserRow, target: ActionTarget, at: { lat: number; lng: number }) {
  if (u.in_transit) fail('IN_TRANSIT', 'In transit — catching paused. Slow down to play.');
  const r = canActAt(moveStateOf(u), target, at, ctx.now());
  if (!r.ok) {
    if (r.code === 'TOO_FAR') fail('TOO_FAR', `${Math.round(r.distance!)} m away — get a bit closer.`, 400, { distance: Math.round(r.distance!) });
    if (r.code === 'SUSPICIOUS_MOVE') fail('SUSPICIOUS_MOVE', 'Re-syncing your position… try again in a few minutes.');
    fail('NO_POSITION', 'Waiting for your position…');
  }
}

/** Éclats visibles autour d'une position (hors déjà capturés), + éclat du tutoriel. */
export function visibleSpawns(ctx: Ctx, u: UserRow, lat: number, lng: number): SpawnView[] {
  const now = ctx.now();
  const w = spawnWindow(now);
  const health = reserveHealth(getPools(ctx).main);
  const out: SpawnView[] = [];
  for (const cell of gridDisk(cellOf(lat, lng), 2)) {
    for (const s of spawnsForCell(ctx.cfg.SPAWN_SECRET, cell, w, cellInfo(ctx.world, cell), health)) {
      if (haversineM({ lat, lng }, s) <= 250) out.push(s);
    }
  }
  if (!tutorialOf(u).caught && u.tut_lat !== null && u.tut_lng !== null) {
    out.push({ id: TUTORIAL_SPAWN(u.id), family: 'deepseek', lat: u.tut_lat, lng: u.tut_lng, expiresAt: now + 3600_000 });
  }
  if (!out.length) return out;
  const caught = new Set((ctx.db.prepare(`SELECT spawn_id FROM catches WHERE user_id = ? AND spawn_id IN (${out.map(() => '?').join(',')})`)
    .all(u.id, ...out.map((s) => s.id)) as { spawn_id: string }[]).map((r) => r.spawn_id));
  return out.filter((s) => !caught.has(s.id));
}

/** Retrouve un éclat par son id (le serveur le recalcule : le client ne peut pas l'inventer). */
function findSpawn(ctx: Ctx, u: UserRow, spawnId: string): SpawnView | null {
  if (spawnId === TUTORIAL_SPAWN(u.id)) {
    if (tutorialOf(u).caught || u.tut_lat === null) return null;
    return { id: spawnId, family: 'deepseek', lat: u.tut_lat, lng: u.tut_lng!, expiresAt: ctx.now() + 3600_000 };
  }
  const [cell, win, idx] = spawnId.split(':');
  if (!cell || win === undefined || idx === undefined) return null;
  const w = Number(win);
  const cur = spawnWindow(ctx.now());
  if (w !== cur && !(w === cur - 1)) return null; // tolère la fenêtre précédente (bascule pendant le mini-jeu)
  const health = reserveHealth(getPools(ctx).main);
  return spawnsForCell(ctx.cfg.SPAWN_SECRET, cell, w, cellInfo(ctx.world, cell), health).find((s) => s.id === spawnId) ?? null;
}

export function worldView(ctx: Ctx, userId: string, lat: number, lng: number): WorldResponse {
  const u = getUser(ctx, userId)!;
  const now = ctx.now();
  const nodes = nodesNear(ctx.world, lat, lng, 1200);
  const forgeIds = new Set(nodes.filter((n) => n.kind === 'forge').map((n) => n.id));
  for (const f of ctx.world.forges) if (!forgeIds.has(f.id) && haversineM({ lat, lng }, f) < 3000) nodes.push(f);
  const syncs = new Map((ctx.db.prepare('SELECT node_id, at FROM relay_syncs WHERE user_id = ? AND at > ?').all(userId, now - RELAY.cooldownMs) as { node_id: string; at: number }[])
    .map((r) => [r.node_id, r.at + RELAY.cooldownMs]));
  const views: NodeView[] = nodes.map((n) => {
    const v: NodeView = { id: n.id, kind: n.kind, name: n.name, lat: n.lat, lng: n.lng, category: n.category, affinities: n.affinities };
    if (n.kind === 'relay') v.cooldownUntil = syncs.get(n.id) ?? null;
    if (n.kind === 'market') {
      const m = merchantByNode(ctx, n.id);
      if (m) {
        const live = m.contract && m.contract.expiresAt > now ? m.contract : null;
        v.merchant = { id: m.id, name: m.name, archetype: m.archetype, status: m.status, hasContract: !!live, ...(live ? { contractFamily: live.family } : {}) };
      }
    }
    if (n.kind === 'forge') v.theme = ctx.world.forges.find((f) => f.id === n.id)?.theme ?? n.affinities;
    return v;
  });
  return { now, nodes: views, spawns: visibleSpawns(ctx, u, lat, lng), reserve: reserveView(ctx), objective: objective(ctx, u, lat, lng) };
}

/** Objectif épinglé : la recette la plus proche d'être complète + où trouver ce qui manque. */
function objective(ctx: Ctx, u: UserRow, lat: number, lng: number): Objective | null {
  const pos = { lat, lng };
  const t = tutorialOf(u);
  const near = (kind: string, fam?: Family) => nodesNear(ctx.world, lat, lng, 1500)
    .filter((n) => n.kind === kind && (!fam || n.affinities.includes(fam)))
    .sort((a, b) => haversineM(pos, a) - haversineM(pos, b))[0];
  const dist = (n: { lat: number; lng: number }) => `${Math.round(haversineM(pos, n))} m`;
  if (!t.caught) return { text: 'Catch the glowing shard right next to you' };
  if (!t.synced) { const r = near('relay'); return r ? { text: `Sync a Relay · ${r.name} · ${dist(r)}`, target: { lat: r.lat, lng: r.lng, name: r.name } } : null; }
  if (!t.traded) { const m = near('market'); return m ? { text: `Trade with a merchant · ${m.name} · ${dist(m)}`, target: { lat: m.lat, lng: m.lng, name: m.name } } : null; }
  const forge = [...ctx.world.forges].sort((a, b) => haversineM(pos, a) - haversineM(pos, b))[0]!;
  const inv = inventory(ctx, u.id).shards;
  if (!t.firstCompile) {
    const lack = missingFor({ deepseek: 2, qwen: 1 }, inv);
    const fam = Object.keys(lack)[0] as Family | undefined;
    if (fam) return { text: `First Compile @ ${forge.name} — need ${lack[fam]} ${FAMILY_INFO[fam].name}`, target: { lat: forge.lat, lng: forge.lng, name: forge.name } };
    return { text: `First Compile ready · ${forge.name} · ${dist(forge)}`, target: { lat: forge.lat, lng: forge.lng, name: forge.name } };
  }
  const tier = levelOf(u) >= 5 ? 1 : 0;
  const recipe = recipesFor(ctx.cfg.SPAWN_SECRET, forge.id, forge.theme, parisDay(ctx.now()))[tier]!;
  const lack = missingFor(recipe.needs, inv);
  const total = Object.values(recipe.needs).reduce((s, n) => s + (n ?? 0), 0);
  const missing = Object.values(lack).reduce((s, n) => s + (n ?? 0), 0);
  const label = `${recipe.tier[0]!.toUpperCase()}${recipe.tier.slice(1)} @ ${forge.name.split(' —')[0]} ${total - missing}/${total}`;
  const fam = (Object.keys(lack) as Family[]).sort((a, b) => FAMILY_INFO[b].p0 - FAMILY_INFO[a].p0)[0];
  if (!fam) return { text: `${label} — ready to compile · ${dist(forge)}`, target: { lat: forge.lat, lng: forge.lng, name: forge.name } };
  const spot = near('relay', fam) ?? near('market', fam);
  return {
    text: `${label} — need ${lack[fam]} ${FAMILY_INFO[fam].name}${spot ? ` · ${spot.name} ${dist(spot)}` : ''}`,
    ...(spot ? { target: { lat: spot.lat, lng: spot.lng, name: spot.name } } : {}),
  };
}

// ───── Capture ─────
interface Attempt { id: string; userId: string; spawn: SpawnView; startedAt: number }
const attempts = new Map<string, Attempt>();

export function catchStart(ctx: Ctx, userId: string, spawnId: string): CatchStartResponse {
  const u = getUser(ctx, userId)!;
  const spawn = findSpawn(ctx, u, spawnId);
  if (!spawn) fail('EXPIRED', 'This shard has faded away.');
  if (ctx.db.prepare('SELECT 1 FROM catches WHERE user_id = ? AND spawn_id = ?').get(userId, spawnId)) fail('ALREADY_CAUGHT', 'Already caught.');
  assertCanAct(ctx, u, 'spawn', spawn!);
  const now = ctx.now();
  for (const [k, a] of attempts) if (now - a.startedAt > CATCH.attemptTtlMs) attempts.delete(k);
  const id = rngFrom(ctx.cfg.SESSION_SECRET, 'attempt', userId, spawnId, now)().toString(36).slice(2) + now.toString(36);
  attempts.set(id, { id, userId, spawn: spawn!, startedAt: now });
  const p = catchParams(spawn!.family);
  return { attemptId: id, family: spawn!.family, ringMs: p.ringMs, perfectPct: p.perfectPct, goodPct: p.goodPct, tries: p.tries };
}

export function catchResolve(ctx: Ctx, userId: string, attemptId: string, offsets: number[]): CatchResolveResponse {
  const a = attempts.get(attemptId);
  const now = ctx.now();
  if (!a || a.userId !== userId || now - a.startedAt > CATCH.attemptTtlMs) fail('EXPIRED', 'Too slow — the shard drifted away.');
  attempts.delete(attemptId);
  if (now - a!.startedAt < CATCH.minResolveMs) fail('BAD_REQUEST', 'Too fast.');
  const spawn = a!.spawn;
  const recent = ctx.db.prepare('SELECT quality FROM catches WHERE user_id = ? ORDER BY at DESC LIMIT ?').all(userId, CATCH.perfectCapWindow) as { quality: string }[];
  const perfects = recent.filter((r) => r.quality === 'perfect').length;
  const rng = rngFrom(ctx.cfg.SPAWN_SECRET, 'catch', userId, spawn.id);
  // le tutoriel est indulgent : la capture réussit toujours
  const isTut = spawn.id.startsWith('tut:');
  let res = resolveCatch(spawn.family, offsets.filter((o) => typeof o === 'number').slice(0, 3), rng, perfects, recent.length);
  if (isTut && (res.result === 'miss' || res.result === 'fled')) res = { result: 'good', bonus: false };
  return ctx.db.transaction((): CatchResolveResponse => {
    const u = getUser(ctx, userId)!;
    if (ctx.db.prepare('SELECT 1 FROM catches WHERE user_id = ? AND spawn_id = ?').get(userId, spawn.id)) fail('ALREADY_CAUGHT', 'Already caught.');
    if (res.result === 'miss') {
      return { result: 'miss', family: spawn.family, qty: 0, xp: 0, combo: u.combo, levelUp: null, me: meView(ctx, userId) };
    }
    ctx.db.prepare('INSERT INTO catches (user_id, spawn_id, at, family, quality) VALUES (?, ?, ?, ?, ?)').run(userId, spawn.id, now, spawn.family, res.result);
    if (res.result === 'fled') {
      return { result: 'fled', family: spawn.family, qty: 0, xp: 0, combo: 0, levelUp: null, me: meView(ctx, userId) };
    }
    const qty = 'bonus' in res && res.bonus ? 2 : 1;
    credit(ctx, userId, shardToken(spawn.family), qty, `catch:${spawn.id}`);
    const combo = nextCombo(u.combo, u.last_catch_at, now);
    ctx.db.prepare('UPDATE users SET combo = ?, last_catch_at = ? WHERE id = ?').run(combo, now, userId);
    const xp = catchXp(res.result === 'perfect', combo);
    const levelUp = addXp(ctx, userId, xp);
    markTutorial(ctx, userId, 'caught');
    return { result: res.result, family: spawn.family, qty, xp, combo, levelUp, me: meView(ctx, userId) };
  })();
}

// ───── Relay ─────
export function relaySync(ctx: Ctx, userId: string, nodeId: string): SyncResponse {
  const node = ctx.world.byId.get(nodeId);
  if (!node || node.kind !== 'relay') fail('NOT_FOUND', 'Unknown relay.', 404);
  const u = getUser(ctx, userId)!;
  assertCanAct(ctx, u, 'relay', node!);
  const now = ctx.now();
  return ctx.db.transaction((): SyncResponse => {
    const last = ctx.db.prepare('SELECT at FROM relay_syncs WHERE user_id = ? AND node_id = ?').get(userId, nodeId) as { at: number } | undefined;
    if (last && now - last.at < RELAY.cooldownMs) {
      fail('COOLDOWN', 'Relay recharging.', 400, { cooldownUntil: last.at + RELAY.cooldownMs });
    }
    ctx.db.prepare('INSERT OR REPLACE INTO relay_syncs (user_id, node_id, at) VALUES (?, ?, ?)').run(userId, nodeId, now);
    const rng = rngFrom(ctx.cfg.SPAWN_SECRET, 'sync', userId, nodeId, now);
    const flux = randInt(rng, RELAY.fluxMin, RELAY.fluxMax);
    credit(ctx, userId, 'flux', flux, `sync:${nodeId}`);
    let shard: Family | null = null;
    if (rng() < RELAY.shardChance || !tutorialOf(u).synced) {
      shard = weightedPick(rng, familyWeights(node!.affinities, reserveHealth(getPools(ctx).main)));
      credit(ctx, userId, shardToken(shard), 1, `sync:${nodeId}`);
    }
    const firstVisit = ctx.db.prepare('INSERT OR IGNORE INTO visits (user_id, node_id, first_at) VALUES (?, ?, ?)').run(userId, nodeId, now).changes === 1;
    const xp = XP.sync + (firstVisit ? XP.firstVisit : 0);
    const levelUp = addXp(ctx, userId, xp);
    markTutorial(ctx, userId, 'synced');
    return { flux, shard, xp, firstVisit, cooldownUntil: now + RELAY.cooldownMs, levelUp, me: meView(ctx, userId) };
  })();
}
