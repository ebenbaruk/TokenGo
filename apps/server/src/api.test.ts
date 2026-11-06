import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { RELAY, haversineM, merchantIdFor, type CatchStartResponse, type ForgeView, type Me, type MerchantView, type QuoteResponse, type WorldResponse } from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import type { Ctx } from './game/context.ts';
import { runHourly } from './game/merchants.ts';

const ORIGIN = 'http://localhost:5173';
const LOUVRE = { lat: 48.8611, lng: 2.3358 };
let clock = Date.parse('2026-11-08T10:00:00Z');
let app: FastifyInstance;
let ctx: Ctx;

beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', DEMO_TOKEN: 'judge-pass' });
  ({ app, ctx } = await buildApp(cfg, { now: () => clock }));
});
afterAll(() => app.close());

/** Petit client avec cookie de session. */
function client() {
  let cookie = '';
  const req = async <T>(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers } });
    const set = res.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
    let parsed: unknown = null;
    try { parsed = res.json(); } catch { /* texte (playground) */ }
    return { status: res.statusCode, body: parsed as T & { error?: { code: string; message: string } }, raw: res };
  };
  return { req, get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}) => req<T>('POST', u, b) };
}

async function walkTo(c: ReturnType<typeof client>, to: { lat: number; lng: number }) {
  clock += 3000;
  return c.post('/api/move', { lat: to.lat, lng: to.lng, acc: 8 });
}

async function catchOne(c: ReturnType<typeof client>, spawnId: string, offset = 0.0) {
  const s = await c.post<CatchStartResponse>('/api/catch/start', { spawnId });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  clock += 1500;
  return c.post<{ result: string; qty: number; me: Me }>('/api/catch/resolve', { attemptId: s.body.attemptId, offsets: [offset] });
}

describe('security basics', () => {
  it('rejects writes without a valid Origin', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/guest', payload: {} });
    expect(res.statusCode).toBe(403);
    const bad = await app.inject({ method: 'POST', url: '/auth/guest', payload: {}, headers: { origin: 'https://evil.example' } });
    expect(bad.statusCode).toBe(403);
  });
  it('requires a session and sets security headers + HttpOnly cookie', async () => {
    const c = client();
    expect((await c.get('/api/me')).status).toBe(401);
    const r = await c.post<Me>('/auth/guest', { demo: true });
    expect(r.raw.headers['content-security-policy']).toContain("default-src 'self'");
    expect(String(r.raw.headers['set-cookie'])).toMatch(/HttpOnly/);
    expect(String(r.raw.headers['set-cookie'])).toMatch(/SameSite=Lax/);
  });
});

describe('tutorial loop: guest → catch → sync → trade → First Compile → credits', () => {
  const c = client();
  let world: WorldResponse;

  it('demo guest starts with a kit at level 3', async () => {
    const me = await c.post<Me>('/auth/guest', { demo: true });
    expect(me.status).toBe(200);
    expect(me.body.mode).toBe('demo');
    expect(me.body.level).toBe(3);
    expect(me.body.flux).toBe(60);
  });

  it('sees the world and a tutorial shard 20 m away', async () => {
    await walkTo(c, LOUVRE);
    world = (await c.get<WorldResponse>(`/api/world?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`)).body;
    expect(world.nodes.some((n) => n.kind === 'forge')).toBe(true);
    expect(world.nodes.filter((n) => n.kind === 'market').length).toBeGreaterThanOrEqual(2);
    const tut = world.spawns.find((s) => s.id.startsWith('tut:'));
    expect(tut).toBeTruthy();
    expect(haversineM(LOUVRE, tut!)).toBeGreaterThan(15);
    expect(world.objective?.text).toMatch(/Catch/);
  });

  it('too far → TOO_FAR; close → catch (server decides)', async () => {
    const tut = world.spawns.find((s) => s.id.startsWith('tut:'))!;
    const far = world.spawns.find((s) => !s.id.startsWith('tut:') && haversineM(LOUVRE, s) > 80);
    if (far) {
      const r = await c.post('/api/catch/start', { spawnId: far.id });
      expect(r.body.error?.code).toBe('TOO_FAR');
    }
    await walkTo(c, tut);
    const r = await catchOne(c, tut.id, 0.9); // raté, mais le tutoriel est indulgent
    expect(r.body.result).toBe('good');
    expect(r.body.me.shards.deepseek).toBe(2);
    expect(r.body.me.tutorial.caught).toBe(true);
    const again = await c.post('/api/catch/start', { spawnId: tut.id });
    expect(again.status).toBe(400);
  });

  it('cannot invent a spawn id', async () => {
    const r = await c.post('/api/catch/start', { spawnId: '891fb4675abffff:1:0' });
    expect(r.body.error?.code).toBe('EXPIRED');
  });

  it('syncs a relay, then cooldown', async () => {
    const relay = world.nodes.filter((n) => n.kind === 'relay').sort((a, b) => haversineM(LOUVRE, a) - haversineM(LOUVRE, b))[0]!;
    await walkTo(c, relay);
    const r = await c.post<{ flux: number; shard: string | null; me: Me }>('/api/relay/sync', { nodeId: relay.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.flux).toBeGreaterThanOrEqual(RELAY.fluxMin);
    expect(r.body.shard).not.toBeNull(); // le premier sync garantit un éclat
    const again = await c.post('/api/relay/sync', { nodeId: relay.id });
    expect(again.body.error?.code).toBe('COOLDOWN');
  });

  it('trades with a merchant: quote → trade, "why this price", PRICE_MOVED', async () => {
    const market = world.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open').sort((a, b) => haversineM(LOUVRE, a) - haversineM(LOUVRE, b))[0]!;
    await walkTo(c, market);
    const view = await c.get<MerchantView>(`/api/merchant/${market.merchant!.id}`);
    expect(view.body.prices).toHaveLength(5);
    const gem = view.body.prices.find((p) => p.family === 'gemini')!;
    expect(gem.buy, JSON.stringify(view.body)).toBeLessThan(gem.sell!);
    const before = (await c.get<Me>('/api/me')).body.shards.gemini;
    const q = await c.post<QuoteResponse>(`/api/merchant/${market.merchant!.id}/quote`, { side: 'sell', family: 'gemini', qty: 1 });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const t = await c.post<{ me: Me; total: number }>(`/api/merchant/${market.merchant!.id}/trade`, { quoteId: q.body.quoteId });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    expect(t.body.me.tutorial.traded).toBe(true);
    expect(t.body.me.shards.gemini).toBe(before - 1);
    // quote rejoué → expiré
    expect((await c.post(`/api/merchant/${market.merchant!.id}/trade`, { quoteId: q.body.quoteId })).body.error?.code).toBe('EXPIRED');
    // PRICE_MOVED : un autre joueur achète entre le devis et la validation
    const q2 = await c.post<QuoteResponse>(`/api/merchant/${market.merchant!.id}/quote`, { side: 'buy', family: 'gpt', qty: 1 });
    expect(q2.status, JSON.stringify(q2.body)).toBe(200);
    const other = client();
    await other.post('/auth/guest', { demo: true, token: 'judge-pass' });
    await walkTo(other, market);
    const oq = await other.post<QuoteResponse>(`/api/merchant/${market.merchant!.id}/quote`, { side: 'buy', family: 'gpt', qty: 2 });
    expect((await other.post(`/api/merchant/${market.merchant!.id}/trade`, { quoteId: oq.body.quoteId })).status).toBe(200);
    const moved = await c.post(`/api/merchant/${market.merchant!.id}/trade`, { quoteId: q2.body.quoteId });
    expect(moved.status).toBe(409);
    expect(moved.body.error?.code).toBe('PRICE_MOVED');
    // acheter 1 Qwen pour la First Compile (2 DeepSeek + 1 Qwen)
    const q3 = await c.post<QuoteResponse>(`/api/merchant/${market.merchant!.id}/quote`, { side: 'buy', family: 'qwen', qty: 1 });
    expect((await c.post(`/api/merchant/${market.merchant!.id}/trade`, { quoteId: q3.body.quoteId })).status).toBe(200);
  });

  it('First Compile at the Louvre forge → simulated real credits, key, playground', async () => {
    const forge = world.nodes.find((n) => n.id === 'forge:louvre')!;
    await walkTo(c, forge);
    const fv = await c.get<ForgeView>(`/api/forge/${forge.id}`);
    const first = fv.body.recipes.find((r) => r.tier === 'first')!;
    expect(first.locked).toBeNull();
    expect(first.payoutNusd).toBe(30_000_000);
    const r = await c.post<{ payoutNusd: number; simulated: boolean; me: Me; equiv: { chats: number } }>(`/api/forge/${forge.id}/compile`, { tier: 'first' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.payoutNusd).toBe(30_000_000);
    expect(r.body.simulated).toBe(true);
    expect(r.body.me.credits.limitNusd).toBe(30_000_000);
    expect(r.body.equiv.chats).toBeGreaterThan(10);
    const again = await c.post(`/api/forge/${forge.id}/compile`, { tier: 'first' });
    expect(again.status).toBe(400);
    const key = await c.post<{ key: string }>('/api/credits/reveal');
    expect(key.body.key).toMatch(/^sk-sim-/);
    const pg = await c.post('/api/credits/playground', { model: 'deepseek/deepseek-v4.1-flash', prompt: 'Hello Paris' });
    expect(pg.status).toBe(200);
    expect(pg.raw.body).toContain('Simulated');
  });

  it('guests beyond First Compile get XP only (outside judge window)', async () => {
    const forge = world.nodes.find((n) => n.id === 'forge:louvre')!;
    const fv = await c.get<ForgeView>(`/api/forge/${forge.id}`);
    const spark = fv.body.recipes.find((r) => r.tier === 'spark')!;
    expect(spark.payoutNusd).toBe(0);
    expect(spark.payoutNote).toMatch(/Google/);
  });
});

describe('anti-cheat & demo pass', () => {
  it('gps teleport → SUSPICIOUS_MOVE on actions', async () => {
    const c = client();
    await c.post('/auth/guest', { demo: false });
    await walkTo(c, LOUVRE);
    clock += 2000;
    await c.post('/api/move', { lat: 48.88, lng: 2.4, acc: 5 });
    const w = (await c.get<WorldResponse>('/api/world?lat=48.88&lng=2.4')).body;
    const relay = w.nodes.find((n) => n.kind === 'relay')!;
    const r = await c.post('/api/relay/sync', { nodeId: relay.id });
    expect(['SUSPICIOUS_MOVE', 'TOO_FAR']).toContain(r.body.error?.code);
  });

  it('demo-token accounts cannot sell to merchants', async () => {
    const c = client();
    const me = await c.post<Me>('/auth/guest', { demo: true, token: 'judge-pass' });
    expect(me.body.level).toBe(7);
    await walkTo(c, LOUVRE);
    const w = (await c.get<WorldResponse>(`/api/world?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`)).body;
    const market = w.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open').sort((a, b) => haversineM(LOUVRE, a) - haversineM(LOUVRE, b))[0]!;
    await walkTo(c, market);
    const q = await c.post(`/api/merchant/${market.merchant!.id}/quote`, { side: 'sell', family: 'gpt', qty: 1 });
    expect(q.body.error?.code, JSON.stringify(q.body)).toBe('DEMO_CANNOT_SELL');
  });
});

describe('merchant jobs', () => {
  it('hourly tick runs, struggling merchant near the Louvre exists, rescue reopens it', async () => {
    runHourly(ctx, clock);
    const pulse = await client().get<{ merchants: { closing: number; closed: number } }>('/api/pulse');
    expect(pulse.body.merchants.closing + pulse.body.merchants.closed).toBeGreaterThanOrEqual(1);
    const struggler = ctx.db.prepare("SELECT value FROM kv WHERE key = 'seeded-struggler'").get() as { value: string };
    const nodeId = JSON.parse(struggler.value) as string;
    const node = ctx.world.byId.get(nodeId)!;
    const c = client();
    await c.post('/auth/guest', { demo: true, token: 'judge-pass' });
    await walkTo(c, node);
    const r = await c.post<{ merchant: MerchantView }>(`/api/merchant/${merchantIdFor(nodeId)}/rescue`, { flux: 500 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.merchant.status).toBe('open');
  });
});
