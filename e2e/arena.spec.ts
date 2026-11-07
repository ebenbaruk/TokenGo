// Arène des modèles (Docs/13 §4) : un invité démo (niveau 3, 1 DeepSeek, 1 Qwen, 2 Gemini, 60 ƒ) marche jusqu'à la Forge
// du Louvre, ouvre l'onglet Arena, aligne 3 modèles, joue les manches jusqu'au résultat, voit ses récompenses et sa
// maîtrise monter. 2e test : un modèle « rate-limited » est grisé et le serveur refuse de le jouer.
import type { Page } from '@playwright/test';
import { expect, test, ORIGIN, open, pageErrors, shot, startGuest, tg, walk } from './helpers.ts';

const FORGE = 'forge:louvre';
type Mastery = Record<string, { level: number; xp: number }>;
const masteryOf = async (page: Page) => ((await tg(page)).me as unknown as { mastery: Mastery }).mastery;

async function openArena(page: Page) {
  const forge = (await tg(page)).world!.nodes.find((n) => n.id === FORGE)!;
  expect(forge).toBeTruthy();
  await walk(page, forge);
  await open(page, FORGE);
  await expect(page.getByTestId('forge-screen')).toBeVisible();
  await page.getByTestId('tab-arena').click();
  await expect(page.getByTestId('arena-tab')).toBeVisible();
  await expect(page.getByTestId('arena-holder')).toBeVisible();
}

async function pickTeam(page: Page) {
  await expect(page.getByTestId('arena-fight')).toBeDisabled();
  await expect(page.getByTestId('arena-fight-reason')).toHaveText('Pick 3 more models');
  for (const f of ['deepseek', 'qwen', 'gemini']) await page.getByTestId(`arena-pick-${f}`).click();
  await expect(page.getByTestId('arena-team-count')).toHaveText('3/3');
  await expect(page.getByTestId('arena-fight')).toBeEnabled();
}

/** Joue une manche : premier modèle disponible, chain-of-thought si le budget le permet. Renvoie le modèle joué. */
async function playRound(page: Page): Promise<string> {
  await expect(page.getByTestId('arena-challenge')).toBeVisible();
  const model = page.locator('[data-testid^="arena-model-"][data-ratelimited="0"]').first();
  const fam = (await model.getAttribute('data-testid'))!.replace('arena-model-', '');
  await model.click();
  const cot = page.getByTestId('arena-tech-cot');
  if (await cot.isEnabled()) await cot.click();
  await page.getByTestId('arena-send').click();
  await expect(page.getByTestId('arena-reveal')).toBeVisible();
  await expect(page.getByTestId('arena-next')).toBeEnabled({ timeout: 5000 });
  await expect(page.getByTestId('arena-line')).toBeVisible();
  return fam;
}

test('walk to the Louvre, pick a team, fight the arena to the end → rewards + mastery up', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  const before = await masteryOf(page);
  expect(Object.values(before).every((m) => m.level === 1)).toBe(true);
  await openArena(page);
  await expect(page.getByTestId('arena-holder')).toContainText('Sentinel of Louvre');
  await shot(page, 'arena-01-tab');
  await pickTeam(page);
  await shot(page, 'arena-02-team');
  const flux0 = (await tg(page)).me!.flux;

  await page.getByTestId('arena-fight').click();
  await expect(page.getByTestId('arena-battle')).toBeVisible();
  await expect.poll(async () => (await tg(page)).me!.flux).toBe(flux0 - 10);
  await shot(page, 'arena-03-challenge');

  const played: string[] = [];
  for (let i = 0; i < 5; i++) {
    played.push(await playRound(page));
    if (i === 0) {
      await shot(page, 'arena-04-reveal');
      // le modèle qui vient de jouer est « rate-limited » à la manche suivante
      if (await page.getByTestId('arena-next').textContent().then((t) => t?.includes('Next'))) {
        await page.getByTestId('arena-next').click();
        await expect(page.getByTestId(`arena-model-${played[0]}`)).toBeDisabled();
        await expect(page.getByTestId(`arena-model-${played[0]}`)).toContainText('Rate-limited');
        continue;
      }
    }
    const label = await page.getByTestId('arena-next').textContent();
    await page.getByTestId('arena-next').click();
    if (label?.includes('See result')) break;
  }
  for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);

  const result = page.getByTestId('arena-result');
  await expect(result).toBeVisible();
  const outcome = await result.getAttribute('data-outcome');
  expect(['won', 'lost']).toContain(outcome);
  await expect(page.getByTestId('arena-xp')).toHaveText(outcome === 'won' ? '+60 XP' : '+15 XP');
  await expect(page.getByTestId('arena-flux')).toHaveText(outcome === 'won' ? '+20 ƒ' : '+0 ƒ');
  if (outcome === 'won') {
    await expect(page.getByTestId('arena-crown')).toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(900);
    await shot(page, 'arena-06-crown');
    await page.getByTestId('arena-crown').click();
  }
  await page.waitForTimeout(500);
  await shot(page, 'arena-05-result');

  // maîtrise : +10 par manche jouée (+10 si gagnée) pour chaque modèle aligné
  const after = await masteryOf(page);
  for (const f of new Set(played)) expect(after[f]!.xp).toBeGreaterThanOrEqual(before[f]!.xp + 10);
  expect((await tg(page)).me!.flux).toBe(flux0 - 10 + (outcome === 'won' ? 20 : 0));

  await page.getByTestId('arena-done').click();
  await expect(page.getByTestId('arena-tab')).toBeVisible();
  await expect(page.getByTestId('arena-left')).toContainText('11/12');
  const f0 = played[0]!;
  await expect(page.getByTestId(`arena-mastery-${f0}`)).toHaveAttribute('data-xp', String(after[f0]!.xp));
  if (outcome === 'won') await expect(page.getByTestId('arena-holder')).toHaveAttribute('data-kind', 'champion');

  // la carte : badge d'arène sur la forge (couronne si on vient de la prendre, bouclier sinon)
  await page.getByTestId('forge-close').click();
  await page.waitForTimeout(1500);
  await shot(page, 'arena-09-map');

  // Sac : niveau + barre de maîtrise par famille
  await page.getByTestId('bag-btn').click();
  await expect(page.getByTestId(`bag-mastery-${f0}`)).toHaveAttribute('data-xp', String(after[f0]!.xp));
  await shot(page, 'arena-07-bag-mastery');
  expect(errors).toEqual([]);
});

test('a rate-limited model is greyed out and the server refuses to play it', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  await openArena(page);
  await pickTeam(page);
  await page.getByTestId('arena-fight').click();
  await expect(page.getByTestId('arena-battle')).toBeVisible();
  const start = (await tg(page)).lastResult as { battle: { battleId: string } };
  const battleId = start.battle.battleId;

  await page.getByTestId('arena-model-qwen').click();
  await page.getByTestId('arena-send').click();
  await expect(page.getByTestId('arena-next')).toBeEnabled({ timeout: 5000 });
  const label = await page.getByTestId('arena-next').textContent();
  expect(label).toContain('Next'); // une seule manche jouée : le combat continue
  await page.getByTestId('arena-next').click();
  const qwen = page.getByTestId('arena-model-qwen');
  await expect(qwen).toBeDisabled();
  await expect(qwen).toHaveAttribute('data-ratelimited', '1');
  await expect(page.getByTestId('arena-send-reason')).toHaveText('Pick a model for this challenge');
  await shot(page, 'arena-08-ratelimited');

  // le client ne peut pas contourner : le serveur refuse Qwen deux manches de suite
  const r = await page.request.post(`/api/arena/battle/${encodeURIComponent(battleId)}/play`, {
    data: { family: 'qwen', technique: 'zero' }, headers: { Origin: ORIGIN },
  });
  expect(r.status()).toBe(400);
  expect(((await r.json()) as { error: { code: string } }).error.code).toBe('MODEL_RATE_LIMITED');
  // … et le combat continue normalement avec un autre modèle
  await page.getByTestId('arena-model-gemini').click();
  await page.getByTestId('arena-send').click();
  await expect(page.getByTestId('arena-reveal')).toHaveAttribute('data-winner', /me|opp|tie/);
  expect(errors).toEqual([]);
});
