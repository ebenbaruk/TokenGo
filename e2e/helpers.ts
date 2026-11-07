// Aides partagées des specs E2E. La carte WebGL n'est pas lisible : on lit l'état via window.__tg,
// on se déplace via window.__tgWalk (Demo Walk) et on ouvre un lieu via window.__tgOpen.
import { existsSync, readFileSync } from 'node:fs';
import { test as base, expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

export const PORT = Number(process.env.E2E_PORT ?? 8788);
export const ORIGIN = `http://localhost:${PORT}`;
export const ADMIN_TOKEN = 'e2e-admin';
export const DEMO_TOKEN = 'e2e-judge';
export const LOUVRE = { lat: 48.8611, lng: 2.3358 };

export type Family = 'deepseek' | 'qwen' | 'gemini' | 'gpt' | 'claude';
export interface LatLng { lat: number; lng: number }
export interface Spawn extends LatLng { id: string; family: Family; expiresAt: number }
export interface WorldNode extends LatLng { id: string; kind: 'relay' | 'market' | 'forge'; name: string; merchant?: { id: string; status: string } }
export interface Me { id: string; handle: string; mode: string; flux: number; level: number; shards: Record<Family, number>; tutorial: Record<string, boolean>; credits: { limitNusd: number } }
export interface TG {
  phase: string;
  me: Me | null;
  world: { spawns: Spawn[]; nodes: WorldNode[] } | null;
  position: (LatLng & { acc: number }) | null;
  lastResult: Record<string, unknown> | null;
  overlay: string | null;
  demo: boolean;
  gps: string;
  toasts: string[];
}
export interface PriceRow { family: Family; specialty: boolean; stock: number; target: number; sell: number | null; buy: number | null; buyBlocked?: string; sellBlocked?: string }
export interface MerchantView { id: string; name: string; status: 'open' | 'closing' | 'closed'; flux: number; prices: PriceRow[] }

const DIST = new URL('../apps/web/dist/', import.meta.url).pathname;
const MIME: Record<string, string> = {
  js: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png', webp: 'image/webp',
  woff: 'font/woff', woff2: 'font/woff2', webmanifest: 'application/manifest+json',
};

/**
 * `test` des specs : les fichiers statiques du build (assets/, art/, map/) sont servis depuis le disque au lieu du
 * serveur. Raison : le rate limit global du serveur (120 req/min par IP) compte aussi les ~21 fichiers statiques
 * de chaque chargement de page — enchaîner les specs depuis 127.0.0.1 finit en 429 (voir rapport).
 * Les documents HTML et toute l'API passent toujours par le vrai serveur (en-têtes CSP compris).
 */
export const test = base.extend<{ staticFromDisk: void }>({
  staticFromDisk: [async ({ context }, use) => {
    await context.route(new RegExp(`^http://localhost:${PORT}/(assets|art|map)/[^?#]+`), async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '');
      const file = DIST + path;
      if (path.includes('..') || !existsSync(file)) return route.fallback();
      await route.fulfill({ status: 200, body: readFileSync(file), contentType: MIME[path.split('.').pop()!] ?? 'application/octet-stream' });
    });
    await use();
  }, { auto: true }],
});
export { expect };

export const tg = (page: Page) => page.evaluate(() => (window as unknown as { __tg: () => TG }).__tg());
export const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/__shots__/${name}.png` });
export const dist = (a: LatLng, b: LatLng) => Math.hypot((a.lat - b.lat) * 111_000, (a.lng - b.lng) * 73_000);
export const open = (page: Page, id: string) => page.evaluate((x) => (window as unknown as { __tgOpen: (i: string) => boolean }).__tgOpen(x), id);
export const merchantIdOf = (nodeId: string) => `m-${nodeId.replace(/^osm:/, '').replace('/', '-')}`;

/** Nœuds du monde (fichier statique, identique côté serveur). */
export function worldNodes(): WorldNode[] {
  const w = JSON.parse(readFileSync(new URL('../data/world/paris.json', import.meta.url), 'utf8')) as { nodes: WorldNode[] };
  return w.nodes;
}

/** Collecte les erreurs JS non rattrapées de la page. */
export function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Splash → « Play as guest » (Demo Walk si demandé) → carte chargée avec le monde. */
export async function startGuest(page: Page, url: string | null = '/?demo=1') {
  if (url !== null) await page.goto(url);
  await expect(page.getByTestId('splash')).toBeVisible();
  await page.getByTestId('play-guest').click();
  const demoBtn = page.getByTestId('use-demo');
  if (await demoBtn.isVisible({ timeout: 2000 }).catch(() => false)) await demoBtn.click();
  await expect(page.getByTestId('map')).toBeVisible();
  await waitWorld(page);
}

export const waitWorld = (page: Page) =>
  page.waitForFunction(() => !!(window as unknown as { __tg: () => TG }).__tg().world?.spawns.length, null, { timeout: 20_000 });

const near = (a: number, b: number) => Math.abs(a - b) < 1e-7;

/**
 * Demo Walk (saut de 300 ms) jusqu'à p, puis attend que le serveur ait reçu cette position exacte
 * (le client force l'envoi à l'arrivée). Avec `world`, attend aussi le /api/world centré sur p.
 */
export async function walk(page: Page, p: LatLng, opts: { world?: boolean } = {}) {
  const moved = page.waitForResponse((r) => {
    if (!r.url().endsWith('/api/move') || r.request().method() !== 'POST') return false;
    const b = r.request().postDataJSON() as LatLng;
    return near(b.lat, p.lat) && near(b.lng, p.lng);
  });
  const world = opts.world
    ? page.waitForResponse((r) => {
      if (!r.url().includes('/api/world?')) return false;
      const q = new URL(r.url()).searchParams;
      return Math.abs(Number(q.get('lat')) - p.lat) < 2e-6 && Math.abs(Number(q.get('lng')) - p.lng) < 2e-6;
    }, { timeout: 20_000 })
    : null;
  await page.evaluate(([lat, lng]) => (window as unknown as { __tgWalk: (a: number, b: number) => void }).__tgWalk(lat!, lng!), [p.lat, p.lng]);
  expect((await moved).ok()).toBe(true);
  if (world) {
    await world;
    // laisser le store appliquer la réponse
    await page.waitForFunction(() => !!(window as unknown as { __tg: () => TG }).__tg().world);
  }
}

/** Vrai glissé tactile (CDP Input.dispatchTouchEvent), comme un doigt sur téléphone. */
export async function drag(page: Page, selector: string, dx: number) {
  await page.waitForTimeout(700); // fin de l'animation d'ouverture de la feuille
  const box = (await page.locator(selector).boundingBox())!;
  const x0 = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', x0);
  for (let i = 1; i <= 20; i++) { await touch('touchMove', x0 + (dx * i) / 20); await page.waitForTimeout(16); }
  await touch('touchEnd', x0 + dx);
  await cdp.detach();
}

/** Maintient un bouton « Hold to … » (HoldButton : 1 s). */
export async function hold(page: Page, testId: string, ms = 1400) {
  const b = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/**
 * Mini-jeu Lock-on : tape (pointerdown) au moment où l'anneau passe sur le cercle cible (scale ≈ 1),
 * en lisant la transform de l'anneau à chaque frame — déterministe, pas de timing côté Node.
 */
export async function tapOnTarget(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      const screen = document.querySelector('[data-testid="catch-screen"]');
      if (!screen) return reject(new Error('catch screen closed'));
      if (screen.querySelector('[data-testid="catch-result"]')) return resolve();
      const ring = [...screen.querySelectorAll<HTMLElement>('div')].find((d) => d.style.transform.includes('scale('));
      const m = ring ? /scale\(([\d.]+)\)/.exec(ring.style.transform) : null;
      if (m && performance.now() - t0 > 400 && Math.abs(Number(m[1]) - 1) < 0.03) {
        screen.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        return resolve();
      }
      if (performance.now() - t0 > 15_000) return reject(new Error('ring never reached the target'));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

/** POST JSON avec l'Origin du site (le serveur refuse toute écriture sans Origin valide). */
export const post = (req: APIRequestContext, path: string, data: unknown = {}): Promise<APIResponse> =>
  req.post(path, { data, headers: { Origin: ORIGIN } });

/** Autre joueur piloté par l'API : crée la session (cookie dans `req`) et renvoie son profil. */
export async function apiGuest(req: APIRequestContext, opts: { demo?: boolean; token?: string } = { demo: true }): Promise<Me> {
  const r = await post(req, '/auth/guest', opts);
  expect(r.ok(), await r.text()).toBe(true);
  const j = (await r.json()) as Me & { me?: Me };
  return j.me ?? j;
}

export async function apiMove(req: APIRequestContext, p: LatLng) {
  const r = await post(req, '/api/move', { lat: p.lat, lng: p.lng, acc: 5 });
  expect(r.ok(), await r.text()).toBe(true);
}

export async function apiMerchant(req: APIRequestContext, id: string): Promise<MerchantView> {
  const r = await req.get(`/api/merchant/${encodeURIComponent(id)}`);
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as MerchantView;
}

export async function apiQuote(req: APIRequestContext, merchantId: string, side: 'buy' | 'sell', family: Family, qty: number) {
  return post(req, `/api/merchant/${encodeURIComponent(merchantId)}/quote`, { side, family, qty });
}

/** Devis + trade par l'API ; renvoie le total payé/reçu. */
export async function apiTrade(req: APIRequestContext, merchantId: string, side: 'buy' | 'sell', family: Family, qty: number): Promise<number> {
  const q = await apiQuote(req, merchantId, side, family, qty);
  expect(q.ok(), await q.text()).toBe(true);
  const { quoteId } = (await q.json()) as { quoteId: string };
  const t = await post(req, `/api/merchant/${encodeURIComponent(merchantId)}/trade`, { quoteId });
  expect(t.ok(), await t.text()).toBe(true);
  return ((await t.json()) as { total: number }).total;
}
