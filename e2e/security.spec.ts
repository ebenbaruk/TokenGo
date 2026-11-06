// Sécurité HTTP : CSP + anti-framing, cookie de session HttpOnly/SameSite=Lax (Secure en prod), Origin obligatoire
// sur toute écriture.
import { expect, test, ORIGIN, pageErrors, post, shot, startGuest } from './helpers.ts';

test('security headers: CSP default-src self, no framing', async ({ request, page }) => {
  for (const path of ['/', '/api/config', '/lab']) {
    const r = await request.get(path);
    expect(r.ok(), path).toBe(true);
    const h = r.headers();
    const csp = h['content-security-policy'] ?? '';
    expect(csp, path).toContain("default-src 'self'");
    expect(csp, path).toContain("script-src 'self'");
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(csp, path).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['x-content-type-options'], path).toBe('nosniff');
  }
  // la page refuse d'être encadrée : une iframe vers le site reste vide
  const errors = pageErrors(page);
  await page.goto('/about');
  await page.setContent('<iframe id="f" width="300" height="300"></iframe>');
  const framed = await page.evaluate((url) => new Promise<{ loaded: boolean; app: boolean }>((resolve) => {
    const f = document.getElementById('f') as HTMLIFrameElement;
    const t = setTimeout(() => resolve({ loaded: false, app: false }), 10_000);
    f.onload = () => {
      clearTimeout(t);
      let app = false;
      try { app = !!f.contentDocument?.querySelector('#root'); } catch { /* bloqué → document d'erreur opaque */ }
      resolve({ loaded: true, app });
    };
    f.src = url;
  }), `${ORIGIN}/`);
  expect(framed.loaded).toBe(true);
  expect(framed.app, 'the app must not render inside a frame').toBe(false);
  // contrôle positif : la même page s'affiche bien hors iframe
  expect((await page.request.get('/')).ok()).toBe(true);
  await shot(page, 'security-01-no-framing');
  expect(errors).toEqual([]);
});

test('session cookie is HttpOnly + SameSite=Lax and invisible to scripts', async ({ page, context }) => {
  await startGuest(page);
  const cookies = await context.cookies();
  const sess = cookies.find((c) => c.name === 'tg_sess' || c.name === '__Host-tg_sess');
  expect(sess, 'a session cookie is set').toBeTruthy();
  expect(sess!.httpOnly).toBe(true);
  expect(sess!.sameSite).toBe('Lax');
  expect(sess!.path).toBe('/');
  // ici en HTTP local (NODE_ENV=test) le cookie n'est pas Secure ; en prod il est __Host- + Secure (cfg.prod)
  expect(await page.evaluate(() => document.cookie)).not.toContain('tg_sess');
  await shot(page, 'security-02-session');

  // même vérification sur l'en-tête brut
  const r = await post(page.request, '/auth/guest', { demo: true });
  const setCookie = r.headersArray().filter((x) => x.name.toLowerCase() === 'set-cookie').map((x) => x.value).join('\n');
  expect(setCookie).toMatch(/tg_sess=/);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);
});

test('writes without a valid Origin are refused (403)', async ({ request }) => {
  // session valide (cookie conservé par `request`)
  const g = await post(request, '/auth/guest', { demo: true });
  expect(g.ok()).toBe(true);
  const body = { lat: 48.8611, lng: 2.3358, acc: 5 };

  const none = await request.post('/api/move', { data: body });
  expect(none.status()).toBe(403);
  expect(((await none.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN_ORIGIN');

  const evil = await request.post('/api/move', { data: body, headers: { Origin: 'https://evil.example' } });
  expect(evil.status()).toBe(403);
  const lookalike = await request.post('/api/move', { data: body, headers: { Origin: `${ORIGIN}.evil.example` } });
  expect(lookalike.status()).toBe(403);
  const nullOrigin = await request.post('/api/move', { data: body, headers: { Origin: 'null' } });
  expect(nullOrigin.status()).toBe(403);
  // l'auth aussi est protégée
  expect((await request.post('/auth/guest', { data: { demo: true } })).status()).toBe(403);

  // contrôle : la même requête avec la bonne Origin passe
  const ok = await request.post('/api/move', { data: body, headers: { Origin: ORIGIN } });
  expect(ok.status()).toBe(200);
});

// Régression : les fichiers statiques ne comptent pas dans le rate limit par IP (sinon page blanche derrière un Wi-Fi partagé).
test('static files are not rate-limited per IP like the API', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const asset = /\/assets\/[^"]+\.js/.exec(html)![0];
  const codes = new Set<number>();
  for (let i = 0; i < 150; i++) codes.add((await request.get(asset)).status());
  expect([...codes]).toEqual([200]);
});
