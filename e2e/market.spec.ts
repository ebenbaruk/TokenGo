// Marchands : acheter / vendre, « Why this price? », total du devis = somme des prix unitaires,
// marchand en fermeture qui n'achète plus, PRICE_MOVED quand un autre joueur bouge le prix entre devis et confirmation.
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test,
  apiGuest, apiMerchant, apiMove, apiQuote, apiTrade, dist, drag, open, pageErrors, shot, startGuest, tg, walk,
  type Family, type MerchantView, type PriceRow, type WorldNode,
} from './helpers.ts';

async function nearestMarket(page: Page, status: (s: string) => boolean): Promise<WorldNode> {
  const s = await tg(page);
  const m = s.world!.nodes
    .filter((n) => n.kind === 'market' && n.merchant && status(n.merchant.status))
    .sort((a, b) => dist(a, s.position!) - dist(b, s.position!) || a.id.localeCompare(b.id))[0];
  expect(m, 'a matching merchant is in the visible world').toBeTruthy();
  return m!;
}

/** Ouvre la feuille du marchand et attend ses prix. */
async function openShop(page: Page, node: WorldNode) {
  await walk(page, node);
  await open(page, node.merchant!.id);
  await expect(page.getByTestId('merchant-sheet')).toBeVisible();
  await expect(page.getByTestId('row-deepseek')).toBeVisible();
}

/** Lit le devis affiché : total + prix unitaires (« a + b » quand qty > 1). */
async function shownQuote(page: Page): Promise<{ total: number; units: number[] }> {
  const box = page.getByTestId('quote-total');
  await expect(box.locator('b')).toBeVisible();
  const total = Number(await box.locator('b').textContent());
  const small = (await box.locator('small').textContent()) ?? '';
  const units = small.includes('+') ? small.split('+').map((x) => Number(x.trim())) : [total];
  return { total, units };
}

/**
 * Fait monter le prix d'une famille chez un marchand : des invités démo successifs (60 ƒ chacun) l'achètent
 * jusqu'à ce que le devis d'une unité diffère de `from`. Renvoie le nouveau prix d'une unité.
 */
async function moveThePrice(req: APIRequestContext, node: WorldNode, family: Family, from: number): Promise<number> {
  const mId = node.merchant!.id;
  let now = from;
  for (let i = 0; i < 8 && now === from; i++) {
    const g = await apiGuest(req, { demo: true });
    await apiMove(req, node);
    const qty = Math.max(1, Math.floor(g.flux / Math.ceil(now * 1.3)));
    await apiTrade(req, mId, 'buy', family, qty);
    // le devis d'une unité donne le nouveau prix ; si l'acheteur n'a plus assez, l'erreur INSUFFICIENT le porte aussi
    const q = await apiQuote(req, mId, 'buy', family, 1);
    const body = (await q.json()) as { total?: number; error?: { code: string; total?: number } };
    expect(q.ok() || body.error?.code === 'INSUFFICIENT', JSON.stringify(body)).toBe(true);
    now = (q.ok() ? body.total : body.error!.total)!;
  }
  return now;
}

const cheapestBuyable = (m: MerchantView, flux: number, qty: number): PriceRow =>
  m.prices
    .filter((p) => p.sell !== null && p.stock >= qty + 5 && p.sell * qty * 1.5 <= flux)
    .sort((a, b) => a.sell! - b.sell! || a.family.localeCompare(b.family))[0]!;

test('buy and sell with "Why this price?", quote total = sum of unit prices', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  const node = await nearestMarket(page, (s) => s === 'open');
  await openShop(page, node);
  const mId = node.merchant!.id;
  let me = (await tg(page)).me!;
  let view = await apiMerchant(page.request, mId);

  const fam = cheapestBuyable(view, me.flux, 2);
  expect(fam, 'merchant sells something affordable').toBeTruthy();

  // « Why this price? » : phrase chiffrée cohérente avec les prix affichés (ligne ★ : test dédié plus bas)
  const plain = view.prices.filter((p) => !p.specialty && p.sell !== null && p.buy !== null).sort((a, b) => a.family.localeCompare(b.family))[0]!;
  expect(plain, 'a non-specialty family with both prices').toBeTruthy();
  await page.getByTestId(`why-${plain.family}`).click();
  const why = page.getByTestId('why-popover');
  await expect(why).toContainText(/^Base [\d.]+ ƒ × scarcity [\d.]+ \(I hold \d+, I want \d+\)/);
  await expect(why).toContainText(`I sell at ${plain.sell} ƒ, I buy at ${plain.buy} ƒ.`);
  await expect(page.getByTestId(`buy-${plain.family}`)).toContainText(String(plain.sell));
  await expect(page.getByTestId(`sell-${plain.family}`)).toContainText(String(plain.buy));
  await shot(page, 'market-01-why');
  await page.getByTestId(`why-${plain.family}`).click();
  await expect(why).toBeHidden();

  // achat de 2 : devis exact, prix glissant unité par unité
  await page.getByTestId(`buy-${fam.family}`).click();
  await expect(page.getByTestId('trade-panel')).toBeVisible();
  await page.getByTestId('trade-panel').getByRole('button', { name: 'More' }).click();
  await expect(page.getByTestId('stepper-value')).toHaveText('2');
  await expect(page.getByTestId('quote-total').locator('small')).toContainText('+');
  const q = await shownQuote(page);
  expect(q.units).toHaveLength(2);
  expect(q.units[0]).toBe(fam.sell);
  expect(q.units.reduce((a, b) => a + b, 0)).toBe(q.total);
  await expect(page.getByTestId('slide-confirm')).toHaveAttribute('aria-label', `Slide to buy · ${q.total} ƒ`);
  await shot(page, 'market-02-quote');
  const beforeShards = me.shards[fam.family];
  await drag(page, '[data-testid="slide-confirm-knob"]', 320);
  await expect.poll(async () => (await tg(page)).me!.shards[fam.family]).toBe(beforeShards + 2);
  me = (await tg(page)).me!;
  expect(me.flux).toBe(60 - q.total);
  await expect(page.getByTestId('trade-panel')).toBeHidden();

  // vente d'1 éclat que le marchand achète
  view = await apiMerchant(page.request, mId);
  const sellable = view.prices.filter((p) => p.buy !== null && (me.shards[p.family] ?? 0) > 0).sort((a, b) => a.family.localeCompare(b.family))[0]!;
  expect(sellable, 'merchant buys a shard we hold').toBeTruthy();
  await page.getByTestId(`sell-${sellable.family}`).click();
  const s1 = await shownQuote(page);
  expect(s1.total).toBe(sellable.buy);
  await expect(page.getByTestId('slide-confirm')).toHaveAttribute('aria-label', `Slide to sell · ${s1.total} ƒ`);
  const held = me.shards[sellable.family];
  await drag(page, '[data-testid="slide-confirm-knob"]', 320);
  await expect.poll(async () => (await tg(page)).me!.shards[sellable.family]).toBe(held - 1);
  expect((await tg(page)).me!.flux).toBe(me.flux + s1.total);
  await expect(page.getByTestId('toast').first()).toContainText(/Sold 1/);
  await shot(page, 'market-03-sold');
  expect(errors).toEqual([]);
});

test('a closing merchant does not buy shards, and says why', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  const node = await nearestMarket(page, (s) => s !== 'open'); // le marchand « en difficulté » semé près du Louvre
  await openShop(page, node);
  const sheet = page.getByTestId('merchant-sheet');
  await expect(sheet).toContainText(/Closing|Closed/);
  const view = await apiMerchant(page.request, node.merchant!.id);
  expect(view.status).not.toBe('open');
  // le joueur (démo) a des Gemini, mais personne ne les rachète ici
  const me = (await tg(page)).me!;
  expect(me.shards.gemini).toBeGreaterThan(0);
  for (const f of ['deepseek', 'qwen', 'gemini', 'gpt', 'claude'] as Family[]) {
    await expect(page.getByTestId(`sell-${f}`)).toBeDisabled();
    await expect(page.getByTestId(`sell-${f}`)).toContainText(/not buying|till empty|closed/);
  }
  await page.getByTestId('why-gemini').click();
  await expect(page.getByTestId('why-popover')).toContainText(view.status === 'closing' ? 'Not buying while I’m closing.' : 'closed');
  await shot(page, 'market-04-closing');
  // le serveur refuse aussi la vente forcée
  const r = await apiQuote(page.request, node.merchant!.id, 'sell', 'gemini', 1);
  expect(r.status()).toBe(400);
  expect(((await r.json()) as { error: { code: string } }).error.code).toBe(view.status === 'closing' ? 'NOT_BUYING' : 'CLOSED');
  expect(errors).toEqual([]);
});

test('PRICE_MOVED: another player trades between quote and confirm → fresh quote shown', async ({ page, browser }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  const node = await nearestMarket(page, (s) => s === 'open');
  await openShop(page, node);
  const mId = node.merchant!.id;
  const me = (await tg(page)).me!;
  const fam = cheapestBuyable(await apiMerchant(page.request, mId), me.flux, 1);
  expect(fam).toBeTruthy();

  await page.getByTestId(`buy-${fam.family}`).click();
  const first = await shownQuote(page);
  await expect(page.getByTestId('slide-confirm')).toHaveAttribute('aria-label', `Slide to buy · ${first.total} ƒ`);

  // d'autres joueurs (invités démo, 60 ƒ chacun) achètent cette famille jusqu'à ce que le prix unitaire change
  const other = await browser.newContext();
  try {
    const now = await moveThePrice(other.request, node, fam.family, first.total);
    expect(now, 'the other player moved the price').not.toBe(first.total);

    // confirmation avec l'ancien devis → le serveur répond PRICE_MOVED, l'UI le dit et re-devise
    const traded = page.waitForResponse((r) => r.url().endsWith(`/trade`) && r.request().method() === 'POST');
    await drag(page, '[data-testid="slide-confirm-knob"]', 320);
    const resp = await traded;
    expect(resp.status()).toBe(409);
    expect(((await resp.json()) as { error: { code: string; total: number } }).error).toMatchObject({ code: 'PRICE_MOVED', total: now });
    await expect(page.getByTestId('toasts')).toContainText('Price moved — here’s a fresh quote.');
    await expect(page.getByTestId('slide-confirm')).toHaveAttribute('aria-label', `Slide to buy · ${now} ƒ`);
    expect((await shownQuote(page)).total).toBe(now);
    expect((await tg(page)).me!.shards[fam.family]).toBe(me.shards[fam.family]); // rien n'a bougé
    await shot(page, 'market-05-price-moved');

    // le nouveau devis passe
    await drag(page, '[data-testid="slide-confirm-knob"]', 320);
    await expect.poll(async () => (await tg(page)).me!.shards[fam.family]).toBe(me.shards[fam.family] + 1);
    expect((await tg(page)).me!.flux).toBe(me.flux - now);
  } finally {
    await other.close();
  }
  expect(errors).toEqual([]);
});

// Régression : à 390 px, sur une ligne « spécialité ★ », la sparkline recouvrait le bouton ⓘ (tap perdu).
test('"Why this price?" is tappable on a specialty (★) row', async ({ page }) => {
  await startGuest(page);
  const node = await nearestMarket(page, (s) => s === 'open');
  await openShop(page, node);
  const view = await apiMerchant(page.request, node.merchant!.id);
  const spec = view.prices.find((p) => p.specialty)!;
  expect(spec).toBeTruthy();
  await page.getByTestId(`why-${spec.family}`).click({ timeout: 5000 });
  await expect(page.getByTestId('why-popover')).toBeVisible();
});

// Régression : après un PRICE_MOVED, la fiche du marchand est rechargée (lignes et sous-titre au nouveau prix).
test('after PRICE_MOVED the shop rows show the moved price too', async ({ page, browser }) => {
  await startGuest(page);
  const node = await nearestMarket(page, (s) => s === 'open');
  await openShop(page, node);
  const mId = node.merchant!.id;
  const fam = cheapestBuyable(await apiMerchant(page.request, mId), (await tg(page)).me!.flux, 1);
  await page.getByTestId(`buy-${fam.family}`).click();
  const first = await shownQuote(page);
  const other = await browser.newContext();
  const now = await moveThePrice(other.request, node, fam.family, first.total).finally(() => other.close());
  await drag(page, '[data-testid="slide-confirm-knob"]', 320);
  await expect(page.getByTestId('slide-confirm')).toHaveAttribute('aria-label', `Slide to buy · ${now} ƒ`);
  await expect(page.getByTestId(`buy-${fam.family}`)).toContainText(`${now}`);
  await expect(page.getByTestId('trade-panel')).toContainText(`${now} ƒ for the first one`);
});
