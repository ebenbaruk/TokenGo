// Raid « Rogue Model » (Docs/13 §6) côté serveur : boss d'un événement de ville `rogue`, assauts de 3 manches (moteur de
// l'Arène), PV communs en direct (SSE `raid.hp`), coups des runners, résolution UNE fois (victoire ou temps écoulé).
// Règles pures : packages/shared/src/economy/raid.ts. Le client n'envoie que des intentions (équipe, modèle + technique).
// Tout le Flux passe par credit() (donc par l'outbox on-chain) ; aucun éclat créé, rien ne touche la Réserve.
import { cellToLatLng } from 'h3-js';
import {
  EVENT_ZONES, FAMILIES, FAMILY_INFO, RAID, RAID_BOSSES, haversineM, playRaidRound, raidAffinity, raidAssaultsLeft, raidBossTeam,
  raidFamiliesUsed, raidMaxHp, raidRanking, raidReward, rngFrom, seedFrom, startRaidAssault, validRaidTeam,
  type ArenaPick, type CityEvent, type CityEventSpec, type CityEventView, type Family, type RaidAssaultState, type RaidAssaultView,
  type RaidLeaderEntry, type RaidLive, type RaidPlayResponse, type RaidResultView, type RaidRound, type RaidRoundView,
  type RaidStartResponse, type RaidView, type Technique,
} from '@tokengo/shared';
import { kvGet, kvSet } from '../db.ts';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { randomId } from './crypto.ts';
import { addXp, credit, getUser, inventory, meView } from './players.ts';
import { assertCanAct } from './actions.ts';
import { addMastery, masteryLevels, masteryView } from './mastery.ts';
import { eventById } from './events.ts';
import { parisDayStart } from './reserve.ts';

interface RaidRow {
  event_id: number; forge_id: string; boss: string; seed: number; team: string; max_hp: number; hp: number;
  status: 'active' | 'won' | 'failed'; created_at: number; resolved_at: number | null;
}
interface AssaultRow { id: string; event_id: number; user_id: string; seed: number; state: string; status: 'open' | 'done' | 'expired'; created_at: number; finished_at: number | null }
interface DamageRow { event_id: number; user_id: string; damage: number; assaults: number; families: string; first_at: number; last_at: number; result: string | null }

const shortName = (name: string) => name.split(' —')[0]!;
const famName = (f: Family) => FAMILY_INFO[f].name;
const bossNameOf = (id: string) => RAID_BOSSES.find((b) => b.id === id)?.name ?? 'Rogue model';
const raidRow = (ctx: Ctx, eventId: number) => ctx.db.prepare('SELECT * FROM raids WHERE event_id = ?').get(eventId) as RaidRow | undefined;

// ───────────── Création (événement `rogue`) ─────────────

/** Joueurs réels actifs dans la dernière heure (PV du boss). */
export function activePlayers(ctx: Ctx): number {
  return (ctx.db.prepare('SELECT COUNT(*) n FROM users WHERE is_agent = 0 AND deleted_at IS NULL AND seen_at > ?')
    .get(ctx.now() - RAID.activeWindowMs) as { n: number }).n;
}

/** Forge de Paris (à ≤ 3 km d'une zone d'événement) la plus entourée de joueurs vus dans l'heure ; sinon tirée au sort. */
function busiestForge(ctx: Ctx, seq: number) {
  const paris = ctx.world.forges.filter((f) => EVENT_ZONES.some((z) => haversineM(z, f) <= 3000));
  const pool = paris.length ? paris : ctx.world.forges;
  if (!pool.length) return null;
  const seen = (ctx.db.prepare('SELECT seen_cell FROM users WHERE is_agent = 0 AND deleted_at IS NULL AND seen_at > ? AND seen_cell IS NOT NULL')
    .all(ctx.now() - RAID.activeWindowMs) as { seen_cell: string }[]).map((r) => { const [lat, lng] = cellToLatLng(r.seen_cell); return { lat, lng }; });
  const scored = pool.map((f) => ({ f, n: seen.filter((p) => haversineM(p, f) <= RAID.activityRadiusM).length }));
  const best = Math.max(...scored.map((x) => x.n));
  const top = scored.filter((x) => x.n === best);
  return top[Math.floor(rngFrom(ctx.cfg.SPAWN_SECRET, 'raid-forge', seq)() * top.length)]!.f;
}

/**
 * Demande d'événement `rogue` : Forge donnée (admin) ou près de l'activité récente, boss tiré au sort.
 * null si la Forge est inconnue (ou s'il n'y en a aucune).
 */
export function rogueSpec(ctx: Ctx, forgeId: string | null, seq: number): Omit<CityEventSpec, 'startsAt'> | null {
  const forge = forgeId ? ctx.world.forges.find((f) => f.id === forgeId) : busiestForge(ctx, seq);
  if (!forge) return null;
  const zone = [...EVENT_ZONES].sort((a, b) => haversineM(a, forge) - haversineM(b, forge))[0]!;
  const boss = RAID_BOSSES[Math.floor(rngFrom(ctx.cfg.SPAWN_SECRET, 'raid-boss', seq, forge.id, ctx.now())() * RAID_BOSSES.length)]!;
  return {
    kind: 'rogue', zone: zone.id, durationMs: RAID.durationMs,
    rogue: { forgeId: forge.id, name: shortName(forge.name), lat: forge.lat, lng: forge.lng, boss: boss.name },
  };
}

/** Crée le boss d'un événement `rogue` (dans la transaction de startEvent). PV figés à la création. */
export function createRaid(ctx: Ctx, ev: CityEvent): void {
  if (ev.kind !== 'rogue' || !ev.forgeId) return;
  const seed = seedFrom(ctx.cfg.SPAWN_SECRET, 'raid', ev.id);
  const boss = RAID_BOSSES.find((b) => b.name === ev.boss) ?? RAID_BOSSES[0];
  const hp = raidMaxHp(activePlayers(ctx));
  ctx.db.prepare('INSERT INTO raids (event_id, forge_id, boss, seed, team, max_hp, hp, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ev.id, ev.forgeId, boss.id, seed, JSON.stringify(raidBossTeam(seed)), hp, hp, 'active', ctx.now());
}

/** Raids automatiques : au plus 2 par jour de Paris, dans le créneau, avec une chance par événement dû. */
export function maybeAutoRogue(ctx: Ctx, seq: number, hour: number): Omit<CityEventSpec, 'startsAt'> | null {
  if (hour < RAID.autoFirstHour || hour >= RAID.autoLastHour) return null;
  const today = (ctx.db.prepare("SELECT COUNT(*) n FROM city_events WHERE kind = 'rogue' AND source = 'auto' AND starts_at >= ?")
    .get(parisDayStart(ctx.now())) as { n: number }).n;
  if (today >= RAID.autoMaxPerDay) return null;
  if (rngFrom(ctx.cfg.SPAWN_SECRET, 'raid-auto', seq)() >= RAID.autoChance) return null;
  return rogueSpec(ctx, null, seq);
}

// ───────────── Vues ─────────────

function liveOf(ctx: Ctx, row: RaidRow, e: CityEvent | null): RaidLive {
  const forge = ctx.world.forges.find((f) => f.id === row.forge_id);
  const aff = raidAffinity(row.seed, ctx.now());
  const participants = (ctx.db.prepare(`SELECT COUNT(*) n FROM raid_damage d JOIN users u ON u.id = d.user_id
    WHERE d.event_id = ? AND u.is_agent = 0 AND d.damage > 0`).get(row.event_id) as { n: number }).n;
  return {
    eventId: row.event_id, forgeId: row.forge_id, forgeName: forge ? shortName(forge.name) : row.forge_id, boss: bossNameOf(row.boss), bossId: row.boss,
    hp: row.hp, maxHp: row.max_hp, status: row.status, endsAt: e?.endsAt ?? row.created_at + RAID.durationMs,
    weakness: aff.weakness, resist: aff.resist, sliceEndsAt: aff.sliceEndsAt, participants,
  };
}

/** Joint l'état du raid à la vue de l'événement de ville (bannière, carte, /pulse). */
export function withRaid(ctx: Ctx, v: CityEventView | null): CityEventView | null {
  if (!v || v.kind !== 'rogue') return v;
  const row = raidRow(ctx, v.id);
  return { ...v, raid: row ? liveOf(ctx, row, v) : null };
}

function roundView(r: RaidRound): RaidRoundView {
  return { index: r.index, category: r.category, prompt: r.prompt, me: { ...r.me }, opp: { ...r.opp }, winner: r.winner, line: r.line, damage: r.damage, mult: r.mult };
}

function assaultView(ctx: Ctx, a: AssaultRow, s: RaidAssaultState, row: RaidRow): RaidAssaultView {
  const open = a.status === 'open' && s.status === 'open';
  const ch = open ? s.challenges[s.rounds.length] : undefined;
  const side = (c: RaidAssaultState['me']) => ({
    team: c.team.map((family) => ({ family, mastery: c.mastery[family] ?? 1 })), tokens: c.tokens, rateLimited: open ? c.last : null, wins: c.wins,
  });
  return {
    assaultId: a.id, eventId: a.event_id, boss: bossNameOf(row.boss), rounds: RAID.rounds, weakness: s.weakness, resist: s.resist, affinities: s.affinities,
    challenge: ch ? { index: s.rounds.length, category: ch.category, prompt: ch.prompt } : null,
    me: side(s.me), opp: side(s.boss), history: s.rounds.map(roundView), damage: s.damage,
    status: a.status === 'expired' ? 'expired' : s.status === 'done' ? 'done' : 'open', expiresAt: a.created_at + RAID.assaultTtlMs,
  };
}

const damageRow = (ctx: Ctx, eventId: number, userId: string) =>
  ctx.db.prepare('SELECT * FROM raid_damage WHERE event_id = ? AND user_id = ?').get(eventId, userId) as DamageRow | undefined;
const assaultsUsed = (ctx: Ctx, eventId: number, userId: string) =>
  (ctx.db.prepare('SELECT COUNT(*) n FROM raid_assaults WHERE event_id = ? AND user_id = ?').get(eventId, userId) as { n: number }).n;

/** Classement : tous les participants (runners compris) ; `rank` humain = rang parmi les joueurs réels (récompenses). */
function standings(ctx: Ctx, eventId: number) {
  const rows = ctx.db.prepare(`SELECT d.user_id, d.damage, d.first_at, d.families, u.handle, u.is_agent FROM raid_damage d JOIN users u ON u.id = d.user_id
    WHERE d.event_id = ? AND d.damage > 0`).all(eventId) as { user_id: string; damage: number; first_at: number; families: string; handle: string; is_agent: number }[];
  const all = raidRanking(rows.map((r) => ({ ...r, firstAt: r.first_at })));
  const humans = raidRanking(rows.filter((r) => !r.is_agent).map((r) => ({ ...r, firstAt: r.first_at })));
  return { all, humans };
}

function leaderboard(ctx: Ctx, eventId: number, userId: string): RaidLeaderEntry[] {
  return standings(ctx, eventId).all.slice(0, 10).map((r) => ({ rank: r.rank, handle: r.handle, damage: r.damage, agent: !!r.is_agent, me: r.user_id === userId }));
}

/** Assaut ouvert du joueur dans ce raid ; expire au passage ceux qui ont dépassé leur durée. */
function openAssaultOf(ctx: Ctx, userId: string, eventId: number): AssaultRow | null {
  const now = ctx.now();
  ctx.db.prepare("UPDATE raid_assaults SET status = 'expired', finished_at = ? WHERE user_id = ? AND status = 'open' AND created_at <= ?")
    .run(now, userId, now - RAID.assaultTtlMs);
  return (ctx.db.prepare("SELECT * FROM raid_assaults WHERE user_id = ? AND event_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1")
    .get(userId, eventId) as AssaultRow | undefined) ?? null;
}

function raidOf(ctx: Ctx, eventId: number): { row: RaidRow; e: CityEvent | null } {
  settleRaids(ctx);
  const row = raidRow(ctx, eventId);
  if (!row) return fail('NOT_FOUND', 'No rogue model here.', 404);
  return { row, e: eventById(ctx, eventId) };
}

export function viewRaid(ctx: Ctx, userId: string, eventId: number): RaidView {
  const { row, e } = raidOf(ctx, eventId);
  const inv = inventory(ctx, userId).shards;
  const mastery = masteryView(ctx, userId);
  const d = damageRow(ctx, eventId, userId);
  const used = assaultsUsed(ctx, eventId, userId);
  const open = row.status === 'active' ? openAssaultOf(ctx, userId, eventId) : null;
  const rank = standings(ctx, eventId).humans.find((r) => r.user_id === userId)?.rank ?? null;
  return {
    raid: liveOf(ctx, row, e),
    bossTeam: (JSON.parse(row.team) as Family[]).map((family) => ({ family, mastery: RAID.bossMastery })),
    leaderboard: leaderboard(ctx, eventId, userId),
    mine: { damage: d?.damage ?? 0, assaults: used, assaultsLeft: row.status === 'active' ? raidAssaultsLeft(used) : 0, rank },
    families: FAMILIES.map((family) => ({ family, owned: inv[family], mastery: mastery[family] })),
    openAssault: open ? assaultView(ctx, open, JSON.parse(open.state) as RaidAssaultState, row) : null,
    result: d?.result ? (JSON.parse(d.result) as RaidResultView) : null,
    me: meView(ctx, userId),
  };
}

// ───────────── Dégâts ─────────────

/**
 * Inflige des dégâts au boss (dans une transaction) : PV bornés à 0, cumul du participant, résolution si le boss tombe.
 * Renvoie les dégâts réellement appliqués (≤ PV restants) et si ce coup a résolu le raid.
 */
function applyDamage(ctx: Ctx, eventId: number, userId: string, dmg: number, families: Family[]): { applied: number; hp: number; killed: boolean } {
  const row = raidRow(ctx, eventId);
  if (!row || row.status !== 'active' || dmg <= 0) return { applied: 0, hp: row?.hp ?? 0, killed: false };
  const applied = Math.min(row.hp, Math.round(dmg));
  const now = ctx.now();
  ctx.db.prepare("UPDATE raids SET hp = hp - ? WHERE event_id = ? AND status = 'active'").run(applied, eventId);
  const prev = damageRow(ctx, eventId, userId);
  const fams = [...new Set([...(prev ? (JSON.parse(prev.families) as Family[]) : []), ...families])];
  ctx.db.prepare(`INSERT INTO raid_damage (event_id, user_id, damage, assaults, families, first_at, last_at) VALUES (?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET damage = damage + excluded.damage, families = excluded.families, last_at = excluded.last_at`)
    .run(eventId, userId, applied, JSON.stringify(fams), now, now);
  const hp = row.hp - applied;
  // annonce ticker (une fois) quand le boss passe sous la moitié de ses PV
  if (row.hp * 2 > row.max_hp && hp * 2 <= row.max_hp && hp > 0) {
    const forge = ctx.world.forges.find((f) => f.id === row.forge_id);
    ctx.bus.publish('raid.half', `${bossNameOf(row.boss)} is down to half HP at ${forge ? shortName(forge.name) : 'the Forge'} — keep pushing!`, { eventId });
  }
  const killed = hp <= 0 && resolveRaid(ctx, eventId, 'won');
  return { applied, hp, killed };
}

const broadcastHp = (ctx: Ctx, eventId: number, by: string, damage: number) => {
  const row = raidRow(ctx, eventId);
  if (row) ctx.bus.broadcast('raid.hp', `${by} hit ${bossNameOf(row.boss)} for ${damage}`, { eventId, hp: row.hp, maxHp: row.max_hp, by, damage });
};

/**
 * Résout le raid UNE seule fois (UPDATE conditionnel) : récompenses de chaque participant réel, titre Codex, ticker.
 * Victoire : l'événement de ville se termine tout de suite. À appeler dans une transaction. Renvoie false si déjà résolu.
 */
export function resolveRaid(ctx: Ctx, eventId: number, outcome: 'won' | 'failed'): boolean {
  const now = ctx.now();
  const r = ctx.db.prepare("UPDATE raids SET status = ?, resolved_at = ? WHERE event_id = ? AND status = 'active'").run(outcome, now, eventId);
  if (r.changes !== 1) return false;
  const row = raidRow(ctx, eventId)!;
  const boss = bossNameOf(row.boss);
  const forge = ctx.world.forges.find((f) => f.id === row.forge_id);
  const where = forge ? shortName(forge.name) : 'the Forge';
  const { humans } = standings(ctx, eventId);
  const total = humans.reduce((s, h) => s + h.damage, 0) || 1;
  for (const h of humans) {
    const rw = raidReward(outcome, h.rank);
    const fams = (JSON.parse(h.families) as Family[]).filter((f) => (FAMILIES as readonly string[]).includes(f));
    const gains = rw.mastery > 0 ? Object.fromEntries(fams.map((f) => [f, rw.mastery])) as Partial<Record<Family, number>> : {};
    const masteryUps = addMastery(ctx, h.user_id, gains);
    if (rw.flux > 0) credit(ctx, h.user_id, 'flux', rw.flux, `raid:${eventId}`);
    const levelUp = addXp(ctx, h.user_id, rw.xp);
    let title: string | null = null;
    if (outcome === 'won') {
      const t = ctx.db.prepare('INSERT OR IGNORE INTO user_titles (user_id, title_id, at) VALUES (?, ?, ?)').run(h.user_id, RAID.title.id, now);
      if (t.changes === 1) title = RAID.title.name;
    }
    const result: RaidResultView = {
      outcome, boss, xp: rw.xp, flux: rw.flux, top3: rw.top3, rank: h.rank, damage: h.damage, share: Math.round((h.damage / total) * 1000) / 1000,
      title, masteryGains: gains, masteryUps, levelUp,
    };
    ctx.db.prepare('UPDATE raid_damage SET result = ? WHERE event_id = ? AND user_id = ?').run(JSON.stringify(result), eventId, h.user_id);
  }
  ctx.db.prepare("UPDATE raid_assaults SET status = 'done', finished_at = ? WHERE event_id = ? AND status = 'open'").run(now, eventId);
  const top = humans.slice(0, 3).map((h) => h.handle).join(', ');
  if (outcome === 'won') {
    // fin immédiate de l'événement de ville (sans le « … is over » du tick : l'annonce de victoire suffit)
    const e = eventById(ctx, eventId);
    if (e && e.endsAt > now) {
      ctx.db.prepare('UPDATE city_events SET ends_at = ?, data = ? WHERE id = ?').run(now, JSON.stringify({ ...e, endsAt: now }), eventId);
      kvSet(ctx.db, 'city-event-ended', Math.max(eventId, kvGet<number>(ctx.db, 'city-event-ended') ?? 0));
    }
    ctx.bus.publish('city.raid.end', `The city contained ${boss} at ${where}!${top ? ` Top damage: ${top}` : ''}`,
      { eventId, outcome, boss, forgeId: row.forge_id, participants: humans.length });
  } else {
    ctx.bus.publish('city.raid.end', `${boss} escaped from ${where} — ${humans.length ? `${humans.length} runner${humans.length === 1 ? '' : 's'} fought it` : 'nobody showed up'}`,
      { eventId, outcome, boss, forgeId: row.forge_id, participants: humans.length });
  }
  return true;
}

/** Échec des raids dont l'événement est terminé (temps écoulé, arrêt admin, remplacé). Idempotent. */
export function settleRaids(ctx: Ctx): void {
  const now = ctx.now();
  const due = ctx.db.prepare(`SELECT r.event_id FROM raids r JOIN city_events e ON e.id = r.event_id WHERE r.status = 'active' AND e.ends_at <= ?`)
    .all(now) as { event_id: number }[];
  for (const d of due) ctx.db.transaction(() => resolveRaid(ctx, d.event_id, 'failed'))();
}

// ───────────── Assauts ─────────────

export function startAssault(ctx: Ctx, userId: string, eventId: number, team: string[]): RaidStartResponse {
  if (!validRaidTeam(team)) fail('BAD_TEAM', 'Pick 3 different models.');
  const fams = team as Family[];
  const { row, e } = raidOf(ctx, eventId);
  if (row.status !== 'active' || !e || e.endsAt <= ctx.now()) fail('RAID_OVER', row.status === 'won' ? 'The city already contained it!' : 'The rogue model is gone.');
  const forge = ctx.world.forges.find((f) => f.id === row.forge_id);
  if (!forge) return fail('NOT_FOUND', 'Unknown forge.', 404);
  const u = getUser(ctx, userId)!;
  assertCanAct(ctx, u, 'forge', forge);
  const inv = inventory(ctx, userId).shards;
  const lack = fams.find((f) => inv[f] < 1);
  if (lack) fail('BAD_TEAM', `You need at least one ${famName(lack)} shard to field it.`);
  const now = ctx.now();
  const a = ctx.db.transaction(() => {
    if (assaultsUsed(ctx, eventId, userId) >= RAID.assaultsPerRaid) fail('NO_ASSAULTS', `You already used your ${RAID.assaultsPerRaid} assaults on this rogue model.`);
    // un seul assaut à la fois : le précédent (abandonné) se termine, ses manches jouées ont déjà compté
    ctx.db.prepare("UPDATE raid_assaults SET status = 'expired', finished_at = ? WHERE user_id = ? AND status = 'open'").run(now, userId);
    const id = randomId(10);
    const seed = seedFrom(ctx.cfg.SPAWN_SECRET, 'raid-assault', id);
    const aff = raidAffinity(row.seed, now);
    const state = startRaidAssault(seed, { team: fams, mastery: masteryLevels(ctx, userId, fams) }, JSON.parse(row.team) as Family[], forge.theme, aff);
    ctx.db.prepare('INSERT INTO raid_assaults (id, event_id, user_id, seed, state, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, eventId, userId, seed, JSON.stringify(state), 'open', now);
    ctx.db.prepare(`INSERT INTO raid_damage (event_id, user_id, damage, assaults, families, first_at, last_at) VALUES (?, ?, 0, 1, '[]', ?, ?)
      ON CONFLICT(event_id, user_id) DO UPDATE SET assaults = assaults + 1, last_at = excluded.last_at`).run(eventId, userId, now, now);
    return ctx.db.prepare('SELECT * FROM raid_assaults WHERE id = ?').get(id) as AssaultRow;
  })();
  return { assault: assaultView(ctx, a, JSON.parse(a.state) as RaidAssaultState, row), raid: liveOf(ctx, row, e), me: meView(ctx, userId) };
}

const PLAY_ERRORS: Record<string, [string, string]> = {
  NOT_IN_TEAM: ['BAD_TEAM', 'That model is not in your team.'],
  NO_TOKENS: ['NO_TOKENS', 'Not enough tokens left for that technique.'],
  BAD_TECHNIQUE: ['BAD_REQUEST', 'Unknown technique.'],
  OVER: ['EXPIRED', 'This assault is over.'],
};

export function playAssault(ctx: Ctx, userId: string, assaultId: string, pick: { family: Family; technique: Technique }): RaidPlayResponse {
  const a = ctx.db.prepare('SELECT * FROM raid_assaults WHERE id = ? AND user_id = ?').get(assaultId, userId) as AssaultRow | undefined;
  if (!a) return fail('NOT_FOUND', 'No such assault.', 404);
  const { row, e } = raidOf(ctx, a.event_id);
  const now = ctx.now();
  if (row.status !== 'active') fail('RAID_OVER', row.status === 'won' ? 'The city already contained it!' : 'The rogue model escaped.');
  if (a.status === 'open' && a.created_at + RAID.assaultTtlMs <= now) {
    ctx.db.prepare("UPDATE raid_assaults SET status = 'expired', finished_at = ? WHERE id = ?").run(now, a.id);
    fail('EXPIRED', 'Too slow — this assault timed out. Start a new one.');
  }
  if (a.status !== 'open') fail('EXPIRED', 'This assault is over.');
  const state = JSON.parse(a.state) as RaidAssaultState;
  const r = playRaidRound(state, pick as ArenaPick);
  if ('error' in r) {
    if (r.error === 'RATE_LIMITED') fail('MODEL_RATE_LIMITED', `${famName(pick.family)} is rate-limited this round — rotate your team.`, 400, { family: pick.family });
    const [code, msg] = PLAY_ERRORS[r.error]!;
    fail(code, msg);
  }
  const ok = r as { state: RaidAssaultState; round: RaidRound };
  const handle = getUser(ctx, userId)?.handle ?? 'a runner';
  const out = ctx.db.transaction(() => {
    const cur = ctx.db.prepare('SELECT state, status FROM raid_assaults WHERE id = ?').get(a.id) as { state: string; status: string };
    if (cur.status !== 'open' || cur.state !== a.state) fail('EXPIRED', 'This round was already played.'); // double envoi
    const hit = applyDamage(ctx, a.event_id, userId, ok.round.damage, raidFamiliesUsed([ok.round]));
    // dégâts réellement appliqués (le dernier coup ne dépasse pas les PV restants)
    const round: RaidRound = { ...ok.round, damage: hit.applied };
    const st: RaidAssaultState = { ...ok.state, rounds: [...ok.state.rounds.slice(0, -1), round], damage: state.damage + hit.applied };
    const status = hit.killed || st.status === 'done' ? 'done' : 'open';
    if (hit.killed) st.status = 'done';
    ctx.db.prepare('UPDATE raid_assaults SET state = ?, status = ?, finished_at = ? WHERE id = ?')
      .run(JSON.stringify(st), status, status === 'done' ? now : null, a.id);
    return { round, st, hit };
  })();
  if (out.hit.applied > 0) broadcastHp(ctx, a.event_id, handle, out.hit.applied);
  const row2 = raidRow(ctx, a.event_id)!;
  const a2 = ctx.db.prepare('SELECT * FROM raid_assaults WHERE id = ?').get(a.id) as AssaultRow;
  const d = damageRow(ctx, a.event_id, userId);
  return {
    round: roundView(out.round), assault: assaultView(ctx, a2, out.st, row2), raid: liveOf(ctx, row2, eventById(ctx, a.event_id) ?? e),
    result: d?.result ? (JSON.parse(d.result) as RaidResultView) : null, me: meView(ctx, userId),
  };
}

// ───────────── Runners (bots) ─────────────

/**
 * Un runner-agent tape le boss de temps en temps (au plus un coup par minute, dégâts modestes 15–30) : le boss tombe
 * même avec peu de joueurs, mais les vrais joueurs font la différence. Appelé à chaque boucle des runners.
 */
export function raidBotTick(ctx: Ctx, runnerIds: readonly string[]): number {
  if (!runnerIds.length) return 0;
  const now = ctx.now();
  const row = ctx.db.prepare(`SELECT r.* FROM raids r JOIN city_events e ON e.id = r.event_id WHERE r.status = 'active' AND e.starts_at <= ? AND e.ends_at > ?
    ORDER BY r.event_id DESC LIMIT 1`).get(now, now) as RaidRow | undefined;
  if (!row) return 0;
  const last = kvGet<number>(ctx.db, 'raid-bot-last') ?? 0;
  if (now - last < RAID.botEveryMs) return 0;
  const rng = rngFrom(ctx.cfg.SPAWN_SECRET, 'raid-bot', row.event_id, Math.floor(now / 10_000));
  if (rng() >= RAID.botChance) return 0;
  const id = runnerIds[Math.floor(rng() * runnerIds.length)]!;
  const u = getUser(ctx, id);
  if (!u) return 0;
  const dmg = RAID.botDamageMin + Math.floor(rng() * (RAID.botDamageMax - RAID.botDamageMin + 1));
  const fam = FAMILIES[Math.floor(rng() * FAMILIES.length)]!;
  kvSet(ctx.db, 'raid-bot-last', now);
  const hit = ctx.db.transaction(() => applyDamage(ctx, row.event_id, id, dmg, [fam]))();
  if (hit.applied > 0) broadcastHp(ctx, row.event_id, u.handle, hit.applied);
  return hit.applied;
}

// ───────────── Crochets pour les autres systèmes ─────────────

/** Dégâts infligés aujourd'hui (jour de Paris) par un joueur, tous raids confondus — pour les missions du jour (Docs/13 §7). */
export function raidDamageToday(ctx: Ctx, userId: string): number {
  return (ctx.db.prepare('SELECT COALESCE(SUM(damage), 0) n FROM raid_damage WHERE user_id = ? AND last_at >= ?')
    .get(userId, parisDayStart(ctx.now())) as { n: number }).n;
}

/** Titres spéciaux gagnés (Codex) : « Rogue Slayer » au premier raid gagné. */
export function specialTitles(ctx: Ctx, userId: string): string[] {
  return (ctx.db.prepare('SELECT title_id FROM user_titles WHERE user_id = ? ORDER BY at').all(userId) as { title_id: string }[]).map((r) => r.title_id);
}

/** e2e / tests seulement (route absente hors NODE_ENV=test) : force les PV du boss. */
export function setRaidHpForTest(ctx: Ctx, eventId: number, hp: number): RaidLive {
  const row = raidRow(ctx, eventId);
  if (!row || row.status !== 'active') return fail('NOT_FOUND', 'No active raid.', 404);
  ctx.db.prepare('UPDATE raids SET hp = ? WHERE event_id = ?').run(Math.max(1, Math.min(row.max_hp, Math.round(hp))), eventId);
  return liveOf(ctx, raidRow(ctx, eventId)!, eventById(ctx, eventId));
}
