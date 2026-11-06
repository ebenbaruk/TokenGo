// Parcours principal (« premier crédit réel en < 3 min ») : invité démo → capture → relais → marchand → First Compile → playground.
// La carte WebGL n'est pas lisible : on lit l'état via window.__tg et on se déplace via window.__tgWalk (Demo Walk).
import { expect, test, dist, drag, hold, open, pageErrors, shot, startGuest, tg, walk } from './helpers.ts';

test('guest demo: catch → sync → trade → First Compile → playground', async ({ page }) => {
  const errors = pageErrors(page);

  await page.goto('/?demo=1');
  await expect(page.getByTestId('splash')).toBeVisible();
  await shot(page, '01-splash');
  await startGuest(page, null); // déjà sur le splash
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
  await hold(page, 'compile-btn');
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
