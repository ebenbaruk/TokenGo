// Raid « Rogue Model » côté serveur (Docs/13 §6) : déclenchement admin (un seul événement à la fois), PV selon l'activité,
// assaut (distance, équipe, 3 manches, rate limit, double envoi), 3 assauts par raid, gratuit, dégâts en direct (SSE),
// victoire résolue UNE fois (récompenses, top 3, titre Codex, ticker), attaques simultanées, échec (consolation), runners,
// crochet des missions (raidDamageToday), route de test réservée à NODE_ENV=test + jeton admin.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  MODEL_STATS, RAID, TECHNIQUE_RULES,
  type CityEventView, type CodexView, type Family, type Me, type PulseEvent, type PulseResponse, type RaidAssaultView, type RaidPlayResponse,
  type RaidStartResponse, type RaidView, type Technique, type WorldResponse,
} from '@tokengo/shared';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import type { Ctx } from './game/context.ts';
import { credit } from './game/players.ts';
import { maybeAutoRogue, raidBotTick, raidDamageToday, resolveRaid } from './game/raid.ts';
import { seedRunners, runnerId, RUNNER_NAMES } from './game/runners.ts';
import { eventTick, startEvent } from './game/events.ts';
import { kvSet } from './db.ts';

const ORIGIN = 'http://localhost:5173';
const ADMIN = 'Bearer test-admin';
const FORGE = 'forge:louvre';
let clock = Date.parse('2026-11-08T13:00:00Z'); // 14 h à Paris
let app: FastifyInstance;
let ctx: Ctx;
let forgePos: { lat: number; lng: number };

beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0', ADMIN_TOKEN: 'test-admin' });
  ({ app, ctx } = await buildApp(cfg, { now: () => clock }));
  forgePos = ctx.world.forges.find((f) => f.id === FORGE)!;
});
afterAll(() => app.close());
beforeEach(async () => { clock += 3600_000; await admin('/api/admin/event/end'); });

let clientN = 0;
function client() {
  let cookie = '';
  const remoteAddress = `10.4.0.${++clientN}`;
  const req = async <T>(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, remoteAddress, ...(body !== undefined ? { payload: body as object } : {}), headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}), ...headers } });
    const set = [res.headers['set-cookie']].flat().find((c) => c?.startsWith('tg_sess='));
    if (set) cookie = set.split(';')[0]!;
    return { status: res.statusCode, body: res.json() as T & { error?: { code: string; message: string } } };
  };
  return { get: <T>(u: string) => req<T>('GET', u), post: <T>(u: string, b: unknown = {}, h: Record<string, string> = {}) => req<T>('POST', u, b, h) };
}
type Client = ReturnType<typeof client>;
const admin = <T>(url: string, body: unknown = {}) => client().post<T>(url, body, { authorization: ADMIN });

async function walkTo(c: Client, to: { lat: number; lng: number }) {
  clock += 3000;
  expect((await c.post('/api/move', { lat: to.lat, lng: to.lng, acc: 8 })).status).toBe(200);
}
/** Joueur démo à la Forge du Louvre, 1 éclat de chaque famille. */
async function player(at?: { lat: number; lng: number }): Promise<{ c: Client; me: Me }> {
  const c = client();
  const r = await c.post<Me>('/auth/guest', { demo: true });
  const me = r.body;
  for (const f of ['deepseek', 'qwen', 'gemini', 'gpt', 'claude'] as Family[]) credit(ctx, me.id, `shard:${f}`, 1, 'test');
  await walkTo(c, at ?? forgePos);
  return { c, me };
}
async function startRogue(extra: Record<string, unknown> = {}): Promise<CityEventView> {
  const r = await admin<{ event: CityEventView }>('/api/admin/event', { kind: 'rogue', forge: FORGE, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.event;
}
function smartPick(a: RaidAssaultView): { family: Family; technique: Technique } {
  const cat = a.challenge!.category;
  const family = a.me.team.map((m) => m.family).filter((f) => f !== a.me.rateLimited).sort((x, y) => MODEL_STATS[y][cat] - MODEL_STATS[x][cat])[0]!;
  const want: Technique = cat === 'math' || cat === 'code' ? 'cot' : cat === 'writing' || cat === 'lang' ? 'few' : cat === 'vision' ? 'tool' : 'zero';
  return { family, technique: TECHNIQUE_RULES[want].cost <= a.me.tokens ? want : 'zero' };
}
const T = ['deepseek', 'qwen', 'gemini'];
async function assault(c: Client, eventId: number, team = T): Promise<RaidPlayResponse[]> {
  const s = await c.post<RaidStartResponse>(`/api/raid/${eventId}/attack`, { team });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  let a = s.body.assault;
  const out: RaidPlayResponse[] = [];
  while (a.status === 'open') {
    const p = await c.post<RaidPlayResponse>(`/api/raid/assault/${a.assaultId}/play`, smartPick(a));
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    out.push(p.body);
    a = p.body.assault;
  }
  return out;
}
const setHp = (eventId: number, hp: number) => admin(`/api/test/raid/${eventId}/hp`, { hp });
const tickerCount = (kind: string) => (ctx.db.prepare('SELECT COUNT(*) n FROM events WHERE kind = ?').get(kind) as { n: number }).n;

describe('raid: start', () => {
  it('admin starts a rogue raid at a forge (one city event at a time); HP from recent activity, bounded', async () => {
    const before = (await client().post('/api/admin/event', { kind: 'rogue' })).status;
    expect(before).toBe(403);
    expect((await admin('/api/admin/event', { kind: 'rogue', forge: 'forge:nope' })).status).toBe(404);
    // un événement en cours est remplacé
    await admin('/api/admin/event', { kind: 'hype', family: 'gpt', zone: 'louvre' });
    const players = (ctx.db.prepare('SELECT COUNT(*) n FROM users WHERE is_agent = 0 AND seen_at > ?').get(clock - 3600_000) as { n: number }).n;
    const e = await startRogue();
    expect(e.kind).toBe('rogue');
    expect(e.forgeId).toBe(FORGE);
    expect(e.title).toBe('Rogue model at Louvre');
    expect(RAID_NAMES).toContain(e.boss);
    expect(e.raid).toMatchObject({ forgeId: FORGE, forgeName: 'Louvre', status: 'active', participants: 0 });
    expect(e.raid!.maxHp).toBe(Math.min(6000, 800 + 120 * players));
    expect(e.raid!.hp).toBe(e.raid!.maxHp);
    expect(e.raid!.weakness).not.toBe(e.raid!.resist);
    expect(e.endsAt - e.startsAt).toBe(45 * 60_000);
    const active = ctx.db.prepare('SELECT COUNT(*) n FROM city_events WHERE ends_at > ?').get(clock) as { n: number };
    expect(active.n).toBe(1);
    // le monde et /pulse portent les PV
    const { c } = await player();
    const w = (await c.get<WorldResponse>(`/api/world?lat=${forgePos.lat}&lng=${forgePos.lng}`)).body;
    expect(w.event?.raid?.hp).toBe(e.raid!.maxHp);
    const p = (await c.get<PulseResponse>('/api/pulse')).body;
    expect(p.cityEvent?.raid?.boss).toBe(e.boss);
    expect(p.events.find((x) => x.kind === 'city.event')?.text).toContain('Rogue model at Louvre');
  });

  it('HP grows with players active in the last hour (capped at 6000)', async () => {
    for (let i = 0; i < 3; i++) await player();
    const n = (ctx.db.prepare('SELECT COUNT(*) n FROM users WHERE is_agent = 0 AND seen_at > ?').get(clock - 3600_000) as { n: number }).n;
    const e = await startRogue();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(e.raid!.maxHp).toBe(Math.min(6000, 800 + 120 * n));
  });
});
const RAID_NAMES = ['GL1TCH-9', 'Overfit Prime', 'The Hallucinator', 'Loop.exe', 'Token Hydra'];

describe('raid: assault', () => {
  it('distance, team, ownership; 3 rounds deal damage live (SSE), free, 3 assaults max', async () => {
    const e = await startRogue();
    const far = await player({ lat: forgePos.lat + 0.004, lng: forgePos.lng });
    expect((await far.c.post(`/api/raid/${e.id}/attack`, { team: T })).body.error?.code).toBe('TOO_FAR');
    const { c, me } = await player();
    expect((await c.post(`/api/raid/${e.id}/attack`, { team: ['deepseek', 'deepseek', 'qwen'] })).body.error?.code).toBe('BAD_TEAM');
    expect((await c.post(`/api/raid/999999/attack`, { team: T })).status).toBe(404);
    const flux0 = (await c.get<Me>('/api/me')).body.flux;
    const seen: PulseEvent[] = [];
    const off = ctx.bus.subscribe((x) => { if (x.kind === 'raid.hp') seen.push(x); });

    const s = await c.post<RaidStartResponse>(`/api/raid/${e.id}/attack`, { team: T });
    expect(s.status).toBe(200);
    const a = s.body.assault;
    expect(a).toMatchObject({ rounds: 3, status: 'open', damage: 0, history: [] });
    expect(a.me.tokens).toBe(6);
    expect(a.opp.team.every((m) => m.mastery === 3)).toBe(true);
    expect(a.challenge).not.toBeNull();
    expect(s.body.me.flux).toBe(flux0); // gratuit
    // manche 1, puis le même modèle est « rate-limited », et un double envoi est refusé
    const p1 = await c.post<RaidPlayResponse>(`/api/raid/assault/${a.assaultId}/play`, { family: 'deepseek', technique: 'zero' });
    expect(p1.status).toBe(200);
    expect(p1.body.round.damage).toBeGreaterThan(0);
    expect(p1.body.raid.hp).toBe(e.raid!.maxHp - p1.body.round.damage);
    expect(seen.at(-1)?.data).toMatchObject({ eventId: e.id, hp: p1.body.raid.hp, damage: p1.body.round.damage, by: me.handle });
    expect(seen.at(-1)?.id).toBe(0); // éphémère : pas dans le ticker
    const rl = await c.post(`/api/raid/assault/${a.assaultId}/play`, { family: 'deepseek', technique: 'zero' });
    expect(rl.body.error?.code).toBe('MODEL_RATE_LIMITED');
    let cur = p1.body.assault;
    while (cur.status === 'open') {
      const p = await c.post<RaidPlayResponse>(`/api/raid/assault/${cur.assaultId}/play`, smartPick(cur));
      expect(p.status).toBe(200);
      cur = p.body.assault;
    }
    expect(cur.history).toHaveLength(3);
    expect(cur.damage).toBe(cur.history.reduce((x, r) => x + r.damage, 0));
    expect((await c.post(`/api/raid/assault/${cur.assaultId}/play`, { family: 'qwen', technique: 'zero' })).body.error?.code).toBe('EXPIRED');
    off();

    const v = (await c.get<RaidView>(`/api/raid/${e.id}`)).body;
    expect(v.mine).toMatchObject({ damage: cur.damage, assaults: 1, assaultsLeft: 2, rank: 1 });
    expect(v.leaderboard[0]).toMatchObject({ handle: me.handle, damage: cur.damage, me: true, agent: false });
    expect(v.raid.participants).toBe(1);
    expect(v.raid.hp).toBe(e.raid!.maxHp - cur.damage);
    expect(raidDamageToday(ctx, me.id)).toBe(cur.damage);
    expect((await c.get<Me>('/api/me')).body.flux).toBe(flux0);

    await assault(c, e.id);
    await assault(c, e.id);
    const no = await c.post(`/api/raid/${e.id}/attack`, { team: T });
    expect(no.body.error?.code).toBe('NO_ASSAULTS');
    expect((await c.get<RaidView>(`/api/raid/${e.id}`)).body.mine.assaultsLeft).toBe(0);
  });
});

describe('raid: victory', () => {
  it('the killing blow resolves once: rewards (+top 3), mastery +20 on used families, Codex title, ticker, event ends', async () => {
    const e = await startRogue();
    const a = await player();
    const b = await player();
    await assault(a.c, e.id); // a frappe d'abord (participant)
    expect((await setHp(e.id, 40)).status).toBe(200);
    const xpA = (await a.c.get<Me>('/api/me')).body.xp;
    const fluxB = (await b.c.get<Me>('/api/me')).body.flux;
    const ends0 = tickerCount('city.raid.end');
    const out = await assault(b.c, e.id);
    const last = out.find((x) => x.result)!;
    expect(last).toBeTruthy();
    expect(last.raid).toMatchObject({ hp: 0, status: 'won' });
    expect(last.assault.status).toBe('done');
    expect(last.result).toMatchObject({ outcome: 'won', xp: 80, flux: 70, top3: true, title: 'Rogue Slayer' });
    expect(last.result!.share).toBeGreaterThan(0);
    expect(Object.values(last.result!.masteryGains).every((g) => g === 20)).toBe(true);
    expect(tickerCount('city.raid.end')).toBe(ends0 + 1);
    expect(ctx.db.prepare("SELECT text FROM events WHERE kind = 'city.raid.end' ORDER BY id DESC").get()).toMatchObject({ text: expect.stringMatching(/^The city contained .+ at Louvre!/) });
    expect((await b.c.get<Me>('/api/me')).body.flux).toBe(fluxB + 70);
    // a aussi est récompensé (participant), une seule fois
    const va = (await a.c.get<RaidView>(`/api/raid/${e.id}`)).body;
    expect(va.result).toMatchObject({ outcome: 'won', xp: 80 });
    expect((await a.c.get<Me>('/api/me')).body.xp).toBe(xpA + 80);
    // l'événement est terminé ; plus d'assaut possible
    const w = (await b.c.get<WorldResponse>(`/api/world?lat=${forgePos.lat}&lng=${forgePos.lng}`)).body;
    expect(w.event).toBeNull();
    expect((await b.c.post(`/api/raid/${e.id}/attack`, { team: T })).body.error?.code).toBe('RAID_OVER');
    // résoudre à nouveau ne fait rien (idempotent)
    expect(ctx.db.transaction(() => resolveRaid(ctx, e.id, 'won'))()).toBe(false);
    expect(ctx.db.transaction(() => resolveRaid(ctx, e.id, 'failed'))()).toBe(false);
    expect((await a.c.get<Me>('/api/me')).body.xp).toBe(xpA + 80);
    // Codex : titre affiché, une seule fois même après un 2ᵉ raid gagné
    const cx = (await b.c.get<CodexView>('/api/codex')).body;
    expect(cx.title).toBe('Rogue Slayer');
    expect(cx.titles.find((t) => t.id === 'rogue-slayer')).toMatchObject({ unlocked: true });
    clock += 60_000;
    const e2 = await startRogue();
    await walkTo(b.c, forgePos);
    await setHp(e2.id, 30);
    const out2 = await assault(b.c, e2.id);
    expect(out2.find((x) => x.result)!.result!.title).toBeNull();
  });

  it('concurrent killing blows from many players resolve the raid exactly once', async () => {
    const e = await startRogue();
    const ps = await Promise.all(Array.from({ length: 6 }, () => player()));
    const starts = await Promise.all(ps.map((p) => p.c.post<RaidStartResponse>(`/api/raid/${e.id}/attack`, { team: T })));
    for (const s of starts) expect(s.status).toBe(200);
    await setHp(e.id, 5);
    const ends0 = tickerCount('city.raid.end');
    const xp0 = await Promise.all(ps.map(async (p) => (await p.c.get<Me>('/api/me')).body.xp));
    const plays = await Promise.all(ps.map((p, i) => p.c.post<RaidPlayResponse>(`/api/raid/assault/${starts[i]!.body.assault.assaultId}/play`, smartPick(starts[i]!.body.assault))));
    const ok = plays.filter((p) => p.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    // une seule manche fait les derniers dégâts, les autres trouvent le raid fini
    expect(plays.filter((p) => p.status === 200 && p.body.round.damage > 0)).toHaveLength(1);
    for (const p of plays.filter((x) => x.status !== 200)) expect(p.body.error?.code).toBe('RAID_OVER');
    expect(tickerCount('city.raid.end')).toBe(ends0 + 1);
    expect((ctx.db.prepare('SELECT status, hp FROM raids WHERE event_id = ?').get(e.id))).toEqual({ status: 'won', hp: 0 });
    // seul le tueur a des dégâts > 0 → seul participant récompensé (les autres n'avaient encore rien infligé)
    const xp1 = await Promise.all(ps.map(async (p) => (await p.c.get<Me>('/api/me')).body.xp));
    const gained = xp1.map((x, i) => x - xp0[i]!);
    expect(gained.filter((g) => g === 80)).toHaveLength(1);
    expect(gained.filter((g) => g === 0)).toHaveLength(5);
  });
});

describe('raid: fail, runners, hooks', () => {
  it('time runs out → failed once, 20 XP consolation, nothing else; ticker says it escaped', async () => {
    const e = await startRogue();
    const { c, me } = await player();
    await assault(c, e.id);
    const before = (await c.get<Me>('/api/me')).body;
    clock = e.endsAt + 1000;
    eventTick(ctx);
    eventTick(ctx);
    const row = ctx.db.prepare('SELECT status FROM raids WHERE event_id = ?').get(e.id);
    expect(row).toEqual({ status: 'failed' });
    const v = (await c.get<RaidView>(`/api/raid/${e.id}`)).body;
    expect(v.result).toMatchObject({ outcome: 'failed', xp: 20, flux: 0, title: null });
    const after = (await c.get<Me>('/api/me')).body;
    expect(after.xp).toBe(before.xp + 20);
    expect(after.flux).toBe(before.flux);
    expect(ctx.db.prepare("SELECT text FROM events WHERE kind = 'city.raid.end' ORDER BY id DESC").get()).toMatchObject({ text: expect.stringContaining('escaped from Louvre') });
    expect((await c.post(`/api/raid/${e.id}/attack`, { team: T })).body.error?.code).toBe('RAID_OVER');
    expect(raidDamageToday(ctx, me.id)).toBeGreaterThan(0);
  });

  it('admin ending the raid early also fails it (and a later play is refused)', async () => {
    const e = await startRogue();
    const { c } = await player();
    const s = await c.post<RaidStartResponse>(`/api/raid/${e.id}/attack`, { team: T });
    await admin('/api/admin/event/end');
    expect(ctx.db.prepare('SELECT status FROM raids WHERE event_id = ?').get(e.id)).toEqual({ status: 'failed' });
    const p = await c.post(`/api/raid/assault/${s.body.assault.assaultId}/play`, smartPick(s.body.assault));
    expect(p.body.error?.code).toBe('RAID_OVER');
  });

  it('runners chip in with modest damage, at most once a minute, and are never rewarded', async () => {
    seedRunners(ctx, 4);
    const ids = RUNNER_NAMES.slice(0, 4).map(runnerId);
    const e = await startRogue();
    kvSet(ctx.db, 'raid-bot-last', 0);
    let total = 0;
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      clock += 10_000;
      const d = raidBotTick(ctx, ids);
      if (d > 0) { hits++; expect(d).toBeGreaterThanOrEqual(RAID.botDamageMin); expect(d).toBeLessThanOrEqual(RAID.botDamageMax); }
      total += d;
    }
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThanOrEqual(10); // 10 min → au plus 10 coups
    const v = (await (await player()).c.get<RaidView>(`/api/raid/${e.id}`)).body;
    expect(v.raid.hp).toBe(v.raid.maxHp - total);
    expect(v.leaderboard.every((l) => l.agent)).toBe(true);
    expect(v.raid.participants).toBe(0);
    // victoire sans joueur réel : personne n'est payé
    await setHp(e.id, 1);
    clock += RAID.botEveryMs;
    let done = 0;
    for (let i = 0; i < 40 && !done; i++) { clock += 10_000; done = raidBotTick(ctx, ids); }
    expect(ctx.db.prepare('SELECT status FROM raids WHERE event_id = ?').get(e.id)).toEqual({ status: 'won' });
    expect((ctx.db.prepare('SELECT COUNT(*) n FROM raid_damage WHERE event_id = ? AND result IS NOT NULL').get(e.id) as { n: number }).n).toBe(0);
  });

  it('automatic raids: some due events become raids, at most 2 per Paris day, only in the raid window', async () => {
    clock = Date.parse('2026-11-12T10:00:00Z'); // 11 h à Paris
    expect(maybeAutoRogue(ctx, 1, 9)).toBeNull();  // hors créneau
    expect(maybeAutoRogue(ctx, 1, 23)).toBeNull();
    let rogues = 0;
    for (let seq = 1; seq <= 60; seq++) {
      const spec = maybeAutoRogue(ctx, seq, 14);
      if (!spec) continue;
      expect(spec.kind).toBe('rogue');
      const ev = startEvent(ctx, spec, 'auto');
      expect(ev.forgeId).toBeTruthy();
      rogues++;
      clock = ev.endsAt + 60_000;
    }
    expect(rogues).toBe(RAID.autoMaxPerDay);
    // le jour suivant, ça repart
    clock = Date.parse('2026-11-13T12:00:00Z');
    expect(Array.from({ length: 30 }, (_, i) => maybeAutoRogue(ctx, 100 + i, 14)).some(Boolean)).toBe(true);
    // et le tick automatique ne dépasse jamais le plafond, raids compris
    kvSet(ctx.db, 'city-event-next', 0);
    expect(() => eventTick(ctx)).not.toThrow();
  });

  it('the HP test knob is admin-only', async () => {
    const e = await startRogue();
    expect((await client().post(`/api/test/raid/${e.id}/hp`, { hp: 1 })).status).toBe(403);
  });
});
