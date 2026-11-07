// Game feel + raisons de revenir : combo visible pendant et après la capture, variante du Codex révélée et enregistrée,
// éclat qui vole au sac, Codex (silhouettes, %), Daily Route bouclée à pied (window.__tgWalk), cartes PNG partageables.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test, dist, pageErrors, shot, startGuest, tapOnTarget, tg, walk, type Spawn, type TG } from './helpers.ts';

const COMMON = ['deepseek', 'qwen'];
interface RouteStop { id: string; kind: string; name: string; lat: number; lng: number; done: boolean }
interface RouteView { stops: RouteStop[]; done: number; total: number; completedAt: number | null; reward: { xp: number; flux: number; shard: string }; streak: number }
type TGX = TG & { route: RouteView | null; celebration: string | null; lastShare: { kind: string; bytes: number; type: string; via: string } | null };
const tgx = (page: Page) => tg(page) as Promise<TGX>;

/** Joue le mini-jeu jusqu'au résultat (taps au moment où l'anneau touche la cible). */
async function playLockOn(page: Page) {
  for (let i = 0; i < 3 && !(await page.getByTestId('catch-result').isVisible()); i++) {
    await tapOnTarget(page);
    await page.getByTestId('catch-result').waitFor({ timeout: 2500 }).catch(() => {});
  }
  await expect(page.getByTestId('catch-result')).toBeVisible({ timeout: 10_000 });
}

/** PNG valide (signature) d'un téléchargement. */
async function expectPng(download: import('@playwright/test').Download) {
  const path = await download.path();
  const buf = readFileSync(path);
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.length).toBeGreaterThan(20_000);
  return buf;
}

test('combo is felt, the Codex records the variant, and the Codex card exports a PNG', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  // 1) éclat du tutoriel : capture n° 1 (variante Classic garantie)
  let s = await tgx(page);
  const tut = s.world!.spawns.find((x) => x.id.startsWith('tut:'))!;
  await walk(page, tut);
  await page.getByTestId('action-btn').click();
  await expect(page.getByTestId('catch-screen')).toBeVisible();
  await playLockOn(page);
  await expect(page.getByTestId('catch-variant')).toHaveAttribute('data-variant', 'classic');
  await expect(page.getByTestId('catch-variant')).toContainText('NEW');
  await expect(page.getByTestId('catch-variant')).toContainText('Codex 1/25');
  await page.getByTestId('catch-continue').click();
  // l'éclat vole jusqu'au sac puis disparaît
  await expect(page.getByTestId('flyer').first()).toBeVisible();
  await expect(page.getByTestId('flyer')).toHaveCount(0, { timeout: 3000 });

  // 2) un éclat ordinaire dans la foulée (< 90 s) : combo ×2
  s = await tgx(page);
  const start = s.position!;
  const pick = (st: TG): Spawn | undefined => st.world!.spawns
    .filter((x) => !x.id.startsWith('tut:') && x.expiresAt > Date.now() + 20_000)
    .sort((a, b) => Number(COMMON.includes(b.family)) - Number(COMMON.includes(a.family)) || dist(a, st.position!) - dist(b, st.position!))[0];
  let sp = pick(s);
  for (let k = 0; !sp && k < 8; k++) {
    const a = (k * Math.PI) / 4;
    await walk(page, { lat: start.lat + (150 * Math.cos(a)) / 111_000, lng: start.lng + (150 * Math.sin(a)) / 73_000 }, { world: true });
    sp = pick(await tgx(page));
  }
  expect(sp, 'a regular shard nearby').toBeTruthy();
  await walk(page, sp!);
  await page.getByTestId('action-btn').click();
  await expect(page.getByTestId('catch-screen')).toBeVisible();
  await expect(page.getByTestId('catch-combo')).toContainText('combo ×1');
  await expect(page.getByTestId('catch-combo')).toContainText('next ×2');
  await shot(page, 'juice-01-combo-lock-on');
  await playLockOn(page);
  const res = (await tgx(page)).lastResult as { result: string; combo: number; codex: { variant: string; name: string; found: number; isNew: boolean } };
  expect(['perfect', 'good']).toContain(res.result);
  expect(res.combo).toBe(2);
  await expect(page.getByTestId('catch-combo-result')).toContainText('COMBO ×2');
  await expect(page.getByTestId('catch-variant')).toHaveAttribute('data-variant', res.codex.variant);
  await expect(page.getByTestId('catch-variant')).toContainText(res.codex.name);
  await page.waitForTimeout(900); // révélation de la variante + compteur d'XP qui roule
  await shot(page, 'juice-02-variant-reveal');
  await page.getByTestId('catch-continue').click();
  await expect(page.getByTestId('combo')).toContainText('combo ×2');
  await shot(page, 'juice-03-hud-combo');

  // 3) Codex : les 2 captures sont enregistrées, le reste en silhouettes
  await page.getByTestId('level').click();
  await page.getByTestId('menu-codex').click();
  await expect(page.getByTestId('codex-sheet')).toBeVisible();
  await expect(page.getByTestId('codex-deepseek-classic')).toHaveAttribute('data-found', '1');
  const sp2 = sp!;
  await expect(page.getByTestId(`codex-${sp2.family}-${res.codex.variant}`)).toHaveAttribute('data-found', '1');
  await expect(page.locator('[data-found="0"]')).toHaveCount(25 - res.codex.found);
  await expect(page.getByTestId('codex-progress')).toContainText(`${res.codex.found}/25`);
  await page.getByTestId('codex-claude-shiny').click();
  await expect(page.getByTestId('codex-detail')).toContainText('Hint: 1 in 40');
  await page.waitForTimeout(400);
  await shot(page, 'juice-04-codex');
  const api = (await (await page.request.get('/api/codex')).json()) as { found: number };
  expect(api.found).toBe(res.codex.found);

  // 4) carte partageable du Codex → PNG (pas de Web Share en headless → téléchargement)
  const dl = page.waitForEvent('download');
  await page.getByTestId('codex-share').click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/^tokengo-codex-\d+of25\.png$/);
  await expectPng(download);
  await download.saveAs('e2e/__shots__/juice-card-codex.png');
  await expect.poll(async () => (await tgx(page)).lastShare?.kind).toBe('codex');
  expect((await tgx(page)).lastShare).toMatchObject({ type: 'image/png', via: 'download' });
  expect(errors).toEqual([]);
});

test('daily route: dotted loop + checklist, completes by walking (__tgWalk), celebration + share card', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  await page.waitForFunction(() => !!(window as unknown as { __tg: () => TGX }).__tg().route, null, { timeout: 20_000 });
  const route = (await tgx(page)).route!;
  expect(route.total).toBeGreaterThanOrEqual(3);
  expect(route.total).toBeLessThanOrEqual(5);
  const chip = page.getByTestId('route-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(`${route.done}/${route.total}`);
  await shot(page, 'juice-05-route-map');
  await chip.click();
  await expect(page.getByTestId('route-sheet')).toBeVisible();
  await expect(page.getByTestId('route-stops').locator('li')).toHaveCount(route.total);
  await page.waitForTimeout(600);
  await shot(page, 'juice-06-route-sheet');
  await page.getByTestId('sheet-close').click();

  const before = (await tgx(page)).me!;
  for (const st of route.stops) {
    if ((await tgx(page)).route?.stops.find((x) => x.id === st.id)?.done) continue;
    await walk(page, st);
    await expect.poll(async () => (await tgx(page)).route?.stops.find((x) => x.id === st.id)?.done, { timeout: 8000 }).toBe(true);
  }
  await expect(page.getByTestId('route-complete')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('route-complete')).toContainText('Loop complete!');
  await page.waitForTimeout(900);
  await shot(page, 'juice-07-route-complete');
  const after = (await tgx(page)).me!;
  expect(after.flux).toBe(before.flux + route.reward.flux);
  expect(after.shards.gemini).toBe(before.shards.gemini + 1);
  expect(after.xp).toBeGreaterThanOrEqual(before.xp + route.reward.xp);

  const dl = page.waitForEvent('download');
  await page.getByTestId('route-share').click();
  const download = await dl;
  await expectPng(download);
  await download.saveAs('e2e/__shots__/juice-card-route.png');
  await page.getByTestId('route-close').click();
  await expect(page.getByTestId('route-complete')).toBeHidden();
  await expect(page.getByTestId('route-chip')).toContainText(`${route.total}/${route.total}`);
  // le serveur ne paie qu'une fois : revenir sur le premier arrêt ne change rien
  await walk(page, route.stops[0]!);
  await page.waitForTimeout(500);
  expect((await tgx(page)).me!.flux).toBe(after.flux);
  expect(errors).toEqual([]);
});
