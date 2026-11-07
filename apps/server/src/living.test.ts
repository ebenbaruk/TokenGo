// Carte vivante côté serveur : événements de ville (admin, planification, effets prix/grève/ruée), marcheurs (vie privée), bulles, Pulse.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CITY_EVENT, LIVING, haversineM, legPosition, type CatchStartResponse, type CityEventView, type MerchantView, type PulseResponse,
  type QuoteResponse, type WalkersResponse, type WorldResponse,
} from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { eventTick } from './game/events.ts';
import { seedRunners, runnerTick } from './game/runners.ts';
import { kvSet } from './db.ts';

const ORIGIN = 'http://localhost:5173';
const LOUVRE = { lat: 48.8611, lng: 2.3358 };
const ADMIN = 'Bearer test-admin';

async function setup() {
  const env = { clock: Date.parse('2026-11-08T11:00:00Z') }; // 12 h à Paris
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', ADMIN_TOKEN: 'test-admin' });
  const { app, ctx } = await buildApp(cfg, { now: () => env.clock });
  let n = 0;
  const client = () => {
    const remoteAddress = `10.0.3.${++n}`;
    let cookie = '';
    const req = async <T>(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await app.inject({ method, url, remoteAddress, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers } });
      const set = [res.headers['set-cookie']].flat().find((c) => c?.startsWith('tg_sess='));
      if (set) cookie = set.split(';')[0]!;
      return { status: res.statusCode, body: res.json() as T & { error?: { code: string; message: string } } };
    };
    return { get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}, h: Record<string, string> = {}) => req<T>('POST', u, b, h) };
  };
  const player = async (at = LOUVRE) => {
    const c = client();
    await c.post('/auth/guest', { demo: true });
    env.clock += 3000;
    await c.post('/api/move', { lat: at.lat, lng: at.lng, acc: 8 });
    return c;
  };
  return { app, ctx, env, client, player };
}

const world = (c: { get: <T>(u: string) => Promise<{ body: T }> }, p = LOUVRE) => c.get<WorldResponse>(`/api/world?lat=${p.lat}&lng=${p.lng}`).then((r) => r.body);
const nearMarkets = (w: WorldResponse) => w.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open')
  .sort((a, b) => haversineM(LOUVRE, a) - haversineM(LOUVRE, b));

describe('city events', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup(); });
  afterAll(() => s.app.close());

  it('admin trigger is behind ADMIN_TOKEN and validated', async () => {
    const c = s.client();
    expect((await c.post('/api/admin/event', { kind: 'flash_crash' })).status).toBe(403);
    expect((await c.post('/api/admin/event', { kind: 'nuke' }, { authorization: ADMIN })).status).toBe(400);
    expect((await c.post('/api/admin/event', { kind: 'hype', minutes: 600 }, { authorization: ADMIN })).status).toBe(400);
  });

  it('flash crash: visible in /world and Pulse, lowers prices in the zone, "why" names it, quotes follow', async () => {
    const c = await s.player();
    const m0 = nearMarkets(await world(c))[0]!;
    const before = (await c.get<MerchantView>(`/api/merchant/${m0.merchant!.id}`)).body.prices.find((p) => p.family === 'deepseek')!;
    const r = await c.post<{ event: CityEventView }>('/api/admin/event', { kind: 'flash_crash', family: 'deepseek', zone: 'louvre', minutes: 20 }, { authorization: ADMIN });
    expect(r.status).toBe(200);
    expect(r.body.event).toMatchObject({ kind: 'flash_crash', family: 'deepseek', priceMult: 0.6, title: 'Flash crash at the Louvre', effect: 'DeepSeek prices −40%' });
    const w = await world(c);
    expect(w.event?.id).toBe(r.body.event.id);
    const after = (await c.get<MerchantView>(`/api/merchant/${m0.merchant!.id}`)).body.prices.find((p) => p.family === 'deepseek')!;
    expect(after.event).toEqual({ label: 'Flash crash at the Louvre', mult: 0.6 });
    expect(after.sell!).toBeLessThan(before.sell! * 0.7);
    const other = (await c.get<MerchantView>(`/api/merchant/${m0.merchant!.id}`)).body.prices.find((p) => p.family === 'qwen')!;
    expect(other.event).toBeUndefined();
    s.env.clock += 3000;
    await c.post('/api/move', { lat: m0.lat, lng: m0.lng, acc: 5 });
    const q = await c.post<QuoteResponse>(`/api/merchant/${m0.merchant!.id}/quote`, { side: 'buy', family: 'deepseek', qty: 1 });
    expect(q.status).toBe(200);
    expect(q.body.total).toBe(after.sell);
    // tous les marchands proches ont une bulle qui parle de l'événement
    const bubbles = (await world(c)).nodes.filter((n) => n.merchant?.bubble?.tone === 'event');
    expect(bubbles.length).toBeGreaterThan(0);
    expect(bubbles[0]!.merchant!.bubble!.text).toMatch(/DeepSeek/);
    const pulse = (await s.client().get<PulseResponse>('/api/pulse')).body;
    expect(pulse.cityEvent?.id).toBe(r.body.event.id);
    expect(pulse.events.some((e) => e.kind === 'city.event' && e.text.includes('Flash crash at the Louvre'))).toBe(true);
  });

  it('a quote made before the event starts is refused with PRICE_MOVED (no silent re-pricing)', async () => {
    const c = await s.player();
    const m0 = nearMarkets(await world(c))[0]!;
    s.env.clock += 3000;
    await c.post('/api/move', { lat: m0.lat, lng: m0.lng, acc: 5 });
    const q = await c.post<QuoteResponse>(`/api/merchant/${m0.merchant!.id}/quote`, { side: 'buy', family: 'qwen', qty: 1 });
    expect(q.status).toBe(200);
    await c.post('/api/admin/event', { kind: 'flash_crash', family: 'qwen', zone: 'louvre' }, { authorization: ADMIN });
    const t = await c.post(`/api/merchant/${m0.merchant!.id}/trade`, { quoteId: q.body.quoteId });
    expect(t.status).toBe(409);
    expect(t.body.error?.code).toBe('PRICE_MOVED');
  });

  it('only one event at a time: a new trigger ends the previous one; admin can end it', async () => {
    const c = s.client();
    await c.post('/api/admin/event', { kind: 'hype', family: 'gpt', zone: 'opera' }, { authorization: ADMIN });
    const active = () => (s.ctx.db.prepare('SELECT COUNT(*) n FROM city_events WHERE starts_at <= ? AND ends_at > ?').get(s.env.clock, s.env.clock) as { n: number }).n;
    expect(active()).toBe(1);
    expect((await c.post('/api/admin/event/end', {})).status).toBe(403);
    const r = await c.post<{ ended: CityEventView | null }>('/api/admin/event/end', {}, { authorization: ADMIN });
    expect(r.body.ended?.kind).toBe('hype');
    expect(active()).toBe(0);
    expect((await world(await s.player())).event).toBeNull();
  });

  it('strike: shops in the zone refuse to sell but still buy', async () => {
    const c = await s.player();
    await c.post('/api/admin/event', { kind: 'strike', zone: 'louvre' }, { authorization: ADMIN });
    const m0 = nearMarkets(await world(c))[0]!;
    s.env.clock += 3000;
    await c.post('/api/move', { lat: m0.lat, lng: m0.lng, acc: 5 });
    const q = await c.post(`/api/merchant/${m0.merchant!.id}/quote`, { side: 'buy', family: 'qwen', qty: 1 });
    expect(q.body.error?.code).toBe('STRIKE');
    const v = (await c.get<MerchantView>(`/api/merchant/${m0.merchant!.id}`)).body;
    expect(v.prices.every((p) => p.sell === null && p.sellBlocked === 'strike')).toBe(true);
    expect(v.prices.some((p) => p.buy !== null)).toBe(true);
  });

  it('gold rush: bonus shards of the family appear in the zone and can really be caught', async () => {
    const c = await s.player();
    const before = (await world(c)).spawns.filter((x) => x.id.includes(':e'));
    expect(before).toEqual([]);
    const r = await c.post<{ event: CityEventView }>('/api/admin/event', { kind: 'gold_rush', family: 'claude', zone: 'louvre' }, { authorization: ADMIN });
    // la vague dépend de la cellule : on cherche un point de la zone où un éclat bonus est visible
    let found: { id: string; lat: number; lng: number } | undefined;
    for (let i = 0; i < 25 && !found; i++) {
      const p = { lat: LOUVRE.lat + ((i % 5) - 2) * 0.0025, lng: LOUVRE.lng + (Math.floor(i / 5) - 2) * 0.0035 };
      found = (await world(c, p)).spawns.find((x) => x.id.endsWith(`:e${r.body.event.id}`));
    }
    expect(found, 'a bonus Claude shard somewhere in the zone').toBeTruthy();
    const w = (await world(c, found!)).spawns.find((x) => x.id === found!.id)!;
    expect(w.family).toBe('claude');
    s.env.clock += 3000;
    await c.post('/api/move', { lat: found!.lat, lng: found!.lng, acc: 5 });
    const st = await c.post<CatchStartResponse>('/api/catch/start', { spawnId: found!.id });
    expect(st.status).toBe(200);
    expect(st.body.family).toBe('claude');
  });

  it('auto schedule: daytime only, gap between events, daily cap, end announced in the Pulse', () => {
    const { ctx, env } = s;
    ctx.db.prepare('DELETE FROM city_events').run();
    kvSet(ctx.db, 'city-event-next', env.clock - 1);
    const e = eventTick(ctx)!;
    expect(e).toBeTruthy();
    expect(eventTick(ctx)).toBeNull(); // déjà un événement actif
    env.clock = e.endsAt + 1;
    expect(eventTick(ctx)).toBeNull(); // pause de 2 à 4 h
    expect(ctx.db.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'city.event.end'").get()).toEqual({ n: 1 });
    // la nuit : rien
    kvSet(ctx.db, 'city-event-next', 0);
    env.clock = Date.parse('2026-11-09T02:00:00Z'); // 3 h à Paris
    expect(eventTick(ctx)).toBeNull();
    // plafond quotidien
    env.clock = Date.parse('2026-11-09T07:30:00Z'); // 8 h 30 à Paris
    let started = 0;
    for (let i = 0; i < 40; i++) {
      kvSet(ctx.db, 'city-event-next', 0);
      const x = eventTick(ctx);
      if (x) { started++; env.clock = x.endsAt + 1; }
    }
    expect(started).toBe(CITY_EVENT.maxPerDay);
  });
});

describe('walkers', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup(); seedRunners(s.ctx, 24); });
  afterAll(() => s.app.close());

  it('runners walk real legs at walking speed and carry a note; never more than 12 walkers', async () => {
    for (let i = 0; i < 30; i++) { s.env.clock += 10_000; await runnerTick(s.ctx, 24); }
    const c = await s.player();
    const r = await c.get<WalkersResponse>(`/api/walkers?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`);
    expect(r.status).toBe(200);
    expect(r.body.walkers.length).toBeGreaterThan(0);
    expect(r.body.walkers.length).toBeLessThanOrEqual(LIVING.walkersMax);
    const moving = r.body.walkers.filter((w) => w.kind === 'runner' && w.arriveAt > r.body.now);
    expect(moving.length).toBeGreaterThan(0);
    for (const w of moving) {
      const v = haversineM(w.from, w.to) / ((w.arriveAt - w.departAt) / 1000);
      expect(v).toBeLessThanOrEqual(5000 / 3600 + 0.01);
      expect(haversineM(w.from, w.to)).toBeLessThan(1300);
      expect(haversineM(LOUVRE, legPosition(w, r.body.now))).toBeLessThanOrEqual(LIVING.walkersRadiusM);
    }
  });

  it('real players: anonymised (cell + jitter, no name, opaque id), never the requester, only when recently seen', async () => {
    const spot = { lat: 48.8606, lng: 2.3376 };
    const b = await s.player(spot);
    const bId = (await b.get<{ id: string }>('/api/me')).body.id;
    const a = await s.player();
    const seen = (await a.get<WalkersResponse>(`/api/walkers?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`)).body.walkers.filter((w) => w.kind === 'player');
    expect(seen.length).toBeGreaterThan(0);
    for (const w of seen) {
      expect(w.name).toBeNull();
      expect(w.note).toBeNull();
      expect(w.id).not.toContain(bId);
      expect(w.from).toEqual(w.to);
    }
    // B ne se voit pas lui-même ; sa position publiée n'est pas sa position exacte mais reste dans son quartier
    const own = (await b.get<WalkersResponse>(`/api/walkers?lat=${spot.lat}&lng=${spot.lng}`)).body.walkers.filter((w) => w.kind === 'player');
    const fromA = seen.find((w) => !own.some((o) => o.id === w.id))!;
    expect(fromA).toBeTruthy();
    const d = haversineM(spot, fromA.from);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(350);
    // 3 min sans bouger : disparaît
    s.env.clock += LIVING.playerSeenMs + 1000;
    const later = (await a.get<WalkersResponse>(`/api/walkers?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`)).body.walkers.filter((w) => w.kind === 'player');
    expect(later).toEqual([]);
  });

  it('is rate-limited and needs a session', async () => {
    expect((await s.client().get(`/api/walkers?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`)).status).toBe(401);
    const c = await s.player();
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) limited = (await c.get(`/api/walkers?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`)).status === 429;
    expect(limited).toBe(true);
  });

  it('Pulse counts walkers', async () => {
    s.env.clock += 1000;
    await s.player();
    const p = (await s.client().get<PulseResponse>('/api/pulse')).body;
    expect(p.walkers.runners).toBe(24);
    expect(p.walkers.players).toBeGreaterThan(0);
  });
});
