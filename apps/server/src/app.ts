// Application Fastify : sessions, sécurité (Origin, CSP, rate limits), routes, SSE.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { z } from 'zod';
import { FAMILIES, RESERVE_PARTITION, haversineM, type PulseEvent } from '@tokengo/shared';
import type { Config } from './config.ts';
import { openDb, type DB } from './db.ts';
import { GameError, type Ctx } from './game/context.ts';
import { createBus } from './game/bus.ts';
import { loadWorld } from './game/world.ts';
import { simulatedCredits, type CreditsProvider } from './game/credits.ts';
import { randomId, safeEqual, sha256hex } from './game/crypto.ts';
import { createUser, getUser, meView, moveStateOf } from './game/players.ts';
import { catchResolve, catchStart, move, relaySync, worldView } from './game/actions.ts';
import { deliver, executeTrade, makeQuote, rescue, viewMerchant } from './game/market.ts';
import { compile, viewForge } from './game/forge.ts';
import { creditsView, playground, revealKey } from './game/creditsView.ts';
import { pulseView } from './game/pulse.ts';
import type { PublicConfig } from '@tokengo/shared';
import { getMerchant, seedMerchants } from './game/merchants.ts';
import { greetingFor } from './game/lines.ts';
import type { NpcBrain } from './nearai/brain.ts';
import { kvSet } from './db.ts';
import { proofsView, startChain } from './chain/chain.ts';
import { chainStatus } from './chain/settler.ts';
import type { ChainClient } from './chain/near.ts';
import { googleClient, newAuthorization, realExchange, signInWithGoogle, type GoogleExchange } from './auth/google.ts';
import { deleteAccount, leaderboards, setDistrict, setHandle } from './game/profile.ts';
import { labSnapshot } from './game/pulse.ts';
import { activeRunnerCount, runnersNear } from './game/runners.ts';
import { invariantStatus, parisDay } from './game/reserve.ts';
import { judgeOpen } from './game/forge.ts';
import { codexView } from './game/codex.ts';
import { dealHaggle, playHaggleCard, startHaggleSession } from './game/haggle.ts';
import { withLock } from './game/lock.ts';
import { HAGGLE_CARDS } from '@tokengo/shared';
import { createRegions, overpassFetcher, parseOverpassUrls, type OverpassFetch } from './game/regions.ts';

const SESSION_TTL = 30 * 24 * 3600_000;
/** Connexions SSE simultanées max : par joueur (/api/stream), par IP (/api/pulse/stream), au total. */
export const SSE_LIMITS = { perUser: 3, perIp: 20, global: 500 };
/** Distance max joueur ↔ marchand pour une salutation générée par le LLM (au-delà : réplique écrite, sans appel). */
export const GREET_RADIUS_M = 200;
const WEB_DIST = new URL('../../web/dist/', import.meta.url).pathname;

declare module 'fastify' {
  interface FastifyRequest { userId: string | null }
}

export interface AppOptions {
  now?: () => number;
  /** Fournisseur de crédits, ou fabrique recevant la base (le réel persiste son refresh token dans kv). */
  credits?: CreditsProvider | ((db: DB) => CreditsProvider);
  /** Cerveau LLM des marchands (salutations contextuelles) — construit une fois le ctx prêt. */
  npc?: (ctx: Ctx) => NpcBrain | null;
  /** Client de chaîne injecté (tests : client factice) ; sinon client near-kit si `cfg.chain`. */
  chainClient?: ChainClient;
  /** Échange OAuth Google (tests : faux échange) ; sinon arctic + id_token. */
  googleExchange?: GoogleExchange;
  /** Client Overpass (tests : faux client ; null = procédural seulement) ; sinon miroirs de OVERPASS_URLS. */
  overpass?: OverpassFetch | null;
}

export async function buildApp(cfg: Config, opts: AppOptions = {}) {
  const now = opts.now ?? Date.now;
  const db = openDb(cfg.DB_PATH === ':memory:' || isAbsolute(cfg.DB_PATH) ? cfg.DB_PATH : resolvePath(new URL('../../../', import.meta.url).pathname, cfg.DB_PATH));
  const sseSockets = new Set<import('node:http').ServerResponse>();
  const world = loadWorld();
  const totalReserve = Object.values(RESERVE_PARTITION).reduce((s, x) => s + x, 0);
  const credits = typeof opts.credits === 'function' ? opts.credits(db) : opts.credits ?? simulatedCredits(totalReserve);
  const ctx: Ctx = { db, cfg, world, bus: createBus(db, now), credits, now };
  seedMerchants(ctx);
  const npc = opts.npc?.(ctx) ?? null;

  const app = Fastify({
    logger: cfg.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    // XFF seulement derrière un nombre connu de proxys (TRUST_PROXY) : sinon req.ip serait falsifiable (rate limits par IP)
    trustProxy: cfg.trustProxy === false ? false : (_addr: string, hop: number) => hop < (cfg.trustProxy as number),
    bodyLimit: 32 * 1024,
  });
  app.decorateRequest('userId', null);
  ctx.regions = createRegions(ctx, opts.overpass !== undefined ? opts.overpass : overpassFetcher(parseOverpassUrls(cfg.OVERPASS_URLS)),
    (msg) => app.log.info({ world: true }, msg));
  const stopChain = startChain(ctx, opts.chainClient, { log: (level, msg) => app.log[level]({ chain: true }, msg) });
  await app.register(cookie, { secret: cfg.SESSION_SECRET });
  await app.register(rateLimit, {
    global: true,
    max: 120,
    // les fichiers statiques (front buildé) ne comptent pas : sinon une page vide pour tout un Wi-Fi partagé
    allowList: (req) => !req.url.startsWith('/api') && !req.url.startsWith('/auth'),
    timeWindow: '1 minute',
    keyGenerator: (req) => (req as FastifyRequest).userId ?? req.ip,
    errorResponseBuilder: () => ({ statusCode: 429, error: { code: 'RATE_LIMITED', message: 'Slow down a little.' } }),
  });

  const cookieName = cfg.prod ? '__Host-tg_sess' : 'tg_sess';

  // ── sécurité : en-têtes, Origin sur toute requête qui écrit ──
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    reply.header('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://tiles.openfreemap.org", "font-src 'self' data:",
      `connect-src 'self' https://tiles.openfreemap.org ${cfg.NEAR_RPC_URL}`, "worker-src 'self' blob:", "frame-ancestors 'none'",
    ].join('; '));
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const origin = req.headers.origin;
      if (!origin || !cfg.allowedOrigins.includes(origin)) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Bad origin.' } });
      }
    }
    const raw = req.cookies[cookieName];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE id_hash = ?').get(sha256hex(unsigned.value)) as { user_id: string; expires_at: number } | undefined;
        if (s && s.expires_at > now()) req.userId = s.user_id;
      }
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof GameError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...err.extra } });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid request.' } });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Slow down a little.' } });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: 'BAD_REQUEST', message: e.message ?? 'Bad request.' } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
  });

  const auth = (req: FastifyRequest): string => {
    if (!req.userId || !getUser(ctx, req.userId)) throw new GameError('UNAUTHENTICATED', 'Please start a session.', 401);
    return req.userId;
  };
  const rl = (max: number, timeWindow = '1 minute') => ({ config: { rateLimit: { max, timeWindow } } });
  const rlIp = (max: number, timeWindow = '1 minute') => ({ config: { rateLimit: { max, timeWindow, keyGenerator: (r: FastifyRequest) => r.ip } } });

  /** Ouvre une session (rotation : l'éventuelle session précédente de ce navigateur est supprimée). */
  const startSession = (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const raw = req.cookies[cookieName];
    const old = raw ? req.unsignCookie(raw) : null;
    if (old?.valid && old.value) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256hex(old.value));
    const sid = randomId(32);
    db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)').run(sha256hex(sid), userId, now(), now(), now() + SESSION_TTL);
    reply.setCookie(cookieName, sid, { path: '/', httpOnly: true, sameSite: 'lax', secure: cfg.prod, signed: true, maxAge: SESSION_TTL / 1000 });
  };

  // ── auth ──
  app.post('/auth/guest', { config: { rateLimit: { max: cfg.prod ? 3 : 1000, timeWindow: '1 hour', keyGenerator: (r: FastifyRequest) => r.ip } } }, async (req, reply) => {
    const body = z.object({ demo: z.boolean().optional(), token: z.string().max(200).optional() }).parse(req.body ?? {});
    const demoToken = !!(cfg.DEMO_TOKEN && body.token && safeEqual(body.token, cfg.DEMO_TOKEN));
    const ipHash = sha256hex(`${cfg.SESSION_SECRET}:${req.ip}`);
    const day = parisDay(now());
    // pass démo : un compte par IP et par jour (un lien de démo qui fuit ne fabrique pas des comptes Judge Pool à la chaîne)
    if (demoToken && db.prepare('SELECT 1 FROM demo_passes WHERE ip_hash = ? AND day = ?').get(ipHash, day)) {
      throw new GameError('RATE_LIMITED', 'This demo pass was already used from your network today — log back in on the original device, or come back tomorrow.', 429);
    }
    const u = db.transaction(() => {
      const u = createUser(ctx, { kind: 'guest', demo: !!(body.demo || demoToken), demoToken, ipHash });
      if (demoToken) db.prepare('INSERT INTO demo_passes (ip_hash, day, user_id) VALUES (?, ?, ?)').run(ipHash, day, u.id);
      return u;
    })();
    startSession(req, reply, u.id);
    return meView(ctx, u.id);
  });
  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[cookieName];
    const v = raw ? req.unsignCookie(raw) : null;
    if (v?.valid && v.value) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256hex(v.value));
    reply.clearCookie(cookieName, { path: '/' });
    return { ok: true };
  });

  // ── Google (OAuth 2 + PKCE ; state et verifier dans un cookie signé de 10 min) ──
  const google = googleClient(cfg);
  const exchange = opts.googleExchange ?? (google ? realExchange(cfg, google) : null);
  const OAUTH_COOKIE = 'tg_oauth';
  const back = (reply: FastifyReply, query: string) => reply.redirect(`${cfg.PUBLIC_URL.replace(/\/$/, '')}/?${query}`);
  app.get('/auth/google', rlIp(10), async (_req, reply) => {
    if (!google || !exchange) return back(reply, 'auth=error&reason=disabled');
    const a = newAuthorization(google);
    reply.setCookie(OAUTH_COOKIE, `${a.state}.${a.codeVerifier}`, { path: '/auth/google', httpOnly: true, sameSite: 'lax', secure: cfg.prod, signed: true, maxAge: 600 });
    return reply.redirect(a.url.toString());
  });
  app.get('/auth/google/callback', rlIp(10), async (req, reply) => {
    if (!google || !exchange) return back(reply, 'auth=error&reason=disabled');
    const q = z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }).parse(req.query);
    const raw = req.cookies[OAUTH_COOKIE];
    const c = raw ? req.unsignCookie(raw) : null;
    reply.clearCookie(OAUTH_COOKIE, { path: '/auth/google' });
    const [state, verifier] = c?.valid && c.value ? c.value.split('.') : [];
    if (q.error || !q.code || !q.state || !state || !verifier || q.state !== state) return back(reply, 'auth=error&reason=state');
    let profile;
    try {
      profile = await exchange(q.code, verifier);
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, 'google exchange failed');
      return back(reply, 'auth=error&reason=exchange');
    }
    const r = signInWithGoogle(ctx, profile, req.userId);
    if ('error' in r) return back(reply, `auth=error&reason=${r.error}`);
    startSession(req, reply, r.userId);
    return back(reply, `auth=google&outcome=${r.outcome}`);
  });

  app.get('/api/config', rlIp(60), async (): Promise<PublicConfig> =>
    ({ googleEnabled: !!(google && exchange), simulatedCredits: credits.simulated, chain: cfg.chain, judgeOpen: judgeOpen(ctx) }));

  // ── profil ──
  app.post('/api/me/handle', rl(10), async (req) => setHandle(ctx, auth(req), z.object({ handle: z.string().max(40) }).parse(req.body).handle));
  app.post('/api/me/district', rl(10), async (req) => setDistrict(ctx, auth(req), z.object({ district: z.number().int().min(1).max(20) }).parse(req.body).district));
  app.delete('/api/me', rl(3), async (req, reply) => {
    const r = await deleteAccount(ctx, auth(req));
    reply.clearCookie(cookieName, { path: '/' });
    return r;
  });
  app.get('/api/leaderboards', rlIp(60), async (req) => leaderboards(ctx, req.userId && getUser(ctx, req.userId) ? req.userId : null));
  app.get('/api/lab/snapshot', rlIp(60), async () => labSnapshot(ctx, activeRunnerCount(ctx)));

  // ── jeu ──
  const LatLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
  app.get('/api/me', async (req) => meView(ctx, auth(req)));
  app.post('/api/move', rl(40), async (req) => move(ctx, auth(req), LatLng.extend({ acc: z.number().min(0).max(10_000), heading: z.number().optional() }).parse(req.body)));
  app.get('/api/world', async (req) => {
    const q = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).parse(req.query);
    const w = worldView(ctx, auth(req), q.lat, q.lng, sha256hex(`${cfg.SESSION_SECRET}:${req.ip}`));
    const runners = runnersNear(ctx, q.lat, q.lng);
    return runners.length ? { ...w, runners } : w;
  });
  app.post('/api/catch/start', rl(30), async (req) => catchStart(ctx, auth(req), z.object({ spawnId: z.string().max(80) }).parse(req.body).spawnId));
  app.post('/api/catch/resolve', rl(30), async (req) => {
    const b = z.object({ attemptId: z.string().max(80), offsets: z.array(z.number()).max(3) }).parse(req.body);
    return catchResolve(ctx, auth(req), b.attemptId, b.offsets);
  });
  app.get('/api/codex', rl(30), async (req) => codexView(ctx, auth(req)));
  app.post('/api/relay/sync', rl(20), async (req) => relaySync(ctx, auth(req), z.object({ nodeId: z.string().max(80) }).parse(req.body).nodeId));

  const Id = z.object({ id: z.string().max(100) });
  app.get('/api/merchant/:id', async (req) => viewMerchant(ctx, auth(req), Id.parse(req.params).id));
  app.get('/api/merchant/:id/greet', rl(30), async (req) => {
    const userId = auth(req);
    const cur = getMerchant(ctx, Id.parse(req.params).id);
    if (!cur) throw new GameError('NOT_FOUND', 'No merchant here.', 404);
    // appel LLM (payant) seulement si le joueur est devant l'échoppe (≤ 200 m de sa dernière position) ; sinon réplique écrite
    const last = moveStateOf(getUser(ctx, userId)!).last;
    const near = !!last && haversineM(last, cur.node) <= GREET_RADIUS_M;
    const llm = npc && near && cur.m.status === 'open' ? await npc.greet(cur.m, userId).catch(() => null) : null;
    return { greeting: llm ?? greetingFor(cur.m, userId, now()), source: llm ? 'llm' : 'lines' };
  });
  app.post('/api/merchant/:id/quote', rl(60), async (req) => {
    const b = z.object({ side: z.enum(['sell', 'buy']), family: z.enum(FAMILIES), qty: z.number().int() }).parse(req.body);
    return makeQuote(ctx, auth(req), Id.parse(req.params).id, b);
  });
  app.post('/api/merchant/:id/trade', rl(30), async (req) =>
    executeTrade(ctx, auth(req), Id.parse(req.params).id, z.object({ quoteId: z.string().max(40) }).parse(req.body).quoteId));
  // Marchandage : séance côté serveur ; le client n'envoie que la carte choisie. Verrou par joueur (pas de double « Deal »).
  const TradeReq = z.object({ side: z.enum(['sell', 'buy']), family: z.enum(FAMILIES), qty: z.number().int() });
  const HaggleId = z.object({ haggleId: z.string().max(40) });
  app.post('/api/merchant/:id/haggle', rl(20), async (req) => {
    const userId = auth(req);
    const b = TradeReq.parse(req.body);
    return withLock(`haggle:${userId}`, async () => startHaggleSession(ctx, userId, Id.parse(req.params).id, b));
  });
  app.post('/api/merchant/:id/haggle/play', rl(30), async (req) => {
    const userId = auth(req);
    const b = HaggleId.extend({ card: z.enum(HAGGLE_CARDS) }).parse(req.body);
    return withLock(`haggle:${userId}`, async () => playHaggleCard(ctx, userId, Id.parse(req.params).id, b.haggleId, b.card, npc));
  });
  app.post('/api/merchant/:id/haggle/deal', rl(20), async (req) => {
    const userId = auth(req);
    const b = HaggleId.parse(req.body);
    return withLock(`haggle:${userId}`, async () => dealHaggle(ctx, userId, Id.parse(req.params).id, b.haggleId));
  });
  app.post('/api/merchant/:id/contract/deliver', rl(20), async (req) => deliver(ctx, auth(req), Id.parse(req.params).id));
  app.post('/api/merchant/:id/rescue', rl(20), async (req) =>
    rescue(ctx, auth(req), Id.parse(req.params).id, z.object({ flux: z.number().int() }).parse(req.body).flux));

  app.get('/api/forge/:id', async (req) => viewForge(ctx, auth(req), Id.parse(req.params).id));
  app.post('/api/forge/:id/compile', rl(6), async (req) =>
    compile(ctx, auth(req), Id.parse(req.params).id, z.object({ tier: z.enum(['first', 'spark', 'prism', 'aura']) }).parse(req.body).tier));

  app.get('/api/credits', async (req) => creditsView(ctx, auth(req)));
  app.post('/api/credits/reveal', rl(5, '1 hour'), async (req) => revealKey(ctx, auth(req)));
  app.post('/api/credits/playground', rl(10), async (req, reply) => {
    const userId = auth(req);
    const b = z.object({ model: z.string().max(80), prompt: z.string().max(8000) }).parse(req.body);
    const it = playground(ctx, userId, b.model, b.prompt)[Symbol.asyncIterator]();
    const first = await it.next(); // les erreurs (pas de clé…) sortent avant d'envoyer l'en-tête
    reply.raw.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    if (!first.done) reply.raw.write(first.value);
    for (let r = await it.next(); !r.done; r = await it.next()) reply.raw.write(r.value);
    reply.raw.end();
    return reply;
  });

  // ── public ──
  app.get('/api/pulse', rl(60), async () => pulseView(ctx));
  app.get('/api/chain/status', rl(60), async () => chainStatus(ctx));
  app.get('/api/proofs', rl(30), async (req) => proofsView(ctx, auth(req)));
  // SSE : flux longs → plafonds de connexions simultanées (par joueur, par IP pour le flux public, global)
  const sseOpen = new Map<string, number>();
  const sse = (req: FastifyRequest, reply: FastifyReply, key: string, max: number, subscribe: (fn: (e: PulseEvent) => void) => () => void) => {
    if (sseSockets.size >= SSE_LIMITS.global || (sseOpen.get(key) ?? 0) >= max) {
      throw new GameError('RATE_LIMITED', 'Too many live connections — close another tab and retry.', 429);
    }
    sseOpen.set(key, (sseOpen.get(key) ?? 0) + 1);
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write(': hello\n\n');
    const off = subscribe((e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => reply.raw.write(':ping\n\n'), 20_000);
    sseSockets.add(reply.raw);
    req.raw.on('close', () => {
      clearInterval(ping); off(); sseSockets.delete(reply.raw);
      const n = (sseOpen.get(key) ?? 1) - 1;
      if (n > 0) sseOpen.set(key, n); else sseOpen.delete(key);
    });
    return reply;
  };
  app.get('/api/pulse/stream', async (req, reply) => sse(req, reply, `ip:${req.ip}`, SSE_LIMITS.perIp, ctx.bus.subscribe));
  app.get('/api/stream', async (req, reply) => {
    const userId = auth(req);
    return sse(req, reply, `user:${userId}`, SSE_LIMITS.perUser, (fn) => ctx.bus.subscribeUser(userId, fn));
  });

  const isAdmin = (req: FastifyRequest) => !!cfg.ADMIN_TOKEN && safeEqual(req.headers.authorization ?? '', `Bearer ${cfg.ADMIN_TOKEN}`);
  app.post('/api/admin/forge/:action', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'No.' } });
    const action = z.object({ action: z.enum(['pause', 'resume']) }).parse(req.params).action;
    kvSet(db, 'forge-paused', action === 'pause');
    return { ok: true, paused: action === 'pause' };
  });

  app.get('/healthz', async (req) => {
    db.prepare('SELECT 1').get();
    const cs = chainStatus(ctx);
    const inv = await invariantStatus(ctx);
    // public : booléens seulement ; soldes, engagements et file de la chaîne réservés à l'admin
    if (!isAdmin(req)) return { ok: true, invariantOk: inv.ok, chain: cs.enabled, simulatedCredits: credits.simulated };
    return {
      ok: true, simulatedCredits: credits.simulated, chain: cs.enabled, chainPending: cs.pending + cs.inFlight, chainLagMs: cs.lagMs,
      invariantOk: inv.ok, invariant: inv,
    };
  });

  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/auth')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    });
  }

  app.addHook('preClose', async () => { for (const r of sseSockets) r.destroy(); });
  app.addHook('onClose', async () => { await stopChain(); db.close(); });
  return { app, ctx, npc };
}
