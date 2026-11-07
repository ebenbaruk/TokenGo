// Actions de la boucle 30 s / 5 min : déplacement, monde visible, capture, sync de relais.
import { gridDisk } from 'h3-js';
import {
  CATCH, DECODE, FAMILY_INFO, LIVING, RELAY, WORLD_GEN, XP, eventSpawnsForCell, merchantBubble, applyMove, canActAt, catchParams, catchXp, haversineM, missingFor, nextCombo, offsetM,
  judgeTap, randInt, recipesFor, resolveCatch, rngFrom, shardToken, spawnWindow, spawnsForCell, weightedPick, familyWeights,
  type ActionTarget, type CatchResolveResponse, type CatchStartResponse, type DecodeAnswerResponse, type DecodeView, type Family, type MoveRequest, type MoveResponse,
  type NodeView, type Objective, type SpawnView, type SyncResponse, type WorldResponse,
} from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import {
  addXp, credit, getUser, inventory, levelOf, markTutorial, meView, moveStateOf, saveScout, scoutOf, scoutView, tutorialOf, type UserRow,
} from './players.ts';
import { cellInfo, cellOf, nodesNear } from './world.ts';
import { merchantByNode } from './merchants.ts';
import { getPools, reserveView } from './reserve.ts';
import { parisDay } from './reserve.ts';
import { reserveHealth, scoutHop } from '@tokengo/shared';
import { assertQuota, bumpQuota } from './quotas.ts';
import { recordCatchVariant, routeCheckin, routeFor } from './codex.ts';
import { activeEvent, eventById, eventView } from './events.ts';
import { addMastery, arenaOnCatch } from './mastery.ts'; // Arène (Docs/13 §2) : maîtrise à la capture
import { arenaBadge } from './arena.ts';      // Arène (Docs/13 §4) : couronne / bouclier des forges
import { missionBump, missionsOnCatch } from './missions.ts'; // Missions du jour (Docs/13 §7) : compteurs
// Décodage (Docs/13 §3) : import direct — la banque de questions n'est pas dans l'index du paquet partagé (bundle web)
import { decodePublic, decodeRequired, judgeDecode, pickDecode, type DecodeChallenge } from '@tokengo/shared/economy/decode.ts';

const TUTORIAL_SPAWN = (userId: string) => `tut:${userId}`;

export function move(ctx: Ctx, userId: string, req: MoveRequest): MoveResponse {
  const u = getUser(ctx, userId)!;
  const now = ctx.now();
  const ms = moveStateOf(u);
  // Remote Scout (mode démo) : vitesse plafonnée et batterie, vérifiées ici — un vol refusé ne déplace pas le joueur
  let scout: MoveResponse['scout'];
  if (u.mode === 'demo') {
    const h = scoutHop(scoutOf(u, now), ms.last, req, now);
    saveScout(ctx, userId, h.state);
    if (!h.ok) {
      const at = ms.last ? { lat: ms.last.lat, lng: ms.last.lng } : null;
      return { ok: true, inTransit: false, ignored: true, suspicious: false, walkedM: u.walked_m, scout: scoutView(h.state, at), refused: h.code, at };
    }
    scout = scoutView(h.state, { lat: req.lat, lng: req.lng });
  }
  const v = applyMove(ms, { lat: req.lat, lng: req.lng, acc: req.acc, at: now }, u.mode === 'demo');
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
  // présence sur la carte des autres : seulement la cellule H3 (~175 m), jamais la position exacte
  if (!v.ignored && !v.suspicious) ctx.db.prepare('UPDATE users SET seen_cell = ?, seen_at = ? WHERE id = ?').run(cellOf(req.lat, req.lng), now, userId);
  // Daily Route : validation des arrêts sur une position acceptée (pas en transit, pas de saut suspect)
  const route = !v.ignored && !v.suspicious && !v.inTransit && now >= v.state.suspiciousUntil
    ? routeCheckin(ctx, userId, { lat: req.lat, lng: req.lng, acc: req.acc }) : undefined;
  return { ok: true, inTransit: v.inTransit, ignored: v.ignored, suspicious: v.suspicious, walkedM: walked, ...(route ? { route } : {}), ...(scout ? { scout } : {}) };
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
  const event = activeEvent(ctx);
  const out: SpawnView[] = [];
  for (const cell of gridDisk(cellOf(lat, lng), 2)) {
    // + vague bonus d'une ruée en cours (ids distincts : `cell:window:e<id>`)
    for (const s of [...spawnsForCell(ctx.cfg.SPAWN_SECRET, cell, w, cellInfo(ctx.world, cell), health), ...eventSpawnsForCell(ctx.cfg.SPAWN_SECRET, event, cell, w)]) {
      if (haversineM({ lat, lng }, s) <= 250 && s.expiresAt > now) out.push(s);
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
  if (idx.startsWith('e')) return eventSpawnsForCell(ctx.cfg.SPAWN_SECRET, eventById(ctx, Number(idx.slice(1))), cell, w).find((s) => s.id === spawnId) ?? null;
  const health = reserveHealth(getPools(ctx).main);
  return spawnsForCell(ctx.cfg.SPAWN_SECRET, cell, w, cellInfo(ctx.world, cell), health).find((s) => s.id === spawnId) ?? null;
}

export function worldView(ctx: Ctx, userId: string, lat: number, lng: number, ipHash: string | null = null): WorldResponse {
  const u = getUser(ctx, userId)!;
  const now = ctx.now();
  const nodes = nodesNear(ctx.world, lat, lng, 1200);
  const forgeIds = new Set(nodes.filter((n) => n.kind === 'forge').map((n) => n.id));
  for (const f of ctx.world.forges) if (!forgeIds.has(f.id) && haversineM({ lat, lng }, f) < 3000) nodes.push(f);
  const event = activeEvent(ctx);
  const reopened = new Map((ctx.db.prepare("SELECT at, data FROM events WHERE kind = 'merchant.reopened' AND at > ?").all(now - LIVING.reopenedBubbleMs) as { at: number; data: string | null }[])
    .map((r) => [(JSON.parse(r.data ?? '{}') as { merchantId?: string }).merchantId, r.at]));
  const syncs = new Map((ctx.db.prepare('SELECT node_id, at FROM relay_syncs WHERE user_id = ? AND at > ?').all(userId, now - RELAY.cooldownMs) as { node_id: string; at: number }[])
    .map((r) => [r.node_id, r.at + RELAY.cooldownMs]));
  const views: NodeView[] = nodes.map((n) => {
    const v: NodeView = { id: n.id, kind: n.kind, name: n.name, lat: n.lat, lng: n.lng, category: n.category, affinities: n.affinities };
    if (n.kind === 'relay') v.cooldownUntil = syncs.get(n.id) ?? null;
    if (n.kind === 'market') {
      const m = merchantByNode(ctx, n.id);
      if (m) {
        const live = m.contract && m.contract.expiresAt > now ? m.contract : null;
        // bulle : seulement pour les marchands proches (le client en affiche 3 au plus)
        const bubble = haversineM({ lat, lng }, n) <= LIVING.bubbleRadiusM ? merchantBubble(m, now, { pos: n, event, reopenedAt: reopened.get(m.id) ?? null }) : null;
        v.merchant = { id: m.id, name: m.name, archetype: m.archetype, status: m.status, hasContract: !!live, ...(live ? { contractFamily: live.family } : {}), ...(bubble ? { bubble } : {}) };
      }
    }
    if (n.kind === 'forge') {
      v.theme = ctx.world.forges.find((f) => f.id === n.id)?.theme ?? n.affinities;
      v.arena = arenaBadge(ctx, n.id, userId);
    }
    return v;
  });
  // la route s'ancre sur la dernière position reçue par /api/move (pas sur les paramètres de /api/world)
  const last = moveStateOf(u).last;
  const route = routeFor(ctx, u, last);
  // nouvelles régions : seulement autour de la position serveur récente du joueur (pas d'un lat/lng choisi par le client)
  const anchored = !!last && now - last.at <= WORLD_GEN.anchorFreshMs && haversineM(last, { lat, lng }) <= WORLD_GEN.anchorMaxM;
  const region = ctx.regions?.ensure(lat, lng, ipHash, anchored);
  return {
    now, nodes: views, spawns: visibleSpawns(ctx, u, lat, lng), reserve: reserveView(ctx), objective: objective(ctx, u, lat, lng), route,
    event: eventView(event), ...(region ? { region } : {}),
  };
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
/**
 * Tentative de capture, en mémoire (TTL court). `phase` : 'lock' = Lock-on en cours ; 'decode' = Lock-on réussi sur un
 * Rare/Épique, Décodage obligatoire en attente (l'éclat n'est pas encore donné) ; 'bonus' = commun capturé, Décodage
 * bonus disponible (Docs/13 §3).
 */
interface Attempt {
  id: string; userId: string; spawn: SpawnView; startedAt: number; expiresAt: number;
  phase: 'lock' | 'decode' | 'bonus';
  triesUsed: number;              // taps consommés par les Lock-on précédents de cette tentative
  lastResolveAt: number;
  decode?: PendingDecode;
}
const attempts = new Map<string, Attempt>();

export function catchStart(ctx: Ctx, userId: string, spawnId: string): CatchStartResponse {
  const u = getUser(ctx, userId)!;
  const spawn = findSpawn(ctx, u, spawnId);
  if (!spawn) fail('EXPIRED', 'This shard has faded away.');
  const now = ctx.now();
  settleAbandoned(ctx, userId, spawnId, now); // Décodage (Docs/13 §3)
  if (ctx.db.prepare('SELECT 1 FROM catches WHERE user_id = ? AND spawn_id = ?').get(userId, spawnId)) fail('ALREADY_CAUGHT', 'Already caught.');
  assertCanAct(ctx, u, 'spawn', spawn!);
  assertQuota(ctx, userId, 'catch');
  for (const [k, a] of attempts) if (now > a.expiresAt) attempts.delete(k);
  const id = rngFrom(ctx.cfg.SESSION_SECRET, 'attempt', userId, spawnId, now)().toString(36).slice(2) + now.toString(36);
  attempts.set(id, { id, userId, spawn: spawn!, startedAt: now, expiresAt: now + CATCH.attemptTtlMs, phase: 'lock', triesUsed: 0, lastResolveAt: now });
  const p = catchParams(spawn!.family);
  return { attemptId: id, family: spawn!.family, ringMs: p.ringMs, perfectPct: p.perfectPct, goodPct: p.goodPct, tries: p.tries };
}

export function catchResolve(ctx: Ctx, userId: string, attemptId: string, offsets: number[]): CatchResolveResponse {
  const a = attempts.get(attemptId);
  const now = ctx.now();
  if (!a || a.userId !== userId || now > a.expiresAt || a.phase !== 'lock') fail('EXPIRED', 'Too slow — the shard drifted away.');
  if (now - a!.lastResolveAt < CATCH.minResolveMs) { attempts.delete(attemptId); fail('BAD_REQUEST', 'Too fast.'); }
  const spawn = a!.spawn;
  const recent = ctx.db.prepare('SELECT quality FROM catches WHERE user_id = ? ORDER BY at DESC LIMIT ?').all(userId, CATCH.perfectCapWindow) as { quality: string }[];
  const perfects = recent.filter((r) => r.quality === 'perfect').length;
  // relance après un Décodage raté : graine distincte (sinon même tirage) et essais restants seulement
  const rng = a!.triesUsed
    ? rngFrom(ctx.cfg.SPAWN_SECRET, 'catch', userId, spawn.id, a!.triesUsed)
    : rngFrom(ctx.cfg.SPAWN_SECRET, 'catch', userId, spawn.id);
  const taps = offsets.filter((o) => typeof o === 'number').slice(0, CATCH.maxTries - a!.triesUsed);
  // le tutoriel est indulgent : la capture réussit toujours
  const isTut = spawn.id.startsWith('tut:');
  let res = resolveCatch(spawn.family, taps, rng, perfects, recent.length);
  if (isTut && (res.result === 'miss' || res.result === 'fled')) res = { result: 'good', bonus: false };
  // Décodage obligatoire (Rare / Épique, Docs/13 §3) : rien n'est donné tant que le bon jeton n'est pas choisi
  if ((res.result === 'perfect' || res.result === 'good') && !isTut && decodeRequired(spawn.family)) {
    const p = catchParams(spawn.family);
    return askDecode(ctx, a!, res, taps.findIndex((o) => judgeTap(o, p) !== 'miss') + 1, now);
  }
  attempts.delete(attemptId);
  const out = grantCatch(ctx, userId, spawn, res, now);
  // Décodage bonus (Commun / Peu commun) : proposé après la capture, jamais au tutoriel
  if ((out.result === 'perfect' || out.result === 'good') && !isTut && !decodeRequired(spawn.family)) {
    offerBonusDecode(a!, now);
    return { ...out, bonusDecode: { id: attemptId } };
  }
  return out;
}

type CatchOutcome = ReturnType<typeof resolveCatch>;

/** Applique le résultat d'une capture (transaction) : inventaire, combo, XP, tutoriel. */
function grantCatch(ctx: Ctx, userId: string, spawn: SpawnView, res: CatchOutcome, now: number): CatchResolveResponse {
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
    arenaOnCatch(ctx, userId, spawn.family);
    const combo = nextCombo(u.combo, u.last_catch_at, now);
    ctx.db.prepare('UPDATE users SET combo = ?, last_catch_at = ?, best_combo = MAX(best_combo, ?) WHERE id = ?').run(combo, now, combo, userId);
    // variante cosmétique (Codex) : ne change rien à l'inventaire ; XP de découverte une fois par case
    // Décodage bonus réussi avant (Docs/13 §3) : chance de Shiny doublée sur CETTE capture, puis consommée
    const lucky = consumeLucky(ctx, u);
    const codex = recordCatchVariant(ctx, userId, spawn, res.result === 'perfect', combo, now, lucky ? DECODE.luckyShinyMult : 1);
    missionsOnCatch(ctx, userId, { family: spawn.family, combo, variant: codex.variant }); // Missions (Docs/13 §7)
    const xp = catchXp(res.result === 'perfect', combo) + codex.xp;
    const levelUp = addXp(ctx, userId, xp);
    markTutorial(ctx, userId, 'caught');
    return { result: res.result, family: spawn.family, qty, xp, combo, levelUp, me: meView(ctx, userId), codex, ...(lucky ? { lucky } : {}) };
  })();
}

// ───── Décodage « Next token » (Docs/13 §3) ─────
// Question tirée par le serveur (graine HMAC(spawn, joueur, essai)), choix mélangés à ids opaques, réponse gardée ici ;
// délai mesuré côté serveur depuis l'envoi (+ DECODE.networkGraceMs). Une seule réponse par question.
interface PendingDecode { ch: DecodeChallenge; issuedAt: number; outcome?: CatchOutcome; used?: number }

function challengeFor(ctx: Ctx, a: Attempt, kind: 'required' | 'bonus'): DecodeChallenge {
  return pickDecode(a.spawn.family, rngFrom(ctx.cfg.SPAWN_SECRET, 'decode', kind, a.userId, a.spawn.id, a.triesUsed));
}
const viewOf = (a: Attempt): DecodeView => ({ id: a.id, ...decodePublic(a.decode!.ch) });
/** Laisse le temps de répondre (délai + tolérance + marge) même en fin de TTL. */
const answerWindow = (ch: DecodeChallenge) => ch.timeMs + DECODE.networkGraceMs + 1000;

/** Lock-on réussi sur un Rare/Épique : la tentative attend le Décodage, l'éclat n'est pas donné. `used` = taps consommés. */
function askDecode(ctx: Ctx, a: Attempt, res: CatchOutcome, used: number, now: number): CatchResolveResponse {
  a.phase = 'decode';
  a.decode = { ch: challengeFor(ctx, a, 'required'), issuedAt: now, outcome: res, used };
  a.expiresAt = Math.max(a.expiresAt, now + answerWindow(a.decode.ch));
  const u = getUser(ctx, a.userId)!;
  return {
    result: 'decode', family: a.spawn.family, qty: 0, xp: 0, combo: u.combo, levelUp: null, me: meView(ctx, a.userId),
    lock: res.result === 'perfect' ? 'perfect' : 'good', decode: viewOf(a),
  };
}

/** Commun capturé : la tentative reste en vie (60 s) pour un Décodage bonus, dont le chrono part à l'ouverture. */
function offerBonusDecode(a: Attempt, now: number) {
  a.phase = 'bonus';
  a.expiresAt = now + DECODE.bonusOpenTtlMs;
  a.decode = undefined;
  attempts.set(a.id, a);
}

/** Tentative du joueur ; celle d'un autre est invisible (même erreur qu'une tentative expirée) et reste intacte. */
function ownAttempt(ctx: Ctx, userId: string, attemptId: string): Attempt {
  const a = attempts.get(attemptId);
  if (!a || a.userId !== userId || ctx.now() > a.expiresAt) fail('EXPIRED', 'Too slow — the shard drifted away.');
  return a!;
}

/** POST /api/catch/:attemptId/decode/open — démarre le chrono du Décodage bonus et envoie la question. */
export function decodeOpen(ctx: Ctx, userId: string, attemptId: string): DecodeView {
  const a = ownAttempt(ctx, userId, attemptId);
  if (a.phase !== 'bonus' || a.decode) fail('NO_DECODE', 'No decode waiting here.');
  const now = ctx.now();
  a.decode = { ch: challengeFor(ctx, a, 'bonus'), issuedAt: now };
  a.expiresAt = now + answerWindow(a.decode.ch);
  return viewOf(a);
}

/** POST /api/catch/:attemptId/decode — une seule réponse par question, jugée avec l'horloge du serveur. */
export function decodeAnswer(ctx: Ctx, userId: string, attemptId: string, choiceId: string | null): DecodeAnswerResponse {
  const a = ownAttempt(ctx, userId, attemptId);
  const d = a.decode;
  if (!d || a.phase === 'lock') fail('NO_DECODE', 'No decode waiting here.');
  const now = ctx.now();
  const verdict = judgeDecode(d!.ch, choiceId, now - d!.issuedAt);
  const correctId = d!.ch.correctId;
  a.decode = undefined; // question consommée avant tout le reste : pas de deuxième réponse

  if (a.phase === 'bonus') {
    attempts.delete(attemptId);
    if (verdict !== 'correct') return { verdict, correctId, kind: 'bonus', bonus: { xp: 0, luckyNext: false, levelUp: null, me: meView(ctx, userId) } };
    return ctx.db.transaction((): DecodeAnswerResponse => {
      const u = getUser(ctx, userId)!;
      const flags = JSON.parse(u.flags) as Record<string, unknown>;
      flags.luckyDecode = 1; // non cumulable : un seul cran, consommé à la prochaine capture réussie
      ctx.db.prepare('UPDATE users SET flags = ? WHERE id = ?').run(JSON.stringify(flags), userId);
      missionBump(ctx, userId, 'decode'); // Missions (Docs/13 §7)
      const levelUp = addXp(ctx, userId, DECODE.bonusXp);
      addMastery(ctx, userId, { [a.spawn.family]: DECODE.masteryBonus }); // maîtrise +5 (Docs/13 §2)
      return { verdict, correctId, kind: 'bonus', bonus: { xp: DECODE.bonusXp, luckyNext: true, levelUp, me: meView(ctx, userId) } };
    })();
  }

  // Décodage obligatoire : bon jeton → capture donnée exactement comme un Lock-on réussi (XP, PERFECT, combo, variante, Codex)
  if (verdict === 'correct') {
    attempts.delete(attemptId);
    const caught = ctx.db.transaction(() => {
      missionBump(ctx, userId, 'decode'); // Missions (Docs/13 §7)
      const c = grantCatch(ctx, userId, a.spawn, d!.outcome!, now);
      addMastery(ctx, userId, { [a.spawn.family]: DECODE.masteryBonus }); // maîtrise +5 (Docs/13 §2)
      return c;
    })();
    return { verdict, correctId, kind: 'required', catch: caught };
  }
  return { verdict, correctId, kind: 'required', catch: hallucinate(ctx, a, d!.used ?? 1, now) };
}

/**
 * « Hallucination » (mauvais jeton, délai dépassé ou question abandonnée) : même probabilité de fuite qu'un tap raté
 * (graine HMAC), sinon le Lock-on reprend sur la même tentative avec les essais restants.
 */
function hallucinate(ctx: Ctx, a: Attempt, used: number, now: number): CatchResolveResponse {
  a.triesUsed += used;
  const flee = CATCH.fleeAfterMiss[FAMILY_INFO[a.spawn.family].rarity];
  if (rngFrom(ctx.cfg.SPAWN_SECRET, 'decode-flee', a.userId, a.spawn.id, a.triesUsed)() < flee) {
    attempts.delete(a.id);
    return grantCatch(ctx, a.userId, a.spawn, { result: 'fled' }, now);
  }
  const triesLeft = CATCH.maxTries - a.triesUsed;
  if (triesLeft <= 0) {
    attempts.delete(a.id);
    return grantCatch(ctx, a.userId, a.spawn, { result: 'miss' }, now);
  }
  a.phase = 'lock';
  a.decode = undefined;
  a.lastResolveAt = now;
  a.expiresAt = Math.max(a.expiresAt, now + CATCH.attemptTtlMs / 2); // le temps de jouer les essais restants
  const u = getUser(ctx, a.userId)!;
  return { result: 'miss', family: a.spawn.family, qty: 0, xp: 0, combo: u.combo, levelUp: null, me: meView(ctx, a.userId), triesLeft };
}

/**
 * Relancer une capture en laissant une question obligatoire sans réponse compte comme une hallucination :
 * on n'esquive pas le risque de fuite en fermant l'écran.
 */
function settleAbandoned(ctx: Ctx, userId: string, spawnId: string, now: number) {
  for (const a of [...attempts.values()]) {
    if (a.userId !== userId || a.spawn.id !== spawnId || a.phase !== 'decode' || !a.decode) continue;
    const r = hallucinate(ctx, a, a.decode.used ?? 1, now);
    attempts.delete(a.id);
    if (r.result === 'fled') fail('EXPIRED', 'It hallucinated and drifted away.');
  }
}

/** Lit et consomme le cran de chance du Décodage bonus (dans la transaction de la capture). */
function consumeLucky(ctx: Ctx, u: UserRow): boolean {
  const flags = JSON.parse(u.flags) as Record<string, unknown>;
  if (!flags.luckyDecode) return false;
  delete flags.luckyDecode;
  ctx.db.prepare('UPDATE users SET flags = ? WHERE id = ?').run(JSON.stringify(flags), u.id);
  return true;
}

/** Tests seulement (route montée si NODE_ENV=test, jeton admin) : bonne réponse d'une question en attente. */
export function decodeAnswerForTest(attemptId: string): string | null {
  return attempts.get(attemptId)?.decode?.ch.correctId ?? null;
}
// ───── fin Décodage ─────

/**
 * Capture d'un runner-agent : mêmes contrôles serveur (éclat réel, distance, quota, unicité), mini-jeu court-circuité (« good »).
 * Décodage (Docs/13 §3) : les runners ne le jouent pas — ni obligatoire sur les Rares/Épiques, ni bonus. Leur taux de
 * réussite reste celui d'aujourd'hui (Lock-on déjà court-circuité) ; ils n'ont jamais l'XP ni la chance du bonus.
 */
export function agentCatch(ctx: Ctx, userId: string, spawnId: string): CatchResolveResponse {
  const u = getUser(ctx, userId)!;
  if (!u.is_agent) fail('FORBIDDEN', 'Agents only.', 403);
  const spawn = findSpawn(ctx, u, spawnId);
  if (!spawn) fail('EXPIRED', 'This shard has faded away.');
  if (ctx.db.prepare('SELECT 1 FROM catches WHERE user_id = ? AND spawn_id = ?').get(userId, spawnId)) fail('ALREADY_CAUGHT', 'Already caught.');
  assertCanAct(ctx, u, 'spawn', spawn!);
  assertQuota(ctx, userId, 'catch');
  return grantCatch(ctx, userId, spawn!, { result: 'good', bonus: false }, ctx.now());
}

// ───── Relay ─────
export function relaySync(ctx: Ctx, userId: string, nodeId: string): SyncResponse {
  const node = ctx.world.byId.get(nodeId);
  if (!node || node.kind !== 'relay') fail('NOT_FOUND', 'Unknown relay.', 404);
  const u = getUser(ctx, userId)!;
  assertCanAct(ctx, u, 'relay', node!);
  assertQuota(ctx, userId, 'sync');
  const now = ctx.now();
  return ctx.db.transaction((): SyncResponse => {
    const last = ctx.db.prepare('SELECT at FROM relay_syncs WHERE user_id = ? AND node_id = ?').get(userId, nodeId) as { at: number } | undefined;
    if (last && now - last.at < RELAY.cooldownMs) {
      fail('COOLDOWN', 'Relay recharging.', 400, { cooldownUntil: last.at + RELAY.cooldownMs });
    }
    ctx.db.prepare('INSERT OR REPLACE INTO relay_syncs (user_id, node_id, at) VALUES (?, ?, ?)').run(userId, nodeId, now);
    bumpQuota(ctx, userId, 'sync');
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
    missionBump(ctx, userId, 'relay_sync'); // Missions (Docs/13 §7)
    const levelUp = addXp(ctx, userId, xp);
    markTutorial(ctx, userId, 'synced');
    return { flux, shard, xp, firstVisit, cooldownUntil: now + RELAY.cooldownMs, levelUp, me: meView(ctx, userId) };
  })();
}
