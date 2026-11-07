// Arène des modèles (Docs/13 §4) côté serveur : Gardien du jour, Champion « fantôme » figé, combats (départ, manches,
// fin), revenu borné du Champion, échéance de 48 h. Les règles sont les fonctions pures de packages/shared/src/economy/arena.ts.
// Le client n'envoie que des intentions (équipe, modèle + technique) ; chaque mouvement de Flux passe par credit/debit
// (donc par l'outbox on-chain). Rien ne touche la Réserve ni les crédits réels.
import {
  ARENA, FAMILIES, FAMILY_INFO, arenaFinalLine, battleRewards, guardianMastery, guardianTeam, masteryGains, playArenaRound,
  rngFrom, seedFrom, startArenaBattle, validArenaTeam, championAccrual,
  type ArenaBadge, type ArenaBattleState, type ArenaBattleView, type ArenaHolderView, type ArenaPick, type ArenaPlayResponse,
  type ArenaResultView, type ArenaRound, type ArenaRoundView, type ArenaStartResponse, type ArenaView, type Family, type Technique,
} from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { randomId } from './crypto.ts';
import { addXp, balance, credit, debit, getUser, inventory, levelOf, meView } from './players.ts';
import { assertCanAct } from './actions.ts';
import { assertQuota, quotaUsed } from './quotas.ts';
import { parisDay } from './reserve.ts';
import { addMastery, masteryLevels, masteryView, touchChampion } from './mastery.ts';

interface ArenaRow { forge_id: string; champion_user: string; team: string; mastery: string; since: number; active_at: number; last_paid: number }
interface BattleRow {
  id: string; user_id: string; forge_id: string; seed: number; team: string; opp: string; state: string;
  status: 'open' | 'won' | 'lost' | 'expired'; result: string | null; created_at: number; finished_at: number | null;
}
/** Adversaire d'un combat, figé au départ. userId = Champion défié (null = Gardien). */
interface Opp { kind: 'guardian' | 'champion'; userId: string | null; name: string; team: Family[]; mastery: Record<Family, number> }

const INCOME_KIND = 'arena-income'; // daily_counts : Flux de revenu de Champion versés aujourd'hui

function forgeOf(ctx: Ctx, forgeId: string) {
  const f = ctx.world.forges.find((x) => x.id === forgeId);
  if (!f) return fail('NOT_FOUND', 'Unknown arena.', 404);
  return f;
}
const shortName = (name: string) => name.split(' —')[0]!;
const famName = (f: Family) => FAMILY_INFO[f].name;

/** Gardien du jour : équipe tirée par (forge, jour de Paris), maîtrise 2 + (jour mod 3). */
function guardianOf(ctx: Ctx, forge: { id: string; name: string }): Opp {
  const day = parisDay(ctx.now());
  const team = guardianTeam(rngFrom(ctx.cfg.SPAWN_SECRET, 'guardian', forge.id, day));
  const m = guardianMastery(day);
  return { kind: 'guardian', userId: null, name: `Sentinel of ${shortName(forge.name)}`, team, mastery: Object.fromEntries(team.map((f) => [f, m])) as Record<Family, number> };
}

const arenaRow = (ctx: Ctx, forgeId: string) =>
  ctx.db.prepare('SELECT * FROM arenas WHERE forge_id = ?').get(forgeId) as ArenaRow | undefined;
const handleOf = (ctx: Ctx, userId: string) => getUser(ctx, userId)?.handle ?? 'a runner';
const championOpp = (ctx: Ctx, row: ArenaRow): Opp =>
  ({ kind: 'champion', userId: row.champion_user, name: handleOf(ctx, row.champion_user), team: JSON.parse(row.team) as Family[], mastery: JSON.parse(row.mastery) as Record<Family, number> });

function incomeToday(ctx: Ctx, userId: string): number {
  const r = ctx.db.prepare('SELECT n FROM daily_counts WHERE user_id = ? AND day = ? AND kind = ?').get(userId, parisDay(ctx.now()), INCOME_KIND) as { n: number } | undefined;
  return r?.n ?? 0;
}

/** Verse au Champion son revenu jusqu'à `until` (+4 ƒ / 10 min, plafond du jour). Renvoie les Flux versés. */
function payChampion(ctx: Ctx, row: ArenaRow, until: number): number {
  const { flux, lastPaid } = championAccrual(row.last_paid, until, incomeToday(ctx, row.champion_user));
  if (lastPaid === row.last_paid) return 0;
  ctx.db.prepare('UPDATE arenas SET last_paid = ? WHERE forge_id = ?').run(lastPaid, row.forge_id);
  row.last_paid = lastPaid;
  if (flux > 0) {
    credit(ctx, row.champion_user, 'flux', flux, `arena-income:${row.forge_id}`);
    ctx.db.prepare(`INSERT INTO daily_counts (user_id, day, kind, n) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, day, kind) DO UPDATE SET n = n + excluded.n`).run(row.champion_user, parisDay(ctx.now()), INCOME_KIND, flux);
  }
  return flux;
}

/**
 * Règle une arène maintenant : revenu du Champion (jusqu'à l'échéance au plus), puis retour au Gardien si le Champion
 * n'a plus joué depuis 48 h (ou a supprimé son compte). Renvoie la ligne du Champion en place, et ce qui vient d'être versé.
 */
function settleArena(ctx: Ctx, forge: { id: string; name: string }): { row: ArenaRow | null; paid: number } {
  const row = arenaRow(ctx, forge.id);
  if (!row) return { row: null, paid: 0 };
  const now = ctx.now();
  const expiry = row.active_at + ARENA.championExpiryMs;
  const gone = !!getUser(ctx, row.champion_user)?.deleted_at;
  const paid = gone ? 0 : payChampion(ctx, row, Math.min(now, expiry));
  if (gone || now >= expiry) {
    ctx.db.prepare('DELETE FROM arenas WHERE forge_id = ?').run(forge.id);
    const g = guardianOf(ctx, forge);
    ctx.bus.publish('arena.guardian', `${g.name} reclaims the arena — ${handleOf(ctx, row.champion_user)} went quiet`, { forgeId: forge.id });
    return { row: null, paid };
  }
  return { row, paid };
}

/** Badge de la carte (lecture seule, sans versement) : couronne du Champion ou bouclier du Gardien. */
export function arenaBadge(ctx: Ctx, forgeId: string, userId: string): ArenaBadge {
  const row = arenaRow(ctx, forgeId);
  if (!row || row.active_at + ARENA.championExpiryMs <= ctx.now()) return { holder: 'guardian', champion: null, mine: false };
  return { holder: 'champion', champion: handleOf(ctx, row.champion_user), mine: row.champion_user === userId };
}

function holderView(ctx: Ctx, forge: { id: string; name: string }, row: ArenaRow | null, userId: string): ArenaHolderView {
  const o = row ? championOpp(ctx, row) : guardianOf(ctx, forge);
  return {
    kind: o.kind, name: o.name, team: o.team.map((family) => ({ family, mastery: o.mastery[family] ?? 1 })),
    since: row?.since ?? null, expiresAt: row ? row.active_at + ARENA.championExpiryMs : null, mine: row?.champion_user === userId,
  };
}

// ───────────── Vues ─────────────

function roundView(r: ArenaRound): ArenaRoundView {
  return { index: r.index, category: r.category, prompt: r.prompt, me: { ...r.me }, opp: { ...r.opp }, winner: r.winner, line: r.line };
}

function battleView(ctx: Ctx, b: BattleRow, s: ArenaBattleState): ArenaBattleView {
  const opp = JSON.parse(b.opp) as Opp;
  const forge = ctx.world.forges.find((x) => x.id === b.forge_id);
  const open = b.status === 'open' && s.status === 'open';
  const ch = open ? s.challenges[s.rounds.length] : undefined;
  const side = (c: ArenaBattleState['me']) => ({
    team: c.team.map((family) => ({ family, mastery: c.mastery[family] ?? 1 })), tokens: c.tokens, rateLimited: open ? c.last : null, wins: c.wins,
  });
  return {
    battleId: b.id, forgeId: b.forge_id, forgeName: forge?.name ?? b.forge_id, opponent: { kind: opp.kind, name: opp.name }, affinities: s.affinities,
    rounds: ARENA.rounds, challenge: ch ? { index: s.rounds.length, category: ch.category, prompt: ch.prompt } : null,
    me: side(s.me), opp: side(s.opp), history: s.rounds.map(roundView),
    status: b.status === 'expired' ? 'expired' : s.status, expiresAt: b.created_at + ARENA.battleTtlMs,
    result: b.result ? (JSON.parse(b.result) as ArenaResultView) : null,
  };
}

/** Combat en cours (non expiré) du joueur ; expire au passage ceux qui ont dépassé leur durée. */
function openBattleOf(ctx: Ctx, userId: string): BattleRow | null {
  const now = ctx.now();
  ctx.db.prepare("UPDATE battles SET status = 'expired', finished_at = ? WHERE user_id = ? AND status = 'open' AND created_at <= ?")
    .run(now, userId, now - ARENA.battleTtlMs);
  return (ctx.db.prepare("SELECT * FROM battles WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").get(userId) as BattleRow | undefined) ?? null;
}

export function viewArena(ctx: Ctx, userId: string, forgeId: string): ArenaView {
  const forge = forgeOf(ctx, forgeId);
  const u = getUser(ctx, userId)!;
  const { row, paid } = ctx.db.transaction(() => settleArena(ctx, forge))();
  const mine = row?.champion_user === userId;
  const inv = inventory(ctx, userId).shards;
  const mastery = masteryView(ctx, userId);
  const open = openBattleOf(ctx, userId);
  const locked = levelOf(u) < ARENA.level ? `Arena unlocks at level ${ARENA.level}.` : mine ? 'You hold this arena — your ghost team defends it.' : null;
  return {
    forgeId: forge.id, forgeName: forge.name, affinities: forge.theme, holder: holderView(ctx, forge, row, userId),
    families: FAMILIES.map((family) => ({ family, owned: inv[family], mastery: mastery[family] })),
    fee: ARENA.entryFee, battlesLeft: Math.max(0, ARENA.battlesPerDay - quotaUsed(ctx, userId, 'battle')), battlesPerDay: ARENA.battlesPerDay,
    locked, income: mine ? { paid, paidToday: incomeToday(ctx, userId), maxDay: ARENA.championFluxMaxDay } : null,
    openBattle: open && open.forge_id === forge.id ? battleView(ctx, open, JSON.parse(open.state) as ArenaBattleState) : null,
    me: meView(ctx, userId),
  };
}

// ───────────── Combat ─────────────

export function startBattle(ctx: Ctx, userId: string, forgeId: string, team: string[]): ArenaStartResponse {
  if (!validArenaTeam(team)) fail('BAD_TEAM', 'Pick 3 different models.');
  const fams = team as Family[];
  const forge = forgeOf(ctx, forgeId);
  const u = getUser(ctx, userId)!;
  if (levelOf(u) < ARENA.level) fail('LEVEL_LOCKED', `Arena unlocks at level ${ARENA.level}.`);
  assertCanAct(ctx, u, 'forge', forge);
  assertQuota(ctx, userId, 'battle');
  const inv = inventory(ctx, userId).shards;
  const lack = fams.find((f) => inv[f] < 1);
  if (lack) fail('BAD_TEAM', `You need at least one ${famName(lack)} shard to field it.`);
  if (balance(ctx, userId, 'flux') < ARENA.entryFee) fail('INSUFFICIENT', `The entry fee is ${ARENA.entryFee} ƒ.`);
  const now = ctx.now();
  const res = ctx.db.transaction(() => {
    const { row } = settleArena(ctx, forge);
    if (row?.champion_user === userId) fail('OWN_ARENA', 'You already hold this arena.');
    // un seul combat à la fois : le précédent (abandonné) expire, frais perdus
    ctx.db.prepare("UPDATE battles SET status = 'expired', finished_at = ? WHERE user_id = ? AND status = 'open'").run(now, userId);
    const id = randomId(10);
    debit(ctx, userId, 'flux', ARENA.entryFee, `arena:${id}`);
    const opp = row ? championOpp(ctx, row) : guardianOf(ctx, forge);
    const seed = seedFrom(ctx.cfg.SPAWN_SECRET, 'arena', id);
    const state = startArenaBattle(seed, { team: fams, mastery: masteryLevels(ctx, userId, fams) }, { team: opp.team, mastery: opp.mastery }, forge.theme);
    ctx.db.prepare('INSERT INTO battles (id, user_id, forge_id, seed, team, opp, state, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, forge.id, seed, JSON.stringify(fams), JSON.stringify(opp), JSON.stringify(state), 'open', now);
    touchChampion(ctx, userId);
    return ctx.db.prepare('SELECT * FROM battles WHERE id = ?').get(id) as BattleRow;
  })();
  return { battle: battleView(ctx, res, JSON.parse(res.state) as ArenaBattleState), me: meView(ctx, userId) };
}

const PLAY_ERRORS: Record<string, [string, string]> = {
  NOT_IN_TEAM: ['BAD_TEAM', 'That model is not in your team.'],
  NO_TOKENS: ['NO_TOKENS', 'Not enough tokens left for that technique.'],
  BAD_TECHNIQUE: ['BAD_REQUEST', 'Unknown technique.'],
  OVER: ['EXPIRED', 'This battle is over.'],
};

export function playBattle(ctx: Ctx, userId: string, battleId: string, pick: { family: Family; technique: Technique }): ArenaPlayResponse {
  const b = ctx.db.prepare('SELECT * FROM battles WHERE id = ? AND user_id = ?').get(battleId, userId) as BattleRow | undefined;
  if (!b) return fail('NOT_FOUND', 'No such battle.', 404);
  const now = ctx.now();
  if (b.status === 'open' && b.created_at + ARENA.battleTtlMs <= now) {
    ctx.db.prepare("UPDATE battles SET status = 'expired', finished_at = ? WHERE id = ?").run(now, b.id);
    fail('EXPIRED', 'Too slow — the judges went home. Start a new battle.');
  }
  if (b.status !== 'open') fail('EXPIRED', 'This battle is over.');
  const state = JSON.parse(b.state) as ArenaBattleState;
  const r = playArenaRound(state, pick as ArenaPick);
  if ('error' in r) {
    if (r.error === 'RATE_LIMITED') fail('MODEL_RATE_LIMITED', `${famName(pick.family)} is rate-limited this round — rotate your team.`, 400, { family: pick.family });
    const [code, msg] = PLAY_ERRORS[r.error]!;
    fail(code, msg);
  }
  const ok = r as { state: ArenaBattleState; round: ArenaRound };
  const row = ctx.db.transaction((): BattleRow => {
    const cur = ctx.db.prepare('SELECT state, status FROM battles WHERE id = ?').get(b.id) as { state: string; status: string };
    if (cur.status !== 'open' || cur.state !== b.state) fail('EXPIRED', 'This round was already played.'); // double envoi
    ctx.db.prepare('UPDATE battles SET state = ? WHERE id = ?').run(JSON.stringify(ok.state), b.id);
    if (ok.state.status !== 'open') finishBattle(ctx, b, ok.state);
    return ctx.db.prepare('SELECT * FROM battles WHERE id = ?').get(b.id) as BattleRow;
  })();
  return { round: roundView(ok.round), battle: battleView(ctx, row, ok.state), me: meView(ctx, userId) };
}

/** Fin de combat (dans la transaction de la dernière manche) : récompenses bornées, maîtrise, couronne éventuelle. */
function finishBattle(ctx: Ctx, b: BattleRow, s: ArenaBattleState) {
  const now = ctx.now();
  const opp = JSON.parse(b.opp) as Opp;
  const forge = forgeOf(ctx, b.forge_id);
  const outcome = s.status === 'won' ? 'won' : 'lost';
  const rw = battleRewards(outcome, opp.kind);
  const gains = masteryGains(s.rounds);
  const masteryUps = addMastery(ctx, b.user_id, gains);
  if (rw.flux > 0) credit(ctx, b.user_id, 'flux', rw.flux, `arena:${b.id}`);
  const levelUp = addXp(ctx, b.user_id, rw.xp);
  let becameChampion = false;
  let note: string | null = null;
  if (outcome === 'won') {
    const { row } = settleArena(ctx, forge); // verse le revenu du Champion battu jusqu'à maintenant
    if ((row?.champion_user ?? null) === opp.userId && row?.champion_user !== b.user_id) {
      ctx.db.prepare(`INSERT INTO arenas (forge_id, champion_user, team, mastery, since, active_at, last_paid) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(forge_id) DO UPDATE SET champion_user = excluded.champion_user, team = excluded.team, mastery = excluded.mastery,
          since = excluded.since, active_at = excluded.active_at, last_paid = excluded.last_paid`)
        .run(forge.id, b.user_id, JSON.stringify(s.me.team), JSON.stringify(s.me.mastery), now, now, now);
      becameChampion = true;
      const who = handleOf(ctx, b.user_id);
      ctx.bus.publish('arena.champion', `${who} is the new Champion of ${shortName(forge.name)}${opp.kind === 'champion' ? ` — dethroned ${opp.name}` : ''}`,
        { forgeId: forge.id, champion: who, team: s.me.team });
    } else note = 'The arena changed hands during your battle — no crown this time.';
  }
  const result: ArenaResultView = {
    outcome, xp: rw.xp, flux: rw.flux, fee: ARENA.entryFee, becameChampion, line: arenaFinalLine(s.seed, outcome),
    masteryGains: gains, masteryUps, levelUp, note,
  };
  ctx.db.prepare('UPDATE battles SET status = ?, result = ?, finished_at = ? WHERE id = ?').run(outcome, JSON.stringify(result), now, b.id);
}
