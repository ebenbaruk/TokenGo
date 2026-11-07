// Carte vivante : marcheurs animés autour du Louvre (tap → étiquette), bulles des marchands, événement de ville
// déclenché par l'admin (zone sur la carte + bannière + prix qui baisse + « Why this price? ») et visible dans le Pulse.
import type { Page } from '@playwright/test';
import {
  expect, test, ADMIN_TOKEN, ORIGIN, LOUVRE, apiMerchant, dist, open, pageErrors, shot, startGuest, tg, walk, type LatLng,
} from './helpers.ts';

interface Walker { id: string; kind: 'runner' | 'player'; name: string | null; from: LatLng; to: LatLng; departAt: number; arriveAt: number; note: string | null }
const walkers = async (page: Page) => ((await tg(page)) as unknown as { walkers: Walker[] }).walkers;
const rendered = (page: Page, layer: string) => page.evaluate((l) => {
  const map = (window as unknown as { __tgMap: { queryRenderedFeatures: (o: { layers: string[] }) => unknown[] } }).__tgMap;
  return map.queryRenderedFeatures({ layers: [l] }).length;
}, layer);
/** Joue sans le coach du tutoriel (captures lisibles). */
async function play(page: Page) {
  await startGuest(page);
  const skip = page.getByTestId('tutorial-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}
const admin = (page: Page, path: string, data: unknown = {}) =>
  page.request.post(path, { data, headers: { Origin: ORIGIN, Authorization: `Bearer ${ADMIN_TOKEN}` } });

test.afterAll(async ({ request }) => {
  // ne pas laisser un événement actif pour les specs suivantes (prix du Louvre)
  await request.post('/api/admin/event/end', { headers: { Origin: ORIGIN, Authorization: `Bearer ${ADMIN_TOKEN}` } });
});

test('walkers walk around the Louvre, a tap shows who they are', async ({ page }) => {
  const errors = pageErrors(page);
  await play(page);
  await expect.poll(async () => (await walkers(page)).filter((w) => w.kind === 'runner').length, { timeout: 20_000 }).toBeGreaterThan(0);
  const list = await walkers(page);
  // on se place à ~40 m au sud du runner le plus proche : il est à l'écran, au-dessus de l'avatar
  const now = Date.now();
  const here = (w: Walker) => {
    const k = w.arriveAt > w.departAt ? Math.min(1, Math.max(0, (now - w.departAt) / (w.arriveAt - w.departAt))) : 1;
    return { lat: w.from.lat + (w.to.lat - w.from.lat) * k, lng: w.from.lng + (w.to.lng - w.from.lng) * k };
  };
  const nearest = list.filter((w) => w.kind === 'runner').sort((a, b) => dist(here(a), LOUVRE) - dist(here(b), LOUVRE))[0]!;
  const p = here(nearest);
  await walk(page, { lat: p.lat - 0.00036, lng: p.lng }, { world: true });
  await page.waitForTimeout(1200); // caméra
  expect(list.length).toBeLessThanOrEqual(12);
  // de vrais trajets à vitesse de marche (5 km/h), pas des points fixes
  for (const w of list.filter((x) => x.arriveAt > x.departAt)) {
    expect(dist(w.from, w.to) / ((w.arriveAt - w.departAt) / 1000)).toBeLessThan(1.45);
  }
  await expect.poll(() => rendered(page, 'walkers'), { timeout: 10_000 }).toBeGreaterThan(0);
  await shot(page, 'living-01-walkers');

  // tap sur le marcheur affiché le plus proche du centre de l'écran
  const target = await page.evaluate(() => {
    const map = (window as unknown as { __tgMap: { queryRenderedFeatures: (o: { layers: string[] }) => { properties: { id: string; idle: number }; geometry: { coordinates: [number, number] } }[]; project: (c: [number, number]) => { x: number; y: number }; getContainer: () => HTMLElement } }).__tgMap;
    const box = map.getContainer().getBoundingClientRect();
    const fs = map.queryRenderedFeatures({ layers: ['walkers'] }).map((f) => { const p = map.project(f.geometry.coordinates); return { id: f.properties.id, p: { x: p.x + (f.properties.idle === 1 ? 24 : 0), y: p.y } }; })
      .filter((f) => f.p.y > 180 && f.p.y < box.height - 200 && f.p.x > 30 && f.p.x < box.width - 30)
      .sort((a, b) => Math.hypot(a.p.x - box.width / 2, a.p.y - box.height / 2) - Math.hypot(b.p.x - box.width / 2, b.p.y - box.height / 2));
    return fs[0] ? { id: fs[0].id, x: box.left + fs[0].p.x, y: box.top + fs[0].p.y - 14 } : null;
  });
  expect(target, 'a walker on screen').toBeTruthy();
  await page.mouse.click(target!.x, target!.y);
  const tag = page.getByTestId('walker-tag');
  await expect(tag).toBeVisible();
  const w = (await walkers(page)).find((x) => x.id === target!.id)!;
  await expect(tag).toContainText(w.name ?? 'Another player');
  await shot(page, 'living-02-tag');
  expect(errors).toEqual([]);
});

test('merchants talk: a struggling shop calls for help in a comic bubble', async ({ page }) => {
  const errors = pageErrors(page);
  await play(page);
  const s = await tg(page);
  const struggler = s.world!.nodes.find((n) => n.kind === 'market' && n.merchant && n.merchant.status !== 'open');
  expect(struggler, 'the seeded struggling merchant near the Louvre').toBeTruthy();
  // à ~60 m au sud : l'échoppe est à l'écran au-dessus de l'avatar, la bulle doit apparaître au-dessus d'elle
  await walk(page, { lat: struggler!.lat - 0.00055, lng: struggler!.lng }, { world: true });
  const bubbles = page.getByTestId('merchant-bubble');
  await expect(bubbles.filter({ hasText: /help|invest|Last days|investor|empty|Rescue/i }).first()).toBeVisible({ timeout: 15_000 });
  expect(await bubbles.count()).toBeLessThanOrEqual(3);
  await page.waitForTimeout(500); // fin de l'animation d'apparition
  await shot(page, 'living-03-bubbles');
  // la bulle est un raccourci vers le marchand (Demo Walk : « Jump there » d'abord, il est à 60 m)
  await bubbles.filter({ hasText: /help|invest|Last days|investor|empty|Rescue/i }).first().click({ force: true }); // elle se dandine
  await expect(page.getByTestId('jump-sheet')).toContainText(struggler!.name);
  expect(errors).toEqual([]);
});

test('admin-triggered flash crash: zone on the map, banner, cheaper DeepSeek, explained, in the Pulse', async ({ page }) => {
  const errors = pageErrors(page);
  await play(page);
  const s = await tg(page);
  const market = s.world!.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open').sort((a, b) => dist(a, LOUVRE) - dist(b, LOUVRE))[0]!;
  const before = (await apiMerchant(page.request, market.merchant!.id)).prices.find((p) => p.family === 'deepseek')!;
  expect(before.sell).not.toBeNull();

  expect((await page.request.post('/api/admin/event', { data: { kind: 'flash_crash' }, headers: { Origin: ORIGIN } })).status()).toBe(403);
  const r = await admin(page, '/api/admin/event', { kind: 'flash_crash', family: 'deepseek', zone: 'louvre', minutes: 20 });
  expect(r.ok(), await r.text()).toBe(true);

  // poussé par SSE : la bannière arrive sans attendre le rafraîchissement du monde
  const banner = page.getByTestId('event-banner');
  await expect(banner).toBeVisible({ timeout: 6_000 });
  await expect(banner).toContainText('Flash crash at the Louvre');
  await expect(banner).toContainText('DeepSeek prices −40%');
  await expect(banner).toContainText('in the zone');
  await expect.poll(() => rendered(page, 'event-fill'), { timeout: 5_000 }).toBeGreaterThan(0);
  // les marchands de la zone en parlent (on se place au nord-est du plus proche : sa bulle est à l'écran, hors du HUD)
  await walk(page, { lat: market.lat + 0.0004, lng: market.lng + 0.0008 }, { world: true });
  await expect(page.getByTestId('merchant-bubble').filter({ hasText: /DeepSeek|crash/i }).first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot(page, 'living-04-event-map');

  // le prix baisse vraiment (serveur), et la fiche le dit
  const after = (await apiMerchant(page.request, market.merchant!.id)).prices.find((p) => p.family === 'deepseek')!;
  expect(after.sell!).toBeLessThan(before.sell! * 0.7);
  await walk(page, market);
  await open(page, market.merchant!.id);
  await expect(page.getByTestId('merchant-sheet')).toBeVisible();
  await expect(page.getByTestId('event-chip-deepseek')).toContainText('−40%');
  await expect(page.getByTestId('buy-deepseek')).toContainText(String(after.sell));
  await page.getByTestId('why-deepseek').click();
  await expect(page.getByTestId('why-popover')).toContainText('Flash crash at the Louvre');
  await page.waitForTimeout(400);
  await shot(page, 'living-05-merchant-event');

  // City Pulse : l'événement en cours et les marcheurs
  await page.goto('/pulse');
  await expect(page.getByTestId('pulse-city-event')).toContainText('Flash crash at the Louvre');
  await expect(page.getByTestId('pulse-walkers')).toContainText('runner-agents');
  await expect(page.getByTestId('pulse-ticker')).toContainText('Flash crash at the Louvre — 20 min: DeepSeek prices −40%');
  await shot(page, 'living-06-pulse');

  // fin : la zone et la bannière disparaissent
  expect((await admin(page, '/api/admin/event/end')).ok()).toBe(true);
  await page.goto('/?demo=1');
  await startGuest(page, null).catch(() => {});
  await expect(page.getByTestId('event-banner')).toHaveCount(0);
  expect(errors).toEqual([]);
});
