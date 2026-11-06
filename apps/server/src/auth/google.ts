// Connexion Google (arctic, OAuth 2 + PKCE) et règles anti-sybil (Docs/08 §1) : 1 `sub` = 1 joueur, email vérifié,
// email normalisé unique (gmail : points et +tag ignorés). Un invité qui se connecte est promu (progression conservée).
import { Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';
import type { Config } from '../config.ts';
import type { Ctx } from '../game/context.ts';
import { createUser, getUser } from '../game/players.ts';

export interface GoogleProfile { sub: string; email: string; emailVerified: boolean }
/** Échange code + verifier → profil vérifié (injectable dans les tests). */
export type GoogleExchange = (code: string, codeVerifier: string) => Promise<GoogleProfile>;

export const GOOGLE_SCOPES = ['openid', 'email', 'profile'];
export const redirectUri = (cfg: Config) => `${cfg.PUBLIC_URL.replace(/\/$/, '')}/auth/google/callback`;

export function googleClient(cfg: Config): Google | null {
  return cfg.googleEnabled ? new Google(cfg.GOOGLE_CLIENT_ID!, cfg.GOOGLE_CLIENT_SECRET!, redirectUri(cfg)) : null;
}

export function newAuthorization(google: Google): { url: URL; state: string; codeVerifier: string } {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  return { url: google.createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES), state, codeVerifier };
}

/** Échange réel : id_token reçu directement du token endpoint de Google (TLS) → décodé, iss/aud/exp vérifiés. */
export function realExchange(cfg: Config, google: Google): GoogleExchange {
  return async (code, codeVerifier) => {
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    const c = decodeIdToken(tokens.idToken()) as { iss?: string; aud?: string | string[]; exp?: number; sub?: string; email?: string; email_verified?: boolean | string };
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(c.iss ?? '') || !aud.includes(cfg.GOOGLE_CLIENT_ID)) throw new Error('bad id_token issuer/audience');
    if (!c.exp || c.exp * 1000 < Date.now()) throw new Error('expired id_token');
    if (!c.sub || !c.email) throw new Error('id_token without sub/email');
    return { sub: c.sub, email: c.email, emailVerified: c.email_verified === true || c.email_verified === 'true' };
  };
}

/** Normalisation anti-sybil : minuscules ; gmail/googlemail → sans points ni +tag, domaine gmail.com. */
export function normalizeEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') return `${local.split('+')[0]!.replace(/\./g, '')}@gmail.com`;
  return `${local}@${domain}`;
}

export type SignInOutcome = { userId: string; outcome: 'login' | 'upgraded' | 'created' } | { error: 'unverified' | 'email_taken' };

/** Trouve, promeut ou crée le compte Google. `currentUserId` : session invité éventuelle (promue au lieu d'être perdue). */
export function signInWithGoogle(ctx: Ctx, p: GoogleProfile, currentUserId: string | null): SignInOutcome {
  if (!p.emailVerified) return { error: 'unverified' };
  return ctx.db.transaction((): SignInOutcome => {
    const known = ctx.db.prepare('SELECT id FROM users WHERE google_sub = ? AND deleted_at IS NULL').get(p.sub) as { id: string } | undefined;
    if (known) return { userId: known.id, outcome: 'login' };
    const norm = normalizeEmail(p.email);
    if (ctx.db.prepare('SELECT 1 FROM users WHERE email_norm = ?').get(norm)) return { error: 'email_taken' };
    const cur = currentUserId ? getUser(ctx, currentUserId) : undefined;
    // un invité ordinaire est promu ; pas un pass démo (kit juge), ni un runner-agent
    if (cur && cur.kind === 'guest' && !cur.is_agent && !cur.demo_token && !cur.deleted_at) {
      ctx.db.prepare(`UPDATE users SET kind = 'google', google_sub = ?, email = ?, email_norm = ?, mode = 'gps',
        move_state = CASE WHEN mode = 'demo' THEN NULL ELSE move_state END WHERE id = ?`).run(p.sub, p.email, norm, cur.id);
      return { userId: cur.id, outcome: 'upgraded' };
    }
    const u = createUser(ctx, { kind: 'google', demo: false, google: { sub: p.sub, email: p.email, emailNorm: norm } });
    return { userId: u.id, outcome: 'created' };
  })();
}
