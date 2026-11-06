import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { haversineM, type ForgeView, type Me, type WorldResponse } from '@tokengo/shared';
import { loadConfig } from '../config.ts';
import { buildApp } from '../app.ts';
import { openDb } from '../db.ts';
import type { Ctx } from '../game/context.ts';
import { BURN_PROOF } from '../game/forge.ts';
import { accountFor, isValidAccountId, labelFor, merchantNearId, shortUserId } from './accounts.ts';
import { ChainError, type ChainClient, type ChainOp } from './near.ts';
import { reconcile } from './reconcile.ts';
import type { ProofsView } from './chain.ts';
import type { ChainStatus } from './settler.ts';

/** Contrat factice : même sémantique que op_settle (atomique, idempotent, panique si solde insuffisant). */
function fakeChain() {
  const bal = new Map<string, bigint>();
  const settled = new Set<string>();
  const calls: { id: string; ops: ChainOp[]; final: boolean }[] = [];
  const created: string[] = [];
  const st = { failNext: 0, landThenFail: 0, delayMs: 0, n: 0 };
  const key = (a: string, t: string) => `${a}|${t}`;
  const client: ChainClient = {
    contractId: 'tokengo.testnet',
    async settle(ops, id, o = {}) {
      calls.push({ id, ops, final: !!o.final });
      o.onSigned?.(`h${++st.n}`);
      if (st.delayMs) await new Promise((r) => setTimeout(r, st.delayMs));
      if (st.failNext > 0) { st.failNext--; throw new ChainError('network', 'RPC timeout'); }
      if (settled.has(id)) throw new ChainError('already', 'Smart contract panicked: settlement already applied');
      const next = new Map(bal);
      const add = (a: string, t: string, d: bigint) => {
        const v = (next.get(key(a, t)) ?? 0n) + d;
        if (v < 0n) throw new ChainError('contract', 'Smart contract panicked: insufficient balance');
        next.set(key(a, t), v);
      };
      for (const op of ops) {
        expect(isValidAccountId(op.kind === 'transfer' ? op.from : op.owner_id)).toBe(true);
        if (op.kind === 'mint') add(op.owner_id, op.token_id, BigInt(op.amount));
        else if (op.kind === 'burn') add(op.owner_id, op.token_id, -BigInt(op.amount));
        else if (op.kind === 'transfer') { add(op.from, op.token_id, -BigInt(op.amount)); add(op.to, op.token_id, BigInt(op.amount)); }
      }
      for (const [k, v] of next) bal.set(k, v);
      settled.add(id);
      if (st.landThenFail > 0) { st.landThenFail--; throw new ChainError('network', 'timeout after send'); }
      return { txHash: `tx-${id}`, gasBurnt: 3e12, ms: 1 };
    },
    async isSettled(id) { return settled.has(id); },
    async createAccount(id) { created.push(id); return { txHash: `acc-${id}` }; },
    async balances(a, tokens) { return tokens.map((t) => bal.get(key(a, t)) ?? 0n); },
  };
  return { client, bal, settled, calls, created, st, key };
}

describe('account mapping', () => {
  it('maps logical accounts to valid NEAR sub-accounts', () => {
    expect(shortUserId('Ab_c-DEFghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnopqrst');
    expect(labelFor('user:Xy_9-Kq3ZzPp0aaaaaa')).toBe('p-xy9kq3zzpp0aaaaaa');
    expect(labelFor('merchant:m-node-123')).toBe('m-node-123');
    expect(labelFor('user:abc', 'dev-')).toBe('dev-p-abc');
    expect(merchantNearId('m-way-42', 'tokengo.testnet')).toBe('m-way-42.tokengo.testnet');
    expect(isValidAccountId('p-abc.tokengo.testnet')).toBe(true);
    expect(isValidAccountId('p--abc.tokengo.testnet')).toBe(false);
    expect(isValidAccountId('P-abc.tokengo.testnet')).toBe(false);
    expect(() => labelFor('bank:1')).toThrow();
  });
  it('records the mapping and resolves collisions', () => {
    const db = openDb(':memory:');
    const a = accountFor(db, 'user:AbC', 'tokengo.testnet');
    const b = accountFor(db, 'user:abc', 'tokengo.testnet');
    expect(a).toBe('p-abc.tokengo.testnet');
    expect(b).toBe('p-abc1.tokengo.testnet');
    expect(accountFor(db, 'user:AbC', 'tokengo.testnet')).toBe(a);
    db.close();
  });
});

describe('settler with a fake chain', () => {
  const ORIGIN = 'http://localhost:5173';
  const LOUVRE = { lat: 48.8611, lng: 2.3358 };
  let clock = Date.parse('2026-11-08T10:00:00Z');
  let app: FastifyInstance;
  let ctx: Ctx;
  const fake = fakeChain();

  beforeAll(async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', DEMO_TOKEN: 'judge-pass', NEAR_ACCOUNT_PREFIX: '' });
    ({ app, ctx } = await buildApp(cfg, { now: () => clock, chainClient: fake.client }));
  });
  afterAll(() => app.close());

  const drain = async () => { for (let i = 0; i < 5; i++) await ctx.chain!.tick(); };
  const statuses = () => Object.fromEntries((ctx.db.prepare('SELECT status, COUNT(*) n FROM chain_ops GROUP BY status').all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));

  function client() {
    let cookie = '';
    const req = async <T>(method: 'GET' | 'POST', url: string, body?: unknown) => {
      const res = await app.inject({ method, url, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
      const set = res.headers['set-cookie'];
      if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
      return { status: res.statusCode, body: res.json() as T & { error?: { code: string } } };
    };
    return { get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}) => req<T>('POST', u, b) };
  }
  const walkTo = (c: ReturnType<typeof client>, to: { lat: number; lng: number }) => { clock += 3000; return c.post('/api/move', { lat: to.lat, lng: to.lng, acc: 8 }); };

  it('settles the merchant seed in strict id order, in capped batches', async () => {
    await drain();
    expect(statuses()).toEqual({ final: expect.any(Number) });
    const all = ctx.db.prepare('SELECT id, settlement_id FROM chain_ops ORDER BY id').all() as { id: number; settlement_id: string }[];
    const flat = fake.calls.map((c) => c.id);
    expect(new Set(flat).size).toBe(flat.length);
    expect(Math.max(...fake.calls.map((c) => c.ops.length))).toBeLessThanOrEqual(50);
    // lots contigus et ordonnés : chaque settlement_id couvre un intervalle d'ids qui suit le précédent
    const ranges = flat.map((id) => id.split('-').slice(-2).map(Number) as [number, number]);
    expect(ranges[0]![0]).toBe(all[0]!.id);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1] + 1);
    expect(ranges.at(-1)![1]).toBe(all.at(-1)!.id);
    const r = await reconcile(ctx.db, fake.client, { recheckMs: 0 });
    expect(r.checked).toBeGreaterThan(100);
    expect(r.mismatches).toEqual([]);
    const st = (await client().get<ChainStatus>('/api/chain/status')).body;
    expect(st.pending + st.inFlight).toBe(0);
    expect(st.lastSettlement?.url).toMatch(/^https:\/\/testnet\.nearblocks\.io\/txns\/tx-s-/);
  });

  it('retries after a network failure without double-applying (is_settled)', async () => {
    const c = client();
    await c.post('/auth/guest', { demo: true });
    fake.st.landThenFail = 1;
    await ctx.chain!.tick();
    expect(statuses().failed).toBeGreaterThan(0);
    const alertsBefore = ctx.db.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'chain.alert'").get() as { n: number };
    clock += 60_000; // passe le backoff
    await drain();
    expect(statuses()).toEqual({ final: expect.any(Number) });
    expect((await reconcile(ctx.db, fake.client, { recheckMs: 0 })).ok).toBe(true);
    // 5 échecs réseau → alerte publiée
    await c.post('/auth/logout');
    await client().post('/auth/guest', { demo: true });
    fake.st.failNext = 5;
    for (let i = 0; i < 5; i++) { await ctx.chain!.tick(); clock += 10 * 60_000; }
    const alertsAfter = ctx.db.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'chain.alert'").get() as { n: number };
    expect(alertsAfter.n).toBe(alertsBefore.n + 1);
    await drain();
    expect(statuses()).toEqual({ final: expect.any(Number) });
  });

  it('isolates an op the contract refuses (bisection) and keeps the rest flowing', async () => {
    ctx.db.prepare("INSERT INTO chain_ops (kind, from_acc, to_acc, token_id, amount, memo, created_at) VALUES ('burn', 'user:nobody', NULL, 'flux', 5, 'bad', ?)").run(clock);
    await client().post('/auth/guest', { demo: true }); // ops valides après l'op fautive
    await drain();
    expect(statuses()).toEqual({ final: expect.any(Number), rejected: 1 });
    expect(ctx.db.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'chain.alert' AND text LIKE '%rejected%'").get()).toEqual({ n: 1 });
  });

  it('forge: burn settled synchronously, burnTx returned and stored; player account created after a trade', async () => {
    const c = client();
    expect((await c.post<Me>('/auth/guest', { demo: true, token: 'judge-pass' })).status).toBe(200);
    await walkTo(c, LOUVRE);
    const w = (await c.get<WorldResponse>(`/api/world?lat=${LOUVRE.lat}&lng=${LOUVRE.lng}`)).body;
    const market = w.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open').sort((a, b) => haversineM(LOUVRE, a) - haversineM(LOUVRE, b))[0]!;
    await walkTo(c, market);
    const q = await c.post<{ quoteId: string }>(`/api/merchant/${market.merchant!.id}/quote`, { side: 'buy', family: 'deepseek', qty: 1 });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect((await c.post(`/api/merchant/${market.merchant!.id}/trade`, { quoteId: q.body.quoteId })).status).toBe(200);

    const forge = w.nodes.find((n) => n.id === 'forge:louvre')!;
    await walkTo(c, forge);
    const fv = (await c.get<ForgeView>(`/api/forge/${forge.id}`)).body;
    const recipe = fv.recipes.find((r) => r.tier !== 'first' && !r.locked && !Object.keys(r.missing).length);
    expect(recipe, JSON.stringify(fv.recipes)).toBeTruthy();
    const pendingBefore = statuses().pending ?? 0;
    expect(pendingBefore).toBeGreaterThan(0); // kit + trade pas encore réglés
    const r = await c.post<{ compileId: string; burnTx: string | null }>(`/api/forge/${forge.id}/compile`, { tier: recipe!.tier });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.burnTx).toMatch(/^tx-s-/);
    expect(fake.calls.at(-1)!.final).toBe(true); // lot de la Forge attendu en FINAL
    const row = ctx.db.prepare('SELECT burn_tx FROM compiles WHERE id = ?').get(r.body.compileId) as { burn_tx: string };
    expect(row.burn_tx).toBe(r.body.burnTx);
    await drain(); // laisse la file de comptes avancer
    const proofs = (await c.get<ProofsView>('/api/proofs')).body;
    expect(proofs.account).toMatch(/^p-[a-z0-9]+\.tokengo\.testnet$/);
    expect(fake.created).toContain(proofs.account);
    expect(proofs.accountCreated).toBe(true);
    expect(proofs.ops.length).toBe(10);
    expect(proofs.ops[0]!.memo).toBe(`forge:${r.body.compileId}`);
    expect(proofs.ops[0]!.url).toContain(r.body.burnTx!);
  });

  it('forge: on a slow chain, credits are still granted and burn_tx is filled later', async () => {
    const c = client();
    await c.post('/auth/guest', { demo: true, token: 'judge-pass' });
    const forge = ctx.world.forges.find((f) => f.id === 'forge:louvre')!;
    await walkTo(c, forge);
    const fv = (await c.get<ForgeView>(`/api/forge/${forge.id}`)).body;
    const recipe = fv.recipes.find((r) => r.tier !== 'first' && !r.locked && !Object.keys(r.missing).length)!;
    BURN_PROOF.timeoutMs = 50;
    fake.st.delayMs = 300;
    try {
      const r = await c.post<{ compileId: string; burnTx: string | null }>(`/api/forge/${forge.id}/compile`, { tier: recipe.tier });
      expect(r.status).toBe(200);
      expect(r.body.burnTx).toBeNull();
      await drain();
      const row = ctx.db.prepare('SELECT burn_tx FROM compiles WHERE id = ?').get(r.body.compileId) as { burn_tx: string | null };
      expect(row.burn_tx).toMatch(/^tx-s-/);
    } finally {
      BURN_PROOF.timeoutMs = 15_000;
      fake.st.delayMs = 0;
    }
  });

  it('reconcile detects an artificial on-chain difference', async () => {
    await drain();
    const acc = ctx.db.prepare("SELECT account_id FROM near_accounts WHERE owner LIKE 'merchant:%' LIMIT 1").get() as { account_id: string };
    fake.bal.set(fake.key(acc.account_id, 'flux'), (fake.bal.get(fake.key(acc.account_id, 'flux')) ?? 0n) + 7n);
    const r = await reconcile(ctx.db, fake.client, { recheckMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.mismatches).toEqual([expect.objectContaining({ account: acc.account_id, token: 'flux' })]);
    expect(BigInt(r.mismatches[0]!.chain) - BigInt(r.mismatches[0]!.expected)).toBe(7n);
  });
});
