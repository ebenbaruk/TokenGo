// API : Décodage « Next token » (Docs/13 §3). Rare/Épique : obligatoire avant de donner l'éclat ; Commun : bonus borné.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CATCH, DECODE, type CatchResolveResponse, type CatchStartResponse, type DecodeAnswerResponse, type DecodeView, type Me, type SpawnView,
  type WorldResponse,
} from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import type { Ctx } from './game/context.ts';

const ORIGIN = 'http://localhost:5173';
const LOUVRE = { lat: 48.8611, lng: 2.3358 };
const ADMIN = 'adm-decode';
let clock = Date.parse('2026-11-08T10:00:00Z');
let app: FastifyInstance;
let ctx: Ctx;

beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', ADMIN_TOKEN: ADMIN });
  ({ app, ctx } = await buildApp(cfg, { now: () => clock }));
});
afterAll(() => app.close());

let clientN = 0;
function client() {
  let cookie = '';
  const remoteAddress = `10.0.13.${++clientN}`;
  const req = async <T>(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, remoteAddress, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers } });
    const set = res.headers['set-cookie'];
    if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(';')[0]!;
    return { status: res.statusCode, body: res.json() as T & { error?: { code: string } }, text: res.body };
  };
  return { req, get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}) => req<T>('POST', u, b) };
}
type Client = ReturnType<typeof client>;

async function player(): Promise<Client> {
  const c = client();
  expect((await c.post<Me>('/auth/guest', { demo: true })).status).toBe(200);
  return c;
}
const move = async (c: Client, p: { lat: number; lng: number }) => {
  clock += 3000;
  expect((await c.post('/api/move', { lat: p.lat, lng: p.lng, acc: 8 })).status).toBe(200);
};
const me = async (c: Client) => (await c.get<Me>('/api/me')).body;
const answerOf = async (c: Client, attemptId: string) =>
  (await c.req<{ correctId: string | null }>('GET', `/api/test/decode/${attemptId}`, undefined, { authorization: `Bearer ${ADMIN}` })).body.correctId!;

/** Spawns d'une famille autour du Louvre (lecture du monde, sans bouger). */
async function spawnsOf(families: string[], n: number): Promise<SpawnView[]> {
  const scout = await player();
  const out = new Map<string, SpawnView>();
  for (let i = 0; i < 49 && out.size < n; i++) {
    const p = { lat: LOUVRE.lat + ((i % 7) - 3) * 0.003, lng: LOUVRE.lng + (Math.floor(i / 7) - 3) * 0.004 };
    const w = (await scout.get<WorldResponse>(`/api/world?lat=${p.lat}&lng=${p.lng}`)).body;
    for (const s of w.spawns) if (families.includes(s.family) && !s.id.startsWith('tut:')) out.set(s.id, s);
  }
  expect(out.size, `${families.join('/')} spawns around the Louvre`).toBeGreaterThanOrEqual(n);
  return [...out.values()];
}

/** Démarre et résout un Lock-on parfait (offset 0) ; renvoie la réponse de resolve. */
async function lockOn(c: Client, sp: SpawnView, attemptId?: string) {
  let id = attemptId;
  if (!id) {
    const s = await c.post<CatchStartResponse>('/api/catch/start', { spawnId: sp.id });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    id = s.body.attemptId;
  }
  clock += 1500;
  const r = await c.post<CatchResolveResponse>('/api/catch/resolve', { attemptId: id, offsets: [0] });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { id, r: r.body, raw: r.text };
}
const answer = (c: Client, id: string, choiceId: string | null) => c.post<DecodeAnswerResponse>(`/api/catch/${id}/decode`, { choiceId });

let rares: SpawnView[] = [];
let commons: SpawnView[] = [];

describe('decode: required on rare/epic', () => {
  beforeAll(async () => {
    rares = await spawnsOf(['gpt', 'claude'], 1);
    commons = await spawnsOf(['deepseek', 'qwen'], 2);
  });

  it('a good lock-on on a rare asks a question and grants nothing yet; the answer never leaves the server', async () => {
    const c = await player();
    const sp = rares[0]!;
    await move(c, sp);
    const before = (await me(c)).shards[sp.family];
    const { id, r, raw } = await lockOn(c, sp);
    expect(r.result).toBe('decode');
    expect(r.qty).toBe(0);
    expect(r.lock).toBe('perfect');
    const d = r.decode!;
    expect(d.id).toBe(id);
    expect(d.prompt).toContain('___');
    expect(d.choices).toHaveLength(3);
    expect(d.deadlineMs).toBe(sp.family === 'claude' ? 5000 : 4000);
    expect(raw).not.toMatch(/correct|answer/i);
    expect((await me(c)).shards[sp.family]).toBe(before);
    // pendant la question, pas de deuxième resolve
    expect((await c.post('/api/catch/resolve', { attemptId: id, offsets: [0] })).body.error?.code).toBe('EXPIRED');

    // bonne réponse → capture donnée comme aujourd'hui (XP, PERFECT, combo, variante, Codex)
    clock += 1200;
    const ok = await answer(c, id, await answerOf(c, id));
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.verdict).toBe('correct');
    expect(ok.body.kind).toBe('required');
    const got = ok.body.catch!;
    expect(['perfect', 'good']).toContain(got.result);
    expect(got.qty).toBeGreaterThanOrEqual(1);
    expect(got.qty).toBeLessThanOrEqual(2);
    expect(got.codex).toBeTruthy();
    expect(got.xp).toBeGreaterThanOrEqual(10);
    expect(got.me.shards[sp.family]).toBe(before + got.qty);
    expect(got.bonusDecode).toBeUndefined();

    // rejouer la réponse est refusé, et l'éclat n'est donné qu'une fois
    const again = await answer(c, id, ok.body.correctId);
    expect(again.status).toBe(400);
    expect((await me(c)).shards[sp.family]).toBe(before + got.qty);
  });

  it('late (server clock) → hallucinated, even with the right token', async () => {
    const c = await player();
    const sp = rares[0]!;
    await move(c, sp);
    const { id, r } = await lockOn(c, sp);
    expect(r.result).toBe('decode');
    const right = await answerOf(c, id);
    clock += r.decode!.deadlineMs + DECODE.networkGraceMs + 200;
    const late = await answer(c, id, right);
    expect(late.status, late.text).toBe(200);
    expect(late.body.verdict).toBe('late');
    expect(late.body.correctId).toBe(right);
    expect(['fled', 'miss']).toContain(late.body.catch!.result);
    expect(late.body.catch!.qty).toBe(0);
  });

  it('wrong → flee at fleeAfterMiss or retry the lock-on with the tries left, then decode again', async () => {
    let sawRetry = false;
    let sawFled = false;
    for (let k = 0; k < 40 && !(sawRetry && sawFled); k++) {
      const c = await player();
      const sp = rares[0]!;
      await move(c, sp);
      const { id, r } = await lockOn(c, sp);
      const right = await answerOf(c, id);
      const wrong = r.decode!.choices.find((x) => x.id !== right)!.id;
      clock += 800;
      const w = await answer(c, id, wrong);
      expect(w.body.verdict).toBe('wrong');
      const out = w.body.catch!;
      if (out.result === 'fled') {
        sawFled = true;
        expect(out.qty).toBe(0);
        // l'éclat est parti pour ce joueur
        expect((await c.post('/api/catch/start', { spawnId: sp.id })).body.error?.code).toBe('ALREADY_CAUGHT');
        continue;
      }
      expect(out.result).toBe('miss');
      expect(out.triesLeft).toBe(CATCH.maxTries - 1);
      if (sawRetry) continue;
      sawRetry = true;
      // même tentative : Lock-on relancé → nouvelle question → bonne réponse → capturé
      const again = await lockOn(c, sp, id);
      expect(again.r.result).toBe('decode');
      clock += 900;
      const ok = await answer(c, id, await answerOf(c, id));
      expect(ok.body.verdict).toBe('correct');
      expect(['perfect', 'good']).toContain(ok.body.catch!.result);
    }
    expect(sawRetry).toBe(true);
    expect(sawFled).toBe(true);
  });

  it("cannot answer someone else's decode (and it stays answerable by its owner)", async () => {
    const a = await player();
    const b = await player();
    const sp = rares[0]!;
    await move(a, sp);
    const { id } = await lockOn(a, sp);
    const right = await answerOf(a, id);
    const steal = await answer(b, id, right);
    expect(steal.status).toBe(400);
    expect(steal.body.error?.code).toBe('EXPIRED');
    clock += 500;
    const ok = await answer(a, id, right);
    expect(ok.body.verdict).toBe('correct');
  });

  it('abandoning a pending question and restarting counts as a hallucination', async () => {
    const c = await player();
    const sp = rares[0]!;
    await move(c, sp);
    const { r } = await lockOn(c, sp);
    expect(r.result).toBe('decode');
    clock += 400;
    const s = await c.post<CatchStartResponse>('/api/catch/start', { spawnId: sp.id });
    // soit il a fui (EXPIRED « hallucinated »), soit une nouvelle tentative démarre
    if (s.status !== 200) expect(s.body.error?.code).toBe('EXPIRED');
    else expect(s.body.attemptId).toBeTruthy();
  });

  it('validates the body and requires a session', async () => {
    const c = await player();
    expect((await c.post('/api/catch/whatever/decode', { choiceId: 42 })).status).toBe(400);
    expect((await c.post('/api/catch/whatever/decode', { choiceId: 'abc' })).body.error?.code).toBe('EXPIRED');
    const anon = client();
    expect((await anon.post('/api/catch/whatever/decode', { choiceId: 'abc' })).status).toBe(401);
    // la route de test exige le jeton admin
    expect((await c.get('/api/test/decode/whatever')).status).toBe(403);
  });
});

describe('decode: optional bonus on commons', () => {
  it('a common catch is granted as today and offers a bonus; correct → +5 XP and a lucky next catch (no shard)', async () => {
    const c = await player();
    const sp = commons[0]!;
    await move(c, sp);
    const { id, r } = await lockOn(c, sp);
    expect(['perfect', 'good']).toContain(r.result);
    expect(r.qty).toBeGreaterThanOrEqual(1);
    expect(r.bonusDecode).toEqual({ id });
    expect(r.decode).toBeUndefined();
    const after = await me(c);
    // pas de réponse avant l'ouverture (le chrono part à l'ouverture)
    expect((await answer(c, id, 'abcdefgh')).body.error?.code).toBe('NO_DECODE');
    const open = await c.post<DecodeView>(`/api/catch/${id}/decode/open`);
    expect(open.status, open.text).toBe(200);
    expect(open.body.choices).toHaveLength(3);
    expect(open.text).not.toMatch(/correct|answer/i);
    expect((await c.post(`/api/catch/${id}/decode/open`)).body.error?.code).toBe('NO_DECODE'); // une seule ouverture
    clock += 1500;
    const ok = await answer(c, id, await answerOf(c, id));
    expect(ok.body.verdict).toBe('correct');
    expect(ok.body.kind).toBe('bonus');
    expect(ok.body.bonus).toMatchObject({ xp: DECODE.bonusXp, luckyNext: true });
    const m = ok.body.bonus!.me;
    expect(m.shards).toEqual(after.shards); // aucun éclat en plus
    expect(m.xp).toBe(after.xp + DECODE.bonusXp);
    expect((await answer(c, id, ok.body.correctId)).status).toBe(400); // une seule réponse

    // la capture suivante consomme la chance (Shiny ×2), une seule fois
    const sp2 = commons[1]!;
    await move(c, sp2);
    const next = await lockOn(c, sp2);
    expect(next.r.lucky).toBe(true);
    expect(next.r.qty).toBeGreaterThanOrEqual(1);
  });

  it('wrong bonus answer → nothing; the bonus expires if never opened', async () => {
    const c = await player();
    const sp = commons[0]!;
    await move(c, sp);
    const { id } = await lockOn(c, sp);
    const open = await c.post<DecodeView>(`/api/catch/${id}/decode/open`);
    const right = await answerOf(c, id);
    const w = await answer(c, id, open.body.choices.find((x) => x.id !== right)!.id);
    expect(w.body.verdict).toBe('wrong');
    expect(w.body.bonus).toMatchObject({ xp: 0, luckyNext: false });

    const c2 = await player();
    await move(c2, commons[1]!);
    const t = await lockOn(c2, commons[1]!);
    clock += DECODE.bonusOpenTtlMs + 1000;
    expect((await c2.post(`/api/catch/${t.id}/decode/open`)).body.error?.code).toBe('EXPIRED');
    clock -= DECODE.bonusOpenTtlMs; // garde les spawns de la fenêtre courante pour la suite
  });
});
