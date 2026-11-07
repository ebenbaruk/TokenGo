// Marchandage : près du Louvre, on a vu les prix d'un marchand voisin, on joue la carte « rival » (vraie),
// le marchand concède une remise bornée (≤ 8 %), « Deal! » → l'inventaire et les Flux suivent le total marchandé.
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test,
  apiGuest, apiMerchant, apiMove, apiTrade, dist, open, pageErrors, shot, startGuest, tg, walk,
  type Family, type MerchantView, type WorldNode,
} from './helpers.ts';

const QTY = 3;
const sellOf = (v: MerchantView, f: Family) => v.prices.find((p) => p.family === f)!;

/** Cible T + rival R (déjà vus par le joueur) tels que R vend `f` moins cher que T, et 3 unités chez T restent abordables. */
function pickDuel(views: [WorldNode, MerchantView][], flux: number): { T: WorldNode; R: MerchantView; f: Family } | null {
  for (const f of ['deepseek', 'qwen'] as Family[]) {
    for (const [i, j] of [[0, 1], [1, 0]] as const) {
      const [tNode, t] = views[i]!;
      const r = views[j]![1];
      const pt = sellOf(t, f);
      const pr = sellOf(r, f);
      if (pt.sell === null || pr.sell === null || pt.stock < QTY + 2) continue;
      if (pr.sell < pt.sell && pt.sell * QTY + 4 <= flux) return { T: tNode, R: r, f };
    }
  }
  return null;
}

/** Un autre joueur (contexte API séparé) achète `f` chez `node` pour en faire monter le prix. */
async function raisePrice(req: APIRequestContext, node: WorldNode, f: Family) {
  await apiGuest(req, { demo: true });
  await apiMove(req, node);
  await apiTrade(req, node.merchant!.id, 'buy', f, 3);
}

async function bothViews(page: Page, a: WorldNode, b: WorldNode): Promise<[WorldNode, MerchantView][]> {
  return [[a, await apiMerchant(page.request, a.merchant!.id)], [b, await apiMerchant(page.request, b.merchant!.id)]];
}

test('haggle with a true "rival sells cheaper" card → bounded discount → Deal! applied to inventory', async ({ page, request }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  const s = await tg(page);
  const [A, B] = s.world!.nodes
    .filter((n) => n.kind === 'market' && n.merchant?.status === 'open')
    .sort((a, b) => dist(a, s.position!) - dist(b, s.position!) || a.id.localeCompare(b.id));
  expect(A && B, 'two open merchants near the Louvre').toBeTruthy();

  // le joueur « fait ses devoirs » : il consulte les prix des deux échoppes (enregistrés côté serveur, ≤ 2 h)
  let views = await bothViews(page, A!, B!);
  let duel = pickDuel(views, s.me!.flux);
  if (!duel) { // prix identiques chez les deux : un autre runner fait monter DeepSeek chez B
    await raisePrice(request, B!, 'deepseek');
    views = await bothViews(page, A!, B!);
    duel = pickDuel(views, s.me!.flux);
  }
  expect(duel, 'a rival sells cheaper for an affordable family').toBeTruthy();
  const { T, R, f } = duel!;
  const rivalPrice = sellOf(R, f).sell!;

  await walk(page, T);
  await open(page, T.merchant!.id);
  await expect(page.getByTestId('merchant-sheet')).toBeVisible();
  await page.getByTestId(`buy-${f}`).click();
  const panel = page.getByTestId('trade-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('haggle-btn')).toBeDisabled();
  await expect(page.getByTestId('haggle-why')).toHaveText('Haggle from 3 shards');
  for (let i = 1; i < QTY; i++) await panel.getByRole('button', { name: 'More' }).click();
  await expect(page.getByTestId('stepper-value')).toHaveText(String(QTY));
  await expect(page.getByTestId('quote-total').locator('small')).toContainText('+');
  await expect(page.getByTestId('haggle-btn')).toBeEnabled();
  await shot(page, 'haggle-00-panel');
  await page.getByTestId('haggle-btn').click();

  const game = page.getByTestId('haggle-game');
  await expect(game).toBeVisible();
  const rival = page.getByTestId('haggle-card-rival');
  await expect(rival).toContainText(`${R.name.split(' ')[0]} sells ${rivalPrice} ƒ`);
  await expect(page.getByTestId('haggle-cards').locator('button')).toHaveCount(3);
  const base = Number(await page.getByTestId('haggle-total').getAttribute('data-value'));
  expect(base).toBeGreaterThan(0);
  await page.waitForTimeout(400); // fin de l'animation des cartes
  await shot(page, 'haggle-01-cards');

  await rival.click();
  await expect(page.getByTestId('haggle-saved')).toBeVisible();
  const total = Number(await page.getByTestId('haggle-total').getAttribute('data-value'));
  expect(total).toBeLessThan(base);
  expect(total).toBeGreaterThanOrEqual(Math.ceil(base * 0.92)); // jamais plus de 8 %
  await expect(page.getByTestId('haggle-base')).toHaveText(`${base} ƒ`);
  await expect(page.getByTestId('haggle-saved')).toHaveText(`−${base - total} ƒ`);
  await expect(page.getByTestId('haggle-cards').locator('button')).toHaveCount(3);
  await expect(page.getByTestId('haggle-card-walk')).toBeVisible();
  await page.waitForTimeout(700); // le compteur finit de défiler
  await shot(page, 'haggle-02-rival');

  const before = (await tg(page)).me!;
  await page.getByTestId('haggle-deal').click();
  await expect(page.getByTestId('haggle-stamp')).toHaveText('DEAL!');
  await page.waitForTimeout(450);
  await shot(page, 'haggle-03-deal');
  await expect.poll(async () => (await tg(page)).me!.shards[f]).toBe(before.shards[f] + QTY);
  expect((await tg(page)).me!.flux).toBe(before.flux - total);
  await expect(game).toBeHidden();
  await expect(page.getByTestId('toast').first()).toContainText(`Deal! Bought ${QTY}`);

  // le marchand se souvient : habitué du jour + marchandage conclu ; une séance de moins aujourd'hui
  const after = (await apiMerchant(page.request, T.merchant!.id)) as MerchantView & { relation: { rep: number; hagglesLeft: number } };
  expect(after.relation.rep).toBe(2);
  expect(after.relation.hagglesLeft).toBe(1);
  expect(errors).toEqual([]);
});

test('a haggle session cannot be replayed: second Deal and a stranger are refused', async ({ page, request }) => {
  await startGuest(page);
  const s = await tg(page);
  const node = s.world!.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open')
    .sort((a, b) => dist(a, s.position!) - dist(b, s.position!) || a.id.localeCompare(b.id))[0]!;
  await walk(page, node);
  const v = await apiMerchant(page.request, node.merchant!.id);
  const fam = (['deepseek', 'qwen'] as Family[]).find((f) => sellOf(v, f).sell !== null && sellOf(v, f).stock >= QTY + 2)!;
  const post = (req: APIRequestContext, p: string, data: unknown) => req.post(`/api/merchant/${node.merchant!.id}${p}`, { data, headers: { Origin: new URL(page.url()).origin } });
  const start = await post(page.request, '/haggle', { side: 'buy', family: fam, qty: QTY });
  expect(start.ok(), await start.text()).toBe(true);
  const { haggleId } = (await start.json()) as { haggleId: string };
  // un autre joueur ne peut ni jouer ni conclure cette séance
  await apiGuest(request, { demo: true });
  await apiMove(request, node);
  const steal = await post(request, '/haggle/deal', { haggleId });
  expect(((await steal.json()) as { error: { code: string } }).error.code).toBe('EXPIRED');
  const d1 = await post(page.request, '/haggle/deal', { haggleId });
  expect(d1.ok(), await d1.text()).toBe(true);
  const d2 = await post(page.request, '/haggle/deal', { haggleId });
  expect(((await d2.json()) as { error: { code: string } }).error.code).toBe('EXPIRED');
});

test('without homework you can only bluff — the merchant reacts and patience drops', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  const s = await tg(page);
  const node = s.world!.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open')
    .sort((a, b) => dist(a, s.position!) - dist(b, s.position!) || a.id.localeCompare(b.id))[0]!;
  await walk(page, node);
  await open(page, node.merchant!.id); // seule échoppe vue : aucun prix rival connu
  const v = await apiMerchant(page.request, node.merchant!.id);
  const fam = (['deepseek', 'qwen'] as Family[]).find((f) => sellOf(v, f).sell !== null && sellOf(v, f).stock >= QTY + 2)!;
  await page.getByTestId(`buy-${fam}`).click();
  const panel = page.getByTestId('trade-panel');
  for (let i = 1; i < QTY; i++) await panel.getByRole('button', { name: 'More' }).click();
  await expect(page.getByTestId('haggle-btn')).toBeEnabled();
  await page.getByTestId('haggle-btn').click();
  await expect(page.getByTestId('haggle-card-bluff')).toBeVisible();
  await expect(page.getByTestId('haggle-card-rival')).toHaveCount(0);
  const p0 = Number(await page.getByTestId('haggle-patience').getAttribute('data-value'));
  await page.getByTestId('haggle-card-bluff').click();
  await expect(page.getByTestId('haggle-patience')).not.toHaveAttribute('data-value', String(p0));
  const face = await page.getByTestId('haggle-face').getAttribute('data-face');
  expect(['annoyed', 'neutral']).toContain(face);
  await page.waitForTimeout(500);
  await shot(page, 'haggle-04-bluff');
  // on peut toujours partir : la feuille du marchand est intacte
  const leave = page.getByTestId('haggle-leave');
  if (await leave.isVisible()) await leave.click(); else await page.getByTestId('haggle-close').click();
  await expect(page.getByTestId('haggle-game')).toBeHidden();
  await expect(page.getByTestId('merchant-sheet')).toBeVisible();
  expect(errors).toEqual([]);
});
