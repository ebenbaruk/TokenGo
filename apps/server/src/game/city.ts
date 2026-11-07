// Contrôle de la ville (Docs/13 §8) : qui tient chaque Forge-Arène, depuis quand, et classement Top Champions
// (temps de détention cumulé sur 7 jours). Les intervalles de détention sont notés par deux crochets de arena.ts :
//   holdStart(ctx, forgeId, userId, at)  un joueur devient Champion (ferme la détention précédente à `at`)
//   holdEnd(ctx, forgeId, at)            l'arène repasse au Gardien (échéance de 48 h, compte supprimé)
import { ARENA, type CityArenaView, type CityControlResponse, type TopChampionView } from '@tokengo/shared';
import type { Ctx } from './context.ts';

export const CITY_WINDOW_DAYS = 7;
const TOP_MAX = 5;

export function holdEnd(ctx: Ctx, forgeId: string, at: number): void {
  ctx.db.prepare('UPDATE arena_holds SET end_at = MAX(start_at, ?) WHERE forge_id = ? AND end_at IS NULL').run(at, forgeId);
}

export function holdStart(ctx: Ctx, forgeId: string, userId: string, at: number): void {
  holdEnd(ctx, forgeId, at);
  ctx.db.prepare('INSERT INTO arena_holds (forge_id, user_id, start_at) VALUES (?, ?, ?)').run(forgeId, userId, at);
}

interface ArenaRow { forge_id: string; champion_user: string; since: number; active_at: number; handle: string | null; district: number | null }

const shortName = (name: string) => name.split(' —')[0]!;

export function cityControl(ctx: Ctx, viewer: string | null): CityControlResponse {
  const now = ctx.now();
  const rows = ctx.db.prepare(`SELECT a.forge_id, a.champion_user, a.since, a.active_at, u.handle, u.district
    FROM arenas a LEFT JOIN users u ON u.id = a.champion_user AND u.deleted_at IS NULL`).all() as ArenaRow[];
  // arène tenue = ligne non échue d'un compte actif (même règle que le badge de la carte)
  const held = new Map(rows.filter((r) => r.handle && r.active_at + ARENA.championExpiryMs > now).map((r) => [r.forge_id, r]));
  // Paris d'abord (10 Forges), + les Forges des régions générées qui ont un Champion
  const forges = ctx.world.forges.filter((f) => !f.region || held.has(f.id));
  const arenas: CityArenaView[] = forges.map((f) => {
    const r = held.get(f.id);
    return {
      forgeId: f.id, forgeName: shortName(f.name), lat: f.lat, lng: f.lng,
      holder: r ? 'champion' : 'guardian', name: r ? r.handle! : `Sentinel of ${shortName(f.name)}`,
      district: r?.district ?? null, since: r?.since ?? null, mine: !!r && r.champion_user === viewer,
    };
  });
  arenas.sort((a, b) => Number(b.holder === 'champion') - Number(a.holder === 'champion') || (a.since ?? 0) - (b.since ?? 0) || a.forgeName.localeCompare(b.forgeName));

  // Top Champions : chevauchement de chaque détention avec la fenêtre de 7 jours ; une détention ouverte s'arrête
  // maintenant, ou à l'échéance de 48 h si le Champion s'est tu (pas encore réglée par arena.ts).
  const from = now - CITY_WINDOW_DAYS * 24 * 3600_000;
  const holds = ctx.db.prepare(`SELECT h.forge_id, h.user_id, h.start_at, h.end_at, u.handle, u.district FROM arena_holds h
    JOIN users u ON u.id = h.user_id AND u.deleted_at IS NULL WHERE h.end_at IS NULL OR h.end_at > ?`).all(from) as
    { forge_id: string; user_id: string; start_at: number; end_at: number | null; handle: string; district: number | null }[];
  const live = new Map(rows.map((r) => [r.forge_id, r]));
  const by = new Map<string, TopChampionView & { userId: string }>();
  for (const h of holds) {
    let end = h.end_at ?? now;
    if (h.end_at === null) {
      const r = live.get(h.forge_id);
      if (r && r.champion_user === h.user_id) end = Math.min(now, r.active_at + ARENA.championExpiryMs);
    }
    const ms = Math.max(0, end - Math.max(from, h.start_at));
    if (ms <= 0) continue;
    const cur = by.get(h.user_id) ?? { userId: h.user_id, handle: h.handle, district: h.district, heldMs: 0, arenas: 0, mine: h.user_id === viewer };
    cur.heldMs += ms;
    by.set(h.user_id, cur);
  }
  for (const r of held.values()) { const c = by.get(r.champion_user); if (c) c.arenas++; }
  const top = [...by.values()].sort((a, b) => b.heldMs - a.heldMs || a.handle.localeCompare(b.handle)).slice(0, TOP_MAX)
    .map(({ userId: _u, ...t }) => t);
  return { now, arenas, top, windowDays: CITY_WINDOW_DAYS };
}

/**
 * Tests seulement (route montée si NODE_ENV=test, jeton admin) : installe un Champion sur une arène depuis `hoursAgo` h,
 * ou (userId null) rend l'arène à son Gardien.
 */
export function holdForTest(ctx: Ctx, forgeId: string, userId: string | null, hoursAgo: number): void {
  if (!ctx.world.forges.some((f) => f.id === forgeId)) return;
  const now = ctx.now();
  if (!userId) {
    ctx.db.prepare('DELETE FROM arenas WHERE forge_id = ?').run(forgeId);
    holdEnd(ctx, forgeId, now);
    return;
  }
  const since = now - Math.round(hoursAgo * 3600_000);
  ctx.db.transaction(() => {
    ctx.db.prepare(`INSERT INTO arenas (forge_id, champion_user, team, mastery, since, active_at, last_paid) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(forge_id) DO UPDATE SET champion_user = excluded.champion_user, team = excluded.team, mastery = excluded.mastery,
        since = excluded.since, active_at = excluded.active_at, last_paid = excluded.last_paid`)
      .run(forgeId, userId, JSON.stringify(['deepseek', 'qwen', 'gemini']), JSON.stringify({ deepseek: 2, qwen: 2, gemini: 2 }), since, now, now);
    holdStart(ctx, forgeId, userId, since);
  })();
}
