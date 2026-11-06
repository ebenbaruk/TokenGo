// City Pulse (/pulse) : un autre joueur fait un trade par l'API → le ticker l'affiche en quelques secondes (SSE).
import { expect, test, LOUVRE, apiGuest, apiMerchant, apiMove, apiTrade, dist, merchantIdOf, pageErrors, shot, worldNodes } from './helpers.ts';

test('the live ticker receives a trade over SSE', async ({ page, browser }) => {
  const errors = pageErrors(page);
  const stream = page.waitForResponse((r) => r.url().endsWith('/api/pulse/stream'));
  await page.goto('/pulse');
  await expect(page.getByTestId('pulse-page')).toBeVisible();
  expect((await stream).status()).toBe(200);
  await expect(page.getByText('connecting…')).toHaveCount(0); // EventSource ouvert
  const ticker = page.getByTestId('pulse-ticker');
  await expect(ticker).toBeVisible();
  await shot(page, 'pulse-01-before');

  // autre joueur, autre contexte : invité démo devant le marchand ouvert le plus proche du Louvre
  const other = await browser.newContext();
  try {
    const me = await apiGuest(other.request, { demo: true });
    const markets = worldNodes().filter((n) => n.kind === 'market').sort((a, b) => dist(a, LOUVRE) - dist(b, LOUVRE));
    let traded: { name: string; total: number } | null = null;
    for (const n of markets.slice(0, 5)) {
      const m = await apiMerchant(other.request, merchantIdOf(n.id));
      const fam = m.prices.filter((p) => p.sell !== null && p.stock > 2 && p.sell <= me.flux).sort((a, b) => a.sell! - b.sell!)[0];
      if (m.status !== 'open' || !fam) continue;
      await apiMove(other.request, n);
      const t0 = Date.now();
      const total = await apiTrade(other.request, m.id, 'buy', fam.family, 1);
      traded = { name: m.name, total };
      // le ticker n'est rechargé en HTTP que toutes les 30 s : l'apparition en < 5 s vient du flux SSE
      const line = ticker.locator('li').filter({ hasText: `${me.handle} bought 1 ${fam.family} from ${m.name} · ${total} ƒ` });
      await expect(line).toBeVisible({ timeout: 5_000 });
      expect(Date.now() - t0).toBeLessThan(5_000);
      await expect(ticker.locator('li').first()).toContainText(me.handle); // le plus récent en haut
      break;
    }
    expect(traded, 'found an open merchant near the Louvre').toBeTruthy();
  } finally {
    await other.close();
  }
  await ticker.scrollIntoViewIfNeeded();
  await shot(page, 'pulse-02-ticker');
  expect(errors).toEqual([]);
});
