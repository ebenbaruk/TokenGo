// Missions du jour (Docs/13 §7) et contrôle de la ville (§8) côté serveur : tirage figé, compteurs branchés sur les vraies
// actions (relais, commerce, arène), réclamation bornée (+40 XP +15 ƒ, coffre +60 ƒ + 1 Gemini une fois par jour, via le
// journal on-chain), pastille dans Me, route de test protégée ; détentions d'arènes et Top Champions sur 7 jours.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ARENA, MISSION_CATALOG, MISSIONS, MODEL_STATS, TECHNIQUE_RULES, haversineM, type Technique,
  type ArenaPlayResponse, type ArenaStartResponse, type CityControlResponse, type Family, type Me, type MissionClaimResponse,
  type MissionKind, type MissionsView, type QuoteResponse, type WorldResponse,
} from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import type { Ctx } from './game/context.ts';
import { credit } from './game/players.ts';
import { missionsForTest } from './game/missions.ts';

const ORIGIN = 'http://localhost:5173';
const FORGE = 'forge:louvre';
let clock = Date.parse('2026-11-08T09:00:00Z');
let app: FastifyInstance;
let ctx: Ctx;
let forgePos: { lat: number; lng: number };

beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', ADMIN_TOKEN: 'adm' });
  ({ app, ctx } = await buildApp(cfg, { now: () => clock }));
  forgePos = ctx.world.forges.find((f) => f.id === FORGE)!;
});
afterAll(() => app.close());
beforeEach(() => { clock += 3600_000 * 30; ctx.db.prepare('DELETE FROM arenas').run(); ctx.db.prepare('DELETE FROM arena_holds').run(); });

let clientN = 0;
function client() {
  let cookie = '';
  const remoteAddress = `10.7.0.${++clientN}`;
  const req = async <T>(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, remoteAddress, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers } });
    const set = res.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
    return { status: res.statusCode, body: res.json() as T & { error?: { code: string; message: string } } };
  };
  return {
    get: <T>(u: string) => req<T>('GET', u),
    post: <T>(u: string, b: unknown = {}, h?: Record<string, string>) => req<T>('POST', u, b, h),
  };
}
type Client = ReturnType<typeof client>;

async function player(opts: { masteryXp?: number } = {}): Promise<{ c: Client; me: Me }> {
  const c = client();
  const r = await c.post<Me>('/auth/guest', { demo: true });
  const me = (r.body as unknown as { me?: Me }).me ?? r.body;
  ctx.db.prepare("UPDATE inventory SET amount = 500 WHERE user_id = ? AND token_id = 'flux'").run(me.id);
  for (const f of ['deepseek', 'qwen', 'gemini', 'gpt', 'claude'] as Family[]) credit(ctx, me.id, `shard:${f}`, 1, 'test');
  if (opts.masteryXp) for (const f of ['deepseek', 'qwen', 'gemini', 'gpt', 'claude']) ctx.db.prepare('INSERT INTO mastery (user_id, family, xp) VALUES (?, ?, ?)').run(me.id, f, opts.masteryXp);
  return { c, me };
}
async function walkTo(c: Client, to: { lat: number; lng: number }) {
  clock += 3000;
  expect((await c.post('/api/move', { lat: to.lat, lng: to.lng, acc: 8 })).status).toBe(200);
}
const setKinds = (userId: string, kinds: MissionKind[]) => missionsForTest(ctx, userId, { kinds });
const bump = (userId: string, key: MissionKind, n: number) => missionsForTest(ctx, userId, { bump: { key, n } });
const progressOf = (v: MissionsView, k: MissionKind) => v.missions.find((m) => m.id === k)!.progress;

async function fight(c: Client, team: Family[]): Promise<ArenaPlayResponse> {
  const s = await c.post<ArenaStartResponse>(`/api/arena/${encodeURIComponent(FORGE)}/start`, { team });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  let b = s.body.battle;
  let last: ArenaPlayResponse | null = null;
  while (b.status === 'open') {
    // meilleure stat disponible pour l'épreuve, technique adaptée si le budget le permet
    const cat = b.challenge!.category;
    const family = b.me.team.map((m) => m.family).filter((f) => f !== b.me.rateLimited).sort((x, y) => MODEL_STATS[y][cat] - MODEL_STATS[x][cat])[0]!;
    const want: Technique = cat === 'math' || cat === 'code' ? 'cot' : cat === 'writing' || cat === 'lang' ? 'few' : cat === 'vision' ? 'tool' : 'zero';
    const technique = TECHNIQUE_RULES[want].cost <= b.me.tokens ? want : 'zero';
    const p = await c.post<ArenaPlayResponse>(`/api/arena/battle/${b.battleId}/play`, { family, technique });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    last = p.body;
    b = p.body.battle;
  }
  return last!;
}

describe('daily missions', () => {
  it('3 missions a day, frozen for the day, ≥ 1 Arena/Decode; a summary rides along in Me', async () => {
    const { c, me } = await player();
    const v = await c.get<MissionsView>('/api/missions');
    expect(v.status).toBe(200);
    expect(v.body.missions).toHaveLength(3);
    expect(new Set(v.body.missions.map((m) => m.id)).size).toBe(3);
    expect(v.body.missions.some((m) => MISSION_CATALOG[m.id].group === 'arena')).toBe(true);
    expect(v.body.missions.every((m) => m.reward.xp === 40 && m.reward.flux === 15 && m.progress === 0 && !m.claimed)).toBe(true);
    expect(v.body.missions.some((m) => m.id === 'raid_damage')).toBe(false); // pas de raid en cours
    expect(v.body.chest).toEqual({ flux: 60, shard: 'gemini', opened: false });
    expect(v.body.resetAt).toBeGreaterThan(clock);
    expect((await c.get<MissionsView>('/api/missions')).body.missions.map((m) => m.id)).toEqual(v.body.missions.map((m) => m.id));
    const m = (await c.get<Me>('/api/me')).body;
    expect(m.missions).toEqual({ ready: 0, claimed: 0, total: 3, chest: false, readyIds: [] });
    expect(me.id).toBeTruthy();
  });

  it('counters are fed by real actions: relay sync, trades at distinct shops, arena rounds and wins', async () => {
    const { c, me } = await player({ masteryXp: 1500 });
    setKinds(me.id, ['relay_sync', 'shops', 'arena_rounds']);
    // relais
    const relay = ctx.world.nodes.filter((n) => n.kind === 'relay').sort((a, b) => haversineM(forgePos, a) - haversineM(forgePos, b))[0]!;
    await walkTo(c, relay);
    const s = await c.post<{ me: Me }>('/api/relay/sync', { nodeId: relay.id });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    // commerce : deux achats chez le même marchand comptent pour 1 boutique
    const w = await c.get<WorldResponse>(`/api/world?lat=${forgePos.lat}&lng=${forgePos.lng}`);
    const market = w.body.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open').sort((a, b) => haversineM(forgePos, a) - haversineM(forgePos, b))[0]!;
    await walkTo(c, market);
    for (let i = 0; i < 2; i++) {
      const q = await c.post<QuoteResponse>(`/api/merchant/${market.merchant!.id}/quote`, { side: 'buy', family: 'deepseek', qty: 1 });
      expect(q.status, JSON.stringify(q.body)).toBe(200);
      expect((await c.post(`/api/merchant/${market.merchant!.id}/trade`, { quoteId: q.body.quoteId })).status).toBe(200);
    }
    // arène : chaque manche jouée compte
    await walkTo(c, forgePos);
    const r = await fight(c, ['claude', 'gpt', 'gemini']);
    const rounds = r.battle.history.length;
    const v = (await c.get<MissionsView>('/api/missions')).body;
    expect(progressOf(v, 'relay_sync')).toBe(1);
    expect(progressOf(v, 'shops')).toBe(1);
    expect(progressOf(v, 'arena_rounds')).toBe(Math.min(5, rounds));
    const wins = ctx.db.prepare("SELECT n FROM mission_counts WHERE user_id = ? AND key = 'arena_win'").get(me.id) as { n: number } | undefined;
    expect(wins?.n ?? 0).toBe(r.battle.result!.outcome === 'won' ? 1 : 0);
  });

  it('claim: refused before done, then +40 XP +15 ƒ once; Me shows the red dot until claimed', async () => {
    const { c, me } = await player();
    setKinds(me.id, ['decode', 'relay_sync', 'combo3']);
    const early = await c.post(`/api/missions/decode/claim`);
    expect(early.body.error?.code).toBe('MISSION_NOT_DONE');
    expect((await c.post('/api/missions/arena_win/claim')).status).toBe(404);
    bump(me.id, 'decode', 3);
    const before = (await c.get<Me>('/api/me')).body;
    expect(before.missions).toMatchObject({ ready: 1, readyIds: ['decode'] });
    const r = await c.post<MissionClaimResponse>('/api/missions/decode/claim');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.reward).toEqual({ xp: 40, flux: 15 });
    expect(r.body.chest).toBeNull();
    expect(r.body.me.xp - before.xp).toBe(40);
    expect(r.body.me.flux - before.flux).toBe(15);
    expect(r.body.me.missions).toMatchObject({ ready: 0, claimed: 1 });
    expect(r.body.missions.missions.find((m) => m.id === 'decode')!.claimed).toBe(true);
    expect((await c.post('/api/missions/decode/claim')).body.error?.code).toBe('MISSION_CLAIMED');
    // Flux versé via le journal (outbox on-chain), jamais depuis la Réserve
    const ops = ctx.db.prepare("SELECT kind, token_id, amount FROM chain_ops WHERE memo LIKE 'mission:%' AND to_acc = ?").all(`user:${me.id}`);
    expect(ops).toEqual([{ kind: 'mint', token_id: 'flux', amount: 15 }]);
  });

  it('all 3 claimed → daily chest +60 ƒ + 1 Gemini, once a day; a new day brings new missions', async () => {
    const { c, me } = await player();
    const kinds: MissionKind[] = ['decode', 'relay_sync', 'shops'];
    setKinds(me.id, kinds);
    for (const k of kinds) bump(me.id, k, MISSION_CATALOG[k].goal);
    const start = (await c.get<Me>('/api/me')).body;
    expect(start.missions!.ready).toBe(3);
    let last: MissionClaimResponse | null = null;
    for (const k of kinds) {
      const r = await c.post<MissionClaimResponse>(`/api/missions/${k}/claim`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      if (k !== 'shops') expect(r.body.chest).toBeNull();
      last = r.body;
    }
    expect(last!.chest).toEqual({ flux: MISSIONS.chestFlux, shard: 'gemini' });
    expect(last!.missions.chest.opened).toBe(true);
    expect(last!.me.flux - start.flux).toBe(3 * 15 + 60);
    expect(last!.me.shards.gemini - start.shards.gemini).toBe(1);
    expect(last!.me.missions).toMatchObject({ ready: 0, claimed: 3, chest: true });
    const chest = ctx.db.prepare("SELECT token_id, amount FROM chain_ops WHERE memo LIKE 'mission-chest:%' AND to_acc = ? ORDER BY id").all(`user:${me.id}`);
    expect(chest).toEqual([{ token_id: 'flux', amount: 60 }, { token_id: 'shard:gemini', amount: 1 }]);
    // le test-knob remet les mêmes missions : le coffre du jour ne se rouvre pas pour autant deux fois via la vraie route
    expect(ctx.db.prepare("SELECT COUNT(*) n FROM chain_ops WHERE memo LIKE 'mission-chest:%' AND to_acc = ?").get(`user:${me.id}`)).toEqual({ n: 2 });
    // jour suivant : nouvelles missions, rien de réclamé
    clock += 26 * 3600_000;
    const next = (await c.get<MissionsView>('/api/missions')).body;
    expect(next.day).not.toBe(last!.missions.day);
    expect(next.claimed).toBe(0);
    expect(next.chest.opened).toBe(false);
  });

  it('a successful catch counts its family once (distinct families), and the badge turns ready by itself', async () => {
    const c = client();
    const r = await c.post<Me>('/auth/guest', {});
    const me = (r.body as unknown as { me?: Me }).me ?? r.body;
    setKinds(me.id, ['decode', 'catch_families', 'shops']);
    bump(me.id, 'catch_families', 2); // déjà 2 familles aujourd'hui
    await walkTo(c, forgePos);
    const w = (await c.get<WorldResponse>(`/api/world?lat=${forgePos.lat}&lng=${forgePos.lng}`)).body;
    const tut = w.spawns.find((s) => s.id.startsWith('tut:'))!;
    await walkTo(c, tut);
    const s = await c.post<{ attemptId: string }>('/api/catch/start', { spawnId: tut.id });
    clock += 1500;
    const res = await c.post<{ result: string; me: Me }>('/api/catch/resolve', { attemptId: s.body.attemptId, offsets: [0] });
    expect(res.body.result).toMatch(/good|perfect/);
    expect(res.body.me.missions).toMatchObject({ ready: 1, readyIds: ['catch_families'] }); // dans la réponse même de l'action
    const again = ctx.db.prepare("SELECT COUNT(*) n FROM mission_marks WHERE user_id = ? AND key = 'catch_families'").get(me.id) as { n: number };
    expect(again.n).toBe(1);
  });

  it('the test knob exists only with the admin token', async () => {
    const { c, me } = await player();
    expect((await c.post('/api/test/missions', { userId: me.id, bump: { key: 'decode', n: 1 } })).status).toBe(403);
    const ok = await c.post<MissionsView>('/api/test/missions', { userId: me.id, kinds: ['decode', 'shops', 'combo3'], bump: { key: 'decode', n: 2 } }, { authorization: 'Bearer adm' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(progressOf(ok.body, 'decode')).toBe(2);
  });

  it('below the Arena level, no battle missions are drawn', async () => {
    const c = client();
    const r = await c.post<Me>('/auth/guest', {}); // GPS : niveau 1
    const me = (r.body as unknown as { me?: Me }).me ?? r.body;
    expect(me.level).toBeLessThan(ARENA.level);
    const v = (await c.get<MissionsView>('/api/missions')).body;
    expect(v.missions.map((m) => m.id)).toContain('decode');
    expect(v.missions.some((m) => m.id === 'arena_win' || m.id === 'arena_rounds')).toBe(false);
  });
});

describe('city control', () => {
  it('lists the 10 Paris arenas with Sentinels; a new Champion shows with district, and Top Champions counts hold time', async () => {
    const pub = client();
    const empty = (await pub.get<CityControlResponse>('/api/city/control')).body;
    expect(empty.arenas.length).toBe(10);
    expect(empty.arenas.every((a) => a.holder === 'guardian' && a.name.startsWith('Sentinel of '))).toBe(true);
    expect(empty.top).toEqual([]);

    const { c, me } = await player({ masteryXp: 1500 });
    await c.post('/api/me/district', { district: 7 });
    await walkTo(c, forgePos);
    let won = false;
    for (let i = 0; i < ARENA.battlesPerDay && !won; i++) {
      const r = await fight(c, ['claude', 'gpt', 'gemini']);
      won = r.battle.result!.becameChampion;
      if (!won) await walkTo(c, forgePos);
    }
    expect(won).toBe(true);
    clock += 2 * 3600_000;
    const v = (await c.get<CityControlResponse>('/api/city/control')).body;
    const louvre = v.arenas.find((a) => a.forgeId === FORGE)!;
    expect(louvre).toMatchObject({ holder: 'champion', name: me.handle, district: 7, mine: true, forgeName: 'Louvre' });
    expect(v.arenas[0]!.forgeId).toBe(FORGE); // les arènes tenues d'abord
    expect(v.top).toHaveLength(1);
    expect(v.top[0]).toMatchObject({ handle: me.handle, district: 7, arenas: 1, mine: true });
    expect(v.top[0]!.heldMs).toBeGreaterThanOrEqual(2 * 3600_000);
    // vu par quelqu'un d'autre : pas « mine »
    expect((await pub.get<CityControlResponse>('/api/city/control')).body.arenas.find((a) => a.forgeId === FORGE)!.mine).toBe(false);
    // la couronne de la carte porte le district
    const w = (await c.get<WorldResponse>(`/api/world?lat=${forgePos.lat}&lng=${forgePos.lng}`)).body;
    expect(w.nodes.find((n) => n.id === FORGE)!.arena).toMatchObject({ holder: 'champion', district: 7 });

    // 48 h sans jouer : le Gardien reprend, la détention s'arrête à l'échéance (pas au moment de la consultation)
    const since = louvre.since!;
    const active = (ctx.db.prepare('SELECT active_at FROM arenas WHERE forge_id = ?').get(FORGE) as { active_at: number }).active_at;
    clock = active + ARENA.championExpiryMs + 5 * 3600_000;
    const other = await player();
    await other.c.get(`/api/arena/${encodeURIComponent(FORGE)}`); // règle l'arène
    const after = (await pub.get<CityControlResponse>('/api/city/control')).body;
    expect(after.arenas.find((a) => a.forgeId === FORGE)!.holder).toBe('guardian');
    expect(after.top[0]!.arenas).toBe(0);
    expect(after.top[0]!.heldMs).toBe(active + ARENA.championExpiryMs - since);
    // au-delà de 7 jours : sorti du classement
    clock += 8 * 24 * 3600_000;
    expect((await pub.get<CityControlResponse>('/api/city/control')).body.top).toEqual([]);
  });
});
