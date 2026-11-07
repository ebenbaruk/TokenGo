// API : Codex (variantes cosmétiques des captures) et Daily Route (arrêts validés par /api/move, récompense une fois par jour).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  DAILY_ROUTE, VARIANTS, haversineM, type CatchResolveResponse, type CatchStartResponse, type CodexView, type Me, type MoveResponse,
  type WorldResponse,
} from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';

const ORIGIN = 'http://localhost:5173';
const LOUVRE = { lat: 48.8611, lng: 2.3358 };
let clock = Date.parse('2026-11-08T10:00:00Z');
let app: FastifyInstance;

beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0' });
  ({ app } = await buildApp(cfg, { now: () => clock }));
});
afterAll(() => app.close());

let clientN = 0;
function client() {
  let cookie = '';
  const remoteAddress = `10.0.7.${++clientN}`;
  const req = async <T>(method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await app.inject({ method, url, remoteAddress, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
    const set = res.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
    return { status: res.statusCode, body: res.json() as T & { error?: { code: string } } };
  };
  return { get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}) => req<T>('POST', u, b) };
}
type Client = ReturnType<typeof client>;

const move = async (c: Client, p: { lat: number; lng: number }) => {
  clock += 3000;
  const r = await c.post<MoveResponse>('/api/move', { lat: p.lat, lng: p.lng, acc: 8 });
  expect(r.status).toBe(200);
  return r.body;
};
const world = async (c: Client, p: { lat: number; lng: number }) => (await c.get<WorldResponse>(`/api/world?lat=${p.lat}&lng=${p.lng}`)).body;

async function catchAt(c: Client, spawnId: string, offset: number) {
  const s = await c.post<CatchStartResponse>('/api/catch/start', { spawnId });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  clock += 1500;
  return (await c.post<CatchResolveResponse>('/api/catch/resolve', { attemptId: s.body.attemptId, offsets: [offset] })).body;
}

/** Cherche un éclat commun (ne fuit jamais) autour de `from`, en marchant sur des anneaux fixes. */
async function findCommon(c: Client, from: { lat: number; lng: number }) {
  for (const r of [0, 150, 300]) {
    for (let k = 0; k < (r ? 8 : 1); k++) {
      const a = (k * Math.PI) / 4;
      const p = { lat: from.lat + (r * Math.cos(a)) / 111_000, lng: from.lng + (r * Math.sin(a)) / 73_000 };
      await move(c, p);
      const w = await world(c, p);
      const sp = w.spawns.find((s) => !s.id.startsWith('tut:') && (s.family === 'deepseek' || s.family === 'qwen'));
      if (sp) return sp;
    }
  }
  throw new Error('no common shard around');
}

describe('codex: cosmetic variants on catches', () => {
  const c = client();

  it('tutorial catch is a Classic and opens the Codex (+XP once)', async () => {
    await c.post<Me>('/auth/guest', { demo: true });
    await move(c, LOUVRE);
    const w = await world(c, LOUVRE);
    const tut = w.spawns.find((s) => s.id.startsWith('tut:'))!;
    await move(c, tut);
    const r = await catchAt(c, tut.id, 0.9);
    expect(r.result).toBe('good');
    expect(r.codex).toMatchObject({ variant: 'classic', name: 'DeepSeek', isNew: true, found: 1, total: 25, xp: 15 });
    expect(r.xp).toBe(10 + 15);
  });

  it('a regular catch near a Forge rolls a server-side variant; inventory only counts the family', async () => {
    const sp = await findCommon(c, LOUVRE);
    await move(c, sp);
    const before = (await c.get<Me>('/api/me')).body.shards[sp.family];
    const r = await catchAt(c, sp.id, 0.15); // « good » : pas d'overclocked possible
    expect(['good', 'perfect']).toContain(r.result);
    expect(VARIANTS).toContain(r.codex!.variant);
    expect(r.me.shards[sp.family]).toBe(before + r.qty); // la variante ne crée ni ne change de valeur
    const nearForge = haversineM(sp, { lat: 48.8616, lng: 2.334 }) <= 300;
    if (r.codex!.variant !== 'shiny') expect(r.codex!.variant).toBe(nearForge ? 'landmark' : 'classic');
    if (r.codex!.variant === 'landmark') expect(r.codex!.name).toMatch(/^Louvre /);
  });

  it('GET /api/codex lists 25 cells with silhouettes, records and titles', async () => {
    const v = (await c.get<CodexView>('/api/codex')).body;
    expect(v.entries).toHaveLength(25);
    expect(v.found).toBeGreaterThanOrEqual(1);
    expect(v.entries.find((e) => e.family === 'deepseek' && e.variant === 'classic')!.found).toBe(true);
    const unknown = v.entries.find((e) => !e.found)!;
    expect(unknown.name).toBe('???');
    expect(unknown.hint.length).toBeGreaterThan(3);
    expect(v.records.catches).toBe(2);
    expect(v.titles[0]!.name).toBe('Shard Spotter');
  });

  it('a catch at night (solar time) far from any Forge is a Night variant', async () => {
    const n = client();
    await n.post<Me>('/auth/guest', { demo: true });
    clock = Date.parse('2026-11-08T22:30:00Z');
    const away = { lat: 48.8400, lng: 2.3100 }; // Montparnasse/Vaugirard, loin des 10 forges
    const sp = await findCommon(n, away);
    await move(n, sp);
    const r = await catchAt(n, sp.id, 0.15);
    expect(r.codex!.variant === 'night' || r.codex!.variant === 'shiny').toBe(true);
    clock = Date.parse('2026-11-08T10:30:00Z');
  });
});

describe('daily route', () => {
  const c = client();
  let me0: Me;

  it('world carries a deterministic route of 3–5 real nodes around the player', async () => {
    me0 = (await c.post<Me>('/auth/guest', { demo: true })).body;
    await move(c, LOUVRE);
    const w = await world(c, LOUVRE);
    expect(w.route).toBeTruthy();
    const r = w.route!;
    expect(r.total).toBeGreaterThanOrEqual(DAILY_ROUTE.stopsMin);
    expect(r.total).toBeLessThanOrEqual(DAILY_ROUTE.stopsMax);
    expect(r.done).toBe(0);
    expect(r.reward).toEqual({ xp: 200, flux: 60, shard: 'gemini' });
    for (const s of r.stops) expect(['relay', 'market', 'forge']).toContain(s.kind);
    // même quartier, même jour → même route pour un autre joueur
    const o = client();
    await o.post('/auth/guest', { demo: true });
    await move(o, { lat: LOUVRE.lat + 0.0003, lng: LOUVRE.lng });
    const w2 = await world(o, LOUVRE);
    expect(w2.route!.stops.map((s) => s.id)).toEqual(r.stops.map((s) => s.id));
  });

  it('walking to every stop completes it once, with the bounded reward', async () => {
    const r = (await world(c, LOUVRE)).route!;
    let last: MoveResponse | null = null;
    for (const [i, s] of r.stops.entries()) {
      last = await move(c, s);
      expect(last.route, `stop ${i}`).toBeTruthy();
      expect(last.route!.stopIds).toContain(s.id);
    }
    expect(last!.route!.completed).toBe(true);
    expect(last!.route!.reward).toEqual({ xp: 200, flux: 60, shard: 'gemini' });
    expect(last!.route!.streak).toBe(1);
    const me = (await c.get<Me>('/api/me')).body;
    expect(me.flux).toBe(me0.flux + 60);
    expect(me.shards.gemini).toBe(me0.shards.gemini + 1);
    // revenir sur un arrêt ne redonne rien
    const again = await move(c, r.stops[0]!);
    expect(again.route).toBeUndefined();
    expect((await c.get<Me>('/api/me')).body.flux).toBe(me0.flux + 60);
    const w = await world(c, LOUVRE);
    expect(w.route!.completedAt).not.toBeNull();
    expect(w.route!.streak).toBe(1);
  });

  it('next day: a new route, streak 2 → +10 ƒ', async () => {
    clock += 24 * 3600_000;
    await move(c, LOUVRE);
    const r = (await world(c, LOUVRE)).route!;
    expect(r.done).toBe(0);
    expect(r.reward.flux).toBe(70);
    let last: MoveResponse | null = null;
    for (const s of r.stops) last = await move(c, s);
    expect(last!.route!.completed).toBe(true);
    expect(last!.route!.streak).toBe(2);
    const v = (await c.get<CodexView>('/api/codex')).body;
    expect(v.records.routesDone).toBe(2);
    expect(v.records.routeStreak).toBe(2);
  });

  it('no route in the middle of nowhere (no world nodes)', async () => {
    const n = client();
    await n.post('/auth/guest', { demo: true });
    await move(n, { lat: 47.0, lng: 1.0 });
    const w = await world(n, { lat: 47.0, lng: 1.0 });
    expect(w.route ?? null).toBeNull();
  });
});
