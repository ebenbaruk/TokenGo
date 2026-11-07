// Arène des modèles côté serveur : vue, départ (niveau, distance, équipe, frais, quota), manches (rate limit, budget,
// double envoi), fin de combat (récompenses bornées, maîtrise), couronne + Pulse, fantôme figé, revenu du Champion,
// échéance de 48 h, maîtrise à la capture, badge de la carte.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ARENA, MASTERY, MODEL_STATS, TECHNIQUE_RULES,
  type ArenaBattleView, type ArenaPlayResponse, type ArenaStartResponse, type ArenaView, type CatchResolveResponse, type CatchStartResponse,
  type Family, type Me, type Technique, type WorldResponse,
} from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import type { Ctx } from './game/context.ts';
import { credit } from './game/players.ts';

const ORIGIN = 'http://localhost:5173';
const FORGE = 'forge:louvre';
const A = `/api/arena/${encodeURIComponent(FORGE)}`;
let clock = Date.parse('2026-11-08T10:00:00Z');
let app: FastifyInstance;
let ctx: Ctx;
let forgePos: { lat: number; lng: number };

beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0' });
  ({ app, ctx } = await buildApp(cfg, { now: () => clock }));
  forgePos = ctx.world.forges.find((f) => f.id === FORGE)!;
});
afterAll(() => app.close());
beforeEach(() => { clock += 3600_000 * 30; ctx.db.prepare('DELETE FROM arenas').run(); }); // nouveau jour, arène au Gardien

let clientN = 0;
function client() {
  let cookie = '';
  const remoteAddress = `10.2.0.${++clientN}`;
  const req = async <T>(method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await app.inject({ method, url, remoteAddress, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
    const set = res.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
    return { status: res.statusCode, body: res.json() as T & { error?: { code: string; message: string } } };
  };
  return { get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}) => req<T>('POST', u, b) };
}
type Client = ReturnType<typeof client>;

/** Joueur démo (niveau 3) à la Forge du Louvre, avec 1 éclat de chaque famille et `flux` Flux. */
async function player(opts: { flux?: number; masteryXp?: number; at?: { lat: number; lng: number } } = {}): Promise<{ c: Client; me: Me }> {
  const c = client();
  const r = await c.post<Me>('/auth/guest', { demo: true });
  const me = (r.body as unknown as { me?: Me }).me ?? r.body;
  ctx.db.prepare("UPDATE inventory SET amount = ? WHERE user_id = ? AND token_id = 'flux'").run(opts.flux ?? 500, me.id);
  for (const f of ['deepseek', 'qwen', 'gemini', 'gpt', 'claude'] as Family[]) credit(ctx, me.id, `shard:${f}`, 1, 'test');
  if (opts.masteryXp) for (const f of ['deepseek', 'qwen', 'gemini', 'gpt', 'claude']) ctx.db.prepare('INSERT INTO mastery (user_id, family, xp) VALUES (?, ?, ?)').run(me.id, f, opts.masteryXp);
  await walkTo(c, opts.at ?? forgePos);
  return { c, me };
}
async function walkTo(c: Client, to: { lat: number; lng: number }) {
  clock += 3000;
  expect((await c.post('/api/move', { lat: to.lat, lng: to.lng, acc: 8 })).status).toBe(200);
}

/** Stratégie raisonnable : meilleure stat disponible, technique adaptée à la catégorie si le budget le permet. */
function smartPick(b: ArenaBattleView): { family: Family; technique: Technique } {
  const cat = b.challenge!.category;
  const family = b.me.team.map((m) => m.family).filter((f) => f !== b.me.rateLimited).sort((x, y) => MODEL_STATS[y][cat] - MODEL_STATS[x][cat])[0]!;
  const want: Technique = cat === 'math' || cat === 'code' ? 'cot' : cat === 'writing' || cat === 'lang' ? 'few' : cat === 'vision' ? 'tool' : 'zero';
  return { family, technique: TECHNIQUE_RULES[want].cost <= b.me.tokens ? want : 'zero' };
}
async function fight(c: Client, team: Family[]): Promise<ArenaPlayResponse> {
  const s = await c.post<ArenaStartResponse>(`${A}/start`, { team });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  let b = s.body.battle;
  let last: ArenaPlayResponse | null = null;
  while (b.status === 'open') {
    const p = await c.post<ArenaPlayResponse>(`/api/arena/battle/${b.battleId}/play`, smartPick(b));
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    last = p.body;
    b = p.body.battle;
  }
  return last!;
}
/** Combat jusqu'à une victoire (maîtrise 10 conseillée), en restant sous le quota du jour. */
async function winOnce(c: Client, team: Family[]): Promise<ArenaPlayResponse> {
  for (let i = 0; i < ARENA.battlesPerDay; i++) {
    const r = await fight(c, team);
    if (r.battle.result!.outcome === 'won') return r;
    await walkTo(c, forgePos); // position fraîche
  }
  throw new Error('never won');
}

describe('arena', () => {
  it('view: Guardian of the day, families with mastery, fee and quota; locked below level 2', async () => {
    const { c } = await player();
    const v = await c.get<ArenaView>(A);
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.holder.kind).toBe('guardian');
    expect(v.body.holder.name).toBe('Sentinel of Louvre');
    expect(v.body.holder.team).toHaveLength(3);
    const m = v.body.holder.team[0]!.mastery;
    expect(m).toBeGreaterThanOrEqual(2);
    expect(m).toBeLessThanOrEqual(4);
    expect(v.body.affinities).toEqual(['gemini', 'claude']);
    expect(v.body.families).toHaveLength(5);
    expect(v.body.families.every((f) => f.owned >= 1 && f.mastery.level === 1)).toBe(true);
    expect(v.body).toMatchObject({ fee: 10, battlesLeft: 12, battlesPerDay: 12, locked: null, income: null, openBattle: null });
    // même Gardien pour tout le monde ce jour-là
    const other = await player();
    expect((await other.c.get<ArenaView>(A)).body.holder).toEqual(v.body.holder);
    // invité normal (niveau 1) : verrouillé
    const g = client();
    await g.post('/auth/guest', {});
    expect((await g.get<ArenaView>(A)).body.locked).toMatch(/level 2/);
    await walkTo(g, forgePos);
    expect((await g.post(`${A}/start`, { team: ['deepseek', 'qwen', 'gemini'] })).body.error?.code).toBe('LEVEL_LOCKED');
  });

  it('start checks distance, team, fee; burns the fee through the ledger; reveals only the first challenge', async () => {
    const far = await player({ at: { lat: forgePos.lat + 0.004, lng: forgePos.lng } });
    expect((await far.c.post(`${A}/start`, { team: ['deepseek', 'qwen', 'gemini'] })).body.error?.code).toBe('TOO_FAR');
    const { c, me } = await player({ flux: 9 });
    expect((await c.post(`${A}/start`, { team: ['deepseek', 'qwen', 'gemini'] })).body.error?.code).toBe('INSUFFICIENT');
    expect((await c.post(`${A}/start`, { team: ['deepseek', 'deepseek', 'gemini'] })).body.error?.code).toBe('BAD_TEAM');
    expect((await c.post(`${A}/start`, { team: ['deepseek', 'qwen'] })).status).toBe(400);
    ctx.db.prepare("UPDATE inventory SET amount = 100 WHERE user_id = ? AND token_id = 'flux'").run(me.id);
    ctx.db.prepare("UPDATE inventory SET amount = 0 WHERE user_id = ? AND token_id = 'shard:claude'").run(me.id);
    expect((await c.post(`${A}/start`, { team: ['claude', 'qwen', 'gemini'] })).body.error?.code).toBe('BAD_TEAM');
    const s = await c.post<ArenaStartResponse>(`${A}/start`, { team: ['deepseek', 'qwen', 'gemini'] });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.me.flux).toBe(90);
    const b = s.body.battle;
    expect(b).toMatchObject({ status: 'open', rounds: 5, history: [], result: null, opponent: { kind: 'guardian', name: 'Sentinel of Louvre' } });
    expect(b.challenge!.index).toBe(0);
    expect(b.challenge!.prompt.length).toBeGreaterThan(5);
    expect(b.me.tokens).toBe(10);
    expect(JSON.stringify(b)).not.toContain('"challenges"'); // les épreuves suivantes restent secrètes
    const op = ctx.db.prepare("SELECT kind, amount FROM chain_ops WHERE memo = ?").get(`arena:${b.battleId}`) as { kind: string; amount: number };
    expect(op).toEqual({ kind: 'burn', amount: 10 });
    // reprise : la vue de l'arène renvoie le combat en cours
    expect((await c.get<ArenaView>(A)).body.openBattle?.battleId).toBe(b.battleId);
  });

  it('server refuses a rate-limited model, an unaffordable technique and a double send', async () => {
    const { c } = await player();
    const s = await c.post<ArenaStartResponse>(`${A}/start`, { team: ['deepseek', 'qwen', 'gemini'] });
    const id = s.body.battle.battleId;
    const p1 = await c.post<ArenaPlayResponse>(`/api/arena/battle/${id}/play`, { family: 'deepseek', technique: 'cot' });
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect(p1.body.round.me.family).toBe('deepseek');
    expect(['me', 'opp', 'tie']).toContain(p1.body.round.winner);
    expect(p1.body.battle.me.rateLimited).toBe('deepseek');
    expect(p1.body.battle.me.tokens).toBe(7);
    const rl = await c.post(`/api/arena/battle/${id}/play`, { family: 'deepseek', technique: 'zero' });
    expect(rl.status).toBe(400);
    expect(rl.body.error?.code).toBe('MODEL_RATE_LIMITED');
    expect((await c.post(`/api/arena/battle/${id}/play`, { family: 'claude', technique: 'zero' })).body.error?.code).toBe('BAD_TEAM');
    expect((await c.post(`/api/arena/battle/${id}/play`, { family: 'qwen', technique: 'magic' })).status).toBe(400);
    const p2 = await c.post<ArenaPlayResponse>(`/api/arena/battle/${id}/play`, { family: 'qwen', technique: 'cot' });
    if (p2.body.battle.status === 'open') {
      const p3 = await c.post<ArenaPlayResponse>(`/api/arena/battle/${id}/play`, { family: 'gemini', technique: 'cot' });
      if (p3.body.battle.status === 'open') {
        expect(p3.body.battle.me.tokens).toBe(1);
        expect((await c.post(`/api/arena/battle/${id}/play`, { family: 'qwen', technique: 'few' })).body.error?.code).toBe('NO_TOKENS');
      }
    }
    // un autre joueur ne peut pas jouer ce combat
    const o = await player();
    expect((await o.c.post(`/api/arena/battle/${id}/play`, { family: 'qwen', technique: 'zero' })).status).toBe(404);
  });

  it('full battle → bounded rewards, mastery XP (+10 per round, +10 per win), quota counted', async () => {
    const { c, me } = await player();
    const r = await fight(c, ['deepseek', 'qwen', 'gemini']);
    const res = r.battle.result!;
    expect(['won', 'lost']).toContain(res.outcome);
    const rounds = r.battle.history;
    expect(rounds.length).toBeGreaterThanOrEqual(3);
    expect(res.xp).toBe(res.outcome === 'won' ? 60 : 15);
    expect(res.flux).toBe(res.outcome === 'won' ? 20 : 0);
    expect(r.me.flux).toBe(500 - 10 + res.flux);
    const gained = Object.values(res.masteryGains).reduce((a, b) => a + (b ?? 0), 0);
    expect(gained).toBe(rounds.length * MASTERY.xpRound + rounds.filter((x) => x.winner === 'me').length * MASTERY.xpRoundWon);
    for (const [f, n] of Object.entries(res.masteryGains) as [Family, number][]) expect(r.me.mastery[f].xp).toBe(n);
    expect(r.me.xp).toBe(me.xp + res.xp);
    expect((await c.get<ArenaView>(A)).body.battlesLeft).toBe(11);
    // le combat fini ne se rejoue pas
    expect((await c.post(`/api/arena/battle/${r.battle.battleId}/play`, { family: 'qwen', technique: 'zero' })).body.error?.code).toBe('EXPIRED');
  });

  it('beating the Guardian crowns a Champion (Pulse + map badge); the ghost team is frozen; cannot challenge own arena', async () => {
    const champ = await player({ masteryXp: 1500 });
    const won = await winOnce(champ.c, ['claude', 'gpt', 'gemini']);
    expect(won.battle.result!.becameChampion).toBe(true);
    expect(won.battle.result!.flux).toBe(20);
    const ev = ctx.db.prepare("SELECT text FROM events WHERE kind = 'arena.champion' ORDER BY id DESC LIMIT 1").get() as { text: string };
    expect(ev.text).toBe(`${champ.me.handle} is the new Champion of Louvre`);
    const w = await champ.c.get<WorldResponse>(`/api/world?lat=${forgePos.lat}&lng=${forgePos.lng}`);
    expect(w.body.nodes.find((n) => n.id === FORGE)!.arena).toEqual({ holder: 'champion', champion: champ.me.handle, mine: true });
    const v = await champ.c.get<ArenaView>(A);
    expect(v.body.holder).toMatchObject({ kind: 'champion', name: champ.me.handle, mine: true });
    expect(v.body.holder.team).toEqual([{ family: 'claude', mastery: 10 }, { family: 'gpt', mastery: 10 }, { family: 'gemini', mastery: 10 }]);
    expect(v.body.locked).toMatch(/hold this arena/);
    await walkTo(champ.c, forgePos);
    expect((await champ.c.post(`${A}/start`, { team: ['claude', 'gpt', 'gemini'] })).body.error?.code).toBe('OWN_ARENA');
    // la maîtrise réelle du Champion peut changer : son fantôme reste figé
    ctx.db.prepare('UPDATE mastery SET xp = 0 WHERE user_id = ?').run(champ.me.id);
    const rival = await player({ masteryXp: 1500 });
    const rv = await rival.c.get<ArenaView>(A);
    expect(rv.body.holder.team.every((m) => m.mastery === 10)).toBe(true);
    expect((await rival.c.get<WorldResponse>(`/api/world?lat=${forgePos.lat}&lng=${forgePos.lng}`)).body.nodes.find((n) => n.id === FORGE)!.arena)
      .toEqual({ holder: 'champion', champion: champ.me.handle, mine: false });
    const s = await rival.c.post<ArenaStartResponse>(`${A}/start`, { team: ['deepseek', 'qwen', 'gemini'] });
    expect(s.body.battle.opponent).toEqual({ kind: 'champion', name: champ.me.handle });
    expect(s.body.battle.opp.team.map((m) => m.family)).toEqual(['claude', 'gpt', 'gemini']);
  });

  it('dethroning a Champion pays 100 XP / 30 ƒ and announces it; the old Champion is paid up to the defeat', async () => {
    const champ = await player({ masteryXp: 0 });
    // Champion faible installé directement (maîtrise 1)
    ctx.db.prepare('INSERT INTO arenas (forge_id, champion_user, team, mastery, since, active_at, last_paid) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(FORGE, champ.me.id, JSON.stringify(['claude', 'gpt', 'qwen']), JSON.stringify({ claude: 1, gpt: 1, qwen: 1 }), clock, clock, clock);
    clock += 30 * 60_000; // 30 min tenues → 12 ƒ dus
    const before = (await champ.c.get<Me>('/api/me')).body.flux;
    const rival = await player({ masteryXp: 1500 });
    let won: ArenaPlayResponse | null = null;
    for (let i = 0; i < ARENA.battlesPerDay && !won; i++) {
      const r = await fight(rival.c, ['deepseek', 'gemini', 'claude']);
      if (r.battle.result!.outcome === 'won') won = r;
      else await walkTo(rival.c, forgePos);
    }
    expect(won, 'a level-10 team beats a level-1 ghost').toBeTruthy();
    expect(won!.battle.result).toMatchObject({ xp: 100, flux: 30, becameChampion: true });
    const ev = ctx.db.prepare("SELECT text FROM events WHERE kind = 'arena.champion' ORDER BY id DESC LIMIT 1").get() as { text: string };
    expect(ev.text).toBe(`${rival.me.handle} is the new Champion of Louvre — dethroned ${champ.me.handle}`);
    const after = (await champ.c.get<Me>('/api/me')).body.flux;
    expect(after - before).toBeGreaterThanOrEqual(12);
    expect(after - before).toBeLessThanOrEqual(ARENA.championFluxMaxDay);
  });

  it('Champion income: +4 ƒ / 10 min paid on view, capped at 240 ƒ a day; 48 h idle → the Guardian is back', async () => {
    const champ = await player();
    ctx.db.prepare('INSERT INTO arenas (forge_id, champion_user, team, mastery, since, active_at, last_paid) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(FORGE, champ.me.id, JSON.stringify(['claude', 'gpt', 'qwen']), JSON.stringify({ claude: 3, gpt: 3, qwen: 3 }), clock, clock, clock);
    clock += 25 * 60_000;
    const v1 = await champ.c.get<ArenaView>(A);
    expect(v1.body.income).toEqual({ paid: 8, paidToday: 8, maxDay: 240 });
    expect(v1.body.me.flux).toBe(508);
    const op = ctx.db.prepare("SELECT kind, amount FROM chain_ops WHERE memo = ? ORDER BY id DESC").get(`arena-income:${FORGE}`) as { kind: string; amount: number };
    expect(op).toEqual({ kind: 'mint', amount: 8 });
    clock += 5 * 60_000; // le reste (5 min) a été gardé : +4 de plus
    expect((await champ.c.get<ArenaView>(A)).body.income!.paid).toBe(4);
    clock += 20 * 3600_000; // plafond du jour (le jour de Paris a pu changer entre-temps : compteur remis à zéro)
    const v3 = await champ.c.get<ArenaView>(A);
    expect(v3.body.income!.paid).toBeGreaterThan(0);
    expect(v3.body.income!.paid).toBeLessThanOrEqual(240);
    expect(v3.body.income!.paidToday).toBeLessThanOrEqual(240);
    clock += 3600_000;
    const v3b = await champ.c.get<ArenaView>(A);
    expect(v3b.body.income!.paidToday).toBeLessThanOrEqual(240);
    clock += 29 * 3600_000; // > 48 h sans jouer
    const v4 = await champ.c.get<ArenaView>(A);
    expect(v4.body.holder.kind).toBe('guardian');
    expect(v4.body.income).toBeNull();
    const ev = ctx.db.prepare("SELECT text FROM events WHERE kind = 'arena.guardian' ORDER BY id DESC LIMIT 1").get() as { text: string };
    expect(ev.text).toContain(champ.me.handle);
  });

  it('12 battles a day, then RATE_LIMITED', async () => {
    const { c } = await player();
    for (let i = 0; i < ARENA.battlesPerDay; i++) {
      const s = await c.post(`${A}/start`, { team: ['deepseek', 'qwen', 'gemini'] });
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      if (i % 4 === 3) await walkTo(c, forgePos);
    }
    await walkTo(c, forgePos);
    const r = await c.post(`${A}/start`, { team: ['deepseek', 'qwen', 'gemini'] });
    expect(r.status).toBe(429);
    expect(r.body.error?.code).toBe('RATE_LIMITED');
    // les combats abandonnés ont expiré (un seul combat ouvert à la fois)
    expect((ctx.db.prepare("SELECT COUNT(*) n FROM battles b JOIN users u ON u.id = b.user_id WHERE b.status = 'open' AND u.id = (SELECT user_id FROM battles ORDER BY created_at DESC LIMIT 1)").get() as { n: number }).n).toBe(1);
  });

  it('a catch gives +5 mastery to its family', async () => {
    const c = client();
    await c.post('/auth/guest', { demo: true });
    await walkTo(c, forgePos);
    const me = (await c.get<Me>('/api/me')).body;
    expect(me.mastery.deepseek).toEqual({ level: 1, xp: 0, into: 0, need: 30, next: 30 });
    const s = await c.post<CatchStartResponse>('/api/catch/start', { spawnId: `tut:${me.id}` });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    clock += 1500;
    const r = await c.post<CatchResolveResponse>('/api/catch/resolve', { attemptId: s.body.attemptId, offsets: [0] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.me.mastery.deepseek.xp).toBe(MASTERY.xpCatch);
  });
});
