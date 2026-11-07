// Monde « partout » (régions générées) et Remote Scout (batterie) — par l'API, horloge injectée, Overpass simulé.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SCOUT, WORLD_GEN, haversineM, offsetM, type CatchStartResponse, type Me, type MoveResponse, type QuoteResponse, type WorldResponse } from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import type { Ctx } from './game/context.ts';
import { fakeOverpass, LISBON } from './game/worldgen.fixture.ts';
import { regionOf } from './game/worldgen.ts';

const ORIGIN = 'http://localhost:5173';
const LOUVRE = { lat: 48.8611, lng: 2.3358 };
let clock = Date.parse('2026-11-08T10:00:00Z');
const dir = mkdtempSync(join(tmpdir(), 'tg-regions-'));
const DB = join(dir, 'regions.db');
const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: DB, FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0' });
let app: FastifyInstance;
let ctx: Ctx;
let overpassCalls = 0;
let overpassDown = false;
const overpass = async (q: string) => {
  overpassCalls++;
  if (overpassDown) throw new Error('overpass unavailable');
  expect(q).toContain('[out:json]');
  return fakeOverpass(regionOf(LISBON.lat, LISBON.lng));
};

beforeAll(async () => { ({ app, ctx } = await buildApp(cfg, { now: () => clock, overpass })); });
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

let ipN = 0;
function client(ip = `10.1.0.${++ipN}`) {
  let cookie = '';
  const req = async <T>(method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await app.inject({ method, url, remoteAddress: ip, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
    const set = res.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
    return { status: res.statusCode, body: res.json() as T & { error?: { code: string } } };
  };
  return { get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}) => req<T>('POST', u, b) };
}
type Client = ReturnType<typeof client>;
const world = (c: Client, p: { lat: number; lng: number }) => c.get<WorldResponse>(`/api/world?lat=${p.lat}&lng=${p.lng}`);

/** Marche réelle (GPS) : pas de 20 m toutes les 15 s (≈ 5 km/h), sans déclencher l'anti-triche. */
async function walkGps(c: Client, from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const d = haversineM(from, to);
  const steps = Math.max(1, Math.ceil(d / 20));
  for (let i = 1; i <= steps; i++) {
    clock += 15_000;
    const p = { lat: from.lat + ((to.lat - from.lat) * i) / steps, lng: from.lng + ((to.lng - from.lng) * i) / steps };
    const r = await c.post<MoveResponse>('/api/move', { ...p, acc: 8 });
    expect(r.status).toBe(200);
    expect(r.body.suspicious).toBe(false);
  }
  return to;
}

describe('play anywhere: a GPS player in Lisbon', () => {
  it('scouts the neighbourhood in the background, then catch, sync and sell work there', async () => {
    const c = client();
    expect((await c.post<Me>('/auth/guest', {})).status).toBe(200);
    await c.post('/api/move', { ...LISBON, acc: 8 });
    const first = await world(c, LISBON);
    expect(first.status).toBe(200);
    expect(first.body.region).toMatchObject({ status: 'scouting', source: null });
    expect(first.body.region!.ids[0]).toBe(regionOf(LISBON.lat, LISBON.lng));
    await ctx.regions!.idle();
    expect(overpassCalls).toBeGreaterThanOrEqual(1);

    const w = (await world(c, LISBON)).body;
    expect(w.region).toMatchObject({ status: 'ready', source: 'osm' });
    const markets = w.nodes.filter((n) => n.kind === 'market');
    expect(markets.length).toBeGreaterThanOrEqual(2);
    expect(markets.every((m) => m.merchant && m.merchant.status === 'open')).toBe(true);
    expect(w.nodes.some((n) => n.kind === 'forge')).toBe(true);
    expect(w.nodes.filter((n) => n.kind === 'relay').length).toBeGreaterThanOrEqual(WORLD_GEN.minOsmRelays);
    expect(w.objective?.text).toMatch(/Catch/);

    // capture de l'éclat du tutoriel (20 m au nord), puis d'un éclat ordinaire
    let pos = LISBON;
    const tut = w.spawns.find((s) => s.id.startsWith('tut:'))!;
    pos = await walkGps(c, pos, tut);
    const start = await c.post<CatchStartResponse>('/api/catch/start', { spawnId: tut.id });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    clock += 1500;
    const res = await c.post<{ result: string; me: Me }>('/api/catch/resolve', { attemptId: start.body.attemptId, offsets: [0] });
    expect(['perfect', 'good']).toContain(res.body.result);

    // sync du relais généré le plus proche
    const relay = (await world(c, pos)).body.nodes.filter((n) => n.kind === 'relay').sort((a, b) => haversineM(pos, a) - haversineM(pos, b))[0]!;
    pos = await walkGps(c, pos, relay);
    const sync = await c.post<{ flux: number }>('/api/relay/sync', { nodeId: relay.id });
    expect(sync.status, JSON.stringify(sync.body)).toBe(200);
    expect(sync.body.flux).toBeGreaterThan(0);

    // vente au marchand généré le plus proche
    const mk = markets.sort((a, b) => haversineM(pos, a) - haversineM(pos, b))[0]!;
    pos = await walkGps(c, pos, mk);
    const me = (await c.get<Me>('/api/me')).body;
    const fam = (Object.keys(me.shards) as (keyof Me['shards'])[]).find((f) => me.shards[f] > 0)!;
    const q = await c.post<QuoteResponse>(`/api/merchant/${encodeURIComponent(mk.merchant!.id)}/quote`, { side: 'sell', family: fam, qty: 1 });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const t = await c.post<{ total: number; me: Me }>(`/api/merchant/${encodeURIComponent(mk.merchant!.id)}/trade`, { quoteId: q.body.quoteId });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    expect(t.body.me.flux).toBeGreaterThan(me.flux);
  });

  it('persists regions: a restarted server reloads them (same nodes, same merchants)', async () => {
    const before = ctx.world.nodes.filter((n) => n.region).map((n) => n.id).sort();
    expect(before.length).toBeGreaterThan(0);
    const again = await buildApp(cfg, { now: () => clock, overpass: async () => { throw new Error('must not refetch'); } });
    try {
      const after = again.ctx.world.nodes.filter((n) => n.region).map((n) => n.id).sort();
      expect(after).toEqual(before);
      const mk = again.ctx.world.nodes.find((n) => n.region && n.kind === 'market')!;
      expect(again.ctx.db.prepare('SELECT 1 FROM merchants WHERE node_id = ?').get(mk.id)).toBeTruthy();
      expect(again.ctx.world.forges.some((f) => f.region && f.theme.length === 2)).toBe(true);
    } finally {
      await again.app.close();
    }
  });

  it('Overpass down → procedural fallback (deterministic), the game still works', async () => {
    overpassDown = true;
    try {
      const c = client();
      await c.post('/auth/guest', {});
      const berlin = { lat: 52.52, lng: 13.405 };
      await c.post('/api/move', { ...berlin, acc: 8 });
      expect((await world(c, berlin)).body.region?.status).toBe('scouting');
      await ctx.regions!.idle();
      const w = (await world(c, berlin)).body;
      expect(w.region).toMatchObject({ status: 'ready', source: 'procedural' });
      expect(w.nodes.length).toBeGreaterThan(5);
      const gen = ctx.world.nodes.filter((n) => n.region === regionOf(berlin.lat, berlin.lng));
      expect(gen.filter((n) => n.kind === 'market')).toHaveLength(WORLD_GEN.procedural.markets);
    } finally {
      overpassDown = false;
    }
  });

  it('Paris is never generated; caps regions per IP and per day', async () => {
    const paris = client();
    await paris.post('/auth/guest', {});
    expect((await world(paris, LOUVRE)).body.region).toMatchObject({ status: 'ready', source: 'paris' });

    overpassDown = true;
    const ip = '10.9.9.9';
    const c = client(ip);
    await c.post('/auth/guest', {});
    let capped: WorldResponse['region'] | null = null;
    for (let i = 0; i < 20 && !capped; i++) {
      const p = { lat: -33.9 + i * 0.3, lng: 18.4 };
      clock += 15_000;
      await c.post('/api/move', { ...p, acc: 8 }); // la génération suit la position serveur du joueur
      const r = (await world(c, p)).body.region!;
      await ctx.regions!.idle();
      if (r.status === 'capped') capped = r;
    }
    overpassDown = false;
    expect(capped).toMatchObject({ status: 'capped', source: null });
    const ipHashCount = (ctx.db.prepare('SELECT ip_hash, COUNT(*) n FROM regions GROUP BY ip_hash ORDER BY n DESC').all() as { n: number }[])[0]!.n;
    expect(ipHashCount).toBe(WORLD_GEN.maxRegionsPerIpPerDay);
    // un autre réseau peut encore générer
    const other = client('10.9.9.10');
    await other.post('/auth/guest', {});
    await other.post('/api/move', { lat: 35.68, lng: 139.76, acc: 8 });
    expect((await world(other, { lat: 35.68, lng: 139.76 })).body.region?.status).toBe('scouting');
    await ctx.regions!.idle();
  });

  // Sécurité : /api/world prend lat/lng en paramètres. Sans ancrage, n'importe qui génère des quartiers n'importe où
  // (et vide le plafond global du jour pour tout le monde) sans jamais y être.
  it('generates only around the player’s own server position, never at an arbitrary lat/lng', async () => {
    overpassDown = true;
    try {
      const berlin = { lat: 52.23, lng: 21.01 }; // Varsovie
      const exists = () => !!ctx.db.prepare('SELECT 1 FROM regions WHERE id = ?').get(regionOf(berlin.lat, berlin.lng));
      const c = client();
      await c.post('/auth/guest', {});
      await world(c, berlin); // pas de position serveur
      await ctx.regions!.idle();
      expect(exists()).toBe(false);
      clock += 15_000;
      await c.post('/api/move', { ...LOUVRE, acc: 8 }); // position serveur à Paris, carte demandée à Berlin
      await world(c, berlin);
      await ctx.regions!.idle();
      expect(exists()).toBe(false);
      clock += 15_000;
      await c.post('/api/move', { ...berlin, acc: 8 }); // le joueur y est (pour le serveur)
      await world(c, berlin);
      await ctx.regions!.idle();
      expect(exists()).toBe(true);
    } finally { overpassDown = false; }
  });

  // Sécurité : une box IPv6 reçoit un /64 entier ; une adresse par requête ne doit pas multiplier le plafond par IP.
  it('IPv6 addresses of one /64 share the per-network daily cap', async () => {
    overpassDown = true;
    try {
      let capped = false;
      for (let i = 0; i < 20 && !capped; i++) {
        const c = client(`2001:db8:77:1::${(i + 1).toString(16)}`);
        await c.post('/auth/guest', {});
        const p = { lat: -20 + i * 0.3, lng: 57.5 };
        clock += 15_000;
        await c.post('/api/move', { ...p, acc: 8 });
        capped = (await world(c, p)).body.region?.status === 'capped';
        await ctx.regions!.idle();
      }
      expect(capped).toBe(true);
    } finally { overpassDown = false; }
  });
});

describe('Remote Scout: battery and speed cap (server-enforced)', () => {
  it('drains, refuses impossible flights, grounds the scout, then recovers with time', async () => {
    const c = client();
    const me = (await c.post<Me>('/auth/guest', { demo: true })).body;
    expect(me.mode).toBe('demo');
    expect(me.scout).toMatchObject({ battery: 100, grounded: false, last: null });

    clock += 1000;
    expect((await c.post<MoveResponse>('/api/move', { ...LOUVRE, acc: 5 })).body.scout?.battery).toBe(100);
    // Dash de 1,4 km en 3 s : accepté, coûte 1,4 × 30 × 1,5 = 63 %
    clock += 3000;
    const far = offsetM(LOUVRE, 0, 1400);
    const d1 = (await c.post<MoveResponse>('/api/move', { ...far, acc: 5 })).body;
    expect(d1.refused).toBeUndefined();
    expect(d1.scout!.battery).toBeCloseTo(37, 0);
    // second Dash : pas assez de batterie → refusé, la position serveur reste `far`
    clock += 3000;
    const d2 = (await c.post<MoveResponse>('/api/move', { ...LOUVRE, acc: 5 })).body;
    expect(d2.refused).toBe('BATTERY_EMPTY');
    expect(haversineM(d2.at!, far)).toBeLessThan(1);
    // saut de 3 km : jamais d'un coup
    clock += 3000;
    expect((await c.post<MoveResponse>('/api/move', { ...offsetM(far, 0, 3000), acc: 5 })).body.refused).toBe('HOP_TOO_LONG');
    // vol de croisière (36 km/h) jusqu'à la panne — pas de 100 m : le rate limit de /api/move est en temps réel
    let p = far;
    let last: MoveResponse | null = null;
    for (let i = 0; i < 35; i++) {
      clock += 10_000;
      const to = offsetM(p, 100, 0);
      last = (await c.post<MoveResponse>('/api/move', { ...to, acc: 5 })).body;
      if (last.refused) break;
      p = to;
    }
    expect(last!.refused).toBe('BATTERY_EMPTY');
    expect(last!.scout).toMatchObject({ grounded: true });
    const resumeAt = last!.scout!.resumeAt!;
    expect(resumeAt - clock).toBeLessThanOrEqual((SCOUT.resumeAtPct / SCOUT.rechargePerMin) * 60_000 + 1000);
    // /api/me expose le même état ; les actions restent possibles au sol (on ne bouge juste plus)
    expect((await c.get<Me>('/api/me')).body.scout).toMatchObject({ grounded: true });
    clock = resumeAt + 1000;
    const ok = (await c.post<MoveResponse>('/api/move', { ...offsetM(p, 100, 0), acc: 5 })).body;
    expect(ok.refused).toBeUndefined();
    expect(ok.scout!.grounded).toBe(false);
  });

  it('GPS players have no battery', async () => {
    const c = client();
    expect((await c.post<Me>('/auth/guest', {})).body.scout).toBeNull();
    expect((await c.post<MoveResponse>('/api/move', { ...LOUVRE, acc: 8 })).body.scout).toBeUndefined();
  });
});
