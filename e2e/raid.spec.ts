// Raid « Rogue Model » (Docs/13 §6) : l'admin lâche un boss sur la Forge du Louvre ; bannière glitchée + marqueur sur la carte ;
// un invité démo marche jusqu'à la Forge, ouvre l'onglet Raid, lance un assaut de 3 manches et voit les PV du boss baisser.
// 2ᵉ test : PV forcés bas (route de test, NODE_ENV=test + jeton admin) → le joueur porte le dernier coup → écran de fin
// collectif, récompenses de victoire (80 XP + 30 ƒ + 40 ƒ top 3) et titre Codex « Rogue Slayer ».
import type { Page } from '@playwright/test';
import { expect, test, ADMIN_TOKEN, ORIGIN, open, pageErrors, shot, startGuest, tg, walk } from './helpers.ts';

const FORGE = 'forge:louvre';
const admin = (page: Page, path: string, data: unknown = {}) =>
  page.request.post(path, { data, headers: { Origin: ORIGIN, Authorization: `Bearer ${ADMIN_TOKEN}` } });

test.afterAll(async ({ request }) => {
  // ne pas laisser de raid actif pour les specs suivantes
  await request.post('/api/admin/event/end', { headers: { Origin: ORIGIN, Authorization: `Bearer ${ADMIN_TOKEN}` } });
});

async function startRogue(page: Page): Promise<number> {
  const r = await admin(page, '/api/admin/event', { kind: 'rogue', forge: FORGE });
  expect(r.ok(), await r.text()).toBe(true);
  return ((await r.json()) as { event: { id: number } }).event.id;
}

async function openRaid(page: Page) {
  const forge = (await tg(page)).world!.nodes.find((n) => n.id === FORGE)!;
  await walk(page, forge);
  await open(page, FORGE);
  await expect(page.getByTestId('forge-screen')).toBeVisible();
  await expect(page.getByTestId('tab-raid')).toBeVisible();
  await expect(page.getByTestId('raid-tab')).toBeVisible(); // l'onglet Raid s'ouvre de lui-même pendant le raid
  await expect(page.getByTestId('raid-boss-name')).not.toBeEmpty();
}

async function pickAndAttack(page: Page) {
  await expect(page.getByTestId('raid-attack-reason')).toHaveText('Pick 3 more models');
  for (const f of ['deepseek', 'qwen', 'gemini']) await page.getByTestId(`raid-pick-${f}`).click();
  await expect(page.getByTestId('raid-team-count')).toHaveText('3/3');
  await page.getByTestId('raid-attack').click();
  await expect(page.getByTestId('raid-assault')).toBeVisible();
}

/** Joue une manche (premier modèle disponible) ; renvoie les dégâts affichés. */
async function playRound(page: Page): Promise<number> {
  await expect(page.getByTestId('raid-challenge')).toBeVisible();
  await page.locator('[data-testid^="raid-model-"][data-ratelimited="0"]').first().click();
  await page.getByTestId('raid-send').click();
  await expect(page.getByTestId('raid-reveal')).toBeVisible();
  await expect(page.getByTestId('raid-next')).toBeEnabled({ timeout: 6000 });
  return Number(await page.getByTestId('raid-round-damage').getAttribute('data-damage'));
}
const hpOf = async (page: Page, testId: string) => Number(await page.getByTestId(testId).getAttribute('data-hp'));

test('admin unleashes a rogue model at the Louvre; a player assaults it for 3 rounds and the HP bar drops', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  const eventId = await startRogue(page);

  // poussé par SSE : bannière glitchée avec les PV et la faiblesse, marqueur du boss sur la carte
  const banner = page.getByTestId('event-banner');
  await expect(banner).toBeVisible({ timeout: 8000 });
  await expect(banner).toHaveAttribute('data-kind', 'rogue');
  await expect(banner).toContainText('ROGUE MODEL');
  await expect(banner).toContainText('at Louvre');
  await expect(banner).toContainText('HP');
  await expect(banner).toContainText('weak to');
  await expect(page.getByTestId('raid-marker')).toBeVisible({ timeout: 8000 });
  const skip = page.getByTestId('tutorial-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click();
  // vue depuis ~110 m au sud de la Forge : le boss flotte au-dessus d'elle, bien visible
  const forge = (await tg(page)).world!.nodes.find((n) => n.id === FORGE)!;
  await walk(page, { lat: forge.lat + 0.0007, lng: forge.lng - 0.0002 });
  await page.waitForTimeout(3000);
  await shot(page, 'raid-01-map-banner');

  await openRaid(page);
  const hp0 = await hpOf(page, 'raid-hp');
  expect(hp0).toBeGreaterThanOrEqual(800);
  await expect(page.getByTestId('raid-weak')).toBeVisible();
  await expect(page.getByTestId('raid-assaults-left')).toHaveText('3/3');
  await page.getByTestId('raid-pick-deepseek').click(); // un modèle choisi, pour la capture
  await page.waitForTimeout(2800); // les toasts (route du jour…) s'en vont
  await shot(page, 'raid-02-tab');
  await page.getByTestId('raid-pick-deepseek').click();
  await pickAndAttack(page);
  await shot(page, 'raid-03-assault');

  let dealt = 0;
  for (let i = 0; i < 3; i++) {
    dealt += await playRound(page);
    if (i === 0) {
      await page.waitForTimeout(200);
      await shot(page, 'raid-04-hit');
      // la barre de PV du boss a baissé, dans l'écran d'assaut
      expect(await hpOf(page, 'raid-assault-hp')).toBeLessThan(hp0);
    }
    await page.getByTestId('raid-next').click();
  }
  expect(dealt).toBeGreaterThan(0);
  await expect(page.getByTestId('raid-assault-result')).toBeVisible();
  await expect(page.getByTestId('raid-assault-damage')).toHaveText(String(dealt).replace(/\B(?=(\d{3})+(?!\d))/g, ' '), { timeout: 3000 });
  await shot(page, 'raid-05-assault-done');

  // retour à l'onglet : mes dégâts, mon rang, 2 assauts restants, PV plus bas (serveur)
  await page.getByTestId('raid-done').click();
  await expect(page.getByTestId('raid-tab')).toBeVisible();
  await expect(page.getByTestId('raid-assaults-left')).toHaveText('2/3');
  await expect(page.getByTestId('raid-my-damage')).not.toHaveText('0');
  await expect(page.getByTestId('raid-leaderboard')).toContainText((await tg(page)).me!.handle);
  expect(await hpOf(page, 'raid-hp')).toBeLessThanOrEqual(hp0 - dealt);
  const v = await (await page.request.get(`/api/raid/${eventId}`)).json() as { mine: { damage: number }; raid: { hp: number } };
  expect(v.mine.damage).toBe(dealt);
  await shot(page, 'raid-06-tab-after');

  // la carte et la bannière suivent les PV du serveur
  await page.getByTestId('forge-close').click();
  await expect.poll(async () => hpOf(page, 'raid-banner-hp'), { timeout: 8000 }).toBeLessThanOrEqual(hp0 - dealt);
  await walk(page, { lat: forge.lat + 0.0007, lng: forge.lng - 0.0002 });
  await page.waitForTimeout(1500);
  await shot(page, 'raid-07-map-after');
  // /pulse montre la barre de PV
  await page.goto('/pulse');
  await expect(page.getByTestId('pulse-raid')).toBeVisible({ timeout: 8000 });
  expect(await hpOf(page, 'pulse-raid-hp')).toBeLessThanOrEqual(hp0 - dealt);
  expect(errors).toEqual([]);
});

test('the killing blow: collective victory screen, rewards, top 3 bonus and the Rogue Slayer Codex title', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  const eventId = await startRogue(page);
  await openRaid(page);
  // route de test : boss presque à terre (absente hors NODE_ENV=test, jeton admin exigé)
  expect((await page.request.post(`/api/test/raid/${eventId}/hp`, { data: { hp: 60 }, headers: { Origin: ORIGIN } })).status()).toBe(403);
  expect((await admin(page, `/api/test/raid/${eventId}/hp`, { hp: 60 })).ok()).toBe(true);
  const me0 = (await tg(page)).me!;
  await pickAndAttack(page);
  await expect.poll(async () => hpOf(page, 'raid-assault-hp')).toBeLessThanOrEqual(60);

  for (let i = 0; i < 3; i++) {
    await playRound(page);
    const label = (await page.getByTestId('raid-next').textContent()) ?? '';
    await page.getByTestId('raid-next').click();
    if (label.includes('going down')) break;
  }
  const end = page.getByTestId('raid-end').first();
  await expect(end).toBeVisible({ timeout: 8000 });
  await expect(end).toHaveAttribute('data-outcome', 'won');
  await expect(page.getByTestId('raid-end-title').first()).toContainText('The city contained');
  await expect(page.getByTestId('raid-end-xp').first()).toHaveText('+80 XP');
  await expect(page.getByTestId('raid-end-flux').first()).toHaveText('+70 ƒ');
  await expect(page.getByTestId('raid-end-top3').first()).toBeVisible();
  await expect(page.getByTestId('raid-end-codex-title').first()).toContainText('Rogue Slayer');
  await page.waitForTimeout(1700); // fin des animations (tampon, récompenses)
  await shot(page, 'raid-08-victory');

  // récompenses vraiment créditées (serveur), une seule fois
  await expect.poll(async () => (await tg(page)).me!.flux).toBe(me0.flux + 70);
  const r = await (await page.request.get(`/api/raid/${eventId}`)).json() as { raid: { status: string; hp: number }; result: { xp: number; title: string } };
  expect(r.raid).toMatchObject({ status: 'won', hp: 0 });
  expect(r.result).toMatchObject({ xp: 80, title: 'Rogue Slayer' });

  // l'événement est fini : plus de bannière ; le Codex affiche le titre
  const close = page.getByTestId('raid-end-close').first();
  if (await close.isVisible().catch(() => false)) await close.click();
  if (await page.getByTestId('forge-close').isVisible().catch(() => false)) await page.getByTestId('forge-close').click();
  await expect(page.getByTestId('event-banner')).toBeHidden({ timeout: 8000 });
  await page.getByTestId('level').click();
  await page.getByTestId('menu-codex').click();
  await expect(page.getByTestId('codex-sheet')).toBeVisible();
  await expect(page.getByTestId('codex-progress')).toContainText('Rogue Slayer');
  await expect(page.getByTestId('codex-title-rogue-slayer')).toHaveAttribute('data-unlocked', '1');
  await shot(page, 'raid-09-codex-title');
  expect(errors).toEqual([]);
});
