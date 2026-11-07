// Monde « partout » : quartier procédural servi vite (Overpass lent), puis remplacé par la vraie carte OSM si elle
// arrive tant que le quartier est « frais » (regionFresh). Overpass simulé par des promesses qu'on résout à la main.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WORLD_GEN, haversineM, type Me, type MoveResponse, type QuoteResponse, type WorldResponse } from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import type { Ctx } from './game/context.ts';
import { regionFresh, type RegionActivity } from './game/regions.ts';
import { fakeOverpass } from './game/worldgen.fixture.ts';
import { overpassQuery, regionOf } from './game/worldgen.ts';
import type { OsmElement } from './game/worldgen.ts';

const ORIGIN = 'http://localhost:5173';
let clock = Date.parse('2026-11-08T10:00:00Z');
const dir = mkdtempSync(join(tmpdir(), 'tg-upgrade-'));
const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: join(dir, 'up.db'), FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0' });

/** Requêtes Overpass en attente : la réponse n'arrive que quand le test le décide. */
const calls: { query: string; resolve: (e: OsmElement[]) => void; reject: (e: Error) => void }[] = [];
let failFast = false; // miroirs saturés : la requête échoue tout de suite (504)
const overpass = (query: string) => new Promise<OsmElement[]>((resolve, reject) => {
  if (failFast) reject(new Error('HTTP 504')); else calls.push({ query, resolve, reject });
});
/**
 * La réponse OSM (fixture riche) arrive pour la région `id` ; toutes les autres requêtes en attente échouent (régions
 * voisines : elles restent procédurales). La fixture réutilise les mêmes ids OSM d'une région à l'autre.
 */
function osmArrives(id: string) {
  const q = overpassQuery(id);
  for (const c of calls.splice(0)) {
    if (c.query === q) c.resolve(fakeOverpass(id)); else c.reject(new Error('mirror timeout'));
  }
}

let app: FastifyInstance;
let ctx: Ctx;
beforeAll(async () => { ({ app, ctx } = await buildApp(cfg, { now: () => clock, overpass, regionTimings: { quickMs: 30, retryMs: 300 } })); });
afterAll(async () => {
  for (const c of calls.splice(0)) c.reject(new Error('test over'));
  await ctx.regions!.upgradesIdle();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

let ipN = 0;
function client() {
  const ip = `10.4.0.${++ipN}`;
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
const world = async (c: Client, p: { lat: number; lng: number }) => (await c.get<WorldResponse>(`/api/world?lat=${p.lat}&lng=${p.lng}`)).body;

async function walkGps(c: Client, from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const steps = Math.max(1, Math.ceil(haversineM(from, to) / 20));
  for (let i = 1; i <= steps; i++) {
    clock += 15_000;
    const p = { lat: from.lat + ((to.lat - from.lat) * i) / steps, lng: from.lng + ((to.lng - from.lng) * i) / steps };
    expect((await c.post<MoveResponse>('/api/move', { ...p, acc: 8 })).body.suspicious).toBe(false);
  }
  return to;
}

/** Arrive en GPS à `p`, attend le quartier procédural (Overpass ne répond pas dans le délai court). */
async function arriveProcedural(p: { lat: number; lng: number }) {
  const c = client();
  await c.post<Me>('/auth/guest', {});
  await c.post('/api/move', { ...p, acc: 8 });
  expect((await world(c, p)).region?.status).toBe('scouting');
  await ctx.regions!.idle();
  const w = await world(c, p);
  expect(w.region).toMatchObject({ status: 'ready', source: 'procedural', upgrading: true });
  return { c, w, region: regionOf(p.lat, p.lng) };
}

const merchantIdsIn = (region: string) => ctx.world.nodes.filter((n) => n.region === region && n.kind === 'market')
  .map((n) => (ctx.db.prepare('SELECT id FROM merchants WHERE node_id = ?').get(n.id) as { id: string } | undefined)?.id).filter(Boolean) as string[];

describe('regionFresh (pure rule)', () => {
  const none: RegionActivity = { trades: 0, haggles: 0, rescues: 0, contracts: 0, compiles: 0, routeStops: 0 };
  const t0 = 1_000_000;
  it('only a procedural region, younger than the window, with no player activity tied to its places', () => {
    expect(regionFresh({ source: 'procedural', createdAt: t0 }, none, t0 + 60_000)).toBe(true);
    expect(regionFresh({ source: 'procedural', createdAt: t0 }, none, t0 + WORLD_GEN.upgradeWindowMs - 1)).toBe(true);
    expect(regionFresh({ source: 'procedural', createdAt: t0 }, none, t0 + WORLD_GEN.upgradeWindowMs)).toBe(false);
    expect(regionFresh({ source: 'osm', createdAt: t0 }, none, t0 + 1)).toBe(false);
    for (const k of Object.keys(none) as (keyof RegionActivity)[]) {
      expect(regionFresh({ source: 'procedural', createdAt: t0 }, { ...none, [k]: 1 }, t0 + 1), k).toBe(false);
    }
  });
});

describe('slow Overpass: play now (procedural), real map later (OSM)', () => {
  it('Lisbon: served procedural after the short wait, then upgraded to OSM — merchants re-seeded, route re-planned, old holdings burnt', async () => {
    const LISBON = { lat: 38.7107, lng: -9.1365 };
    const { c, w, region } = await arriveProcedural(LISBON);
    const oldNodes = new Set(ctx.world.nodes.filter((n) => n.region === region).map((n) => n.id));
    const oldMerchants = merchantIdsIn(region);
    expect(oldMerchants).toHaveLength(WORLD_GEN.procedural.markets);
    const routeBefore = w.route;
    expect(routeBefore?.stops.length ?? 0).toBeGreaterThan(0); // route du jour sur les nœuds procéduraux (pas commencée)
    const mintsBefore = (ctx.db.prepare("SELECT COUNT(*) n FROM chain_ops WHERE memo = 'merchant-seed'").get() as { n: number }).n;

    osmArrives(region);
    await ctx.regions!.upgradesIdle();

    const after = await world(c, LISBON);
    expect(after.region).toMatchObject({ status: 'ready', source: 'osm' });
    expect(after.region?.upgrading).toBeUndefined();
    const regionNodes = ctx.world.nodes.filter((n) => n.region === region);
    expect(regionNodes.some((n) => oldNodes.has(n.id))).toBe(false);
    expect(regionNodes.filter((n) => n.kind === 'relay').length).toBeGreaterThanOrEqual(WORLD_GEN.minOsmRelays);
    // marchands : les anciens ont disparu (et rendu leur stock), les nouveaux sont ouverts
    for (const id of oldMerchants) expect(ctx.db.prepare('SELECT 1 FROM merchants WHERE id = ?').get(id)).toBeUndefined();
    const fresh = after.nodes.filter((n) => n.kind === 'market' && ctx.world.byId.get(n.id)?.region === region);
    expect(fresh.length).toBeGreaterThanOrEqual(WORLD_GEN.minOsmMarkets);
    expect(fresh.every((n) => n.merchant?.status === 'open')).toBe(true);
    const burns = ctx.db.prepare("SELECT COUNT(*) n FROM chain_ops WHERE kind = 'burn' AND memo = ?").get(`region-upgrade:${region}`) as { n: number };
    expect(burns.n).toBeGreaterThan(0);
    // l'outbox n'est jamais réécrite : les mints de création sont toujours là (+ ceux des nouveaux marchands)
    expect((ctx.db.prepare("SELECT COUNT(*) n FROM chain_ops WHERE memo = 'merchant-seed'").get() as { n: number }).n).toBeGreaterThan(mintsBefore);
    // la route pas commencée est recalculée sur les vrais lieux
    expect(after.route?.stops.every((s) => ctx.world.byId.get(s.id))).toBe(true);
    expect(after.route?.stops.some((s) => oldNodes.has(s.id))).toBe(false);
    expect((ctx.db.prepare('SELECT source FROM regions WHERE id = ?').get(region) as { source: string }).source).toBe('osm');

    // on joue sur la vraie carte : achat chez un marchand OSM
    const mk = fresh.sort((a, b) => haversineM(LISBON, a) - haversineM(LISBON, b))[0]!;
    await walkGps(c, LISBON, mk);
    const q = await c.post<QuoteResponse>(`/api/merchant/${encodeURIComponent(mk.merchant!.id)}/quote`, { side: 'buy', family: 'qwen', qty: 1 });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect((await c.post(`/api/merchant/${encodeURIComponent(mk.merchant!.id)}/trade`, { quoteId: q.body.quoteId })).status).toBe(200);

    // redémarrage : la région rechargée est la version OSM
    const again = await buildApp(cfg, { now: () => clock, overpass: async () => { throw new Error('must not refetch an OSM region'); } });
    try {
      expect(again.ctx.world.regions.get(region)).toBe('osm');
      expect(again.ctx.world.nodes.filter((n) => n.region === region).map((n) => n.id).sort()).toEqual(regionNodes.map((n) => n.id).sort());
    } finally { await again.app.close(); }
  });

  it('Berlin: someone already traded at a procedural shop → the OSM answer is ignored (stays procedural)', async () => {
    const BERLIN = { lat: 52.52, lng: 13.405 };
    const { c, w, region } = await arriveProcedural(BERLIN);
    const mk = w.nodes.filter((n) => n.kind === 'market').sort((a, b) => haversineM(BERLIN, a) - haversineM(BERLIN, b))[0]!;
    await walkGps(c, BERLIN, mk);
    const q = await c.post<QuoteResponse>(`/api/merchant/${encodeURIComponent(mk.merchant!.id)}/quote`, { side: 'buy', family: 'qwen', qty: 1 });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect((await c.post(`/api/merchant/${encodeURIComponent(mk.merchant!.id)}/trade`, { quoteId: q.body.quoteId })).status).toBe(200);
    const before = ctx.world.nodes.filter((n) => n.region === region).map((n) => n.id).sort();

    osmArrives(region);
    await ctx.regions!.upgradesIdle();
    expect(ctx.world.regions.get(region)).toBe('procedural');
    expect(ctx.world.nodes.filter((n) => n.region === region).map((n) => n.id).sort()).toEqual(before);
    expect(ctx.db.prepare('SELECT 1 FROM merchants WHERE id = ?').get(mk.merchant!.id)).toBeTruthy();
    expect((await world(c, mk)).region?.upgrading).toBeUndefined();
  });

  it('Madrid: the OSM answer arrives after the 15-min window → stays procedural', async () => {
    const MADRID = { lat: 40.4168, lng: -3.7038 };
    const { w, region } = await arriveProcedural(MADRID);
    clock += WORLD_GEN.upgradeWindowMs + 1000;
    osmArrives(region);
    await ctx.regions!.upgradesIdle();
    expect(ctx.world.regions.get(region)).toBe('procedural');
  });

  it('Rome: Overpass fails fast (504) → procedural at once, one background retry brings the real map', async () => {
    const ROME = { lat: 41.8986, lng: 12.4769 };
    failFast = true;
    const { region } = await arriveProcedural(ROME);
    failFast = false;
    const q = overpassQuery(region);
    await new Promise((r) => setTimeout(r, 700)); // les nouveaux essais (300 ms après chaque échec) sont partis
    expect(calls.some((c) => c.query === q), 'retried once').toBe(true);
    osmArrives(region);
    await ctx.regions!.upgradesIdle();
    expect(ctx.world.regions.get(region)).toBe('osm');
  });
});
