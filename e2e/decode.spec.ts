// Décodage « Next token » (Docs/13 §3) : Rare/Épique → carte DECODE obligatoire après le Lock-on (faux → hallucination,
// bon → capture) ; Commun → bouton « Decode bonus » facultatif (+XP, aucun éclat).
// La bonne réponse ne quitte jamais le serveur : la spec la lit via GET /api/test/decode/:id, route montée seulement
// en NODE_ENV=test et protégée par le jeton admin (absente en production).
import type { Page } from '@playwright/test';
import { expect, test, ADMIN_TOKEN, ORIGIN, dist, pageErrors, shot, startGuest, tapOnTarget, tg, walk, type Spawn, type TG } from './helpers.ts';

const RARE = ['gpt', 'claude'];
const COMMON = ['deepseek', 'qwen'];

test.afterAll(async ({ request }) => {
  await request.post('/api/admin/event/end', { headers: { Origin: ORIGIN, Authorization: `Bearer ${ADMIN_TOKEN}` } });
});

const correctId = async (page: Page, attemptId: string): Promise<string> => {
  const r = await page.request.get(`/api/test/decode/${attemptId}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } });
  expect(r.ok()).toBe(true);
  const id = ((await r.json()) as { correctId: string | null }).correctId;
  expect(id, 'a pending decode on the server').toBeTruthy();
  return id!;
};

async function play(page: Page) {
  await startGuest(page);
  const skip = page.getByTestId('tutorial-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

/** Cherche un éclat des familles voulues (anneaux fixes autour du départ), en excluant `skip`. */
async function findSpawn(page: Page, families: string[], skip: Set<string> = new Set()): Promise<Spawn> {
  const start = (await tg(page)).position!;
  const pick = (st: TG) => st.world!.spawns
    .filter((x) => families.includes(x.family) && !x.id.startsWith('tut:') && !skip.has(x.id) && x.expiresAt > Date.now() + 30_000)
    .sort((a, b) => dist(a, st.position!) - dist(b, st.position!))[0];
  let sp = pick(await tg(page));
  for (const r of [150, 300, 450]) {
    for (let k = 0; !sp && k < 8; k++) {
      const a = (k * Math.PI) / 4;
      await walk(page, { lat: start.lat + (r * Math.cos(a)) / 111_000, lng: start.lng + (r * Math.sin(a)) / 73_000 }, { world: true });
      sp = pick(await tg(page));
    }
    if (sp) break;
  }
  expect(sp, `a ${families.join('/')} shard nearby`).toBeTruthy();
  return sp!;
}

/** Ouvre la capture d'un éclat et renvoie l'attemptId (réponse de /api/catch/start). */
async function openCatch(page: Page, sp: Spawn): Promise<string> {
  await walk(page, sp);
  await expect(page.getByTestId('action-btn')).toHaveText(/Catch/);
  const started = page.waitForResponse((r) => r.url().endsWith('/api/catch/start'));
  await page.getByTestId('action-btn').click();
  await expect(page.getByTestId('catch-screen')).toBeVisible();
  return ((await (await started).json()) as { attemptId: string }).attemptId;
}


/** Joue le Lock-on jusqu'à la carte DECODE (ou un résultat). */
async function lockOn(page: Page) {
  const card = page.getByTestId('decode-card');
  const result = page.getByTestId('catch-result');
  for (let i = 0; i < 3 && !(await card.isVisible()) && !(await result.isVisible()); i++) {
    await tapOnTarget(page);
    await card.or(result).first().waitFor({ timeout: 4000 }).catch(() => {});
  }
}

/** Ferme l'écran de capture (Continue, ou fermeture automatique déjà faite). */
async function closeCatch(page: Page) {
  await page.getByTestId('catch-continue').click({ timeout: 1500 }).catch(() => {});
  await expect(page.getByTestId('catch-screen')).toBeHidden({ timeout: 5000 });
}

/**
 * Ouvre la capture d'un éclat rare et joue le Lock-on jusqu'à la carte DECODE. Si les 3 taps ratent (machine chargée)
 * ou si l'éclat fuit, on passe à un autre éclat rare.
 */
async function rareToDecode(page: Page, tried: Set<string>): Promise<{ sp: Spawn; attemptId: string }> {
  for (let k = 0; k < 4; k++) {
    const sp = await findSpawn(page, RARE, tried);
    tried.add(sp.id);
    const attemptId = await openCatch(page, sp);
    await lockOn(page);
    if (await page.getByTestId('decode-card').isVisible()) return { sp, attemptId };
    await closeCatch(page);
  }
  throw new Error('never reached the DECODE card');
}

test('rare shard: lock-on → DECODE card → wrong token hallucinates → right token catches it', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = pageErrors(page);
  await play(page);
  // ruée vers l'or : plus d'éclats GPT autour du Louvre (événement borné, terminé après la spec)
  const ev = await page.request.post('/api/admin/event', { data: { kind: 'gold_rush', family: 'gpt', zone: 'louvre', minutes: 20 }, headers: { Origin: ORIGIN, Authorization: `Bearer ${ADMIN_TOKEN}` } });
  expect(ev.ok()).toBe(true);
  const tried = new Set<string>();
  let { sp, attemptId } = await rareToDecode(page, tried);

  const card = page.getByTestId('decode-card');
  const result = page.getByTestId('catch-result');
  await expect(card).toHaveAttribute('data-mode', 'required');
  await expect(page.getByTestId('decode-prompt')).toContainText('___');
  await expect(card.locator('[data-choice-id]')).toHaveCount(3);
  // rien n'est donné avant la réponse
  expect(((await tg(page)).lastResult as { result: string }).result).toBe('decode');

  // 1) mauvais jeton → « hallucinated… » (glitch). La capture d'écran peut être lente sur une machine chargée :
  //    si le chrono de 4 s expire avant le clic, c'est aussi une hallucination (verdict « late »).
  const right = await correctId(page, attemptId);
  await page.waitForTimeout(450); // entrée des jetons
  await shot(page, 'decode-01-card');
  await card.locator(`[data-choice-id]:not([data-choice-id="${right}"])`).first().click({ timeout: 1500 }).catch(() => {});
  await expect(page.getByTestId('decode-bad')).toBeVisible();
  await expect(card).toHaveAttribute('data-verdict', /^(wrong|late)$/);
  await expect(card.locator(`[data-choice-id="${right}"]`)).toHaveAttribute('data-state', 'right');
  await shot(page, 'decode-02-hallucinated');
  await expect(card).toBeHidden({ timeout: 4000 });

  /** Après une hallucination : fuite (on change d'éclat) ou relance du Lock-on sur la même tentative. */
  const afterHallucination = async () => {
    if (await result.isVisible()) {
      await expect(result).toContainText(/It hallucinated|Missed/);
      await closeCatch(page);
      ({ sp, attemptId } = await rareToDecode(page, tried));
      return;
    }
    await lockOn(page);
    if (!(await card.isVisible())) { // dernier essai raté
      await closeCatch(page);
      ({ sp, attemptId } = await rareToDecode(page, tried));
    }
  };
  if (await result.isVisible()) await shot(page, 'decode-02b-fled');
  else await expect(page.getByText('Tap when the ring hits the dashed circle!')).toBeVisible(); // le Lock-on reprend
  await afterHallucination();

  // 2) bon jeton → DECODED! → capture comme aujourd'hui (on recommence si la machine était trop lente pour le chrono)
  let fam = sp.family;
  let famBefore = 0;
  for (let k = 0; k < 3; k++) {
    fam = sp.family;
    famBefore = (await tg(page)).me!.shards[fam] ?? 0;
    await expect(card).toBeVisible();
    await card.locator(`[data-choice-id="${await correctId(page, attemptId)}"]`).click({ timeout: 2500 }).catch(() => {});
    await expect(card).toHaveAttribute('data-verdict', /./);
    if ((await card.getAttribute('data-verdict')) === 'correct') break;
    await expect(card).toBeHidden({ timeout: 4000 });
    await afterHallucination();
  }
  await expect(page.getByTestId('decode-ok')).toBeVisible();
  await shot(page, 'decode-03-decoded');
  await expect(result).toBeVisible({ timeout: 4000 });
  await expect(result).toContainText(/\+\d+ \w+ Shard/);
  await expect(result).toContainText('Decoded');
  const res = (await tg(page)).lastResult as { result: string; qty: number };
  await shot(page, 'decode-04-result');
  expect(['perfect', 'good']).toContain(res.result);
  await expect(page.getByTestId('decode-bonus')).toHaveCount(0); // pas de bonus sur un rare
  await closeCatch(page);
  await expect.poll(async () => (await tg(page)).me!.shards[fam]).toBe(famBefore + res.qty);
  expect(errors).toEqual([]);
});

test('common shard: caught as today, optional "Decode bonus" → +5 XP, no extra shard', async ({ page }) => {
  const errors = pageErrors(page);
  await play(page);
  const sp = await findSpawn(page, COMMON);
  const attemptId = await openCatch(page, sp);
  await lockOn(page);
  const result = page.getByTestId('catch-result');
  await expect(result).toBeVisible();
  await expect(page.getByTestId('decode-card')).toHaveCount(0); // pas de Décodage obligatoire
  const caught = (await tg(page)).lastResult as { qty: number };
  const bonusBtn = page.getByTestId('decode-bonus');
  await expect(bonusBtn).toBeVisible();
  await expect(page.getByTestId('catch-continue')).toBeVisible();
  await shot(page, 'decode-05-bonus-button');
  const me0 = (await tg(page)).me!;

  await bonusBtn.click();
  const card = page.getByTestId('decode-card');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-mode', 'bonus');
  // pas de capture d'écran avant de répondre : le chrono de 4 s court (capture lente sur machine chargée)
  await card.locator(`[data-choice-id="${await correctId(page, attemptId)}"]`).click();
  await expect(page.getByTestId('decode-outcome')).toContainText('+5 XP');
  await shot(page, 'decode-06-bonus-won');
  await expect(card).toBeHidden({ timeout: 4000 });
  await expect(page.getByTestId('decode-bonus-won')).toBeVisible();
  await expect(bonusBtn).toHaveCount(0);
  const me1 = (await tg(page)).me!;
  expect(me1.shards).toEqual(me0.shards); // aucun éclat en plus
  expect((me1 as unknown as { xp: number }).xp).toBe((me0 as unknown as { xp: number }).xp + 5);
  await closeCatch(page);
  await expect.poll(async () => (await tg(page)).me!.shards[sp.family]).toBe((me0.shards[sp.family] ?? 0));
  expect(caught.qty).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});
