// Economy Lab (/lab) : « Simulate 1 week » avec le scénario DeepSeek flood → graphiques remplis, contrôles de santé,
// journal d'événements avec au moins une faillite / fermeture.
import { expect, test, pageErrors } from './helpers.ts';

test('Simulate 1 week, DeepSeek flood → charts, health checks, a bankruptcy in the log', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = pageErrors(page);
  // mouvement réduit : la lecture animée saute directement à la fin (tout le journal est visible)
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/lab');
  await expect(page.getByTestId('lab-page')).toBeVisible();
  const run = page.getByTestId('lab-run');
  // premier run automatique (baseline) : attendre qu'il se termine
  await expect(page.getByTestId('lab-meta')).toBeVisible({ timeout: 60_000 });
  await expect(run).toHaveText('Simulate 1 week');

  await page.getByTestId('scen-flood-deepseek').click();
  await expect(page.getByText('Bots dump common shards on merchants.')).toBeVisible();
  await run.click();
  await expect(run).toContainText('Simulating…');
  await expect(run).toHaveText('Simulate 1 week', { timeout: 90_000 });
  await expect(page.getByTestId('lab-meta')).toContainText(/200 bots · \d+ merchants · 7 days simulated/);

  // journal (60 derniers événements à l'instant affiché) : en fin de semaine, au moins une faillite / fermeture
  const log = page.getByTestId('lab-log');
  await expect(log.locator('li').filter({ hasText: /went bankrupt|closing-down sale/ }).first()).toBeVisible();
  await log.screenshot({ path: 'e2e/__shots__/lab-01-event-log.png' });
  // remonter la timeline au début du jour 2 : le flood commence là
  const timeline = page.getByRole('slider', { name: 'Timeline' });
  const max = Number(await timeline.getAttribute('max'));
  expect(max).toBeGreaterThan(20); // une frame toutes les ~2 h simulées
  await timeline.fill(String(Math.round((max * 26) / (7 * 24))));
  await expect(page.getByText(/^Day 2$/)).toBeVisible();
  await expect(log).toContainText('A DeepSeek flood begins');
  await timeline.fill(String(max));

  // graphiques remplis : une courbe par famille sur « Prices vs. start », et 3 autres graphes
  const prices = page.getByTestId('chart-prices');
  await expect(prices).toBeVisible();
  const lines = prices.locator('svg polyline');
  expect(await lines.count()).toBeGreaterThanOrEqual(5);
  const pts = (await lines.first().getAttribute('points')) ?? '';
  expect(pts.trim().split(/\s+/).length).toBeGreaterThan(50); // ≈ un point par heure simulée
  for (const title of ['Flux in circulation', 'Reserve & real payouts', 'Merchants']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }

  // contrôles de santé : un tableau non vide avec un verdict par ligne
  const health = page.getByTestId('lab-health');
  await expect(health).toContainText(/Health checks\s*\d+\/\d+ pass/);
  expect(await health.locator('tbody tr').count()).toBeGreaterThan(0);
  await prices.screenshot({ path: 'e2e/__shots__/lab-02-prices.png' });
  await health.screenshot({ path: 'e2e/__shots__/lab-03-health.png' });
  expect(errors).toEqual([]);
});
