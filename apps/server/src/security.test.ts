// Régressions de la revue de sécurité du 2026-11-06 : courses sur la Forge et les clés, XFF, Judge Pool, pass démo, SSE.
import { request, type ClientRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESERVE, type CompileResponse, type ForgeView, type Me, type PublicConfig } from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp, SSE_LIMITS, type AppOptions } from './app.ts';
import { simulatedCredits, type CreditsProvider } from './game/credits.ts';
import { grantCredits, retryPendingGrants } from './game/reserve.ts';
import { netKey } from './game/crypto.ts';

const ORIGIN = 'http://localhost:5173';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fournisseur simulé avec latence (fait apparaître les courses) qui enregistre les appels. */
function slowCredits(latencyMs = 30) {
  const inner = simulatedCredits(11_500_000_000);
  const log = { created: 0, limits: new Map<string, number>(), fail: false };
  const credits: CreditsProvider = {
    simulated: true,
    orgRemaining: async () => { await sleep(latencyMs); return inner.orgRemaining(); },
    createKey: async (n, l) => {
      await sleep(latencyMs);
      if (log.fail) throw new Error('NEAR AI down');
      log.created++;
      const k = await inner.createKey(n, l);
      log.limits.set(k.keyId, l);
      return k;
    },
    setLimit: async (k, l) => { await sleep(latencyMs); if (log.fail) throw new Error('NEAR AI down'); log.limits.set(k, l); },
    usage: (ids) => inner.usage(ids),
    revoke: async () => {},
    chat: (k, m, p, t) => inner.chat(k, m, p, t),
  };
  return { credits, log };
}

async function setup(overrides: Record<string, string> = {}, opts: AppOptions = {}) {
  const env = { clock: Date.parse('2026-11-08T10:00:00Z') };
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', DEMO_TOKEN: 'judge-pass', ...overrides });
  const { app, ctx } = await buildApp(cfg, { now: () => env.clock, ...opts });
  let ipN = 0;
  const client = (ip = `10.9.0.${++ipN}`) => {
    let cookie = '';
    const req = async <T>(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await app.inject({ method, url, remoteAddress: ip, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers } });
      const set = res.headers['set-cookie'];
      if (set) cookie = String([set].flat()[0]).split(';')[0]!;
      return { status: res.statusCode, body: res.json() as T & { error?: { code: string; message: string } } };
    };
    return {
      req, get cookie() { return cookie; },
      get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}, h: Record<string, string> = {}) => req<T>('POST', u, b, h),
      del: <T>(u: string) => req<T>('DELETE', u),
    };
  };
  const walkTo = async (c: ReturnType<typeof client>, to: { lat: number; lng: number }) => {
    env.clock += 3000;
    return c.post('/api/move', { lat: to.lat, lng: to.lng, acc: 8 });
  };
  const forge = ctx.world.forges.find((f) => f.id === 'forge:louvre')!;
  return { app, ctx, env, client, walkTo, forge };
}

describe('Forge & grants under concurrency (provider with latency)', () => {
  const slow = slowCredits();
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup({}, { credits: slow.credits }); });
  afterAll(() => s.app.close());

  const sumGrants = (userId: string, where = "status != 'failed'") =>
    (s.ctx.db.prepare(`SELECT COALESCE(SUM(amount_nusd), 0) s FROM grants WHERE user_id = ? AND ${where}`).get(userId) as { s: number }).s;
  const keyLimit = (userId: string) => (s.ctx.db.prepare('SELECT limit_nusd FROM api_keys WHERE user_id = ?').get(userId) as { limit_nusd: number }).limit_nusd;

  it('3 concurrent First Compiles → one welcome grant, one key', async () => {
    const c = s.client();
    const me = (await c.post<Me>('/auth/guest', { demo: true, token: 'judge-pass' })).body;
    s.ctx.db.prepare('UPDATE users SET tutorial = ? WHERE id = ?').run(JSON.stringify({ caught: true, synced: true, traded: true }), me.id);
    await s.walkTo(c, s.forge);
    const created = slow.log.created;
    const rs = await Promise.all([1, 2, 3].map(() => c.post<CompileResponse>(`/api/forge/${s.forge.id}/compile`, { tier: 'first' })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 400).map((r) => r.body.error?.message)).toEqual(['First Compile already done.', 'First Compile already done.']);
    expect(s.ctx.db.prepare("SELECT COUNT(*) n FROM grants WHERE user_id = ? AND pool = 'welcome'").get(me.id)).toEqual({ n: 1 });
    expect(slow.log.created - created).toBe(1);
    expect(keyLimit(me.id)).toBe(sumGrants(me.id, "status = 'done'"));
  });

  it('5 concurrent Sparks near the Judge cap never exceed it; key limit = Σ done grants', async () => {
    const c = s.client();
    const me = (await c.post<Me>('/auth/guest', { demo: true, token: 'judge-pass' })).body;
    // déjà presque au plafond Judge (la clé existe avec cette limite)
    const room = 7_000_000;
    await grantCredits(s.ctx, me.id, 'judge', RESERVE.judgeCapPerAccount - room, 'seed');
    s.ctx.db.prepare("UPDATE grants SET at = at - 3 * 86400000 WHERE compile_id = 'seed'").run(); // hors du cap joueur/jour
    for (const f of ['deepseek', 'qwen', 'gemini', 'gpt', 'claude']) {
      s.ctx.db.prepare('INSERT OR REPLACE INTO inventory (user_id, token_id, amount) VALUES (?, ?, 100)').run(me.id, `shard:${f}`);
    }
    s.ctx.db.prepare("UPDATE inventory SET amount = 5000 WHERE user_id = ? AND token_id = 'flux'").run(me.id);
    await s.walkTo(c, s.forge);
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => c.post<CompileResponse>(`/api/forge/${s.forge.id}/compile`, { tier: 'spark' })));
    expect(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.body.error))).toBe(true);
    expect(rs.filter((r) => r.body.payoutNusd > 0).length).toBeGreaterThanOrEqual(1);
    expect(sumGrants(me.id)).toBeLessThanOrEqual(RESERVE.judgeCapPerAccount);
    expect(keyLimit(me.id)).toBe(sumGrants(me.id, "status = 'done'"));
  });

  it('concurrent grantCredits on a fresh player: one createKey, limit = sum (no lost update)', async () => {
    const c = s.client();
    const me = (await c.post<Me>('/auth/guest', { demo: true })).body;
    const created = slow.log.created;
    await Promise.all([1, 2, 3].map((i) => grantCredits(s.ctx, me.id, 'judge', i * 1_000_000, `x${i}`)));
    expect(slow.log.created - created).toBe(1);
    const k = s.ctx.db.prepare('SELECT nearai_key_id, limit_nusd FROM api_keys WHERE user_id = ?').get(me.id) as { nearai_key_id: string; limit_nusd: number };
    expect(k.limit_nusd).toBe(6_000_000);
    expect(slow.log.limits.get(k.nearai_key_id)).toBe(6_000_000);
  });

  it('pending grants of a deleted account are never replayed', async () => {
    const c = s.client();
    const me = (await c.post<Me>('/auth/guest', { demo: true })).body;
    slow.log.fail = true;
    await expect(grantCredits(s.ctx, me.id, 'judge', 1_000_000, 'gone')).rejects.toMatchObject({ code: 'GRANT_PENDING' });
    slow.log.fail = false;
    expect((await c.del('/api/me')).status).toBe(200);
    s.env.clock += 60_000;
    expect(await retryPendingGrants(s.ctx)).toBe(0);
    expect(s.ctx.db.prepare('SELECT 1 FROM api_keys WHERE user_id = ?').get(me.id)).toBeUndefined();
    expect(s.ctx.db.prepare('SELECT status FROM grants WHERE user_id = ?').get(me.id)).toEqual({ status: 'pending' });
  });
});

describe('Judge Pool & demo pass', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup(); });
  afterAll(() => s.app.close());

  it('inside the judge window, a plain guest compiles for XP only; judgeOpen still exposed', async () => {
    s.env.clock = Date.parse('2026-11-16T10:00:00Z');
    expect((await s.client().get<PublicConfig>('/api/config')).body.judgeOpen).toBe(true);
    const c = s.client();
    const me = (await c.post<Me>('/auth/guest', { demo: true })).body;
    expect(me.level).toBeGreaterThanOrEqual(3);
    for (const f of ['deepseek', 'qwen', 'gemini', 'gpt', 'claude']) {
      s.ctx.db.prepare('INSERT OR REPLACE INTO inventory (user_id, token_id, amount) VALUES (?, ?, 100)').run(me.id, `shard:${f}`);
    }
    s.ctx.db.prepare("UPDATE inventory SET amount = 5000 WHERE user_id = ? AND token_id = 'flux'").run(me.id);
    await s.walkTo(c, s.forge);
    const spark = (await c.get<ForgeView>(`/api/forge/${s.forge.id}`)).body.recipes.find((r) => r.tier === 'spark')!;
    expect(spark.payoutNusd).toBe(0);
    const r = await c.post<CompileResponse>(`/api/forge/${s.forge.id}/compile`, { tier: 'spark' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.payoutNusd).toBe(0);
    expect(r.body.pool).toBeNull();
    expect(s.ctx.db.prepare('SELECT COUNT(*) n FROM grants WHERE user_id = ?').get(me.id)).toEqual({ n: 0 });
  });

  it('wrong token → ordinary demo guest; one demo-pass account per IP per day', async () => {
    const wrong = await s.client('10.8.0.1').post<Me>('/auth/guest', { demo: true, token: 'judge-pas' });
    expect(wrong.status).toBe(200);
    expect(wrong.body.level).toBe(3); // pas le kit juge (niveau 7)
    const ok = await s.client('10.8.0.2').post<Me>('/auth/guest', { token: 'judge-pass' });
    expect(ok.body.level).toBe(7);
    const again = await s.client('10.8.0.2').post<Me>('/auth/guest', { token: 'judge-pass' });
    expect(again.status).toBe(429);
    expect(again.body.error?.code).toBe('RATE_LIMITED');
    expect(again.body.error?.message).toMatch(/demo pass/);
    expect((await s.client('10.8.0.2').post<Me>('/auth/guest', { demo: true })).status).toBe(200); // invité ordinaire : OK
    s.env.clock += 24 * 3600_000;
    expect((await s.client('10.8.0.2').post<Me>('/auth/guest', { token: 'judge-pass' })).status).toBe(200);
  });
});

describe('X-Forwarded-For is only trusted behind TRUST_PROXY hops', () => {
  it('defaults: 1 hop in production, none otherwise', () => {
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 's', SPAWN_SECRET: 's' }).trustProxy).toBe(1);
    expect(loadConfig({ NODE_ENV: 'development' }).trustProxy).toBe(false);
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 's', SPAWN_SECRET: 's', TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: '2' }).trustProxy).toBe(2);
  });

  it('without a trusted proxy, a rotating X-Forwarded-For does not reset per-IP limits', async () => {
    const s = await setup();
    const a = await s.client('10.7.0.1').post('/auth/guest', { token: 'judge-pass' }, { 'x-forwarded-for': '1.1.1.1' });
    const b = await s.client('10.7.0.1').post('/auth/guest', { token: 'judge-pass' }, { 'x-forwarded-for': '2.2.2.2' });
    expect([a.status, b.status]).toEqual([200, 429]);
    await s.app.close();
  });

  it('with TRUST_PROXY=1, the client IP comes from the proxy-appended XFF entry', async () => {
    const s = await setup({ TRUST_PROXY: '1' });
    const a = await s.client('10.7.0.1').post('/auth/guest', { token: 'judge-pass' }, { 'x-forwarded-for': '1.1.1.1' });
    const b = await s.client('10.7.0.1').post('/auth/guest', { token: 'judge-pass' }, { 'x-forwarded-for': '2.2.2.2' });
    // un client qui forge un XFF en tête : le proxy ajoute la vraie IP à la fin, c'est elle qui compte
    const c = await s.client('10.7.0.1').post('/auth/guest', { token: 'judge-pass' }, { 'x-forwarded-for': '9.9.9.9, 2.2.2.2' });
    expect([a.status, b.status, c.status]).toEqual([200, 200, 429]);
    await s.app.close();
  });
});

describe('per-IP caps key IPv6 by /64 (revue 2026-11-07)', () => {
  it('netKey: IPv4 as is (and IPv4-mapped), IPv6 reduced to its /64', () => {
    expect(netKey('10.0.0.1')).toBe('10.0.0.1');
    expect(netKey('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(netKey('2001:db8:77:1::5')).toBe('2001:db8:77:1::/64');
    expect(netKey('2001:0db8:0077:0001:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:77:1::/64');
    expect(netKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(netKey('2001:db8:77:2::5')).not.toBe(netKey('2001:db8:77:1::5'));
  });

  it('a demo pass cannot be replayed by rotating addresses inside one IPv6 /64', async () => {
    const s = await setup();
    const a = await s.client('2001:db8:5:5::1').post('/auth/guest', { token: 'judge-pass' });
    const b = await s.client('2001:db8:5:5::2').post('/auth/guest', { token: 'judge-pass' });
    expect([a.status, b.status]).toEqual([200, 429]);
    await s.app.close();
  });
});

describe('SSE connection caps', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  let base = '';
  const open: ClientRequest[] = [];
  beforeAll(async () => {
    s = await setup();
    await s.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(s.app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { for (const r of open) r.destroy(); await s.app.close(); });

  const connect = (path: string, cookie = '') => new Promise<{ status: number; req: ClientRequest; res: IncomingMessage }>((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: cookie ? { cookie } : {} }, (res) => resolve({ status: res.statusCode!, req, res }));
    req.on('error', reject);
    req.end();
    open.push(req);
  });

  it(`max ${SSE_LIMITS.perUser} /api/stream per player; a slot frees up on close`, async () => {
    const c = s.client();
    await c.post('/auth/guest', { demo: true });
    const streams = [];
    for (let i = 0; i < SSE_LIMITS.perUser; i++) streams.push(await connect('/api/stream', c.cookie));
    expect(streams.map((x) => x.status)).toEqual(Array(SSE_LIMITS.perUser).fill(200));
    expect((await connect('/api/stream', c.cookie)).status).toBe(429);
    streams[0]!.req.destroy();
    await sleep(50);
    expect((await connect('/api/stream', c.cookie)).status).toBe(200);
  });

  it(`max ${SSE_LIMITS.perIp} /api/pulse/stream per IP`, async () => {
    const st = [];
    for (let i = 0; i < SSE_LIMITS.perIp; i++) st.push((await connect('/api/pulse/stream')).status);
    expect(st.every((x) => x === 200)).toBe(true);
    expect((await connect('/api/pulse/stream')).status).toBe(429);
  });
});
