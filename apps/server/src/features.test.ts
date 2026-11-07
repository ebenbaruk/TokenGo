// Runners-agents, IOU de crédits, Lab snapshot, Google OAuth, profil, classements, quotas, /healthz.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  LIVING, haversineM, legPosition, type CompileResponse, type WalkersResponse, type CreditsView, type ForgeView, type LabSnapshot, type LeaderboardsResponse, type Me,
  type PublicConfig, type PulseResponse, type WorldResponse,
} from '@tokengo/shared';
import { createSim } from '@tokengo/shared/economy/sim.ts';
import { loadConfig } from './config.ts';
import { buildApp, type AppOptions } from './app.ts';
import { simulatedCredits, type CreditsProvider } from './game/credits.ts';
import { RUNNER, RUNNER_NAMES, agentTradesLastHour, runnerId, runnerTick, seedRunners, type RunnerState } from './game/runners.ts';
import { grantCredits, retryPendingGrants } from './game/reserve.ts';
import { compile } from './game/forge.ts';
import { getUser } from './game/players.ts';
import { normalizeEmail, type GoogleProfile } from './auth/google.ts';
import { handleProblem, weekStart } from './game/profile.ts';
import { parisDay, parisDayStart } from './game/reserve.ts';

const ORIGIN = 'http://localhost:5173';
const LOUVRE = { lat: 48.8611, lng: 2.3358 };

async function setup(overrides: Record<string, string> = {}, opts: AppOptions = {}) {
  const env = { clock: Date.parse('2026-11-08T10:00:00Z') };
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', DEMO_TOKEN: 'judge-pass', ...overrides });
  const { app, ctx } = await buildApp(cfg, { now: () => env.clock, ...opts });
  /** Client HTTP avec un vrai bocal à cookies (session + cookie OAuth). */
  let clientN = 0;
  const client = () => {
    // une IP par client : le pass démo est limité à un compte par IP et par jour
    const remoteAddress = `10.0.2.${++clientN}`;
    const jar = new Map<string, string>();
    const req = async <T>(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) => {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await app.inject({ method, url, remoteAddress, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
      const set = res.headers['set-cookie'];
      for (const c of [set].flat()) {
        if (!c) continue;
        const kv = c.split(';')[0]!;
        const i = kv.indexOf('=');
        const k = kv.slice(0, i);
        const v = kv.slice(i + 1);
        if (!v || /Expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(k); else jar.set(k, v);
      }
      let parsed: unknown = null;
      try { parsed = res.json(); } catch { /* redirection */ }
      return { status: res.statusCode, body: parsed as T & { error?: { code: string; message: string } }, raw: res };
    };
    return { jar, req, get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}) => req<T>('POST', u, b), del: <T>(u: string) => req<T>('DELETE', u) };
  };
  const walkTo = async (c: ReturnType<typeof client>, to: { lat: number; lng: number }) => {
    env.clock += 3000;
    return c.post('/api/move', { lat: to.lat, lng: to.lng, acc: 8 });
  };
  return { app, ctx, env, client, walkTo };
}

// ───────────────────────────── Runners ─────────────────────────────
describe('runner-agents', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup(); });
  afterAll(() => s.app.close());

  it('seeds 24 persistent agents (idempotent), with readable NEAR account names', () => {
    const ids = seedRunners(s.ctx, 24);
    expect(ids).toHaveLength(24);
    seedRunners(s.ctx, 24);
    const n = (s.ctx.db.prepare('SELECT COUNT(*) n FROM users WHERE is_agent = 1').get() as { n: number }).n;
    expect(n).toBe(24);
    const u = getUser(s.ctx, runnerId('Nadia'))!;
    expect(u.handle).toBe('Runner·Nadia');
    expect(u.kind).toBe('guest');
    const acc = s.ctx.db.prepare('SELECT account_id FROM near_accounts WHERE owner = ?').get(`user:${u.id}`) as { account_id: string };
    expect(acc.account_id).toBe('dev-r-nadia.tokengo.testnet');
    const profiles = s.ctx.db.prepare('SELECT profile, COUNT(*) n FROM runners GROUP BY profile').all() as { profile: string; n: number }[];
    expect(profiles.map((p) => p.profile).sort()).toEqual(['arbitrageur', 'flooder', 'forger', 'walker']);
  });

  it('shows runners near the Louvre in GET /api/walkers (named, on a real leg)', async () => {
    const c = s.client();
    await c.post('/auth/guest', { demo: true });
    await s.walkTo(c, LOUVRE);
    const w = await c.get<WalkersResponse>(`/api/walkers?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`);
    expect(w.status).toBe(200);
    const runners = w.body.walkers.filter((x) => x.kind === 'runner');
    expect(runners.length).toBeGreaterThan(0);
    expect(w.body.walkers.length).toBeLessThanOrEqual(LIVING.walkersMax);
    for (const r of runners) {
      expect(RUNNER_NAMES as readonly string[]).toContain(r.name);
      expect(haversineM(LOUVRE, legPosition(r, w.body.now))).toBeLessThanOrEqual(LIVING.walkersRadiusM);
      expect(r.note).toBeTruthy();
    }
  });

  it('walk at walking speed, catch, sync and trade through the real game (capped, tagged, never paid)', async () => {
    const start = s.env.clock;
    const before = new Map((s.ctx.db.prepare("SELECT user_id, state FROM runners").all() as { user_id: string; state: string }[]).map((r) => [r.user_id, r.state]));
    for (let i = 0; i < 6 * 60 * 3; i++) { // 3 h de jeu, boucle de 10 s
      s.env.clock += RUNNER.loopMs;
      await runnerTick(s.ctx, 24);
      expect(agentTradesLastHour(s.ctx)).toBeLessThanOrEqual(RUNNER.tradesPerHour);
    }
    const db = s.ctx.db;
    const catches = (db.prepare('SELECT COUNT(*) n FROM catches c JOIN users u ON u.id = c.user_id WHERE u.is_agent = 1').get() as { n: number }).n;
    const syncs = (db.prepare('SELECT COUNT(*) n FROM relay_syncs s JOIN users u ON u.id = s.user_id WHERE u.is_agent = 1').get() as { n: number }).n;
    const trades = (db.prepare('SELECT COUNT(*) n FROM trades t JOIN users u ON u.id = t.user_id WHERE u.is_agent = 1').get() as { n: number }).n;
    expect(catches).toBeGreaterThan(20);
    expect(syncs).toBeGreaterThan(20);
    expect(trades).toBeGreaterThan(5);
    expect(trades).toBeLessThanOrEqual(RUNNER.tradesPerHour * 3);
    // trades = vrais mouvements de valeur : outbox on-chain alimentée
    expect((db.prepare("SELECT COUNT(*) n FROM chain_ops WHERE memo LIKE 'trade:%' AND (from_acc LIKE 'user:runner_%' OR to_acc LIKE 'user:runner_%')").get() as { n: number }).n).toBeGreaterThan(0);
    // Pulse : badge agent
    const pulse = await s.client().get<PulseResponse>('/api/pulse');
    const agentEvents = pulse.body.events.filter((e) => e.data?.agent === true);
    expect(agentEvents.length).toBeGreaterThan(0);
    // jamais d'octroi, jamais de clé
    expect((db.prepare("SELECT COUNT(*) n FROM grants g JOIN users u ON u.id = g.user_id WHERE u.is_agent = 1").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM api_keys k JOIN users u ON u.id = k.user_id WHERE u.is_agent = 1").get() as { n: number }).n).toBe(0);
    // ils ont bougé, à vitesse de marche
    let moved = 0;
    for (const r of db.prepare('SELECT user_id, state FROM runners').all() as { user_id: string; state: string }[]) {
      const a = JSON.parse(before.get(r.user_id)!) as RunnerState;
      const b = JSON.parse(r.state) as RunnerState;
      if (haversineM(a.to, b.to) > 50) moved++;
      if (b.arriveAt > b.departAt) expect(haversineM(b.from, b.to) / ((b.arriveAt - b.departAt) / 1000)).toBeLessThanOrEqual(RUNNER.walkMps + 0.01);
    }
    expect(moved).toBeGreaterThan(12);
    expect(s.env.clock - start).toBe(3 * 3600_000);
  }, 60_000);

  it('agents compile for XP only, even inside the judge window, and grantCredits refuses them', async () => {
    const id = runnerId('Malik'); // forger niveau 7
    const forge = s.ctx.world.forges.find((f) => f.id === 'forge:louvre')!;
    s.env.clock = Date.parse('2026-11-17T10:00:00Z'); // fenêtre du Judge Pool
    for (const f of ['deepseek', 'qwen', 'gemini', 'gpt', 'claude']) {
      s.ctx.db.prepare('INSERT INTO inventory (user_id, token_id, amount) VALUES (?, ?, 20) ON CONFLICT(user_id, token_id) DO UPDATE SET amount = 20').run(id, `shard:${f}`);
    }
    s.ctx.db.prepare("UPDATE inventory SET amount = 1000 WHERE user_id = ? AND token_id = 'flux'").run(id);
    const fix = { lat: forge.lat, lng: forge.lng, acc: 5, at: s.env.clock };
    s.ctx.db.prepare('UPDATE users SET move_state = ? WHERE id = ?').run(JSON.stringify({ last: fix, recent: [fix], walkedM: 5000, suspiciousUntil: 0, jumps: [] }), id);
    const r = await compile(s.ctx, id, forge.id, 'spark');
    expect(r.payoutNusd).toBe(0);
    expect(r.pool).toBeNull();
    expect(r.xp).toBeGreaterThan(0);
    await expect(grantCredits(s.ctx, id, 'judge', 1000, 'x')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ───────────────────────────── IOU de crédits ─────────────────────────────
describe('pending grants (IOU) retry', () => {
  let fail = true;
  const flaky = (): CreditsProvider => {
    const inner = simulatedCredits(10_000_000_000);
    return {
      simulated: true,
      orgRemaining: () => inner.orgRemaining(),
      createKey: async (n, l) => { if (fail) throw new Error('NEAR AI down'); return inner.createKey(n, l); },
      setLimit: async (k, l) => { if (fail) throw new Error('NEAR AI down'); return inner.setLimit(k, l); },
      usage: (ids) => inner.usage(ids),
      chat: (k, m, p, t) => inner.chat(k, m, p, t),
    };
  };
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup({ ADMIN_TOKEN: 'admin-secret' }, { credits: flaky() }); });
  afterAll(() => s.app.close());

  it('a failed grant after the burn shows "Credit pending", then the job settles it idempotently', async () => {
    const c = s.client();
    const me = await c.post<Me>('/auth/guest', { demo: true, token: 'judge-pass' }); // pass démo → Judge Pool
    const forge = s.ctx.world.forges.find((f) => f.id === 'forge:louvre')!;
    await s.walkTo(c, forge);
    const fv = await c.get<ForgeView>(`/api/forge/${forge.id}`);
    const spark = fv.body.recipes.find((r) => r.tier === 'spark')!;
    expect(spark.payoutNusd).toBeGreaterThan(0);
    for (const [f, n] of Object.entries(spark.needs)) {
      s.ctx.db.prepare('UPDATE inventory SET amount = ? WHERE user_id = ? AND token_id = ?').run(n! + 5, me.body.id, `shard:${f}`);
      s.ctx.db.prepare('INSERT OR IGNORE INTO inventory (user_id, token_id, amount) VALUES (?, ?, ?)').run(me.body.id, `shard:${f}`, n! + 5);
    }
    const r = await c.post<CompileResponse>(`/api/forge/${forge.id}/compile`, { tier: 'spark' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.pending).toBe(true);
    expect(r.body.payoutNusd).toBe(0);
    expect(r.body.note).toMatch(/pending/i);
    let cv = await c.get<CreditsView>('/api/credits');
    expect(cv.body.grants[0]!.pending).toBe(true);
    expect(cv.body.pendingNusd).toBe(r.body.pendingNusd);
    // trop récent (< 30 s) → pas rejoué ; panne persistante → reste pending
    expect(await retryPendingGrants(s.ctx)).toBe(0);
    s.env.clock += 31_000;
    expect(await retryPendingGrants(s.ctx)).toBe(0);
    expect((s.ctx.db.prepare("SELECT tries FROM grants WHERE user_id = ?").get(me.body.id) as { tries: number }).tries).toBe(2);
    fail = false;
    expect(await retryPendingGrants(s.ctx)).toBe(1);
    cv = await c.get<CreditsView>('/api/credits');
    expect(cv.body.grants[0]!.pending).toBe(false);
    expect(cv.body.pendingNusd).toBe(0);
    expect(cv.body.limitNusd).toBe(r.body.pendingNusd);
    expect((s.ctx.db.prepare('SELECT status FROM compiles WHERE id = ?').get(r.body.compileId) as { status: string }).status).toBe('granted');
    // 2e octroi en panne sur une clé existante → la cible = limite + montant
    fail = true;
    await expect(grantCredits(s.ctx, me.body.id, 'judge', 1_000_000, r.body.compileId)).rejects.toMatchObject({ code: 'GRANT_PENDING' });
    fail = false;
    s.env.clock += 31_000;
    expect(await retryPendingGrants(s.ctx)).toBe(1);
    expect(await retryPendingGrants(s.ctx)).toBe(0); // rien à rejouer
    const g = s.ctx.db.prepare("SELECT target_nusd FROM grants WHERE amount_nusd = 1000000").get() as { target_nusd: number };
    expect(g.target_nusd).toBe(r.body.pendingNusd! + 1_000_000);
    expect((await c.get<CreditsView>('/api/credits')).body.limitNusd).toBe(g.target_nusd);
  });

  it('/healthz reports the solvency invariant (booleans publicly, numbers to the admin only)', async () => {
    const pub = await s.client().get<Record<string, unknown>>('/healthz');
    expect(pub.body).toEqual({ ok: true, invariantOk: true, chain: false, simulatedCredits: true });
    const h = await s.app.inject({ method: 'GET', url: '/healthz', headers: { authorization: 'Bearer admin-secret' } });
    const body = h.json() as { invariantOk: boolean; invariant: { commitmentsNusd: number; orgRemainingNusd: number } };
    expect(body.invariantOk).toBe(true);
    expect(body.invariant.commitmentsNusd).toBeLessThanOrEqual(body.invariant.orgRemainingNusd);
    const wrong = await s.app.inject({ method: 'GET', url: '/healthz', headers: { authorization: 'Bearer nope' } });
    expect(Object.keys(wrong.json() as object).sort()).toEqual(['chain', 'invariantOk', 'ok', 'simulatedCredits']);
  });
});

// ───────────────────────────── Lab, config, Google ─────────────────────────────
describe('lab snapshot & public config', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup(); });
  afterAll(() => s.app.close());

  it('GET /api/lab/snapshot is public and feeds createSim directly', async () => {
    const r = await s.client().get<LabSnapshot>('/api/lab/snapshot');
    expect(r.status).toBe(200);
    const markets = s.ctx.world.nodes.filter((n) => n.kind === 'market');
    expect(r.body.initialMerchants).toHaveLength(markets.length);
    expect(r.body.merchants.closing + r.body.merchants.closed).toBeGreaterThanOrEqual(1); // le marchand en difficulté de la démo
    expect(r.body.initialP0.deepseek).toBeGreaterThan(0);
    expect(r.body.initialPools.main.allocated).toBeGreaterThan(0);
    const sim = createSim({ world: { nodes: s.ctx.world.nodes, cells: s.ctx.world.cells }, days: 1, players: 20, seed: 3, initialMerchants: r.body.initialMerchants });
    sim.run(12);
    expect(sim.snapshot().merchants).toHaveLength(markets.length);
  });

  it('GET /api/config without Google', async () => {
    const r = await s.client().get<PublicConfig>('/api/config');
    expect(r.body).toEqual({ googleEnabled: false, simulatedCredits: true, chain: false, judgeOpen: false });
    const g = await s.client().get('/auth/google');
    expect(g.status).toBe(302);
    expect(g.raw.headers.location).toContain('reason=disabled');
  });
});

describe('Google sign-in (mocked token exchange)', () => {
  const profiles: Record<string, GoogleProfile> = {
    'code-ana': { sub: 'g-ana', email: 'Ana.Lovelace+tokengo@gmail.com', emailVerified: true },
    'code-ana-twin': { sub: 'g-twin', email: 'analovelace@googlemail.com', emailVerified: true },
    'code-unverified': { sub: 'g-x', email: 'x@example.com', emailVerified: false },
    'code-bob': { sub: 'g-bob', email: 'bob@example.com', emailVerified: true },
    'code-cleo': { sub: 'g-cleo', email: 'cleo@example.com', emailVerified: true },
    'code-dan': { sub: 'g-dan', email: 'dan@example.com', emailVerified: true },
    'code-dan-newsub': { sub: 'g-dan-2', email: 'Dan@Example.com', emailVerified: true },
  };
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    s = await setup({ GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret', PUBLIC_URL: 'http://localhost:5173' }, {
      googleExchange: async (code, verifier) => {
        expect(verifier.length).toBeGreaterThan(30);
        const p = profiles[code];
        if (!p) throw new Error('bad code');
        return p;
      },
    });
  });
  afterAll(() => s.app.close());

  const signIn = async (c: ReturnType<typeof s.client>, code: string, tamperState = false) => {
    const start = await c.get('/auth/google');
    expect(start.status).toBe(302);
    const url = new URL(String(start.raw.headers.location));
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/auth/google/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(c.jar.has('tg_oauth')).toBe(true);
    const state = tamperState ? 'nope' : url.searchParams.get('state')!;
    const cb = await c.get(`/auth/google/callback?code=${code}&state=${state}`);
    expect(cb.status).toBe(302);
    return new URL(String(cb.raw.headers.location));
  };

  it('normalizes gmail addresses', () => {
    expect(normalizeEmail('Ana.Lovelace+tokengo@GMail.com')).toBe('analovelace@gmail.com');
    expect(normalizeEmail('ana.l@googlemail.com')).toBe('anal@gmail.com');
    expect(normalizeEmail('A.B+c@Example.com')).toBe('a.b+c@example.com');
  });

  it('upgrades the current guest into the Google account (progress kept)', async () => {
    expect((await s.client().get<PublicConfig>('/api/config')).body.googleEnabled).toBe(true);
    const c = s.client();
    const guest = await c.post<Me>('/auth/guest', { demo: false });
    const back = await signIn(c, 'code-ana');
    expect(back.searchParams.get('auth')).toBe('google');
    expect(back.searchParams.get('outcome')).toBe('upgraded');
    const me = await c.get<Me>('/api/me');
    expect(me.body.id).toBe(guest.body.id);
    expect(me.body.kind).toBe('google');
    expect(me.body.flux).toBe(guest.body.flux);
    // nouvelle session (rotation), l'ancienne est supprimée
    expect((s.ctx.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(guest.body.id) as { n: number }).n).toBe(1);
  });

  it('logs back in by sub from another browser; blocks gmail twins, unverified emails and bad state', async () => {
    const c2 = s.client();
    const back = await signIn(c2, 'code-ana');
    expect(back.searchParams.get('outcome')).toBe('login');
    expect((await c2.get<Me>('/api/me')).body.kind).toBe('google');
    expect((await signIn(s.client(), 'code-ana-twin')).searchParams.get('reason')).toBe('email_taken');
    expect((await signIn(s.client(), 'code-unverified')).searchParams.get('reason')).toBe('unverified');
    expect((await signIn(s.client(), 'code-bob', true)).searchParams.get('reason')).toBe('state');
    expect((await signIn(s.client(), 'bad-code')).searchParams.get('reason')).toBe('exchange');
  });

  it('a demo-pass guest is not merged: a fresh Google account is created', async () => {
    const c = s.client();
    const judge = await c.post<Me>('/auth/guest', { demo: true, token: 'judge-pass' });
    const back = await signIn(c, 'code-bob');
    expect(back.searchParams.get('outcome')).toBe('created');
    const me = await c.get<Me>('/api/me');
    expect(me.body.id).not.toBe(judge.body.id);
    expect(me.body.kind).toBe('google');
    expect(me.body.mode).toBe('gps');
  });

  it('a demo-mode guest (no pass) is not promoted either: fresh Google account, demo kit not carried over', async () => {
    const c = s.client();
    const demo = await c.post<Me>('/auth/guest', { demo: true });
    expect(demo.body.mode).toBe('demo');
    const back = await signIn(c, 'code-cleo');
    expect(back.searchParams.get('outcome')).toBe('created');
    const me = (await c.get<Me>('/api/me')).body;
    expect(me.id).not.toBe(demo.body.id);
    expect(me.mode).toBe('gps');
    expect(me.level).toBeLessThan(demo.body.level);
    expect(getUser(s.ctx, demo.body.id)!.kind).toBe('guest');
  });

  it('a deleted Google identity (same sub, or same email) keeps its flag and gets no second welcome grant', async () => {
    const c = s.client();
    await signIn(c, 'code-dan');
    const first = (await c.get<Me>('/api/me')).body;
    s.ctx.db.prepare("INSERT INTO grants (id, at, user_id, pool, amount_nusd, compile_id, status) VALUES ('g-welcome-dan', ?, ?, 'welcome', 30000000, 'c-dan', 'done')").run(s.env.clock, first.id);
    s.ctx.db.prepare('UPDATE users SET flags = ? WHERE id = ?').run(JSON.stringify({ flagged: 1234 }), first.id);
    expect((await c.del('/api/me')).status).toBe(200);
    const tombs = s.ctx.db.prepare('SELECT * FROM account_tombstones').all();
    expect(tombs).toHaveLength(2); // sub + email, hachés
    expect(JSON.stringify(tombs)).not.toMatch(/dan|g-dan/);

    const check = async (code: string) => {
      const c2 = s.client();
      expect((await signIn(c2, code)).searchParams.get('outcome')).toBe('created');
      const me = (await c2.get<Me>('/api/me')).body;
      expect(JSON.parse(getUser(s.ctx, me.id)!.flags)).toMatchObject({ flagged: 1234, noWelcome: true });
      const fv = (await c2.get<ForgeView>('/api/forge/forge:louvre')).body;
      const firstRecipe = fv.recipes.find((r) => r.tier === 'first')!;
      expect(firstRecipe.payoutNusd).toBe(0);
      expect(firstRecipe.payoutNote).toMatch(/already claimed/);
      return c2;
    };
    const again = await check('code-dan'); // même sub
    expect((await again.del('/api/me')).status).toBe(200);
    await check('code-dan-newsub'); // autre sub, même email normalisé
  });
});

// ───────────────────────────── Profil, classements, quotas ─────────────────────────────
describe('profile, leaderboards, daily quotas', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup(); });
  afterAll(() => s.app.close());

  it('handle rules', async () => {
    expect(handleProblem('ab')).not.toBeNull();
    expect(handleProblem('Hello World')).not.toBeNull();
    expect(handleProblem('Sh1tLord')).not.toBeNull();
    expect(handleProblem('RunnerNadia')).not.toBeNull();
    expect(handleProblem('PixelPigeon42')).toBeNull();
    const a = s.client();
    const b = s.client();
    await a.post('/auth/guest', {});
    await b.post('/auth/guest', {});
    const ok = await a.post<Me>('/api/me/handle', { handle: 'PixelPigeon42' });
    expect(ok.status).toBe(200);
    expect(ok.body.handle).toBe('PixelPigeon42');
    const taken = await b.post('/api/me/handle', { handle: 'pixelpigeon42' });
    expect(taken.status).toBe(409);
    expect(taken.body.error?.code).toBe('HANDLE_TAKEN');
    expect((await b.post('/api/me/handle', { handle: 'x y' })).body.error?.code).toBe('BAD_HANDLE');
  });

  it('district', async () => {
    const c = s.client();
    await c.post('/auth/guest', {});
    expect((await c.post('/api/me/district', { district: 21 })).status).toBe(400);
    const r = await c.post<Me>('/api/me/district', { district: 5 });
    expect(r.body.district).toBe(5);
  });

  it('daily quotas return RATE_LIMITED', async () => {
    const c = s.client();
    const me = await c.post<Me>('/auth/guest', { demo: true, token: 'judge-pass' });
    await s.walkTo(c, LOUVRE);
    const w = (await c.get<WorldResponse>(`/api/world?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`)).body;
    const day0 = parisDayStart(s.env.clock);
    const ins = s.ctx.db.prepare('INSERT INTO catches (user_id, spawn_id, at, family, quality) VALUES (?, ?, ?, ?, ?)');
    s.ctx.db.transaction(() => { for (let i = 0; i < 400; i++) ins.run(me.body.id, `fake:${i}`, day0 + 1000 + i, 'deepseek', 'good'); })();
    const spawn = w.spawns[0]!;
    await s.walkTo(c, spawn);
    const r = await c.post('/api/catch/start', { spawnId: spawn.id });
    expect(r.status).toBe(429);
    expect(r.body.error?.code).toBe('RATE_LIMITED');
    s.ctx.db.prepare("INSERT INTO daily_counts (user_id, day, kind, n) VALUES (?, ?, 'sync', 200)").run(me.body.id, parisDay(s.env.clock));
    const relay = w.nodes.filter((n) => n.kind === 'relay').sort((a, b) => haversineM(LOUVRE, a) - haversineM(LOUVRE, b))[0]!;
    await s.walkTo(c, relay);
    expect((await c.post('/api/relay/sync', { nodeId: relay.id })).body.error?.code).toBe('RATE_LIMITED');
    const cins = s.ctx.db.prepare("INSERT INTO compiles (id, at, user_id, forge_id, tier, inputs, fee, pool, payout_nusd, status) VALUES (?, ?, ?, 'forge:louvre', 'spark', '{}', 0, NULL, 0, 'xp-only')");
    for (let i = 0; i < 60; i++) cins.run(`fake${i}`, day0 + 1000 + i, me.body.id);
    await s.walkTo(c, s.ctx.world.byId.get('forge:louvre')!);
    expect((await c.post('/api/forge/forge:louvre/compile', { tier: 'spark' })).body.error?.code).toBe('RATE_LIMITED');
  });

  it('leaderboards: weekly runners XP, traders, patrons, districts; agents marked', async () => {
    seedRunners(s.ctx, 24);
    for (let i = 0; i < 6 * 30; i++) { s.env.clock += RUNNER.loopMs; await runnerTick(s.ctx, 24); }
    const c = s.client();
    const me = await c.post<Me>('/auth/guest', { demo: true });
    await c.post('/api/me/district', { district: 1 });
    await s.walkTo(c, LOUVRE);
    const w = (await c.get<WorldResponse>(`/api/world?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`)).body;
    const tut = w.spawns.find((x) => x.id.startsWith('tut:'))!;
    await s.walkTo(c, tut);
    const st = await c.post<{ attemptId: string }>('/api/catch/start', { spawnId: tut.id });
    s.env.clock += 1500;
    await c.post('/api/catch/resolve', { attemptId: st.body.attemptId, offsets: [0] });
    const lb = await c.get<LeaderboardsResponse>('/api/leaderboards');
    expect(lb.status).toBe(200);
    expect(lb.body.weekStart).toBe(weekStart(s.env.clock));
    expect(lb.body.runners.some((e) => e.agent)).toBe(true);
    expect(lb.body.runners.every((e) => e.me === (e.id === me.body.id))).toBe(true);
    expect(lb.body.districts.find((d) => d.district === 1)?.points).toBeGreaterThan(0);
    expect(lb.body.districts.reduce((sum, d) => sum + d.agentPoints, 0)).toBeGreaterThan(0);
    expect(Array.isArray(lb.body.traders) && Array.isArray(lb.body.patrons)).toBe(true);
  });

  it('DELETE /api/me anonymizes, revokes the key and ends sessions', async () => {
    const c = s.client();
    const me = await c.post<Me>('/auth/guest', {});
    s.ctx.db.prepare("INSERT INTO api_keys (user_id, nearai_key_id, key_enc, key_prefix, limit_nusd, simulated) VALUES (?, 'sim_x', 'x', 'sk-sim', 10, 1)").run(me.body.id);
    const r = await c.del<{ ok: boolean }>('/api/me');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await c.get('/api/me')).status).toBe(401);
    const u = getUser(s.ctx, me.body.id)!;
    expect(u.deleted_at).not.toBeNull();
    expect(u.handle).toMatch(/^deleted/);
    expect(s.ctx.db.prepare('SELECT 1 FROM api_keys WHERE user_id = ?').get(me.body.id)).toBeUndefined();
    expect((s.ctx.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(me.body.id) as { n: number }).n).toBe(0);
  });
});
