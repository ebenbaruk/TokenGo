// Intégration NEAR AI Cloud sans réseau : fetch factice, formes exactes des requêtes, refresh sérialisé, budget du cerveau.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKey, verifyNep413Signature } from 'near-kit';
import { AGENT_BOUNDS, FAMILIES } from '@tokengo/shared';
import { loadConfig } from '../config.ts';
import { buildApp } from '../app.ts';
import { kvGet, kvSet, openDb } from '../db.ts';
import type { Ctx } from '../game/context.ts';
import { makeCipher } from '../game/crypto.ts';
import { allMerchants, getMerchant, reflect } from '../game/merchants.ts';
import { base58Decode, base58Encode, makeNonce, nearAuthBody, nep413Hash } from './nep413.ts';
import { createSession, KV_REFRESH } from './session.ts';
import { nearAiCredits, KEY_EXPIRES_AT } from './provider.ts';
import { createNpcBrain, extractJson, merchantActive, NPC_DAILY_CAP, sanitizeLine, takeNpcCall } from './brain.ts';
import { USER_AGENT } from './http.ts';

const BASE = 'https://nearai.test';
const KP = generateKey();
const SECRET = KP.secretKey;

interface Call { method: string; url: string; path: string; headers: Record<string, string>; body: unknown }
type Handler = (c: Call, n: number) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const c: Call = {
      method: init?.method ?? 'GET', url: String(url), path: u.pathname + u.search,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    return handler(c, calls.length);
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jwt = (expSec: number, tag = '') => `h.${Buffer.from(JSON.stringify({ exp: expSec, tag })).toString('base64url')}.s`;
const tokens = (i: number, expSec: number) => ({ access_token: jwt(expSec, `a${i}`), refresh_token: `r${i}`, refresh_token_expiration: new Date(Date.now() + 7 * 864e5).toISOString() });
const cipher = makeCipher(undefined, 'test-secret');

describe('NEP-413', () => {
  it('base58 aller-retour', () => {
    const b = Uint8Array.from([0, 0, 1, 2, 255, 128]);
    expect(base58Decode(base58Encode(b))).toEqual(b);
    expect(base58Encode(KP.publicKey.data)).toBe(KP.publicKey.toString().slice(8));
  });

  it('même hash que near-kit et signature vérifiable (ed25519, base64)', async () => {
    const body = nearAuthBody('tokengo.near', SECRET);
    expect(body.signed_message.publicKey).toBe(KP.publicKey.toString());
    expect(body.payload).toMatchObject({ message: 'Sign in to NEAR AI Cloud', recipient: 'cloud.near.ai' });
    expect(body.payload.nonce).toHaveLength(32);
    const ts = Number(Buffer.from(body.payload.nonce.slice(0, 8)).readBigUInt64BE());
    expect(Math.abs(ts - Date.now())).toBeLessThan(5000);
    const ok = await verifyNep413Signature(
      { accountId: 'tokengo.near', publicKey: body.signed_message.publicKey, signature: body.signed_message.signature },
      { message: body.payload.message, recipient: body.payload.recipient, nonce: Uint8Array.from(body.payload.nonce) },
    );
    expect(ok).toBe(true);
  });

  it('vecteur fixe (tag 2^31+413 LE, callbackUrl None)', () => {
    const nonce = makeNonce(1_762_460_000_123, new Uint8Array(24).fill(9));
    expect(Buffer.from(nonce.slice(0, 8)).toString('hex')).toBe(1_762_460_000_123n.toString(16).padStart(16, '0'));
    const h = nep413Hash({ message: 'a', nonce, recipient: 'b' });
    // 9d010080 | 01000000 61 | nonce | 01000000 62 | 00
    const expected = Buffer.concat([Buffer.from('9d01008001000000' + '61', 'hex'), nonce, Buffer.from('0100000062' + '00', 'hex')]);
    expect(Buffer.from(h).toString('hex')).toBe(createHash('sha256').update(expected).digest('hex'));
  });
});

describe('session NEAR AI', () => {
  const mk = (handler: Handler, now = () => Date.now()) => {
    const db = openDb(':memory:');
    const { f, calls } = fakeFetch(handler);
    const s = createSession({ base: BASE, accountId: 'tokengo.near', secretKey: SECRET, db, cipher, fetch: f, now });
    return { db, s, calls };
  };

  it('login NEP-413 avec User-Agent constant, refresh persisté chiffré', async () => {
    const { db, s, calls } = mk(() => json(tokens(1, Date.now() / 1000 + 3600)));
    const t = await s.accessToken();
    expect(t).toContain('.');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/v1/auth/near');
    expect(calls[0]!.headers['User-Agent']).toBe(USER_AGENT);
    expect((calls[0]!.body as { signed_message: { accountId: string } }).signed_message.accountId).toBe('tokengo.near');
    const stored = kvGet<{ enc: string }>(db, KV_REFRESH)!;
    expect(stored.enc).not.toContain('r1');
    expect(cipher.decrypt(stored.enc)).toBe('r1');
    await s.accessToken(); // en cache
    expect(calls).toHaveLength(1);
  });

  it('refresh : un seul appel pour 5 demandes concurrentes, nouveau refresh persisté AVANT usage', async () => {
    let i = 0;
    let db!: ReturnType<typeof openDb>;
    const seenAtUse: string[] = [];
    const env = mk((c) => {
      if (c.path === '/v1/auth/near') return json(tokens(++i, Date.now() / 1000 + 30)); // access quasi expiré
      if (c.path === '/v1/users/me/access-tokens') {
        expect(c.headers.Authorization).toBe(`Bearer r${i}`);
        expect(c.headers['User-Agent']).toBe(USER_AGENT);
        return new Promise((r) => setTimeout(() => r(json(tokens(++i, Date.now() / 1000 + 3600))), 20));
      }
      seenAtUse.push(cipher.decrypt(kvGet<{ enc: string }>(db, KV_REFRESH)!.enc));
      return json({ ok: true });
    });
    db = env.db;
    await env.s.accessToken();
    await Promise.all([1, 2, 3, 4, 5].map(() => env.s.request('GET', '/v1/x')));
    expect(env.calls.filter((c) => c.path === '/v1/users/me/access-tokens')).toHaveLength(1);
    expect(env.calls.filter((c) => c.path === '/v1/auth/near')).toHaveLength(1);
    expect(new Set(seenAtUse)).toEqual(new Set(['r2']));
  });

  it('refresh refusé (401) → re-signature ; 401 sur un appel → rejoue avec un nouveau jeton', async () => {
    let logins = 0;
    let first = true;
    const env = mk((c) => {
      if (c.path === '/v1/auth/near') return json(tokens(++logins, Date.now() / 1000 + 3600));
      if (c.path === '/v1/users/me/access-tokens') return json({ error: { message: 'Invalid or expired refresh token', type: 'unauthorized' } }, 401);
      if (first) { first = false; return json({ error: { message: 'expired', type: 'unauthorized' } }, 401); }
      return json({ ok: c.headers.Authorization });
    });
    kvSet(env.db, KV_REFRESH, { enc: cipher.encrypt('stale'), exp: Date.now() + 864e5 });
    const r = await env.s.request<{ ok: string }>('GET', '/v1/y');
    expect(env.calls.map((c) => c.path)).toEqual(['/v1/users/me/access-tokens', '/v1/auth/near', '/v1/y', '/v1/users/me/access-tokens', '/v1/auth/near', '/v1/y']);
    expect(r.ok).toContain('Bearer h.');
    expect(logins).toBe(2);
  });

  it('découvre org et workspace', async () => {
    const env = mk((c) => {
      if (c.path === '/v1/auth/near') return json(tokens(1, Date.now() / 1000 + 3600));
      if (c.path.startsWith('/v1/organizations?')) return json({ organizations: [{ id: 'o-member', role: 'member' }, { id: 'o-own', role: 'owner' }], total: 2, limit: 100, offset: 0 });
      if (c.path.startsWith('/v1/organizations/o-own/workspaces')) return json({ workspaces: [{ id: 'ws-1', is_active: true }], total: 1 });
      return json({}, 404);
    });
    expect(await env.s.ids()).toEqual({ orgId: 'o-own', workspaceId: 'ws-1' });
    expect(kvGet(env.db, 'nearai:ids')).toEqual({ orgId: 'o-own', workspaceId: 'ws-1' });
  });
});

describe('provider NEAR AI (formes des requêtes)', () => {
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', NEARAI_BASE: BASE, NEARAI_AUTH_ACCOUNT: 'tokengo.near', NEARAI_AUTH_KEY: SECRET, NEARAI_ORG_ID: 'org1', NEARAI_WORKSPACE_ID: 'ws1', FEATURE_REAL_CREDITS: undefined });
  const mk = (handler: (c: Call) => Response | Promise<Response>) => {
    const { f, calls } = fakeFetch((c) => (c.path === '/v1/auth/near' ? json(tokens(1, Date.now() / 1000 + 3600)) : handler(c)));
    const p = nearAiCredits(cfg, openDb(':memory:'), { fetch: f, sleep: async () => {} });
    return { p, calls: () => calls.filter((c) => c.path !== '/v1/auth/near') };
  };

  it('realCredits activé par les variables NEARAI_AUTH_*', () => expect(cfg.realCredits).toBe(true));

  it('createKey : POST spendLimit camelCase, expires_at fin 2026', async () => {
    const { p, calls } = mk(() => json({ id: 'k1', key: 'sk-abc123456789xyz', key_prefix: 'sk-abc12', workspace_id: 'ws1', is_active: true, spend_limit: { amount: 30_000_000, scale: 9, currency: 'USD' } }, 201));
    const k = await p.createKey('tg_u1', 30_000_000);
    expect(k).toEqual({ keyId: 'k1', key: 'sk-abc123456789xyz', prefix: 'sk-abc12', limitNusd: 30_000_000 });
    const c = calls()[0]!;
    expect([c.method, c.path]).toEqual(['POST', '/v1/workspaces/ws1/api-keys']);
    expect(c.body).toEqual({ name: 'tg_u1', expires_at: KEY_EXPIRES_AT, spendLimit: { amount: 30_000_000, currency: 'USD' } });
    expect(c.headers.Authorization).toMatch(/^Bearer h\./);
  });

  it('setLimit : PATCH …/spend-limit ; erreur 503 puis relecture → limite déjà à la cible = succès', async () => {
    const { p, calls } = mk((c) => {
      if (c.method === 'PATCH') return json({ error: { message: 'oops', type: 'internal_server_error' } }, 503);
      return json({ api_keys: [{ id: 'k1', key_prefix: 'sk-', is_active: true, spend_limit: { amount: 60_000_000, scale: 9, currency: 'USD' } }], total: 1, limit: 1000, offset: 0 });
    });
    await p.setLimit('k1', 60_000_000);
    expect(calls().map((c) => `${c.method} ${c.path}`)).toEqual([
      'PATCH /v1/workspaces/ws1/api-keys/k1/spend-limit',
      'GET /v1/workspaces/ws1/api-keys?limit=1000&offset=0&order_by=usage&order_direction=desc',
    ]);
    expect(calls()[0]!.body).toEqual({ spendLimit: { amount: 60_000_000, currency: 'USD' } });
  });

  it('setLimit : 400 → pas de retry', async () => {
    const { p, calls } = mk(() => json({ error: { message: 'bad', type: 'bad_request' } }, 400));
    await expect(p.setLimit('k1', 1)).rejects.toThrow(/400 bad_request/);
    expect(calls()).toHaveLength(1);
  });

  it('usage, solde org, révocation', async () => {
    const { p, calls } = mk((c) => {
      if (c.path.startsWith('/v1/workspaces/ws1/api-keys?')) return json({ api_keys: [{ id: 'k1', key_prefix: 'a', is_active: true, usage: { amount: 1234, scale: 9, currency: 'USD' } }, { id: 'k2', key_prefix: 'b', is_active: true }], total: 2 });
      if (c.path === '/v1/organizations/org1/usage/balance') return json({ organization_id: 'org1', total_spent: 5, remaining: 9_000_000_000, credit_limits: [] });
      if (c.method === 'DELETE') return new Response(null, { status: 204 });
      return json({}, 404);
    });
    expect(await p.usage(['k1', 'k2', 'k3'])).toEqual({ k1: 1234, k2: 0, k3: 0 });
    expect(await p.orgRemaining()).toBe(9_000_000_000);
    await p.revoke('k9');
    expect(calls().at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/workspaces/ws1/api-keys/k9' });
  });

  it('chat : streaming SSE avec la clé du joueur, 402 → message lisible', async () => {
    const sse = ['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"Bon"}}]}\n\ndata: {"choices":[{"delta":{"con', 'tent":"jour"}}]}\n\n', 'data: [DONE]\n\n'];
    const { p, calls } = mk((c) => {
      if ((c.body as { model: string }).model === 'broke/model') return json({ error: { message: 'limit', type: 'api_key_limit_exceeded' } }, 402);
      return new Response(new ReadableStream({ start(ctl) { for (const s of sse) ctl.enqueue(new TextEncoder().encode(s)); ctl.close(); } }), { status: 200 });
    });
    let out = '';
    for await (const piece of p.chat('sk-player', 'z-ai/glm-5.3-flash', 'hi', 50)) out += piece;
    expect(out).toBe('Bonjour');
    const c = calls()[0]!;
    expect(c.path).toBe('/v1/chat/completions');
    expect(c.headers.Authorization).toBe('Bearer sk-player');
    expect(c.body).toEqual({ model: 'z-ai/glm-5.3-flash', messages: [{ role: 'user', content: 'hi' }], max_tokens: 50, reasoning_effort: 'low', stream: true });
    let broke = '';
    for await (const piece of p.chat('sk-player', 'broke/model', 'hi', 50)) broke += piece;
    expect(broke).toMatch(/used all its credits/);
  });
});

describe('cerveau des marchands', () => {
  let ctx: Ctx;
  let close: () => Promise<void>;
  let clock = Date.parse('2026-11-08T10:00:00Z');
  beforeAll(async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', NEARAI_BASE: BASE });
    const built = await buildApp(cfg, { now: () => clock });
    ctx = built.ctx;
    close = () => built.app.close();
  });
  afterAll(() => close());

  const visit = (merchantId: string) =>
    ctx.db.prepare('INSERT OR REPLACE INTO price_seen (user_id, merchant_id, at, prices) VALUES (?, ?, ?, ?)').run('u-test', merchantId, clock, '{}');

  it('sanitize / extraction JSON', () => {
    expect(sanitizeLine('  "Hello <b>runner</b>\u0007!" ', 90)).toBe('Hello b runner /b !');
    expect(sanitizeLine('what the fuck', 90)).toBeNull();
    expect(sanitizeLine('x'.repeat(200), 20)!.length).toBeLessThanOrEqual(20);
    expect(extractJson('Sure!\n```json\n{"spread": 0.05, "mood": "hi"}\n```')).toEqual({ spread: 0.05, mood: 'hi' });
    expect(extractJson('<think>{bad}</think> {"a":1} trailing }')).toEqual({ a: 1 });
    expect(extractJson('no json')).toBeNull();
  });

  it('marchand inactif → aucun appel ; actif → sortie LLM bornée (clampDecision) et journalisée', async () => {
    const m = allMerchants(ctx).find((x) => x.status === 'open')!;
    const { f, calls } = fakeFetch(() => json({ choices: [{ message: { content: JSON.stringify({
      spread: 0.9, targetMultipliers: Object.fromEntries(FAMILIES.map((fam) => [fam, 50])), contract: { family: FAMILIES[0], qty: 99 },
      mood: 'All shards half price <script>', reasoning: 'Because I said so',
    }) } }] }));
    const npc = createNpcBrain(ctx, { key: async () => 'sk-npc', fetch: f, structured: async () => true });
    expect(merchantActive(ctx, m.id)).toBe(false);
    expect(await npc.brain(m, {})).toBeNull();
    expect(calls).toHaveLength(0);

    visit(m.id);
    const before = getMerchant(ctx, m.id)!.m;
    await reflect(ctx, m.id, '2026-11-08', npc.brain);
    expect(calls).toHaveLength(1);
    const body = calls[0]!.body as { model: string; response_format: { type: string }; messages: { content: string }[] };
    expect(body.model).toBe(ctx.cfg.NPC_MODEL);
    expect(body.response_format.type).toBe('json_schema');
    expect(calls[0]!.headers.Authorization).toBe('Bearer sk-npc');
    const after = getMerchant(ctx, m.id)!.m;
    expect(after.spread).toBeLessThanOrEqual(AGENT_BOUNDS.spreadMax);
    for (const fam of FAMILIES) expect(after.targetMult[fam]).toBeLessThanOrEqual(before.targetMult[fam] * 1.3 + 1e-9);
    const t = ctx.db.prepare('SELECT output, source FROM merchant_thoughts WHERE merchant_id = ? ORDER BY id DESC LIMIT 1').get(m.id) as { output: string; source: string };
    expect(t.source).toBe('llm');
    expect(JSON.parse(t.output).mood).not.toMatch(/[<>]/);
  });

  it('plafond de 150 appels/jour (salutations comprises) puis repli', async () => {
    const m = allMerchants(ctx).filter((x) => x.status === 'open')[1]!;
    visit(m.id);
    const { f, calls } = fakeFetch(() => json({ choices: [{ message: { content: 'Bonjour, runner! Fancy a shard?' } }] }));
    const npc = createNpcBrain(ctx, { key: async () => 'sk-npc', fetch: f, structured: async () => false });
    kvSet(ctx.db, 'npc-llm-calls', { day: '2026-11-08', n: NPC_DAILY_CAP - 1 });
    expect(await npc.greet(m, 'u-a')).toBe('Bonjour, runner! Fancy a shard?');
    expect(await npc.greet(m, 'u-a')).toBe('Bonjour, runner! Fancy a shard?'); // cache 10 min
    expect(calls).toHaveLength(1);
    clock += 2 * 60_000;
    expect(await npc.greet(m, 'u-b')).toBeNull(); // budget épuisé
    expect(await npc.brain(m, {})).toBeNull();
    expect(calls).toHaveLength(1);
    expect(takeNpcCall(ctx)).toBe(false);
    clock += 24 * 3600_000; // nouveau jour à Paris
    expect(takeNpcCall(ctx)).toBe(true);
  });

  it('modèle refusé → repli sur le second modèle ; timeout/402 → null', async () => {
    const m = allMerchants(ctx).filter((x) => x.status === 'open')[2]!;
    visit(m.id);
    const { f, calls } = fakeFetch((c) => (c.body as { model: string }).model === ctx.cfg.NPC_MODEL
      ? json({ error: { message: 'model down', type: 'service_unavailable' } }, 503)
      : json({ choices: [{ message: { content: '{"spread":0.05,"mood":"Steady as the Seine."}' } }] }));
    const npc = createNpcBrain(ctx, { key: async () => 'sk-npc', fetch: f, structured: async () => false });
    const out = await npc.brain(m, {});
    expect(out?.source).toBe('llm');
    expect(calls.map((c) => (c.body as { model: string }).model)).toEqual([ctx.cfg.NPC_MODEL, ctx.cfg.NPC_MODEL_FALLBACK]);
    const broke = createNpcBrain(ctx, { key: async () => 'sk-npc', fetch: fakeFetch(() => json({ error: { type: 'api_key_limit_exceeded', message: 'x' } }, 402)).f, structured: async () => false });
    expect(await broke.brain(m, {})).toBeNull();
  });
});

describe('GET /api/merchant/:id/greet', () => {
  it('salutation LLM si dispo, sinon phrases préécrites', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0' });
    let llm: string | null = 'Ah, a runner with Claude shards!';
    const { app, ctx } = await buildApp(cfg, { npc: () => ({ brain: async () => null, greet: async () => llm }) });
    const login = await app.inject({ method: 'POST', url: '/auth/guest', payload: {}, headers: { origin: 'http://localhost:5173' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const m = allMerchants(ctx).find((x) => x.status === 'open')!;
    const get = async () => (await app.inject({ method: 'GET', url: `/api/merchant/${m.id}/greet`, headers: { cookie } })).json() as { greeting: string; source: string };
    expect(await get()).toEqual({ greeting: 'Ah, a runner with Claude shards!', source: 'llm' });
    llm = null;
    const fb = await get();
    expect(fb.source).toBe('lines');
    expect(fb.greeting.length).toBeGreaterThan(3);
    expect((await app.inject({ method: 'GET', url: '/api/merchant/nope/greet', headers: { cookie } })).statusCode).toBe(404);
    await app.close();
  });
});
