// Capture d'un éclat ordinaire (hors tutoriel) → inventaire +1 ; éclat trop loin → bouton désactivé + raison, serveur TOO_FAR.
import { expect, test, dist, pageErrors, post, shot, startGuest, tapOnTarget, tg, walk, type LatLng, type TG } from './helpers.ts';

const COMMON = ['deepseek', 'qwen'];
// rayons d'action côté client en Demo Walk (précision 5 m) : éclat/relais/marché 40 + 5, forge 60 + 5
const RADIUS = { spawn: 45, relay: 45, market: 45, forge: 65 } as const;

/** Distance du plus proche élément actionnable (éclat ou lieu), moins son rayon d'action. */
function clearance(s: TG, p: LatLng): number {
  const sp = s.world!.spawns.map((x) => dist(x, p) - RADIUS.spawn);
  const nd = s.world!.nodes.map((n) => dist(n, p) - RADIUS[n.kind]);
  return Math.min(...sp, ...nd);
}

test('walk to a regular shard → catch → inventory +1', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  let s = await tg(page);
  const start = s.position!;
  // éclat ordinaire déterministe : commun d'abord (ne fuit jamais), puis le plus proche. Les éclats changent toutes
  // les 10 min : s'il n'y en a pas autour du départ, on se déplace (anneaux fixes) jusqu'à en voir un.
  const pick = (st: TG) => st.world!.spawns
    // communs seulement : un Rare/Épique déclenche le Décodage obligatoire (testé dans decode.spec.ts)
    .filter((x) => !x.id.startsWith('tut:') && COMMON.includes(x.family) && x.expiresAt > Date.now() + 20_000)
    .sort((a, b) => Number(COMMON.includes(b.family)) - Number(COMMON.includes(a.family)) || dist(a, st.position!) - dist(b, st.position!))[0];
  let regular = pick(s);
  for (let k = 0; !regular && k < 8; k++) {
    const a = (k * Math.PI) / 4;
    await walk(page, { lat: start.lat + (200 * Math.cos(a)) / 111_000, lng: start.lng + (200 * Math.sin(a)) / 73_000 }, { world: true });
    s = await tg(page);
    regular = pick(s);
  }
  expect(regular, 'a regular shard spawns near the Louvre').toBeTruthy();
  const fam = regular!.family;
  const before = s.me!.shards[fam] ?? 0;

  await walk(page, regular!);
  // on est pile sur l'éclat : le bouton contextuel le vise (le plus proche dans le rayon)
  await expect(page.getByTestId('action-btn')).toBeEnabled();
  await expect(page.getByTestId('action-btn')).toHaveText(/Catch/);
  await page.getByTestId('action-btn').click();
  await expect(page.getByTestId('catch-screen')).toBeVisible();
  await expect(page.getByTestId('catch-screen').locator('h2')).toHaveText(new RegExp(`^${fam} Shard$`, 'i'));
  await expect(page.getByText('Tap when the ring hits the dashed circle!')).toBeVisible();
  await shot(page, 'catch-01-lock-on');
  for (let i = 0; i < 3 && !(await page.getByTestId('catch-result').isVisible()); i++) {
    await tapOnTarget(page);
    await page.getByTestId('catch-result').waitFor({ timeout: 2500 }).catch(() => {});
  }
  await expect(page.getByTestId('catch-result')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('catch-result')).toContainText(/\+\d+ \w+ Shard/);
  await shot(page, 'catch-02-result');
  const res = (await tg(page)).lastResult as { result: string; qty: number };
  expect(['perfect', 'good']).toContain(res.result);
  expect(res.qty).toBeGreaterThanOrEqual(1);
  await page.getByTestId('catch-continue').click();
  await expect(page.getByTestId('catch-screen')).toBeHidden();
  // inventaire : +qty dans le store et côté serveur
  await expect.poll(async () => (await tg(page)).me!.shards[fam]).toBe(before + res.qty);
  const me = (await (await page.request.get('/api/me')).json()) as { shards: Record<string, number> };
  expect(me.shards[fam]).toBe(before + res.qty);
  expect(errors).toEqual([]);
});

test('a shard far away: Scout offers "Fly there", server says TOO_FAR', async ({ page }) => {
  const errors = pageErrors(page);
  await startGuest(page);
  const start = (await tg(page)).position!;
  // cherche un point dégagé (rien d'actionnable à portée) sur des anneaux autour du départ, ordre fixe
  let spot: LatLng | null = null;
  outer: for (const r of [120, 200, 280]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const p = { lat: start.lat + (r * Math.cos(a)) / 111_000, lng: start.lng + (r * Math.sin(a)) / 73_000 };
      await walk(page, p, { world: true });
      if (clearance(await tg(page), p) > 5) { spot = p; break outer; }
    }
  }
  expect(spot, 'found a spot with nothing in range').toBeTruthy();
  const s = await tg(page);
  const far = s.world!.spawns.filter((x) => dist(x, spot!) > 60).sort((a, b) => dist(a, spot!) - dist(b, spot!))[0]!;
  expect(far).toBeTruthy();

  // Remote Scout : hors de portée, le gros bouton propose de voler jusqu'à la cible (jamais de bouton mort)
  const btn = page.getByTestId('action-btn');
  await expect(btn).toBeEnabled();
  await expect(btn).toHaveText(/Fly there/);
  await expect(page.getByTestId('action-btn-hint')).toHaveText(/^\d+ m · .+/);
  await shot(page, 'catch-03-too-far');

  // le serveur est autoritaire : la même capture forcée par l'API est refusée
  const r = await post(page.request, '/api/catch/start', { spawnId: far.id });
  expect(r.status()).toBe(400);
  const body = await r.json() as { error: { code: string; message: string; distance: number } };
  expect(body.error.code).toBe('TOO_FAR');
  expect(body.error.message).toMatch(/m away/);
  expect(body.error.distance).toBeGreaterThan(60);
  expect(errors).toEqual([]);
});
