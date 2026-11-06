// Session NEAR AI Cloud côté serveur (la gestion des clés exige un jeton de session, pas une clé sk-).
// login NEP-413 → access (JWT 1 h) + refresh (7 j, rotatif). Refresh sérialisé par un mutex ; le nouveau refresh token
// est persisté chiffré dans kv AVANT d'utiliser l'access token (l'ancien est invalidé par la rotation).
import { kvGet, kvSet, type DB } from '../db.ts';
import { NearAiError, callJson, type Fetch } from './http.ts';
import { nearAuthBody } from './nep413.ts';

interface TokenResp { access_token: string; refresh_token: string; refresh_token_expiration: string }
interface Cipher { encrypt(s: string): string; decrypt(s: string): string }

export interface SessionOpts {
  base: string;
  accountId: string;
  secretKey: string;
  db: DB;
  cipher: Cipher;
  fetch?: Fetch;
  now?: () => number;
  orgId?: string;
  workspaceId?: string;
  timeoutMs?: number;
}
export interface NearAiSession {
  /** Requête authentifiée (jeton de session) ; un 401 invalide l'access token et rejoue une fois. */
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  accessToken(): Promise<string>;
  ids(): Promise<{ orgId: string; workspaceId: string }>;
  readonly base: string;
}

export const KV_REFRESH = 'nearai:refresh';
export const KV_IDS = 'nearai:ids';
const SKEW = 60_000;

/** `exp` (s) d'un JWT, sans vérifier la signature (on ne s'en sert que pour savoir quand rafraîchir). */
export function jwtExpMs(token: string): number | null {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    return typeof p.exp === 'number' ? p.exp * 1000 : null;
  } catch { return null; }
}

export function createSession(o: SessionOpts): NearAiSession {
  const now = o.now ?? Date.now;
  const call = <T>(method: string, path: string, body?: unknown, bearer?: string) =>
    callJson<T>(o.base, method, path, body, { fetch: o.fetch, timeoutMs: o.timeoutMs, bearer });
  let access: { token: string; exp: number } | null = null;
  let inflight: Promise<string> | null = null;

  const adopt = (r: TokenResp): string => {
    if (!r?.access_token || !r.refresh_token) throw new Error('NEAR AI auth: malformed token response');
    const exp = Date.parse(r.refresh_token_expiration);
    // persister d'abord : si le process meurt juste après, le refresh token valide n'est pas perdu
    kvSet(o.db, KV_REFRESH, { enc: o.cipher.encrypt(r.refresh_token), exp: Number.isFinite(exp) ? exp : now() + 6 * 24 * 3600_000 });
    access = { token: r.access_token, exp: jwtExpMs(r.access_token) ?? now() + 55 * 60_000 };
    return r.access_token;
  };

  const obtain = async (): Promise<string> => {
    const stored = kvGet<{ enc: string; exp: number }>(o.db, KV_REFRESH);
    if (stored && stored.exp > now() + SKEW) {
      let refresh: string | null = null;
      try { refresh = o.cipher.decrypt(stored.enc); } catch { /* MASTER_KEY changée : re-login */ }
      if (refresh) {
        try {
          return adopt(await call<TokenResp>('POST', '/v1/users/me/access-tokens', undefined, refresh));
        } catch (e) {
          if (!(e instanceof NearAiError && (e.status === 401 || e.status === 403))) throw e;
          // refresh révoqué / déjà tourné / UA différent → on re-signe
        }
      }
    }
    return adopt(await call<TokenResp>('POST', '/v1/auth/near', nearAuthBody(o.accountId, o.secretKey)));
  };

  const accessToken = async (): Promise<string> => {
    if (access && access.exp - SKEW > now()) return access.token;
    inflight ??= obtain().finally(() => { inflight = null; });
    return inflight;
  };

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const token = await accessToken();
    try {
      return await call<T>(method, path, body, token);
    } catch (e) {
      if (!(e instanceof NearAiError && e.status === 401)) throw e;
      if (access?.token === token) access = null;
      return call<T>(method, path, body, await accessToken());
    }
  };

  let idsMemo: Promise<{ orgId: string; workspaceId: string }> | null = null;
  const discover = async () => {
    let cached = kvGet<{ orgId: string; workspaceId: string }>(o.db, KV_IDS);
    if (o.orgId && cached?.orgId !== o.orgId) cached = null;
    let orgId = o.orgId ?? cached?.orgId;
    if (!orgId) {
      const r = await request<{ organizations: { id: string; role?: string; is_active?: boolean }[] }>('GET', '/v1/organizations?limit=100');
      const orgs = (r?.organizations ?? []).filter((x) => x.is_active !== false);
      orgId = (orgs.find((x) => String(x.role).toLowerCase() === 'owner') ?? orgs[0])?.id;
      if (!orgId) throw new Error('NEAR AI: no organization for this account — set NEARAI_ORG_ID');
    }
    let workspaceId = o.workspaceId ?? cached?.workspaceId;
    if (!workspaceId) {
      const r = await request<{ workspaces: { id: string; is_active?: boolean }[] }>('GET', `/v1/organizations/${orgId}/workspaces?limit=100`);
      workspaceId = (r?.workspaces ?? []).find((w) => w.is_active !== false)?.id;
      if (!workspaceId) throw new Error('NEAR AI: no workspace in this organization — set NEARAI_WORKSPACE_ID');
    }
    if (!o.orgId || !o.workspaceId) kvSet(o.db, KV_IDS, { orgId, workspaceId });
    return { orgId, workspaceId };
  };
  const ids = () => {
    idsMemo ??= discover().catch((e) => { idsMemo = null; throw e; });
    return idsMemo;
  };

  return { request, accessToken, ids, base: o.base };
}
