// Forge : recette incomplète → emplacements manquants + bouton désactivé avec la raison ;
// pass démo (DEMO_TOKEN) → Spark complète → compile → ticket de crédit.
import { expect, test, DEMO_TOKEN, ORIGIN, apiGuest, hold, open, pageErrors, shot, startGuest, tg, walk, type Family } from './helpers.ts';

interface Recipe { tier: string; label: string; needs: Partial<Record<Family, number>>; missing: Partial<Record<Family, number>>; locked: string | null; fee: number; payoutNusd: number }
const NAME: Record<Family, string> = { deepseek: 'DeepSeek', qwen: 'Qwen', gemini: 'Gemini', gpt: 'GPT', claude: 'Claude' };
const FORGE = 'forge:louvre';

async function forgeView(page: import('@playwright/test').Page) {
  const r = await page.request.get(`/api/forge/${encodeURIComponent(FORGE)}`);
  expect(r.ok()).toBe(true);
  return (await r.json()) as { recipes: Recipe[] };
}

async function openForge(page: import('@playwright/test').Page) {
  const forge = (await tg(page)).world!.nodes.find((n) => n.id === FORGE)!;
  expect(forge).toBeTruthy();
  await walk(page, forge);
  await open(page, FORGE);
  await expect(page.getByTestId('forge-screen')).toBeVisible();
  await expect(page.getByTestId('recipe-spark')).toBeVisible();
}

test('an incomplete recipe shows its missing slots and cannot be compiled', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page); // invité démo : niveau 3, 1 DeepSeek, 1 Qwen, 2 Gemini — pas assez pour une Spark
  await openForge(page);
  const spark = (await forgeView(page)).recipes.find((r) => r.tier === 'spark')!;
  expect(spark.locked).toBeNull();
  const missing = Object.entries(spark.missing).filter(([, q]) => q) as [Family, number][];
  expect(missing.length).toBeGreaterThan(0);

  await page.getByTestId('recipe-spark').click();
  await expect(page.getByTestId('recipe-spark')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('recipe-spark')).not.toContainText('ready');
  // un emplacement par éclat demandé ; les manquants sont grisés (classe emptySlot)
  const total = Object.values(spark.needs).reduce((a, b) => a + (b ?? 0), 0);
  const nMissing = missing.reduce((a, [, q]) => a + q, 0);
  const slots = page.getByTestId('recipe-spark').locator('[class*="slot"]:not([class*="slots"])');
  await expect(slots).toHaveCount(total);
  await expect(page.getByTestId('recipe-spark').locator('[class*="emptySlot"]')).toHaveCount(nMissing);

  const btn = page.getByTestId('compile-btn');
  await expect(btn).toBeDisabled();
  const reason = `Missing ${missing.map(([f, q]) => `${q} ${NAME[f]}`).join(', ')}`;
  await expect(page.getByTestId('forge-screen').getByText(reason, { exact: true })).toBeVisible();
  await shot(page, 'forge-01-incomplete');

  // un niveau trop bas verrouille aussi, avec sa raison
  const prism = (await forgeView(page)).recipes.find((r) => r.tier === 'prism')!;
  expect(prism.locked).toBeTruthy();
  await page.getByTestId('recipe-prism').click();
  await expect(btn).toBeDisabled();
  await expect(page.getByTestId('forge-screen').getByText(prism.locked!, { exact: true })).toBeVisible();

  // le serveur refuse aussi une compilation forcée
  const r = await page.request.post(`/api/forge/${encodeURIComponent(FORGE)}/compile`, { data: { tier: 'spark' }, headers: { Origin: ORIGIN } });
  expect(r.ok()).toBe(false);
  expect(errors).toEqual([]);
});

test('demo pass (DEMO_TOKEN) compiles a Spark → credit ticket', async ({ page }) => {
  const errors = pageErrors(page);
  // le pass démo se crée par l'API (le front n'a pas de paramètre de jeton) ; le cookie est partagé avec la page.
  // NB : le serveur n'accorde qu'un pass démo par IP et par jour → seul ce test l'utilise dans la suite.
  const me = await apiGuest(page.request, { token: DEMO_TOKEN });
  expect(me.mode).toBe('demo');
  // le cookie de session est httpOnly : le front s'appuie sur un indice local pour savoir qu'une session existe
  await page.addInitScript(() => { try { localStorage.setItem('tg.session', '1'); } catch { /* */ } });
  await page.goto('/?demo=1');
  await expect(page.getByTestId('play-guest')).toContainText('Continue');
  await expect(page.getByText(me.handle)).toBeVisible();
  await startGuest(page, null);
  expect((await tg(page)).me!.flux).toBe(600);
  await openForge(page);

  const spark = (await forgeView(page)).recipes.find((r) => r.tier === 'spark')!;
  expect(spark.locked).toBeNull();
  expect(Object.values(spark.missing).filter(Boolean)).toHaveLength(0);
  await page.getByTestId('recipe-spark').click();
  await expect(page.getByTestId('recipe-spark')).toContainText('ready');
  await expect(page.getByTestId('compile-btn')).toBeEnabled();
  await shot(page, 'forge-02-ready');

  const before = (await tg(page)).me!;
  await hold(page, 'compile-btn');
  const ticket = page.getByTestId('credit-ticket');
  await expect(ticket).toBeVisible({ timeout: 20_000 });
  const res = (await tg(page)).lastResult as { payoutNusd: number; simulated: boolean; xp: number };
  expect(res.simulated).toBe(true);
  expect(res.payoutNusd).toBeGreaterThan(0);
  await expect(ticket).toContainText('Compiled! Demo credits for now.');
  await expect(ticket).toContainText(/\+\$\d+\.\d{3}/);
  await expect(ticket).toContainText('demo credits');
  await expect(ticket).toContainText(`+${res.xp} XP`);
  await shot(page, 'forge-03-ticket');
  // carte partageable du ticket (PNG, téléchargé faute de Web Share en headless)
  const dl = page.waitForEvent('download');
  await page.getByTestId('ticket-share').click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/^tokengo-credit-.+\.png$/);
  await download.saveAs('e2e/__shots__/forge-card-ticket.png');
  await expect.poll(async () => ((await tg(page)) as unknown as { lastShare: { kind: string; type: string } | null }).lastShare?.kind).toBe('ticket');

  // éclats brûlés + frais payés, crédit visible
  const after = (await tg(page)).me!;
  expect(after.flux).toBe(before.flux - spark.fee);
  for (const [f, q] of Object.entries(spark.needs) as [Family, number][]) expect(after.shards[f]).toBe(before.shards[f] - q);
  expect(after.credits.limitNusd).toBeGreaterThan(before.credits.limitNusd);
  expect(errors).toEqual([]);
});
