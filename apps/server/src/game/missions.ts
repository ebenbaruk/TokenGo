// Missions du jour (Docs/13 §7) côté serveur : tirage figé à la 1re consultation du jour, compteurs incrémentés par les
// actions (UN appel par site : capture, décodage, arène, marchandage, commerce, relais, raid), réclamation bornée.
// Règles pures : packages/shared/src/economy/missions.ts. Récompenses via credit/addXp (journal + outbox on-chain) ;
// rien ne touche la Réserve.
//
// Crochets à appeler (dans la transaction de l'action, AVANT le meView de la réponse pour que la pastille soit à jour) :
//   missionBump(ctx, userId, key, n = 1)       compteur simple (decode, arena_win, arena_rounds, haggle_deal, relay_sync, raid_damage)
//   missionMark(ctx, userId, key, item)        compteur « distinct » (shops : id du marchand)
//   missionsOnCatch(ctx, userId, catch)        capture réussie : familles distinctes, combo ×3, variante Night/Landmark
import {
  ARENA, MISSION_CATALOG, MISSIONS, checkClaim, chestReward, drawMissions, missionReward, missionState, rngFrom, shardToken,
  type Family, type MissionBadge, type MissionClaimResponse, type MissionKind, type MissionState, type MissionsView, type Variant,
} from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { addXp, credit, getUser, levelOf, meView } from './players.ts';
import { parisDay, parisDayStart } from './reserve.ts';
import { activeEvent } from './events.ts';

interface MissionRow { user_id: string; day: string; kinds: string; claimed: string; chest_at: number | null }

/** Un raid Rogue est-il en cours ? (comparaison par chaîne : le type d'événement `rogue` arrive avec le raid, Docs/13 §6) */
const raidActive = (ctx: Ctx) => (activeEvent(ctx)?.kind as string | undefined) === 'rogue';

const today = (ctx: Ctx) => parisDay(ctx.now());

/** Missions du jour du joueur : tirées et enregistrées à la première consultation (le tirage ne bouge plus ensuite). */
function rowFor(ctx: Ctx, userId: string): MissionRow {
  const day = today(ctx);
  const get = () => ctx.db.prepare('SELECT * FROM daily_missions WHERE user_id = ? AND day = ?').get(userId, day) as MissionRow | undefined;
  const cur = get();
  if (cur) return cur;
  const u = getUser(ctx, userId);
  const kinds = drawMissions(rngFrom(ctx.cfg.SPAWN_SECRET, 'missions', userId, day), {
    arenaUnlocked: !!u && levelOf(u) >= ARENA.level, raidActive: raidActive(ctx),
  });
  ctx.db.prepare('INSERT OR IGNORE INTO daily_missions (user_id, day, kinds, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, day, JSON.stringify(kinds), ctx.now());
  return get()!;
}

function countsFor(ctx: Ctx, userId: string, day: string): Map<string, number> {
  const rows = ctx.db.prepare('SELECT key, n FROM mission_counts WHERE user_id = ? AND day = ?').all(userId, day) as { key: string; n: number }[];
  return new Map(rows.map((r) => [r.key, r.n]));
}

function statesOf(ctx: Ctx, row: MissionRow): MissionState[] {
  const counts = countsFor(ctx, row.user_id, row.day);
  const claimed = new Set(JSON.parse(row.claimed) as MissionKind[]);
  return (JSON.parse(row.kinds) as MissionKind[]).map((k) => missionState(k, counts.get(k) ?? 0, claimed.has(k)));
}

// ───── Crochets (compteurs) ─────

/** +n sur un compteur du jour. Sans effet si n ≤ 0. */
export function missionBump(ctx: Ctx, userId: string, key: MissionKind, n = 1): void {
  if (!(n > 0)) return;
  ctx.db.prepare(`INSERT INTO mission_counts (user_id, day, key, n) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, day, key) DO UPDATE SET n = n + excluded.n`).run(userId, today(ctx), key, Math.round(n));
}

/** Compteur « distinct » : `item` ne compte qu'une fois par jour pour cette clé. */
export function missionMark(ctx: Ctx, userId: string, key: MissionKind, item: string): void {
  const r = ctx.db.prepare('INSERT OR IGNORE INTO mission_marks (user_id, day, key, item) VALUES (?, ?, ?, ?)').run(userId, today(ctx), key, item);
  if (r.changes === 1) missionBump(ctx, userId, key);
}

/** Capture réussie (dans la transaction de grantCatch). */
export function missionsOnCatch(ctx: Ctx, userId: string, c: { family: Family; combo: number; variant: Variant }): void {
  missionMark(ctx, userId, 'catch_families', c.family);
  if (c.combo >= 3) missionMark(ctx, userId, 'combo3', 'x3');
  if (c.variant === 'night' || c.variant === 'landmark') missionMark(ctx, userId, 'rare_variant', 'v');
}

// ───── Vues ─────

export function missionsView(ctx: Ctx, userId: string): MissionsView {
  const row = rowFor(ctx, userId);
  const states = statesOf(ctx, row);
  const rw = missionReward();
  const chest = chestReward();
  return {
    day: row.day,
    missions: states.map((s) => {
      const r = MISSION_CATALOG[s.kind];
      return { id: s.kind, title: r.title, hint: r.hint, icon: r.icon, group: r.group, progress: s.progress, goal: s.goal, done: s.done, claimed: s.claimed, reward: rw };
    }),
    claimed: states.filter((s) => s.claimed).length,
    chest: { flux: chest.flux, shard: chest.shard, opened: row.chest_at !== null },
    resetAt: parisDayStart(parisDayStart(ctx.now()) + 26 * 3600_000),
  };
}

/** Résumé pour `Me` (pastille rouge du bouton Quests). */
export function missionBadge(ctx: Ctx, userId: string): MissionBadge {
  const row = rowFor(ctx, userId);
  const states = statesOf(ctx, row);
  const ready = states.filter((s) => s.done && !s.claimed).map((s) => s.kind);
  return { ready: ready.length, claimed: states.filter((s) => s.claimed).length, total: states.length, chest: row.chest_at !== null, readyIds: ready };
}

// ───── Réclamation ─────

const CLAIM_ERRORS = {
  NOT_TODAY: ['NOT_FOUND', 'That mission is not on today’s list.', 404],
  NOT_DONE: ['MISSION_NOT_DONE', 'Not done yet — keep going!', 400],
  ALREADY_CLAIMED: ['MISSION_CLAIMED', 'Already claimed.', 400],
} as const;

/** POST /api/missions/:id/claim — +40 XP +15 ƒ ; la 3e ouvre le coffre (+60 ƒ + 1 Gemini, une fois par jour). */
export function claimMission(ctx: Ctx, userId: string, id: string): MissionClaimResponse {
  return ctx.db.transaction((): MissionClaimResponse => {
    const row = rowFor(ctx, userId);
    const kind = id as MissionKind;
    const c = checkClaim(statesOf(ctx, row), kind);
    if (!c.ok) {
      const [code, msg, status] = CLAIM_ERRORS[c.error];
      return fail(code, msg, status);
    }
    const claimed = [...(JSON.parse(row.claimed) as MissionKind[]), kind];
    // garde contre le double envoi : la ligne ne change que si `claimed` est toujours celle qu'on a lue
    const upd = ctx.db.prepare('UPDATE daily_missions SET claimed = ? WHERE user_id = ? AND day = ? AND claimed = ?')
      .run(JSON.stringify(claimed), userId, row.day, row.claimed);
    if (upd.changes !== 1) fail('MISSION_CLAIMED', 'Already claimed.');
    const rw = missionReward();
    credit(ctx, userId, 'flux', rw.flux, `mission:${row.day}:${kind}`);
    const levelUp = addXp(ctx, userId, rw.xp);
    let chest: MissionClaimResponse['chest'] = null;
    if (c.chest) {
      const open = ctx.db.prepare('UPDATE daily_missions SET chest_at = ? WHERE user_id = ? AND day = ? AND chest_at IS NULL').run(ctx.now(), userId, row.day);
      if (open.changes === 1) {
        chest = chestReward();
        credit(ctx, userId, 'flux', chest.flux, `mission-chest:${row.day}`);
        credit(ctx, userId, shardToken(chest.shard), 1, `mission-chest:${row.day}`);
        const u = getUser(ctx, userId);
        ctx.bus.publish('missions.chest', `${u?.handle ?? 'A runner'} cleared all 3 daily missions`, {});
      }
    }
    return { missions: missionsView(ctx, userId), reward: rw, chest, levelUp, me: meView(ctx, userId) };
  })();
}

/** Tests seulement (route montée si NODE_ENV=test, jeton admin) : fixe les missions du jour et/ou ajoute à un compteur. */
export function missionsForTest(ctx: Ctx, userId: string, opts: { kinds?: MissionKind[]; bump?: { key: MissionKind; n: number } }): MissionsView {
  rowFor(ctx, userId);
  if (opts.kinds) {
    ctx.db.prepare("UPDATE daily_missions SET kinds = ?, claimed = '[]', chest_at = NULL WHERE user_id = ? AND day = ?")
      .run(JSON.stringify(opts.kinds.slice(0, MISSIONS.perDay)), userId, today(ctx));
  }
  if (opts.bump) missionBump(ctx, userId, opts.bump.key, opts.bump.n);
  return missionsView(ctx, userId);
}
