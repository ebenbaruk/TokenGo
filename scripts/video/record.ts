// Tournage de la vidéo de démo : vrais parcours de jeu pilotés par Playwright, filmés image par image via CDP
// (Page.startScreencast, JPEG haute qualité au pixel près du téléphone), à rythme humain (vols lissés, taps visibles).
// Chaque plan → var/video/raw/<plan>/ (images + liste ffmpeg concat + repères temporels) → clip MP4 30 i/s.
// Usage : serveur lancé (scripts/video/run.sh) puis `node scripts/video/record.ts [plan…]`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

const ORIGIN = process.env.VIDEO_ORIGIN ?? 'http://localhost:8807';
const ADMIN = process.env.VIDEO_ADMIN_TOKEN ?? 'video';
const DEMO = process.env.VIDEO_DEMO_TOKEN ?? 'video';
const ROOT = new URL('../../', import.meta.url).pathname;
const RAW = `${ROOT}var/video/raw`;
const DIST = `${ROOT}apps/web/dist/`;
const PHONE = { width: 390, height: 844 };
const DSF = 2;
const LOUVRE = { lat: 48.8611, lng: 2.3358 };

type Family = 'deepseek' | 'qwen' | 'gemini' | 'gpt' | 'claude';
interface LatLng { lat: number; lng: number }
interface Spawn extends LatLng { id: string; family: Family; expiresAt: number }
interface WorldNode extends LatLng { id: string; kind: 'relay' | 'market' | 'forge'; name: string; merchant?: { id: string; status: string } }
interface TG {
  phase: string; me: { flux: number; shards: Record<Family, number> } | null;
  world: { spawns: Spawn[]; nodes: WorldNode[] } | null; position: LatLng | null;
  route?: { stops: (LatLng & { id: string; done: boolean })[]; total: number } | null;
}
const MIME: Record<string, string> = {
  js: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png', webp: 'image/webp',
  woff: 'font/woff', woff2: 'font/woff2', webmanifest: 'application/manifest+json', pbf: 'application/x-protobuf',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Ralenti global du plan en cours (1 = temps réel) : les pauses de mise en scène sont exprimées en temps « page ». */
let K = 1;
const pause = (ms: number) => sleep(ms * K);
const dist = (a: LatLng, b: LatLng) => Math.hypot((a.lat - b.lat) * 111_000, (a.lng - b.lng) * 73_000);
const tg = (page: Page) => page.evaluate(() => (window as unknown as { __tg: () => TG }).__tg());
const log = (...a: unknown[]) => console.log('[video]', ...a);

// ───────── Caméra : screencast CDP → images horodatées ─────────
interface Rec { mark: (name: string) => void; stop: () => Promise<void> }
async function record(page: Page, name: string): Promise<Rec> {
  const dir = `${RAW}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: { file: string; ts: number }[] = [];
  const marks: { name: string; t: number }[] = [];
  let n = 0;
  cdp.on('Page.screencastFrame', (f) => {
    const file = `f${String(++n).padStart(5, '0')}.jpg`;
    writeFileSync(`${dir}/${file}`, Buffer.from(f.data, 'base64'));
    frames.push({ file, ts: f.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  const vp = page.viewportSize() ?? PHONE;
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: vp.width * DSF, maxHeight: vp.height * DSF, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  const slow = K;
  const W = vp.width * DSF;
  const H = vp.height * DSF;
  return {
    mark: (m) => { marks.push({ name: m, t: Date.now() / 1000 - t0 }); log(name, 'mark', m); },
    stop: async () => {
      const tEnd = Date.now() / 1000;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
      if (!frames.length) throw new Error(`${name}: no frames`);
      const lines: string[] = [];
      // le 1er cadre couvre le temps depuis t0 (repères alignés sur l'horloge murale)
      const start = Math.min(t0, frames[0]!.ts);
      for (let i = 0; i < frames.length; i++) {
        const from = i === 0 ? start : frames[i]!.ts;
        const to = i + 1 < frames.length ? frames[i + 1]!.ts : tEnd;
        lines.push(`file '${frames[i]!.file}'`, `duration ${Math.max(0.001, to - from).toFixed(4)}`);
      }
      lines.push(`file '${frames.at(-1)!.file}'`);
      writeFileSync(`${dir}/list.txt`, lines.join('\n') + '\n');
      writeFileSync(`${dir}/marks.json`, JSON.stringify({ duration: tEnd - start, offset: t0 - start, slow, marks, frames: frames.map((f) => +(f.ts - t0).toFixed(3)) }, null, 1));
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`,
        '-vf', `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', `${RAW}/${name}.mp4`]);
      log(name, `${frames.length} frames, ${(tEnd - start).toFixed(1)} s → ${RAW}/${name}.mp4`);
    },
  };
}

// ───────── Mise en scène : doigt visible, vols lissés ─────────
/** Script injecté : un « doigt » (cercle) qui s'enfonce puis fait une onde à chaque tap. Purement visuel. */
const FINGER = () => {
  (window as unknown as { __vidTap: (x: number, y: number, holdMs?: number) => void }).__vidTap = (x, y, holdMs = 0) => {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;
      background:rgba(255,255,255,.55);border:3px solid rgba(26,28,44,.75);box-shadow:0 2px 10px rgba(0,0,0,.35);
      pointer-events:none;z-index:2147483647;`;
    document.documentElement.appendChild(d);
    d.animate([{ transform: 'scale(1.5)', opacity: 0 }, { transform: 'scale(.85)', opacity: 1 }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
    setTimeout(() => {
      const a = d.animate([{ transform: 'scale(.85)', opacity: 1 }, { transform: 'scale(2.1)', opacity: 0 }], { duration: 420, easing: 'ease-out', fill: 'forwards' });
      a.onfinish = () => d.remove();
    }, 160 + holdMs);
  };
};

/**
 * Ralenti (pour filmer le Lock-on à plein débit d'images même sur une machine chargée) : le temps de la page
 * (performance.now, horodatage rAF, délais setTimeout) et les animations CSS/WAAPI tournent à `rate` ; le montage
 * accélère d'autant. Le serveur ne voit rien (Date.now intact, délais de capture larges).
 */
const SLOWMO = () => {
  let rate = 1;
  let realBase = 0;
  let virtBase = 0;
  const pn = performance.now.bind(performance);
  const vnow = () => virtBase + (pn() - realBase) * rate;
  performance.now = vnow;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => cb(vnow()));
  const st = window.setTimeout.bind(window) as (f: TimerHandler, ms?: number, ...a: unknown[]) => number;
  (window as unknown as { setTimeout: unknown }).setTimeout = (f: TimerHandler, ms?: number, ...a: unknown[]) => st(f, (ms ?? 0) / rate, ...a);
  (window as unknown as { __vidSlow: (r: number) => void }).__vidSlow = (r) => { virtBase = vnow(); realBase = pn(); rate = r; };
};

async function slowmo(page: Page, rate: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable').catch(() => {});
  await cdp.send('Animation.setPlaybackRate', { playbackRate: rate });
  await page.evaluate((r) => (window as unknown as { __vidSlow: (r: number) => void }).__vidSlow(r), rate);
  await cdp.detach().catch(() => {});
}

/** Tout le plan au ralenti (×k) : la machine de tournage peut être chargée, le montage réaccélère (marks.json → slow). */
async function slowAll(page: Page, k: number) {
  K = k;
  await slowmo(page, 1 / k);
}

async function finger(page: Page, x: number, y: number, holdMs = 0) {
  await page.evaluate(([a, b, h]) => (window as unknown as { __vidTap: (x: number, y: number, h: number) => void }).__vidTap(a!, b!, h!), [x, y, holdMs]);
}

/** Tap humain sur un élément : le doigt arrive, s'enfonce, clic. */
async function tap(page: Page, testId: string, opts: { pause?: number; nth?: number } = {}) {
  const loc = page.getByTestId(testId).nth(opts.nth ?? 0);
  await loc.waitFor({ state: 'visible', timeout: 15_000 });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = await loc.boundingBox({ timeout: 5000 }).catch(() => null);
  if (b) {
    await finger(page, b.x + b.width / 2, b.y + b.height / 2);
    await pause(140);
  }
  await loc.click({ force: true, timeout: 5000 });
  await pause(opts.pause ?? 500);
}

/** Maintien (HoldButton) avec doigt visible. */
async function holdTap(page: Page, testId: string, ms = 1500) {
  const b = (await page.getByTestId(testId).boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await finger(page, x, y, ms);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await pause(ms);
  await page.mouse.up();
}

/**
 * Vol lissé du Scout jusqu'à p : une suite de petits __tgWalk (300 ms chacun) le long d'une courbe ease-in-out,
 * enchaînés dans la page (pas de latence Node) → le pigeon glisse au lieu de sauter. Attend l'accusé du serveur.
 */
async function glide(page: Page, p: LatLng, ms?: number) {
  const from = (await tg(page)).position!;
  const d = dist(from, p);
  const dur = ms ?? Math.min(3200, Math.max(1100, d * 14));
  const moved = page.waitForResponse((r) => {
    if (!r.url().endsWith('/api/move') || r.request().method() !== 'POST') return false;
    const b = r.request().postDataJSON() as LatLng;
    return Math.abs(b.lat - p.lat) < 1e-7 && Math.abs(b.lng - p.lng) < 1e-7;
  }, { timeout: 20_000 });
  await page.evaluate(([a, b, c, e, T]) => new Promise<void>((resolve) => {
    const w = (window as unknown as { __tgWalk: (x: number, y: number) => void }).__tgWalk;
    const t0 = performance.now();
    const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / T!);
      const q = ease(k);
      // on vise un peu devant (le walkTo de 300 ms rattrape) : mouvement continu, arrivée exacte
      const lead = Math.min(1, ease(Math.min(1, k + 0.06)));
      w(a! + (c! - a!) * lead, b! + (e! - b!) * lead);
      if (k < 1 && q < 1) setTimeout(step, 90); else { w(c!, e!); resolve(); }
    };
    step();
  }), [from.lat, from.lng, p.lat, p.lng, dur]);
  await moved;
  await pause(350);
}

/** Lock-on : tape pile quand l'anneau touche le cercle (lecture de la transform à chaque frame) + doigt visible. */
async function perfectTap(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const t0 = performance.now();
    let prev = NaN;
    const tick = () => {
      const screen = document.querySelector('[data-testid="catch-screen"]');
      if (!screen) return reject(new Error('catch screen closed'));
      if (screen.querySelector('[data-testid="catch-result"]')) return resolve();
      const ring = [...screen.querySelectorAll<HTMLElement>('div')].find((d) => d.style.transform.includes('scale('));
      const m = ring ? /scale\(([\d.]+)\)/.exec(ring.style.transform) : null;
      // laisser voir l'anneau se resserrer au moins un tour avant de taper
      const sc = m ? Number(m[1]) : NaN;
      // fenêtre « perfect » : ±7 % ; on tape dans ±4,5 %, ou à la première frame qui franchit le cercle (frames lentes)
      const hit = Math.abs(sc - 1) < 0.045 || (prev > 1 && sc < 1 && Math.abs(sc - 1) < 0.065);
      prev = sc;
      if (m && performance.now() - t0 > 1300 && hit) {
        const r = ring!.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2 + 150;
        (window as unknown as { __vidTap: (x: number, y: number) => void }).__vidTap(x, y);
        screen.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
        return resolve();
      }
      if (performance.now() - t0 > 15_000) return reject(new Error('ring never reached the target'));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

async function playLockOn(page: Page) {
  for (let i = 0; i < 3 && !(await page.getByTestId('catch-result').isVisible()); i++) {
    await perfectTap(page);
    await page.getByTestId('catch-result').waitFor({ timeout: 2500 }).catch(() => {});
  }
  await page.getByTestId('catch-result').waitFor({ timeout: 10_000 });
}

// ───────── Contexte navigateur ─────────
let browser: Browser;
async function phone(opts: { reducedMotion?: boolean; viewport?: { width: number; height: number }; mobile?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const mobile = opts.mobile ?? true;
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? PHONE, deviceScaleFactor: DSF, isMobile: mobile, hasTouch: mobile,
    userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : undefined,
    geolocation: { latitude: LOUVRE.lat, longitude: LOUVRE.lng, accuracy: 10 }, permissions: ['geolocation'],
    reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference', locale: 'en-US', timezoneId: 'Europe/Paris',
    baseURL: ORIGIN,
  });
  // statiques depuis le disque : évite le rate limit global (120 req/min/IP) entre les plans
  await ctx.route(new RegExp(`^${ORIGIN}/(assets|art|map)/[^?#]+`), async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '');
    const file = DIST + path;
    if (path.includes('..') || !existsSync(file)) return route.fallback();
    await route.fulfill({ status: 200, body: readFileSync(file), contentType: MIME[path.split('.').pop()!] ?? 'application/octet-stream' });
  });
  await ctx.addInitScript(FINGER);
  await ctx.addInitScript(SLOWMO);
  // pas de son dans le navigateur headless (la bande-son est synthétisée au montage)
  await ctx.addInitScript(() => { try { localStorage.setItem('tg.muted', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', e.message));
  return { ctx, page };
}

/** Session « pass démo » (600 ƒ + de quoi forger), partagée par les plans marchand et forge (1 pass par IP et par jour). */
let passSession: Promise<{ ctx: BrowserContext; page: Page }> | null = null;
function withPass() {
  passSession ??= (async () => {
    const p = await phone();
    const r = await p.page.request.post('/auth/guest', { data: { token: DEMO }, headers: { Origin: ORIGIN } });
    if (!r.ok()) throw new Error(`demo pass: ${await r.text()}`);
    await p.ctx.addInitScript(() => { try { localStorage.setItem('tg.session', '1'); } catch { /* */ } });
    return p;
  })();
  return passSession;
}

const waitWorld = (page: Page) =>
  page.waitForFunction(() => !!(window as unknown as { __tg: () => TG }).__tg().world?.spawns.length, null, { timeout: 30_000 });

/** Splash → invité Remote Scout → carte prête (coach du tutoriel fermé si demandé). */
async function enter(page: Page, opts: { skipTutorial?: boolean; url?: string } = {}) {
  await page.goto(opts.url ?? '/?demo=1');
  await page.getByTestId('play-guest').click();
  const demoBtn = page.getByTestId('use-demo');
  if (await demoBtn.isVisible({ timeout: 2000 }).catch(() => false)) await demoBtn.click();
  await page.getByTestId('map').waitFor();
  await waitWorld(page);
  if (opts.skipTutorial ?? true) {
    const skip = page.getByTestId('tutorial-skip');
    if (await skip.isVisible({ timeout: 1500 }).catch(() => false)) await skip.click();
  }
  await sleep(1500); // tuiles + sprites
}

const COMMON: Family[] = ['deepseek', 'qwen'];
function pickSpawn(s: TG, prefer: Family[] = COMMON): Spawn | undefined {
  return s.world!.spawns
    .filter((x) => !x.id.startsWith('tut:') && x.expiresAt > Date.now() + 40_000 && dist(x, s.position!) < 260)
    .sort((a, b) => Number(prefer.includes(b.family)) - Number(prefer.includes(a.family)) || dist(a, s.position!) - dist(b, s.position!))[0];
}

/** Trouve un éclat ordinaire en tournant autour du départ si besoin (hors caméra). */
async function findSpawn(page: Page, prefer?: Family[]): Promise<Spawn> {
  let s = await tg(page);
  const start = s.position!;
  let sp = pickSpawn(s, prefer);
  for (let k = 0; !sp && k < 8; k++) {
    const a = (k * Math.PI) / 4;
    await glide(page, { lat: start.lat + (150 * Math.cos(a)) / 111_000, lng: start.lng + (150 * Math.sin(a)) / 73_000 }, 400);
    await sleep(1200);
    s = await tg(page);
    sp = pickSpawn(s, prefer);
  }
  if (!sp) throw new Error('no regular shard nearby');
  return sp;
}

/** Point à `m` mètres de p, au cap `deg` (0 = nord). */
const offset = (p: LatLng, m: number, deg: number): LatLng => ({
  lat: p.lat + (m * Math.cos((deg * Math.PI) / 180)) / 111_000,
  lng: p.lng + (m * Math.sin((deg * Math.PI) / 180)) / 73_000,
});

const admin = (page: Page, path: string, data: unknown = {}) =>
  page.request.post(path, { data, headers: { Origin: ORIGIN, Authorization: `Bearer ${ADMIN}` } });

// ───────── Plans ─────────
let hookTakes = 0;
/** Facteur de ralenti du Lock-on (exporté dans marks.json pour le montage). */
const HOOK_SLOW = 4;
/** Ralenti des plans carte/feuilles (marchand, forge, événement, route). */
const SLOW_ALL = 3;
const CLIPS: Record<string, () => Promise<void>> = {
  /** Accroche : vol vers un éclat, Lock-on parfait, confettis, COMBO ×2, variante du Codex. */
  async hook() {
    const { ctx, page } = await phone();
    await enter(page, { skipTutorial: false });
    // capture n° 1 (tutoriel) hors caméra : arme le combo
    const tut = (await tg(page)).world!.spawns.find((x) => x.id.startsWith('tut:'))!;
    await glide(page, tut, 500);
    await page.getByTestId('action-btn').click();
    await playLockOn(page);
    await page.getByTestId('catch-continue').click();
    const skip = page.getByTestId('tutorial-skip');
    if (await skip.isVisible({ timeout: 1500 }).catch(() => false)) await skip.click();
    const sp = await findSpawn(page);
    // se placer à ~70 m pour que le vol soit à l'écran
    await glide(page, offset(sp, 70, 200), 400);
    await pause(2500);
    const rec = await record(page, 'hook');
    await pause(600);
    rec.mark('fly');
    await glide(page, sp, 1800);
    await pause(300);
    rec.mark('tap-catch');
    await tap(page, 'action-btn', { pause: 200 });
    await page.getByTestId('catch-screen').waitFor();
    // ralenti ×4 pendant le Lock-on et la révélation (le montage accélère ×HOOK_SLOW)
    await slowmo(page, 1 / HOOK_SLOW);
    rec.mark('lockon');
    await playLockOn(page);
    rec.mark('result');
    const res = ((await page.evaluate(() => (window as unknown as { __tg: () => { lastResult: { result?: string } | null } }).__tg().lastResult)) ?? {}).result;
    await sleep(3200 * HOOK_SLOW);
    rec.mark('continue');
    const cont = await page.getByTestId('catch-continue').isVisible().catch(() => false);
    await slowmo(page, 1);
    if (cont) await tap(page, 'catch-continue', { pause: 1600 });
    rec.mark('end');
    await rec.stop();
    await ctx.close();
    // l'accroche doit être un PERFECT du premier coup : sinon on retourne la prise
    const m = JSON.parse(readFileSync(`${RAW}/hook/marks.json`, 'utf8')) as { marks: { name: string; t: number }[]; frames: number[] };
    const [a, b] = ['lockon', 'result'].map((k) => m.marks.find((x) => x.name === k)!.t);
    const took = (b! - a!) / HOOK_SLOW;
    const fps = m.frames.filter((t) => t >= a! && t <= b!).length / Math.max(0.1, took);  // images par seconde *après* accélération
    log(`hook take: ${res}, ${took.toFixed(1)} s, ${fps.toFixed(0)} fps`);
    if ((!cont || res !== 'perfect' || took > 4 || fps < 24) && (hookTakes += 1) < 4) { log(`hook: ${res} in ${took.toFixed(1)} s → retake`); return CLIPS.hook!(); }
  },

  /** Marchands : bulles sur la carte, fiche, « Why this price? », puis marchandage avec la vraie carte « rival » → DEAL. */
  async market() {
    const { page } = await withPass();
    await enter(page);
    await slowAll(page, SLOW_ALL);
    const s = await tg(page);
    const markets = s.world!.nodes
      .filter((n) => n.kind === 'market' && n.merchant?.status === 'open')
      .sort((a, b) => dist(a, s.position!) - dist(b, s.position!) || a.id.localeCompare(b.id));
    // devoirs du joueur : il a vu les prix des deux échoppes ; on prend comme cible celle qui vend le plus cher
    type View = { name: string; prices: { family: Family; sell: number | null; stock: number }[] };
    const view = async (n: WorldNode) => (await (await page.request.get(`/api/merchant/${encodeURIComponent(n.merchant!.id)}`)).json()) as View;
    let duel: { T: WorldNode; R: View; f: Family } | null = null;
    const flux = s.me!.flux;
    for (let tries = 0; !duel && tries < 2; tries++) {
      const vs = await Promise.all(markets.slice(0, 2).map(async (n) => [n, await view(n)] as const));
      for (const f of COMMON) {
        for (const [i, j] of [[0, 1], [1, 0]] as const) {
          const t = vs[i]![1].prices.find((p) => p.family === f)!;
          const r = vs[j]![1].prices.find((p) => p.family === f)!;
          if (!duel && t.sell !== null && r.sell !== null && t.stock >= 5 && r.sell < t.sell && t.sell * 3 + 4 <= flux) duel = { T: vs[i]![0], R: vs[j]![1], f };
        }
      }
      if (!duel) { // prix identiques : un autre joueur achète chez le 2ᵉ pour faire monter son prix
        const other = await browser.newContext({ baseURL: ORIGIN });
        const h = { Origin: ORIGIN };
        await other.request.post('/auth/guest', { data: { demo: true }, headers: h });
        await other.request.post('/api/move', { data: { lat: markets[1]!.lat, lng: markets[1]!.lng, acc: 5 }, headers: h });
        const id = markets[1]!.merchant!.id;
        const q = await (await other.request.post(`/api/merchant/${id}/quote`, { data: { side: 'buy', family: 'deepseek', qty: 3 }, headers: h })).json() as { quoteId: string };
        const tr = await other.request.post(`/api/merchant/${id}/trade`, { data: { quoteId: q.quoteId }, headers: h });
        log('raise price at', markets[1]!.name, tr.status());
        await other.close();
      }
    }
    if (!duel) throw new Error('no haggle duel');
    const { T, f } = duel as { T: WorldNode; R: View; f: Family };
    log('market: target', T.name, 'family', f);
    // se placer au sud-ouest de la cible : échoppe + bulles à l'écran
    await glide(page, offset(T, 110, 200), 400);
    await pause(3500);
    const rec = await record(page, 'market');
    await pause(1500);
    rec.mark('fly');
    await glide(page, offset(T, 8, 200), 2000);
    await pause(900);
    rec.mark('open');
    // tap sur l'échoppe elle-même (position projetée par la carte), sinon ouverture directe
    const pt = await page.evaluate(([lat, lng]) => {
      const m = (window as unknown as { __tgMap?: { project: (c: [number, number]) => { x: number; y: number }; getContainer: () => HTMLElement } }).__tgMap;
      if (!m) return null;
      const p = m.project([lng!, lat!]);
      const b = m.getContainer().getBoundingClientRect();
      return { x: b.left + p.x, y: b.top + p.y - 16 };
    }, [T.lat, T.lng]);
    if (pt) { await finger(page, pt.x, pt.y); await pause(140); await page.mouse.click(pt.x, pt.y); }
    if (!(await page.getByTestId('merchant-sheet').isVisible({ timeout: 1500 }).catch(() => false))) {
      await page.evaluate((id) => (window as unknown as { __tgOpen: (i: string) => boolean }).__tgOpen(id), T.merchant!.id);
    }
    await page.getByTestId('merchant-sheet').waitFor();
    await page.getByTestId(`row-${f}`).waitFor();
    await pause(1800);
    rec.mark('why');
    await tap(page, `why-${f}`, { pause: 3200 });
    rec.mark('buy');
    await page.mouse.click(10, 300).catch(() => {}); // referme la bulle d'explication
    await pause(300);
    await tap(page, `buy-${f}`, { pause: 900 });
    const panel = page.getByTestId('trade-panel');
    const more = panel.getByRole('button', { name: 'More' });
    for (let i = 1; i < 3; i++) {
      const b = (await more.boundingBox())!;
      await finger(page, b.x + b.width / 2, b.y + b.height / 2);
      await pause(140);
      await more.click();
      await pause(450);
    }
    await pause(500);
    rec.mark('haggle');
    await tap(page, 'haggle-btn', { pause: 1800 });
    rec.mark('rival');
    await tap(page, 'haggle-card-rival', { pause: 2600 });
    rec.mark('deal');
    await tap(page, 'haggle-deal', { pause: 200 });
    await page.getByTestId('haggle-stamp').waitFor();
    rec.mark('stamp');
    await pause(2600);
    rec.mark('end');
    await rec.stop();
  },

  /** Forge (pass démo) : recette Spark → maintien → ticket de crédit → « Try it now » → réponse du Playground. */
  async forge() {
    const { page } = await withPass();
    await enter(page);
    await slowAll(page, SLOW_ALL);
    const forge = (await tg(page)).world!.nodes.find((n) => n.id === 'forge:louvre')!;
    await glide(page, offset(forge, 120, 160), 400);
    await pause(3000);
    const rec = await record(page, 'forge');
    await pause(1200);
    rec.mark('fly');
    await glide(page, offset(forge, 10, 160), 2000);
    await pause(800);
    rec.mark('open');
    await page.evaluate(() => (window as unknown as { __tgOpen: (i: string) => boolean }).__tgOpen('forge:louvre'));
    await page.getByTestId('forge-screen').waitFor();
    await pause(1400);
    await tap(page, 'recipe-spark', { pause: 1500 });
    rec.mark('hold');
    await holdTap(page, 'compile-btn', 1500);
    await page.getByTestId('credit-ticket').waitFor({ timeout: 60_000 });
    rec.mark('ticket');
    await pause(3800);
    rec.mark('try');
    await tap(page, 'try-now', { pause: 1500 });
    const prompt = page.getByTestId('prompt');
    await prompt.waitFor();
    await prompt.scrollIntoViewIfNeeded();
    const pb = (await prompt.boundingBox())!;
    await finger(page, pb.x + pb.width / 2, pb.y + pb.height / 2);
    await prompt.click();
    await prompt.fill('');
    rec.mark('type');
    await prompt.pressSequentially('Write a haiku about catching AI in Paris.', { delay: 45 * K });
    await pause(500);
    rec.mark('ask');
    await tap(page, 'ask-btn', { pause: 300 });
    await page.getByTestId('answer').waitFor({ timeout: 60_000 });
    await page.getByTestId('answer').scrollIntoViewIfNeeded();
    rec.mark('answer');
    await pause(4500);
    rec.mark('end');
    await rec.stop();
  },

  /** Ville vivante : marcheurs, puis flash crash déclenché par l'admin (zone + bannière + bulles), fiche à −40 %. */
  async event() {
    const { ctx, page } = await phone();
    await admin(page, '/api/admin/event/end');
    await enter(page);
    await slowAll(page, SLOW_ALL);
    const s = await tg(page);
    const market = s.world!.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open').sort((a, b) => dist(a, LOUVRE) - dist(b, LOUVRE))[0]!;
    await glide(page, { lat: market.lat + 0.0004, lng: market.lng + 0.0008 }, 400);
    await pause(6000); // marcheurs chargés
    const rec = await record(page, 'event');
    await pause(3500);
    rec.mark('crash');
    const r = await admin(page, '/api/admin/event', { kind: 'flash_crash', family: 'deepseek', zone: 'louvre', minutes: 20 });
    if (!r.ok()) throw new Error(await r.text());
    await page.getByTestId('event-banner').waitFor({ timeout: 8000 });
    rec.mark('banner');
    await pause(5500);
    rec.mark('fly');
    await glide(page, offset(market, 8, 200), 1800);
    await pause(500);
    await page.evaluate((id) => (window as unknown as { __tgOpen: (i: string) => boolean }).__tgOpen(id), market.merchant!.id);
    await page.getByTestId('merchant-sheet').waitFor();
    rec.mark('sheet');
    await pause(1500);
    await tap(page, 'why-deepseek', { pause: 3500 });
    rec.mark('end');
    await rec.stop();
    await admin(page, '/api/admin/event/end');
    await ctx.close();
  },

  /** Daily Route : la puce, la boucle en pointillés, les arrêts survolés un par un → « Loop complete! ». */
  async route() {
    const { ctx, page } = await phone();
    await enter(page);
    await slowAll(page, SLOW_ALL);
    await page.waitForFunction(() => !!(window as unknown as { __tg: () => TG }).__tg().route, null, { timeout: 20_000 });
    await pause(1000);
    const rec = await record(page, 'route');
    await pause(800);
    rec.mark('sheet');
    await tap(page, 'route-chip', { pause: 2600 });
    await tap(page, 'sheet-close', { pause: 600 });
    rec.mark('walk');
    const stops = (await tg(page)).route!.stops;
    for (const st of stops) {
      if ((await tg(page)).route?.stops.find((x) => x.id === st.id)?.done) continue;
      await glide(page, st, 2200);
      await page.waitForFunction((id) => !!(window as unknown as { __tg: () => TG }).__tg().route?.stops.find((x) => x.id === id)?.done, st.id, { timeout: 8000 });
      rec.mark('stop');
      await pause(700);
    }
    await page.getByTestId('route-complete').waitFor({ timeout: 8000 });
    rec.mark('complete');
    await pause(3500);
    rec.mark('end');
    await rec.stop();
    await ctx.close();
  },

  /** Economy Lab : une semaine de Paris simulée dans le navigateur, scénario « DeepSeek flood ». */
  async lab() {
    const { ctx, page } = await phone();
    await page.goto('/lab');
    await page.getByTestId('lab-meta').waitFor({ timeout: 90_000 });
    await pause(800);
    const rec = await record(page, 'lab');
    await pause(800);
    rec.mark('scenario');
    await tap(page, 'scen-flood-deepseek', { pause: 900 });
    rec.mark('run');
    await tap(page, 'lab-run', { pause: 200 });
    await page.getByTestId('lab-run').filter({ hasText: 'Simulate 1 week' }).waitFor({ timeout: 90_000 });
    rec.mark('done');
    await pause(2500);
    // descendre sur les graphes
    await page.mouse.wheel(0, 0);
    await page.evaluate(() => document.querySelector('[data-testid="chart-prices"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    rec.mark('charts');
    await pause(4000);
    rec.mark('end');
    await rec.stop();
    await ctx.close();
  },

  /** Plan « ordinateur portable » : la page d'accueil sur grand écran (cadre de téléphone + panneau). */
  async desktop() {
    const { ctx, page } = await phone({ viewport: { width: 1440, height: 900 }, mobile: false });
    await page.goto('/');
    await page.getByTestId('splash').waitFor();
    await pause(2500);
    const rec = await record(page, 'desktop');
    await pause(4000);
    rec.mark('end');
    await rec.stop();
    await ctx.close();
  },
};

async function main() {
  mkdirSync(RAW, { recursive: true });
  const want = process.argv.slice(2);
  const names = want.length ? want : Object.keys(CLIPS);
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const n of names) {
      if (!CLIPS[n]) throw new Error(`unknown clip ${n}`);
      log('▶', n);
      K = 1;
      await CLIPS[n]!();
    }
  } finally {
    if (passSession) await (await passSession).ctx.close().catch(() => {});
    await browser.close();
  }
}

await main();
