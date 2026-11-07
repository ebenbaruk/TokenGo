// Missions du jour (Docs/13 §7) et contrôle de la ville (§8). Un invité démo voit ses 3 missions dans Quests ; on fixe
// ses missions (route de test, jeton admin) puis il termine « Sync 4 relays » par un VRAI sync de relais : toast + pastille
// rouge ; il réclame (+40 XP +15 ƒ, la pastille disparaît), puis les 2 autres → coffre du jour (+60 ƒ + 1 Gemini).
// « Who holds the city » : la Forge du Louvre et son tenant (Sentinelle, puis Champions installés par la route de test),
// dans Quests, sur la carte (couronne à la couleur du district) et sur /pulse.
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test, ADMIN_TOKEN, ORIGIN, apiGuest, dist, drag, open, pageErrors, post, shot, startGuest, tg, walk } from './helpers.ts';

interface Badge { ready: number; claimed: number; total: number; chest: boolean; readyIds: string[] }
interface MeM { id: string; xp: number; flux: number; shards: Record<string, number>; missions: Badge }
const meOf = async (page: Page) => (await tg(page)).me as unknown as MeM;

async function knob(req: APIRequestContext, body: Record<string, unknown>) {
  const r = await req.post('/api/test/missions', { data: body, headers: { Origin: ORIGIN, Authorization: `Bearer ${ADMIN_TOKEN}` } });
  expect(r.ok(), await r.text()).toBe(true);
}
async function cityHold(req: APIRequestContext, body: { forgeId: string; userId: string | null; hoursAgo?: number }) {
  const r = await req.post('/api/test/city/hold', { data: body, headers: { Origin: ORIGIN, Authorization: `Bearer ${ADMIN_TOKEN}` } });
  expect(r.ok(), await r.text()).toBe(true);
}
async function openQuests(page: Page) {
  await page.getByTestId('quests-btn').click();
  await expect(page.getByTestId('quests-sheet')).toBeVisible();
  await expect(page.getByTestId('missions')).toBeVisible();
  await page.waitForTimeout(700); // fin de l'animation de la feuille
}
async function closeSheet(page: Page) {
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('quests-sheet')).toBeHidden();
}

test('3 daily missions → finish one with a real relay sync → red dot → claim → chest; who holds the city', async ({ page, request }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  const me0 = await meOf(page);
  expect(me0.missions).toMatchObject({ ready: 0, claimed: 0, total: 3, chest: false });

  // tirage du jour : 3 cartes, au moins une Arène/Décodage
  await openQuests(page);
  await expect(page.locator('[data-testid^="mission-"][data-state]')).toHaveCount(3);
  await expect(page.getByTestId('mission-chest')).toContainText('Claim all 3');
  await expect(page.getByTestId('quests-dot')).toHaveCount(0);
  await shot(page, 'missions-01-drawn');
  await closeSheet(page);

  // missions fixées pour un test déterministe ; « Sync 4 relays » à 3/4
  await knob(request, { userId: me0.id, kinds: ['relay_sync', 'decode', 'shops'], bump: { key: 'relay_sync', n: 3 } });
  await openQuests(page);
  await expect(page.getByTestId('mission-relay_sync-progress')).toHaveText('3/4');
  await expect(page.getByTestId('mission-relay_sync')).toHaveAttribute('data-state', 'todo');
  await shot(page, 'missions-02-progress');
  await closeSheet(page);

  // 4e relais : vrai sync → la réponse porte la pastille, le client toaste « Mission complete! »
  const s = await tg(page);
  const relay = s.world!.nodes.filter((n) => n.kind === 'relay').sort((a, b) => dist(a, s.position!) - dist(b, s.position!))[0]!;
  await walk(page, relay);
  await open(page, relay.id);
  await expect(page.getByTestId('relay-sheet')).toBeVisible();
  await drag(page, '[data-testid="sync-disc"]', 160);
  await expect(page.getByTestId('relay-loot')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await tg(page)).toasts.some((t) => t.startsWith('Mission complete!'))).toBe(true);
  expect((await meOf(page)).missions).toMatchObject({ ready: 1, readyIds: ['relay_sync'] });
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('quests-dot')).toHaveText('1');
  await shot(page, 'missions-03-dot');

  // réclamer : +40 XP +15 ƒ, la pastille disparaît
  const before = await meOf(page);
  await openQuests(page);
  await expect(page.getByTestId('mission-relay_sync')).toHaveAttribute('data-state', 'ready');
  await shot(page, 'missions-04-ready');
  await page.getByTestId('mission-relay_sync-claim').click();
  await expect(page.getByTestId('mission-relay_sync')).toHaveAttribute('data-state', 'claimed');
  await page.waitForTimeout(250);
  await shot(page, 'missions-05-claimed');
  const after = await meOf(page);
  expect(after.xp - before.xp).toBe(40);
  expect(after.flux - before.flux).toBe(15);
  expect(after.missions).toMatchObject({ ready: 0, claimed: 1 });
  await closeSheet(page);
  await expect(page.getByTestId('quests-dot')).toHaveCount(0);

  // les 2 autres → coffre du jour
  await knob(request, { userId: me0.id, bump: { key: 'decode', n: 3 } });
  await knob(request, { userId: me0.id, bump: { key: 'shops', n: 2 } });
  await openQuests(page);
  await page.getByTestId('mission-decode-claim').click();
  await expect(page.getByTestId('mission-decode')).toHaveAttribute('data-state', 'claimed');
  const pre = await meOf(page);
  await page.getByTestId('mission-shops-claim').click();
  await expect(page.getByTestId('chest-party')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(900);
  await shot(page, 'missions-06-chest');
  const fin = await meOf(page);
  expect(fin.flux - pre.flux).toBe(15 + 60);
  expect(fin.shards.gemini - pre.shards.gemini).toBe(1);
  expect(fin.missions).toMatchObject({ claimed: 3, chest: true });
  await page.getByTestId('chest-close').click();
  await expect(page.getByTestId('mission-chest')).toHaveAttribute('data-opened', '1');

  // Who holds the city : d'abord tel que le serveur l'a (Champion ou Sentinelle), comme l'API
  const ctl = (await (await request.get('/api/city/control')).json()) as { arenas: { forgeId: string; name: string; holder: string }[] };
  const louvre = ctl.arenas.find((a) => a.forgeId === 'forge:louvre')!;
  expect(ctl.arenas.length).toBeGreaterThanOrEqual(10);
  const row = page.getByTestId('city-forge:louvre');
  await row.scrollIntoViewIfNeeded();
  await expect(row).toContainText('Louvre');
  await expect(row).toHaveAttribute('data-holder', louvre.holder);
  if (louvre.holder === 'guardian') await expect(row).toHaveAttribute('title', 'Sentinel of Louvre');
  else await expect(row).toContainText(louvre.name);
  await closeSheet(page);

  // … puis avec des Champions installés (route de test) : le joueur (1er arr.) tient le Louvre, un rival (2e) Notre-Dame
  await page.request.post('/api/me/district', { data: { district: 1 }, headers: { Origin: ORIGIN } });
  const rival = await apiGuest(request);
  await post(request, '/api/me/district', { district: 2 });
  await cityHold(request, { forgeId: 'forge:louvre', userId: me0.id, hoursAgo: 3.2 });
  await cityHold(request, { forgeId: 'forge:notre-dame', userId: rival.id, hoursAgo: 27 });
  try {
    await openQuests(page);
    const mine = page.getByTestId('city-forge:louvre');
    await mine.scrollIntoViewIfNeeded();
    await expect(mine).toHaveAttribute('data-holder', 'champion');
    await expect(mine).toContainText('You!');
    await expect(mine).toContainText('1st');
    await expect(page.getByTestId('city-forge:notre-dame')).toContainText(rival.handle);
    await expect(page.getByTestId('top-champions').locator('li').first()).toContainText(rival.handle); // 27 h > 3 h
    await page.getByTestId('city-control').scrollIntoViewIfNeeded();
    await shot(page, 'missions-07-city');
    await closeSheet(page);
    // carte : la couronne du Louvre prend la couleur du 1er (badge du monde)
    const forge = (await tg(page)).world!.nodes.find((n) => n.id === 'forge:louvre')!;
    await walk(page, { lat: forge.lat - 0.0005, lng: forge.lng + 0.0003 }, { world: true });
    await expect.poll(async () => ((await tg(page)).world!.nodes.find((n) => n.id === 'forge:louvre') as unknown as { arena?: { district?: number } }).arena?.district).toBe(1);
    await page.waitForTimeout(800);
    await shot(page, 'missions-08-crown');
    // /pulse : la même carte « Who holds the city » + Top Champions
    await page.goto('/pulse');
    const card = page.getByTestId('pulse-city');
    await expect(card.getByTestId('city-forge:louvre')).toHaveAttribute('data-holder', 'champion');
    await expect(card.locator('[data-holder]')).toHaveCount(10);
    await expect(card.getByTestId('top-champions')).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await shot(page, 'missions-09-pulse');
  } finally {
    // les autres specs attendent les Sentinelles
    await cityHold(request, { forgeId: 'forge:louvre', userId: null });
    await cityHold(request, { forgeId: 'forge:notre-dame', userId: null });
  }
  expect(errors).toEqual([]);
});

test('/pulse (public, signed out) shows the 10 arenas and Top Champions', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/pulse');
  const card = page.getByTestId('pulse-city');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('city-forge:louvre')).toHaveAttribute('data-holder', 'guardian');
  await expect(card.locator('[data-holder]')).toHaveCount(10);
  await expect(card.getByText('Top Champions · 7 days')).toBeVisible();
  expect(errors).toEqual([]);
});
