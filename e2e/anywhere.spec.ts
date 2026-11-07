// Monde « partout » et Remote Scout.
// 1. Joueur GPS à Lisbonne : Overpass injoignable (config e2e) → quartier procédural généré en fond (« Scouting… »),
//    puis capture et vente chez un marchand généré.
// 2. Remote Scout : la batterie se vide (Dash), le serveur refuse le vol de trop, le Scout est cloué au sol, puis repart.
import { offsetM } from '@tokengo/shared';
import { proceduralRegion, regionOf } from '../apps/server/src/game/worldgen.ts';
import { expect, test, drag, open, pageErrors, shot, startGuest, tapOnTarget, tg, walk, type TG } from './helpers.ts';

const LISBON = { lat: 38.7107, lng: -9.1365 };
// repli procédural déterministe : on démarre 10 m au sud d'un marchand généré (pas besoin de marcher en GPS simulé)
const MARKET = proceduralRegion(regionOf(LISBON.lat, LISBON.lng)).nodes.filter((n) => n.kind === 'market')[0]!;
const START = offsetM(MARKET, 0, -10);

interface ScoutTG extends TG { scout: { battery: number; at: number; grounded: boolean } | null; world: TG['world'] & { region?: { status: string; source: string | null } } }
const stg = (page: import('@playwright/test').Page) => tg(page) as Promise<ScoutTG>;

test.describe('play anywhere (real GPS, outside Paris)', () => {
  test.use({ geolocation: { latitude: START.lat, longitude: START.lng, accuracy: 8 } });

  test('a GPS player in Lisbon: neighbourhood is scouted, then catch + sell work there', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = pageErrors(page);
    expect(regionOf(START.lat, START.lng)).toBe(MARKET.region);
    await page.goto('/');
    await expect(page.getByTestId('mode-explainer')).toContainText('Remote Scout lets you try it from your couch');
    await page.getByTestId('play-guest').click();
    await page.getByTestId('allow-location').click();
    await expect(page.getByTestId('map')).toBeVisible();
    // 1ʳᵉ réponse /api/world : génération lancée en fond
    await expect(page.getByTestId('scouting')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('mode-badge')).toHaveText(/Walking/);
    await shot(page, 'anywhere-01-scouting');
    await expect(page.getByTestId('scouting')).toBeHidden({ timeout: 15_000 });
    await page.waitForFunction(() => {
      const s = (window as unknown as { __tg: () => ScoutTG }).__tg();
      return s.world?.region?.status === 'ready' && s.world.nodes.some((n) => n.kind === 'market');
    });
    const s = await stg(page);
    expect(s.world!.region).toMatchObject({ status: 'ready', source: 'procedural' });
    expect(s.world!.nodes.map((n) => n.id)).toContain(MARKET.id);
    expect(s.world!.nodes.some((n) => n.kind === 'forge')).toBe(true);
    await expect(page.getByText(/Your neighbourhood is live/)).toBeVisible();
    await page.waitForTimeout(1200); // tuiles de la carte (OpenFreeMap, planète entière)
    await shot(page, 'anywhere-02-lisbon-live');

    // capture : l'éclat du tutoriel apparaît à 20 m (10 m au nord du marchand) — dans le rayon d'action
    await expect(page.getByTestId('action-btn')).toHaveText(/Catch/);
    await page.getByTestId('action-btn').click();
    await expect(page.getByTestId('catch-screen')).toBeVisible();
    for (let i = 0; i < 3 && !(await page.getByTestId('catch-result').isVisible()); i++) {
      await tapOnTarget(page);
      await page.getByTestId('catch-result').waitFor({ timeout: 2500 }).catch(() => {});
    }
    await expect(page.getByTestId('catch-result')).toContainText(/\+\d+ \w+ Shard/);
    await page.getByTestId('catch-continue').click();
    await expect.poll(async () => (await stg(page)).me!.shards.deepseek).toBeGreaterThanOrEqual(1);

    // vente au marchand généré (vrai geste de glisser)
    const node = (await stg(page)).world!.nodes.find((n) => n.id === MARKET.id)!;
    expect(await open(page, node.merchant!.id)).toBe(true);
    await expect(page.getByTestId('merchant-sheet')).toBeVisible();
    await expect(page.getByTestId('sell-deepseek')).toBeEnabled();
    const before = (await stg(page)).me!;
    await page.getByTestId('sell-deepseek').click();
    await expect(page.getByTestId('trade-panel')).toBeVisible();
    await page.waitForTimeout(700); // fin de l'animation de la feuille
    await shot(page, 'anywhere-03-sell');
    await drag(page, '[data-testid="slide-confirm-knob"]', 320);
    await expect.poll(async () => (await stg(page)).me!.shards.deepseek).toBe(before.shards.deepseek - 1);
    expect((await stg(page)).me!.flux).toBeGreaterThan(before.flux);
    await expect(page.getByTestId('toast').first()).toContainText(/Sold 1/);
    expect(errors).toEqual([]);
  });
});

test('Remote Scout: the battery drains, the server grounds the scout, then it flies again', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = pageErrors(page);
  await page.goto('/?demo=1');
  await expect(page.getByTestId('play-guest')).toContainText('Remote Scout');
  await expect(page.getByTestId('play-gps')).toContainText('Play for real');
  await page.waitForTimeout(600); // fin de l'animation d'entrée
  await shot(page, 'scout-01-splash');
  await startGuest(page, null);
  await expect(page.getByTestId('mode-badge')).toHaveText(/Scout/);
  await expect(page.getByTestId('battery-pct')).toHaveText('100%');
  const home = (await stg(page)).position!;
  await page.getByText('Skip tutorial').click();
  await page.waitForTimeout(2500); // tuiles de la carte
  await shot(page, 'scout-02-hud');

  // Dash de 1,4 km (> 40 km/h) : −63 %
  const far = offsetM(home, 0, 1400);
  await walk(page, far);
  await expect.poll(async () => Math.round((await stg(page)).scout!.battery)).toBeLessThanOrEqual(38);
  // Dash vers ~5 % restants, puis le Dash de trop : refusé par le serveur, Scout au sol
  const left = async () => { const sc = (await stg(page)).scout!; return sc.battery + ((Date.now() - sc.at) / 60_000) * 8; };
  const near = offsetM(far, ((await left()) - 5) / 45 * 1000, 0);
  await walk(page, near);
  const refused = page.waitForResponse((r) => r.url().endsWith('/api/move') && r.request().method() === 'POST');
  await page.evaluate(([lat, lng]) => (window as unknown as { __tgWalk: (a: number, b: number) => void }).__tgWalk(lat!, lng!), [offsetM(near, 0, 400).lat, offsetM(near, 0, 400).lng]);
  const body = (await (await refused).json()) as { refused?: string; at?: { lat: number; lng: number } };
  expect(body.refused).toBe('BATTERY_EMPTY');
  await expect(page.getByTestId('scout-grounded')).toBeVisible();
  await expect(page.getByTestId('scout-grounded')).toContainText(/flies again in \d:\d\d/);
  await expect(page.getByText('Battery empty — your scout is recharging.')).toBeVisible();
  // la position revient à la dernière position acceptée
  await expect.poll(async () => { const p = (await stg(page)).position!; return Math.abs(p.lat - near.lat) + Math.abs(p.lng - near.lng); }).toBeLessThan(1e-6);
  await shot(page, 'scout-03-grounded');
  // au sol, le client ne tente même plus de voler
  let sent = 0;
  const count = (r: import('@playwright/test').Request) => { if (r.url().endsWith('/api/move')) sent++; };
  page.on('request', count);
  await page.evaluate(([lat, lng]) => (window as unknown as { __tgWalk: (a: number, b: number) => void }).__tgWalk(lat!, lng!), [offsetM(near, 30, 0).lat, offsetM(near, 30, 0).lng]);
  await page.waitForTimeout(800);
  page.off('request', count);
  expect(sent).toBe(0);

  // recharge (8 %/min) : repart à 10 %
  await expect(page.getByTestId('scout-grounded')).toBeHidden({ timeout: 90_000 });
  await walk(page, offsetM(near, 30, 0));
  await expect.poll(async () => (await stg(page)).scout!.grounded).toBe(false);
  await expect(page.getByTestId('battery-pct')).toHaveText(/^\d+%$/);
  expect(errors).toEqual([]);
});
