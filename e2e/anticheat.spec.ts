// Anti-triche : invité GPS (pas de Demo Walk) au Louvre, téléporté à ~5 km en 2 s → le serveur marque le saut
// suspect, les actions sont bloquées (soft-lock) avec un message neutre, et l'app ne plante pas.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test, LOUVRE, apiMerchant, dist, merchantIdOf, pageErrors, post, shot, tg, worldNodes, type WorldNode } from './helpers.ts';

/**
 * Marché ouvert le plus proche de 5 km du Louvre (choix déterministe), sans éclat à portée dans la fenêtre de spawn
 * courante : sinon le bouton contextuel propose « Catch » (priorité éclat > marché) et le test dépend de l'heure.
 */
async function farMarket(page: Page): Promise<WorldNode> {
  const cands = worldNodes()
    .filter((n) => n.kind === 'market' && Math.abs(dist(n, LOUVRE) - 5000) < 500)
    .sort((a, b) => Math.abs(dist(a, LOUVRE) - 5000) - Math.abs(dist(b, LOUVRE) - 5000) || a.id.localeCompare(b.id));
  for (const n of cands) {
    const m = await apiMerchant(page.request, merchantIdOf(n.id));
    if (m.status !== 'open' || !m.prices.some((p) => p.sell !== null && p.stock > 0)) continue;
    const w = (await (await page.request.get(`/api/world?lat=${n.lat}&lng=${n.lng}`)).json()) as { spawns: { lat: number; lng: number }[] };
    if (w.spawns.some((sp) => dist(sp, n) < 80)) continue;
    return { ...n, merchant: { id: m.id, status: m.status } };
  }
  throw new Error('no open market ~5 km from the Louvre');
}

/** Démarre en mode GPS (géolocalisation simulée au Louvre par la config). */
async function startGps(page: Page) {
  await page.goto('/');
  await page.getByTestId('play-guest').click();
  await expect(page.getByTestId('location-explainer')).toBeVisible();
  await page.getByTestId('allow-location').click();
  await expect(page.getByTestId('map')).toBeVisible();
  await page.waitForFunction(() => {
    const s = (window as unknown as { __tg: () => { gps: string; demo: boolean; world: unknown } }).__tg();
    return s.gps === 'ok' && !s.demo && !!s.world;
  }, null, { timeout: 20_000 });
}

/**
 * Téléportation : la position GPS saute à `to` et y reste (petites variations comme un vrai GPS, ≈ 1 fix/s),
 * jusqu'à ce que le serveur ait répondu « suspicious » à un /api/move ET que la position lissée du client
 * (moyenne des 3 derniers fixes) soit arrivée.
 */
async function teleport(page: Page, context: BrowserContext, to: { lat: number; lng: number }) {
  let flagged: Record<string, unknown> | null = null;
  const onResp = async (r: import('@playwright/test').Response) => {
    if (r.url().endsWith('/api/move') && r.ok()) {
      const j = (await r.json()) as Record<string, unknown>;
      if (j.suspicious === true) flagged = j;
    }
  };
  page.on('response', onResp);
  const toasts = new Set<string>();
  const t0 = Date.now();
  try {
    for (let i = 0; Date.now() - t0 < 30_000; i++) {
      await context.setGeolocation({ latitude: to.lat + (i % 2) * 1e-6, longitude: to.lng, accuracy: 10 });
      await page.waitForTimeout(700);
      const s = await tg(page);
      s.toasts.forEach((t) => toasts.add(t));
      if (flagged && dist(s.position!, to) < 5) break;
    }
    // le toast du saut part juste après la réponse : on le laisse apparaître
    await expect.poll(async () => { (await tg(page)).toasts.forEach((t) => toasts.add(t)); return toasts.size; }).toBeGreaterThan(0);
  } finally {
    page.off('response', onResp);
  }
  expect(flagged, 'the server flagged the jump').toBeTruthy();
  return { move: flagged!, toasts: [...toasts] };
}

test.describe('anti-cheat: teleport 5 km', () => {
  test('actions are soft-locked after a 5 km jump, no crash', async ({ page, context }) => {
    const errors = pageErrors(page);
    await startGps(page);
    const start = (await tg(page)).position!;
    expect(dist(start, LOUVRE)).toBeLessThan(30);
    await shot(page, 'anticheat-01-louvre');

    const target = await farMarket(page);
    expect(dist(target, LOUVRE)).toBeGreaterThan(4500);
    const { move, toasts } = await teleport(page, context, target);
    expect(move.suspicious).toBe(true);
    expect(move.inTransit).toBe(false);
    // le client prévient le joueur, sans planter
    expect(toasts.join(' | ')).toMatch(/paused|Re-syncing/i);
    // le client a bien rejoint la nouvelle position (GPS lissé), le monde suit
    await expect.poll(async () => dist((await tg(page)).position!, target), { timeout: 15_000 }).toBeLessThan(20);
    await expect.poll(async () => (await tg(page)).world!.nodes.some((n) => n.id === target.id), { timeout: 15_000 }).toBe(true);

    // le client croit pouvoir commercer (à portée)… mais le serveur bloque toute action
    await expect(page.getByTestId('action-btn')).toHaveText(/Trade/);
    await expect(page.getByTestId('action-btn')).toBeEnabled();
    await page.getByTestId('action-btn').click();
    await expect(page.getByTestId('merchant-sheet')).toBeVisible();
    const m = await apiMerchant(page.request, target.merchant!.id);
    const fam = m.prices.filter((p) => p.sell !== null && p.stock > 0).sort((a, b) => a.sell! - b.sell!)[0]!;
    await page.getByTestId(`buy-${fam.family}`).click();
    const panel = page.getByTestId('trade-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('quote-total')).toContainText(/paused|Re-syncing/i);
    await expect(page.getByTestId('slide-confirm')).toHaveAttribute('tabindex', '-1'); // désactivé
    await shot(page, 'anticheat-02-blocked');

    // côté serveur : SUSPICIOUS_MOVE, message neutre, sur toutes les actions
    const q = await post(page.request, `/api/merchant/${encodeURIComponent(target.merchant!.id)}/quote`, { side: 'buy', family: fam.family, qty: 1 });
    expect(q.ok()).toBe(false);
    const err = ((await q.json()) as { error: { code: string; message: string } }).error;
    expect(err.code).toBe('SUSPICIOUS_MOVE');
    expect(err.message).toMatch(/^Re-syncing your position/);
    const spawn = (await tg(page)).world!.spawns[0];
    if (spawn) {
      const c = await post(page.request, '/api/catch/start', { spawnId: spawn.id });
      expect(((await c.json()) as { error: { code: string } }).error.code).toBe('SUSPICIOUS_MOVE');
    }

    // pas de plantage : la carte et le HUD sont toujours là
    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('map')).toBeVisible();
    await expect(page.getByTestId('action-btn')).toBeVisible();
    await shot(page, 'anticheat-03-map');
    expect(errors).toEqual([]);
  });

  // Repro : invité GPS au Louvre, setGeolocation à 5 km → toast « That jump looked odd… » ; ouvrir un marchand → idem.
  test('the soft-lock message is neutral ("Re-syncing your position…")', async ({ page, context }) => {
    await startGps(page);
    const target = await farMarket(page);
    const { toasts } = await teleport(page, context, target);
    expect(toasts.join(' | ')).toMatch(/Re-syncing your position/);
    await expect.poll(async () => dist((await tg(page)).position!, target), { timeout: 15_000 }).toBeLessThan(20);
    await page.getByTestId('action-btn').click();
    const m = await apiMerchant(page.request, target.merchant!.id);
    const fam = m.prices.find((p) => p.sell !== null && p.stock > 0)!;
    await page.getByTestId(`buy-${fam.family}`).click();
    await expect(page.getByTestId('quote-total')).toContainText('Re-syncing your position');
    await expect(page.getByText(/looked odd/)).toHaveCount(0);
  });
});
