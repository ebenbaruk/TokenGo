// Marchandage côté serveur : séance (TTL, mauvaise séance), carte « rival » vraie, Deal borné appliqué à l'inventaire,
// double « Deal » concurrent, limites journalières, bouderie (devis −3 %), réplique LLM unique et plafonnée.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  HAGGLE, haversineM, merchantIdFor, quote, souredQuote,
  type Family, type HaggleDealResponse, type HaggleView, type Me, type MerchantState, type MerchantView, type QuoteResponse, type WorldNode,
} from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import type { Ctx } from './game/context.ts';
import { getMerchant, getP0, saveMerchant } from './game/merchants.ts';
import { _resetHaggles } from './game/haggle.ts';
import { kvSet } from './db.ts';
import { parisDay } from './game/reserve.ts';
import { endEvent, startEvent } from './game/events.ts';

const ORIGIN = 'http://localhost:5173';
const LOUVRE = { lat: 48.8611, lng: 2.3358 };
let clock = Date.parse('2026-11-08T10:00:00Z');
let app: FastifyInstance;
let ctx: Ctx;
const llmCalls: string[] = [];

beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0' });
  ({ app, ctx } = await buildApp(cfg, {
    now: () => clock,
    // cerveau factice : seule la réplique de marchandage est « LLM » (fournisseur simulé, aucun appel réseau)
    npc: () => ({ brain: async () => null, greet: async () => null, haggleLine: async (m) => { llmCalls.push(m.id); return 'Shake on it, runner.'; } }),
  }));
});
afterAll(() => app.close());
beforeEach(() => { _resetHaggles(); llmCalls.length = 0; clock += 3600_000 * 30; }); // nouveau jour de Paris : limites remises à zéro

let clientN = 0;
function client() {
  let cookie = '';
  const remoteAddress = `10.1.0.${++clientN}`;
  const req = async <T>(method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await app.inject({ method, url, remoteAddress, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) } });
    const set = res.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
    return { status: res.statusCode, body: res.json() as T & { error?: { code: string; message: string } } };
  };
  return { get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}) => req<T>('POST', u, b) };
}
type Client = ReturnType<typeof client>;

/** Joueur démo (sans pass : peut vendre), niveau 5 et 2 000 ƒ pour enchaîner les échanges. */
async function player(): Promise<{ c: Client; me: Me }> {
  const c = client();
  const r = await c.post<Me>('/auth/guest', { demo: true });
  const me = (r.body as unknown as { me?: Me }).me ?? r.body;
  ctx.db.prepare('UPDATE users SET xp = 5000 WHERE id = ?').run(me.id);
  ctx.db.prepare("UPDATE inventory SET amount = 2000 WHERE user_id = ? AND token_id = 'flux'").run(me.id);
  return { c, me };
}
async function walkTo(c: Client, to: { lat: number; lng: number }) {
  clock += 3000;
  expect((await c.post('/api/move', { lat: to.lat, lng: to.lng, acc: 8 })).status).toBe(200);
}

let A: WorldNode;
let B: WorldNode;
const mid = (n: WorldNode) => merchantIdFor(n.id);
const H = (n: WorldNode, p = '') => `/api/merchant/${mid(n)}/haggle${p}`;
function setMerchant(n: WorldNode, fn: (m: MerchantState) => void) {
  const m = getMerchant(ctx, mid(n))!.m;
  fn(m);
  saveMerchant(ctx, m);
}
/** Prépare deux marchands voisins : A vend `f` nettement moins cher que B (vrai argument « rival »), B pas motivé. */
function stage(f: Family, archetypeB = 'hustler') {
  setMerchant(A, (m) => { m.status = 'open'; m.flux = 3000; m.stock[f] = Math.round(m.baseTarget[f] * m.targetMult[f] * 1.6); m.contract = null; });
  setMerchant(B, (m) => { m.status = 'open'; m.flux = 3000; m.archetype = archetypeB; m.stock[f] = Math.round(m.baseTarget[f] * m.targetMult[f]); m.contract = null; });
}

beforeAll(() => {
  const markets = ctx.world.nodes.filter((n) => n.kind === 'market').sort((a, b) => haversineM(LOUVRE, a) - haversineM(LOUVRE, b));
  [A, B] = [markets[0]!, markets[1]!];
});

/** Visite A (prix vus), puis B : renvoie la vue de B. */
async function visitBoth(c: Client) {
  await walkTo(c, A);
  await c.get<MerchantView>(`/api/merchant/${mid(A)}`);
  await walkTo(c, B);
  return (await c.get<MerchantView>(`/api/merchant/${mid(B)}`)).body;
}

describe('haggle', () => {
  it('true rival card → bounded discount → Deal applied to inventory and merchant till; reputation grows', async () => {
    stage('deepseek');
    const { c, me } = await player();
    const vB = await visitBoth(c);
    expect(vB.relation).toEqual({ rep: 0, trait: 'greedy', sourUntil: null, hagglesLeft: HAGGLE.perMerchantDay });
    const s = await c.post<HaggleView>(H(B), { side: 'buy', family: 'deepseek', qty: 4 });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.phase).toBe('open');
    expect(s.body.total).toBe(s.body.baseTotal);
    expect(s.body.bestTotal).toBeLessThan(s.body.baseTotal);
    expect(s.body.hand[0]!.card).toBe('rival');
    expect(s.body.hand[0]!.rival!.price).toBeLessThan(vB.prices.find((p) => p.family === 'deepseek')!.sell!);
    expect(s.body.hand).toHaveLength(3);

    const p = await c.post<HaggleView>(H(B, '/play'), { haggleId: s.body.haggleId, card: 'rival' });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.event).toBe('rival-true');
    expect(p.body.offerBp).toBeGreaterThanOrEqual(200);
    expect(p.body.offerBp).toBeLessThanOrEqual(p.body.maxBp);
    expect(p.body.total).toBeLessThan(p.body.baseTotal);
    expect(p.body.total).toBeGreaterThanOrEqual(p.body.bestTotal);
    expect(p.body.round).toBe(2);
    expect(p.body.hand.map((h) => h.card)).toContain('walk');

    const tillBefore = getMerchant(ctx, mid(B))!.m.flux;
    const d = await c.post<HaggleDealResponse>(H(B, '/deal'), { haggleId: s.body.haggleId });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.total).toBe(p.body.total);
    expect(d.body.saved).toBe(p.body.baseTotal - p.body.total);
    expect(d.body.me.shards.deepseek).toBe(me.shards.deepseek + 4);
    expect(d.body.me.flux).toBe(2000 - d.body.total);
    expect(getMerchant(ctx, mid(B))!.m.flux).toBe(tillBefore + d.body.total);
    expect(d.body.haggle.phase).toBe('done');
    // réputation : +1 habitué du jour, +1 marchandage conclu
    expect(d.body.merchant.relation.rep).toBe(2);
    expect(d.body.merchant.relation.hagglesLeft).toBe(HAGGLE.perMerchantDay - 1);
    const row = ctx.db.prepare('SELECT outcome, final_total, base_total FROM haggles WHERE id = ?').get(s.body.haggleId) as { outcome: string; final_total: number; base_total: number };
    expect(row).toMatchObject({ outcome: 'deal', final_total: d.body.total });
    // un 2e Deal sur la même séance est refusé
    expect((await c.post(H(B, '/deal'), { haggleId: s.body.haggleId })).body.error?.code).toBe('EXPIRED');
  });

  it('only one LLM line per session (simulated brain), used for the handshake; daily LLM cap respected', async () => {
    stage('qwen');
    const { c } = await player();
    await visitBoth(c);
    const s = await c.post<HaggleView>(H(B), { side: 'buy', family: 'qwen', qty: 3 });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    const p1 = await c.post<HaggleView>(H(B, '/play'), { haggleId: s.body.haggleId, card: 'rival' });
    expect(p1.body.phase).toBe('open');
    await c.post<HaggleView>(H(B, '/play'), { haggleId: s.body.haggleId, card: p1.body.hand.find((h) => h.card !== 'walk')!.card });
    expect(llmCalls).toHaveLength(1);
    const d = await c.post<HaggleDealResponse>(H(B, '/deal'), { haggleId: s.body.haggleId });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.haggle.line).toBe('Shake on it, runner.');
    expect(d.body.haggle.lineSource).toBe('llm');
    // plafond journalier atteint → plus aucun appel, répliques écrites
    kvSet(ctx.db, 'npc-haggle-calls', { day: parisDay(clock), n: HAGGLE.llmLinesPerDay });
    const s2 = await c.post<HaggleView>(H(B), { side: 'buy', family: 'qwen', qty: 3 });
    expect(s2.status, JSON.stringify(s2.body)).toBe(200);
    await c.post(H(B, '/play'), { haggleId: s2.body.haggleId, card: s2.body.hand[0]!.card });
    expect(llmCalls).toHaveLength(1);
  });

  it('double Deal race: two concurrent commits → exactly one trade', async () => {
    stage('deepseek');
    const { c, me } = await player();
    await visitBoth(c);
    const s = await c.post<HaggleView>(H(B), { side: 'buy', family: 'deepseek', qty: 3 });
    await c.post(H(B, '/play'), { haggleId: s.body.haggleId, card: 'rival' });
    const [r1, r2] = await Promise.all([c.post(H(B, '/deal'), { haggleId: s.body.haggleId }), c.post(H(B, '/deal'), { haggleId: s.body.haggleId })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    expect([r1, r2].find((r) => r.status === 400)!.body.error?.code).toBe('EXPIRED');
    const after = (await c.get<Me>('/api/me')).body;
    expect(after.shards.deepseek).toBe(me.shards.deepseek + 3);
    expect((ctx.db.prepare('SELECT COUNT(*) n FROM trades WHERE user_id = ?').get(me.id) as { n: number }).n).toBe(1);
  });

  it('TTL, wrong player, wrong merchant, card not in hand, too few shards', async () => {
    stage('deepseek');
    const { c } = await player();
    await visitBoth(c);
    expect((await c.post(H(B), { side: 'buy', family: 'deepseek', qty: 2 })).body.error?.code).toBe('BAD_QTY');
    const s = await c.post<HaggleView>(H(B), { side: 'buy', family: 'deepseek', qty: 3 });
    const notInHand = (['bulk', 'regular', 'compliment', 'lowball', 'walk'] as const).find((k) => !s.body.hand.some((h) => h.card === k))!;
    expect((await c.post(H(B, '/play'), { haggleId: s.body.haggleId, card: notInHand })).body.error?.code).toBe('BAD_REQUEST');
    const { c: other } = await player();
    await walkTo(other, B);
    expect((await other.post(H(B, '/play'), { haggleId: s.body.haggleId, card: 'rival' })).body.error?.code).toBe('EXPIRED');
    expect((await other.post(H(B, '/deal'), { haggleId: s.body.haggleId })).body.error?.code).toBe('EXPIRED');
    expect((await c.post(H(A, '/play'), { haggleId: s.body.haggleId, card: 'rival' })).body.error?.code).toBe('EXPIRED');
    clock += HAGGLE.sessionTtlMs + 1000;
    expect((await c.post(H(B, '/play'), { haggleId: s.body.haggleId, card: 'rival' })).body.error?.code).toBe('EXPIRED');
    expect((ctx.db.prepare('SELECT outcome FROM haggles WHERE id = ?').get(s.body.haggleId) as { outcome: string }).outcome).toBe('expired');
  });

  it('daily limits: per merchant and per player', async () => {
    stage('deepseek');
    const { c } = await player();
    await visitBoth(c);
    for (let i = 0; i < HAGGLE.perMerchantDay; i++) expect((await c.post(H(B), { side: 'buy', family: 'deepseek', qty: 3 })).status).toBe(200);
    const lim = await c.post(H(B), { side: 'buy', family: 'deepseek', qty: 3 });
    expect(lim.status).toBe(429);
    expect(lim.body.error?.code).toBe('RATE_LIMITED');
    // le compteur par joueur : on simule les séances déjà faites ailleurs aujourd'hui
    const me = (await c.get<Me>('/api/me')).body;
    const ins = ctx.db.prepare("INSERT INTO haggles (id, at, user_id, merchant_id, side, family, qty, base_total) VALUES (?, ?, ?, 'm-elsewhere', 'buy', 'qwen', 3, 30)");
    for (let i = 0; i < HAGGLE.perPlayerDay; i++) ins.run(`x${i}-${me.id}`, clock, me.id);
    await walkTo(c, A);
    const lim2 = await c.post(H(A), { side: 'buy', family: 'deepseek', qty: 3 });
    expect(lim2.status).toBe(429);
    expect((lim2.body.error as unknown as { quota: string }).quota).toBe('haggles');
  });

  it('a caught bluff on a proud merchant sours him: no haggling for 20 min, quotes 3 % worse, reputation −2', async () => {
    stage('gemini', 'purist');
    const { c } = await player();
    await walkTo(c, B); // n'a vu aucun concurrent → carte « bluff »
    await c.get(`/api/merchant/${mid(B)}`);
    const s = await c.post<HaggleView>(H(B), { side: 'buy', family: 'gemini', qty: 3 });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.trait).toBe('proud');
    expect(s.body.patience).toBe(2);
    expect(s.body.hand[0]!.card).toBe('bluff');
    const p = await c.post<HaggleView>(H(B, '/play'), { haggleId: s.body.haggleId, card: 'bluff' });
    expect(p.body.phase).toBe('sour');
    expect(p.body.face).toBe('annoyed');
    expect(p.body.offerBp).toBe(0);
    expect((await c.post(H(B, '/deal'), { haggleId: s.body.haggleId })).body.error?.code).toBe('EXPIRED');
    const again = await c.post(H(B), { side: 'buy', family: 'gemini', qty: 3 });
    expect(again.body.error?.code).toBe('HAGGLE_SOUR');
    const view = (await c.get<MerchantView>(`/api/merchant/${mid(B)}`)).body;
    expect(view.relation.rep).toBe(HAGGLE.repPerSour);
    expect(view.relation.sourUntil).toBe(clock + HAGGLE.sourMs);
    const m = getMerchant(ctx, mid(B))!.m;
    const list = quote(getP0(ctx).gemini, m, 'buy', 'gemini', 2);
    if ('error' in list) throw new Error(list.error);
    const q = await c.post<QuoteResponse>(`/api/merchant/${mid(B)}/quote`, { side: 'buy', family: 'gemini', qty: 2 });
    expect(q.body.total).toBe(souredQuote(list).total);
    expect(q.body.total).toBeGreaterThan(list.total);
    clock += HAGGLE.sourMs + 1000;
    await walkTo(c, B);
    const q2 = await c.post<QuoteResponse>(`/api/merchant/${mid(B)}/quote`, { side: 'buy', family: 'gemini', qty: 2 });
    expect(q2.body.total).toBe(list.total);
  });

  it('walking away from an unmotivated merchant ends the haggle without a deal', async () => {
    stage('deepseek');
    const { c } = await player();
    await visitBoth(c);
    const s = await c.post<HaggleView>(H(B), { side: 'buy', family: 'deepseek', qty: 3 });
    const p = await c.post<HaggleView>(H(B, '/play'), { haggleId: s.body.haggleId, card: 'rival' });
    const w = await c.post<HaggleView>(H(B, '/play'), { haggleId: s.body.haggleId, card: 'walk' });
    expect(p.status).toBe(200);
    expect(w.body.phase).toBe('walked');
    expect(w.body.event).toBe('walk-bye');
    expect((ctx.db.prepare('SELECT outcome FROM haggles WHERE id = ?').get(s.body.haggleId) as { outcome: string }).outcome).toBe('walked');
  });

  it('city event (flash crash): the haggle starts from the event price like a normal quote; an event ending mid-haggle → PRICE_MOVED', async () => {
    stage('deepseek');
    const { c } = await player();
    await visitBoth(c);
    const plain = await c.post<QuoteResponse>(`/api/merchant/${mid(B)}/quote`, { side: 'buy', family: 'deepseek', qty: 4 });
    startEvent(ctx, { kind: 'flash_crash', zone: 'louvre', family: 'deepseek' }, 'admin');
    try {
      const q = await c.post<QuoteResponse>(`/api/merchant/${mid(B)}/quote`, { side: 'buy', family: 'deepseek', qty: 4 });
      expect(q.status, JSON.stringify(q.body)).toBe(200);
      expect(q.body.total).toBeLessThan(plain.body.total); // l'événement fait bien baisser le prix
      const s = await c.post<HaggleView>(H(B), { side: 'buy', family: 'deepseek', qty: 4 });
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      expect(s.body.baseTotal).toBe(q.body.total); // même point de départ que le devis normal
      expect(s.body.bestTotal).toBeLessThanOrEqual(s.body.baseTotal);
      endEvent(ctx);
      const d = await c.post<HaggleDealResponse>(H(B, '/deal'), { haggleId: s.body.haggleId });
      expect(d.body.error?.code).toBe('PRICE_MOVED');
      // le joueur confirme à nouveau : le Deal passe au nouveau prix (hors événement)
      const d2 = await c.post<HaggleDealResponse>(H(B, '/deal'), { haggleId: s.body.haggleId });
      expect(d2.status, JSON.stringify(d2.body)).toBe(200);
      expect(d2.body.total).toBeGreaterThan(q.body.total);
    } finally { endEvent(ctx); }
  });
});
