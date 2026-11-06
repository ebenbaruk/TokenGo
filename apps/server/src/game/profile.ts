// Profil : pseudo, district, suppression du compte (RGPD minimal, Docs/08 §5), classements (Docs/02 §9).
import type { LeaderboardsResponse, LeaderEntry, Me } from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { randomId } from './crypto.ts';
import { meView } from './players.ts';
import { parisDay, parisDayStart } from './reserve.ts';

const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'porn', 'pute', 'salope', 'connard', 'encule', 'batard', 'merde', 'whore', 'slut'];
const RESERVED = ['runner', 'admin', 'tokengo', 'official', 'moderator', 'support', 'deleted'];

/** null si le pseudo est acceptable, sinon le message d'erreur. */
export function handleProblem(handle: string): string | null {
  if (!/^[A-Za-z0-9]{3,20}$/.test(handle)) return '3 to 20 letters or digits, no spaces.';
  const low = handle.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's');
  if (BAD.some((w) => low.includes(w))) return "Let's keep it friendly — pick another name.";
  if (RESERVED.some((w) => low.startsWith(w))) return 'This name is reserved.';
  return null;
}

export function setHandle(ctx: Ctx, userId: string, handle: string): Me {
  const problem = handleProblem(handle);
  if (problem) fail('BAD_HANDLE', problem);
  ctx.db.transaction(() => {
    if (ctx.db.prepare('SELECT 1 FROM users WHERE lower(handle) = lower(?) AND id != ?').get(handle, userId)) fail('HANDLE_TAKEN', 'This name is taken — try another one.', 409);
    ctx.db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, userId);
  })();
  return meView(ctx, userId);
}

export function setDistrict(ctx: Ctx, userId: string, district: number): Me {
  if (!Number.isInteger(district) || district < 1 || district > 20) fail('BAD_REQUEST', 'Pick an arrondissement between 1 and 20.');
  ctx.db.prepare('UPDATE users SET district = ? WHERE id = ?').run(district, userId);
  return meView(ctx, userId);
}

/** Anonymise le compte, révoque sa clé API (réelle ou simulée), supprime ses sessions. L'inventaire reste (miroir on-chain). */
export async function deleteAccount(ctx: Ctx, userId: string): Promise<{ ok: true }> {
  const k = ctx.db.prepare('SELECT nearai_key_id FROM api_keys WHERE user_id = ?').get(userId) as { nearai_key_id: string | null } | undefined;
  if (k?.nearai_key_id && ctx.credits.revoke) {
    try {
      await ctx.credits.revoke(k.nearai_key_id);
    } catch {
      fail('INTERNAL', "Couldn't revoke your API key right now — please try again in a minute.", 503);
    }
  }
  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM api_keys WHERE user_id = ?').run(userId);
    ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    ctx.db.prepare('DELETE FROM price_seen WHERE user_id = ?').run(userId);
    ctx.db.prepare(`UPDATE users SET handle = ?, google_sub = NULL, email = NULL, email_norm = NULL, ip_hash = NULL, move_state = NULL,
      tut_lat = NULL, tut_lng = NULL, district = NULL, deleted_at = ? WHERE id = ?`).run(`deleted${randomId(9).replace(/[^A-Za-z0-9]/g, '')}`, now, userId);
  })();
  return { ok: true };
}

/** Lundi 00:00 Europe/Paris de la semaine contenant `t`. */
export function weekStart(t: number): number {
  const day = parisDay(t);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = dimanche
  const monday = Date.parse(`${day}T12:00:00Z`) - ((dow + 6) % 7) * 86_400_000;
  return parisDayStart(monday);
}

const TOP = 20;
type Row = { id: string; handle: string; is_agent: number; v: number };
const entries = (rows: Row[], me: string | null): LeaderEntry[] =>
  rows.map((r, i) => ({ rank: i + 1, id: r.id, handle: r.handle, value: r.v, agent: r.is_agent === 1, me: r.id === me }));

export function leaderboards(ctx: Ctx, me: string | null): LeaderboardsResponse {
  const ws = weekStart(ctx.now());
  const wsDay = parisDay(ws + 3600_000);
  const db = ctx.db;
  const runners = db.prepare(`SELECT u.id, u.handle, u.is_agent, SUM(x.xp) v FROM xp_daily x JOIN users u ON u.id = x.user_id
    WHERE x.day >= ? AND u.deleted_at IS NULL GROUP BY u.id ORDER BY v DESC LIMIT ?`).all(wsDay, TOP) as Row[];
  const traders = db.prepare(`SELECT u.id, u.handle, u.is_agent, SUM(CASE t.side WHEN 'sell' THEN t.flux_total ELSE -t.flux_total END) v
    FROM trades t JOIN users u ON u.id = t.user_id WHERE t.at >= ? AND u.deleted_at IS NULL GROUP BY u.id HAVING v > 0 ORDER BY v DESC LIMIT ?`).all(ws, TOP) as Row[];
  const patrons = db.prepare(`SELECT u.id, u.handle, u.is_agent, SUM(r.amount) v FROM rescues r JOIN users u ON u.id = r.user_id
    WHERE u.deleted_at IS NULL GROUP BY u.id ORDER BY v DESC LIMIT ?`).all(TOP) as Row[];
  const districts = db.prepare(`SELECT u.district district, SUM(p.pts) points, SUM(CASE WHEN u.is_agent = 1 THEN p.pts ELSE 0 END) agentPoints,
      COUNT(DISTINCT u.id) players
    FROM (
      SELECT user_id, 1 pts FROM catches WHERE at >= @ws AND quality != 'fled'
      UNION ALL SELECT user_id, 1 FROM trades WHERE at >= @ws
      UNION ALL SELECT user_id, 10 FROM compiles WHERE at >= @ws
      UNION ALL SELECT substr(to_acc, 6), 5 FROM chain_ops WHERE memo LIKE 'contract:%' AND token_id = 'flux' AND to_acc LIKE 'user:%' AND created_at >= @ws
    ) p JOIN users u ON u.id = p.user_id
    WHERE u.district BETWEEN 1 AND 20 AND u.deleted_at IS NULL GROUP BY u.district ORDER BY points DESC`).all({ ws }) as LeaderboardsResponse['districts'];
  return { weekStart: ws, runners: entries(runners, me), traders: entries(traders, me), patrons: entries(patrons, me), districts };
}
