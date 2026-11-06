// Parcours principal (« premier crédit réel en < 3 min ») : invité démo → capture → relais → marchand → First Compile → playground.
// La carte WebGL n'est pas lisible : on lit l'état via window.__tg et on se déplace via window.__tgWalk (Demo Walk).
import { expect, test, type Page } from '@playwright/test';

type TG = {
  me: { flux: number; shards: Record<string, number>; tutorial: Record<string, boolean>; credits: { limitNusd: number } } | null;
  world: { spawns: { id: string; lat: number; lng: number }[]; nodes: { id: string; kind: string; lat: number; lng: number; merchant?: { id: string; status: string } }[] } | null;
  position: { lat: number; lng: number } | null;
};
const tg = (page: Page) => page.evaluate(() => (window as unknown as { __tg: () => TG }).__tg());
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/__shots__/${name}.png` });

async function walk(page: Page, p: { lat: number; lng: number }) {
  await page.evaluate(([lat, lng]) => (window as unknown as { __tgWalk: (a: number, b: number) => void }).__tgWalk(lat!, lng!), [p.lat, p.lng]);
  // laisser l'avatar arriver et la position partir au serveur (throttle 3 s côté client)
  await page.waitForFunction(([lat, lng]) => {
    const s = (window as unknown as { __tg: () => TG }).__tg();
    return !!s.position && Math.abs(s.position.lat - lat!) < 1e-5 && Math.abs(s.position.lng - lng!) < 1e-5;
  }, [p.lat, p.lng]);
  await page.waitForTimeout(3500);
}
const open = (page: Page, id: string) => page.evaluate((x) => (window as unknown as { __tgOpen: (i: string) => boolean }).__tgOpen(x), id);
const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.hypot((a.lat - b.lat) * 111_000, (a.lng - b.lng) * 73_000);

/** Vrai glissé tactile (CDP Input.dispatchTouchEvent), comme un doigt sur téléphone. */
async function drag(page: Page, selector: string, dx: number) {
  await page.waitForTimeout(700); // fin de l'animation d'ouverture de la feuille
  const box = (await page.locator(selector).boundingBox())!;
  const x0 = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', x0);
  for (let i = 1; i <= 20; i++) { await touch('touchMove', x0 + (dx * i) / 20); await page.waitForTimeout(16); }
  await touch('touchEnd', x0 + dx);
  await cdp.detach();
}

test('guest demo: catch → sync → trade → First Compile → playground', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?demo=1');
  await expect(page.getByTestId('splash')).toBeVisible();
  await shot(page, '01-splash');
  await page.getByTestId('play-guest').click();
  const demoBtn = page.getByTestId('use-demo');
  if (await demoBtn.isVisible({ timeout: 2000 }).catch(() => false)) await demoBtn.click();
  await expect(page.getByTestId('map')).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __tg: () => TG }).__tg().world?.spawns.length, null, { timeout: 20_000 });
  await shot(page, '02-map');

  // 1. capture de l'éclat du tutoriel
  let s = await tg(page);
  const tut = s.world!.spawns.find((x) => x.id.startsWith('tut:'))!;
  expect(tut).toBeTruthy();
  const before = s.me!.shards.deepseek ?? 0;
  await walk(page, tut);
  await page.getByTestId('action-btn').click();
  await expect(page.getByTestId('catch-screen')).toBeVisible();
  for (let i = 0; i < 3 && !(await page.getByTestId('catch-result').isVisible()); i++) {
    await page.waitForTimeout(600);
    await page.getByTestId('catch-screen').click({ force: true });
  }
  await expect(page.getByTestId('catch-result')).toBeVisible({ timeout: 10_000 });
  await shot(page, '03-catch-result');
  await page.getByTestId('catch-continue').click();
  await expect.poll(async () => (await tg(page)).me!.shards.deepseek).toBeGreaterThan(before);

  // 2. sync du relais le plus proche
  s = await tg(page);
  const relay = s.world!.nodes.filter((n) => n.kind === 'relay').sort((a, b) => dist(a, s.position!) - dist(b, s.position!))[0]!;
  await walk(page, relay);
  await open(page, relay.id);
  await expect(page.getByTestId('relay-sheet')).toBeVisible();
  await drag(page, '[data-testid="sync-disc"]', 160);
  await expect(page.getByTestId('relay-loot')).toBeVisible({ timeout: 10_000 });
  await shot(page, '04-relay');
  await expect.poll(async () => (await tg(page)).me!.tutorial.synced).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByTestId('sheet-close').click().catch(() => {});

  // 3. vendre 1 Gemini au marchand le plus proche, avec « Why this price? »
  s = await tg(page);
  const market = s.world!.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open').sort((a, b) => dist(a, s.position!) - dist(b, s.position!))[0]!;
  await walk(page, market);
  await open(page, market.merchant!.id);
  await expect(page.getByTestId('merchant-sheet')).toBeVisible();
  await page.getByRole('button', { name: /Why.*Gemini/i }).first().click();
  await expect(page.getByTestId('why-popover')).toContainText('ƒ');
  await shot(page, '05-merchant-why');
  await page.getByTestId('sell-gemini').click();
  await expect(page.getByTestId('quote-total')).toBeVisible();
  await drag(page, '[data-testid="slide-confirm-knob"]', 320);
  await expect.poll(async () => (await tg(page)).me!.tutorial.traded, { timeout: 10_000 }).toBe(true);
  await shot(page, '06-traded');
  await page.getByTestId('sheet-close').click().catch(() => {});

  // 4. First Compile à la Forge du Louvre
  s = await tg(page);
  const forge = s.world!.nodes.find((n) => n.id === 'forge:louvre')!;
  await walk(page, forge);
  await open(page, forge.id);
  await expect(page.getByTestId('forge-screen')).toBeVisible();
  await page.getByTestId('recipe-first').click();
  const btn = page.getByTestId('compile-btn');
  const b = (await btn.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1400);
  await page.mouse.up();
  await expect(page.getByTestId('credit-ticket')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('credit-ticket')).toContainText('$0.030');
  await shot(page, '07-credit-ticket');

  // 5. playground avec la clé du joueur
  await page.getByTestId('try-now').click();
  await expect(page.getByTestId('credits-screen')).toBeVisible();
  await expect(page.getByTestId('credits-balance')).toContainText('0.030');
  await page.getByTestId('ask-btn').click();
  await expect(page.getByTestId('answer')).not.toBeEmpty({ timeout: 15_000 });
  await shot(page, '08-playground');

  expect(errors).toEqual([]);
});
