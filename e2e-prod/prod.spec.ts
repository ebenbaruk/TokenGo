// Parcours complet sur la démo EN LIGNE (chaîne testnet active) : npx playwright test -c playwright.prod.config.ts
// Invité Remote Scout → capture → relais → vente → First Compile → preuve de burn → soldes lus sur NEAR → Proofs « Verify on-chain ».
// Crée 1 compte invité (limite serveur : 3 par heure et par IP).
import { test, expect } from '@playwright/test';
import { dist, drag, hold, open, tg, walk } from '../e2e/helpers.ts';

const RPC = 'https://test.rpc.fastnear.com';
const SHOTS = 'e2e-prod/__shots__';
async function onChain(account: string, tokens: string[]): Promise<number[]> {
  const args = Buffer.from(JSON.stringify({ account_id: account, token_ids: tokens })).toString('base64');
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'optimistic', account_id: 'tokengo.testnet', method_name: 'mt_batch_balance_of', args_base64: args } }) });
  const j = (await r.json()) as { result: { result: number[] } };
  return (JSON.parse(Buffer.from(j.result.result).toString()) as string[]).map(Number);
}
async function txStatus(hash: string): Promise<string> {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tx', params: { tx_hash: hash, sender_account_id: 'tokengo.testnet', wait_until: 'FINAL' } }) });
  const j = (await r.json()) as { result?: { status: Record<string, unknown>; receipts_outcome: { outcome: { logs: string[] } }[] } };
  if (!j.result) return 'unknown';
  const logs = j.result.receipts_outcome.flatMap((x) => x.outcome.logs).join(' ');
  return `${'SuccessValue' in j.result.status ? 'success' : 'failure'}${logs.includes('mt_burn') ? ' +mt_burn' : ''}`;
}

test('prod: guest → catch → relay → sell → First Compile with on-chain burn proof → Verify on-chain', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?demo=1');
  await expect(page.getByTestId('demo-season')).toBeVisible();
  await page.getByTestId('play-guest').click();
  await expect(page.getByTestId('map')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__tg().world?.spawns.length, null, { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/1-map.png` });

  // 1. capture
  let s = await tg(page);
  const tut = s.world!.spawns.find((x) => x.id.startsWith('tut:'))!;
  await walk(page, tut);
  await page.getByTestId('action-btn').click();
  await expect(page.getByTestId('catch-screen')).toBeVisible();
  for (let i = 0; i < 3 && !(await page.getByTestId('catch-result').isVisible()); i++) { await page.waitForTimeout(600); await page.getByTestId('catch-screen').click({ force: true }); }
  await expect(page.getByTestId('catch-result')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/2-catch.png` });
  await page.getByTestId('catch-continue').click();
  await expect.poll(async () => (await tg(page)).me!.tutorial.caught).toBe(true);

  // 2. relais
  s = await tg(page);
  const relay = s.world!.nodes.filter((n) => n.kind === 'relay').sort((a, b) => dist(a, s.position!) - dist(b, s.position!))[0]!;
  await walk(page, relay); await open(page, relay.id);
  await expect(page.getByTestId('relay-sheet')).toBeVisible();
  await drag(page, '[data-testid="sync-disc"]', 160);
  await expect(page.getByTestId('relay-loot')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/3-relay.png` });
  await expect.poll(async () => (await tg(page)).me!.tutorial.synced).toBe(true);
  await page.keyboard.press('Escape'); await page.getByTestId('sheet-close').click().catch(() => {});

  // 3. vente d'un Gemini
  s = await tg(page);
  const market = s.world!.nodes.filter((n) => n.kind === 'market' && n.merchant?.status === 'open').sort((a, b) => dist(a, s.position!) - dist(b, s.position!))[0]!;
  await walk(page, market); await open(page, market.merchant!.id);
  await expect(page.getByTestId('merchant-sheet')).toBeVisible();
  await page.getByTestId('sell-gemini').click();
  await expect(page.getByTestId('quote-total')).toBeVisible();
  await drag(page, '[data-testid="slide-confirm-knob"]', 320);
  await expect.poll(async () => (await tg(page)).me!.tutorial.traded, { timeout: 15_000 }).toBe(true);
  await page.screenshot({ path: `${SHOTS}/4-trade.png` });
  await page.getByTestId('sheet-close').click().catch(() => {});

  // 4. First Compile → preuve de burn
  s = await tg(page);
  const before = s.me!.shards;
  const forge = s.world!.nodes.find((n) => n.id === 'forge:louvre')!;
  await walk(page, forge); await open(page, forge.id);
  await expect(page.getByTestId('forge-screen')).toBeVisible();
  await page.getByTestId('recipe-first').click();
  await hold(page, 'compile-btn');
  const ticket = page.getByTestId('credit-ticket');
  await expect(ticket).toBeVisible({ timeout: 30_000 });
  await expect(ticket).toContainText('Compiled! Demo credits for now.');
  await expect(page.getByTestId('ticket-demo')).toBeVisible();
  const res = (await tg(page)).lastResult as { burnTx: string | null; payoutNusd: number };
  console.log('burnTx', res.burnTx, 'payout', res.payoutNusd);
  expect(res.burnTx, 'burn proof tx hash').toBeTruthy();
  const proof = page.getByRole('link', { name: /Burn proof/ });
  await expect(proof).toHaveAttribute('href', new RegExp(`nearblocks\\.io/txns/${res.burnTx}`));
  await page.screenshot({ path: `${SHOTS}/5-ticket.png` });
  const st = await txStatus(res.burnTx!);
  console.log('burn tx on NEAR:', st);
  expect(st).toContain('success');
  expect(st).toContain('mt_burn');

  // 5. soldes : jeu == chaîne
  const me = (await tg(page)).me!;
  expect(me.shards.deepseek).toBe(before.deepseek - 2);
  expect(me.shards.qwen).toBe(before.qwen - 1);
  const account = (await (await page.request.get('/api/proofs')).json() as { account: string }).account;
  await expect.poll(async () => {
    const [flux, ds, qw, ge] = await onChain(account, ['flux', 'shard:deepseek', 'shard:qwen', 'shard:gemini']);
    return [flux, ds, qw, ge];
  }, { timeout: 60_000, intervals: [3000] }).toEqual([(await tg(page)).me!.flux, me.shards.deepseek, me.shards.qwen, me.shards.gemini]);
  console.log('account', account, 'on-chain == in-game ✔');

  // 6. Playground (crédits démo)
  await page.getByTestId('try-now').click();
  await expect(page.getByTestId('credits-screen')).toBeVisible();
  await expect(page.getByTestId('credits-demo-season')).toBeVisible();
  await page.getByTestId('ask-btn').click();
  await expect(page.getByTestId('answer')).not.toBeEmpty({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/6-playground.png` });
  await page.getByTestId('sheet-close').click().catch(() => {});
  await page.keyboard.press('Escape');

  // 7. Proofs → Verify on-chain (depuis le navigateur)
  // feuilles empilées (crédits, « Pick your district »…) : on recharge la page, la session reste
  await page.reload();
  await page.getByTestId('play-guest').click();
  await expect(page.getByTestId('map')).toBeVisible();
  const district = page.getByRole('dialog').filter({ hasText: 'Pick your district' });
  if (await district.isVisible({ timeout: 4000 }).catch(() => false)) await district.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(800);
  await page.getByTestId('level').click();
  await page.getByTestId('menu-profile').click();
  await page.getByTestId('open-proofs').click();
  await expect(page.getByTestId('proofs-sheet')).toBeVisible();
  await expect(page.getByTestId('near-account')).toHaveText(account);
  await page.getByTestId('verify-btn').click();
  await expect(page.getByTestId('verify-result')).toContainText('Everything matches the chain.', { timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/7-proofs.png` });
  expect(errors).toEqual([]);
});
