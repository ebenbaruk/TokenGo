// CreditsProvider réel : clés API NEAR AI Cloud par joueur (limite de dépense = crédits gagnés), solde org, usage, relais chat.
// Formes vérifiées dans github.com/nearai/cloud-api (crates/api/src/models.rs, routes/workspaces.rs, routes/usage.rs).
import { randomBytes } from 'node:crypto';
import type { Config } from '../config.ts';
import type { DB } from '../db.ts';
import type { CreditsProvider, KeyInfo } from '../game/credits.ts';
import { fail } from '../game/context.ts';
import { makeCipher } from '../game/crypto.ts';
import { NearAiError, USER_AGENT, callJson, errorFrom, type Fetch } from './http.ts';
import { createSession, type NearAiSession } from './session.ts';

export const KEY_EXPIRES_AT = '2026-12-31T23:59:59Z';

interface Price { amount: number; scale?: number; currency?: string }
export interface ApiKey {
  id: string; name: string | null; key?: string | null; key_prefix: string; is_active: boolean;
  spend_limit?: Price; usage?: Price; expires_at?: string | null;
}
export interface NearAiCredits extends CreditsProvider {
  readonly session: NearAiSession;
  listKeys(): Promise<ApiKey[]>;
  revoke(keyId: string): Promise<void>;
}

const usd = (amountNusd: number) => ({ amount: Math.round(amountNusd), currency: 'USD' });

/** Paramètres de raisonnement : sans eux, GLM-5.3 Flash raisonne jusqu'à 8 192 tokens (lent, cher, `content` vide si max_tokens petit). */
export function reasoningParams(model: string): Record<string, unknown> {
  if (model.startsWith('z-ai/glm-5.3-flash')) return { reasoning_effort: 'low' }; // docs.near.ai/cloud/reasoning-models : low = < 20 tokens
  if (/^openai\/(gpt-5|o\d)/.test(model)) return { reasoning_effort: 'low' };
  return {};
}

export interface NearAiOpts { fetch?: Fetch; session?: NearAiSession; sleep?: (ms: number) => Promise<void> }

export function nearAiCredits(cfg: Config, db: DB, o: NearAiOpts = {}): NearAiCredits {
  if (!o.session && (!cfg.NEARAI_AUTH_ACCOUNT || !cfg.NEARAI_AUTH_KEY)) throw new Error('NEARAI_AUTH_ACCOUNT / NEARAI_AUTH_KEY missing');
  const session = o.session ?? createSession({
    base: cfg.NEARAI_BASE, accountId: cfg.NEARAI_AUTH_ACCOUNT!, secretKey: cfg.NEARAI_AUTH_KEY!, db,
    cipher: makeCipher(cfg.MASTER_KEY, cfg.SESSION_SECRET), fetch: o.fetch, orgId: cfg.NEARAI_ORG_ID, workspaceId: cfg.NEARAI_WORKSPACE_ID,
  });
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ws = async () => (await session.ids()).workspaceId;

  const listKeys = async (): Promise<ApiKey[]> => {
    const w = await ws();
    const out: ApiKey[] = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await session.request<{ api_keys: ApiKey[]; total: number }>('GET',
        `/v1/workspaces/${w}/api-keys?limit=1000&offset=${offset}&order_by=usage&order_direction=desc`);
      out.push(...(r?.api_keys ?? []));
      if (!r || r.api_keys.length < 1000 || out.length >= r.total) return out;
    }
  };

  const revoke = async (keyId: string) => {
    try { await session.request('DELETE', `/v1/workspaces/${await ws()}/api-keys/${keyId}`); } catch (e) {
      if (!(e instanceof NearAiError && e.status === 404)) throw e; // déjà révoquée
    }
  };

  const create = (name: string, limitNusd: number) => ws().then((w) => session.request<ApiKey>('POST', `/v1/workspaces/${w}/api-keys`,
    { name, expires_at: KEY_EXPIRES_AT, spendLimit: usd(limitNusd) }));

  const transient = (e: unknown) => !(e instanceof NearAiError) || e.status >= 500 || e.status === 429;

  return {
    simulated: false,
    session,
    listKeys,
    revoke,

    async orgRemaining() {
      const { orgId } = await session.ids();
      const r = await session.request<{ remaining?: number | null }>('GET', `/v1/organizations/${orgId}/usage/balance`);
      // pas de limite connue → 0 : la Forge refuse plutôt que de promettre de l'argent qu'on n'a peut-être pas
      return typeof r?.remaining === 'number' ? r.remaining : 0;
    },

    async createKey(name, limitNusd): Promise<KeyInfo> {
      let k: ApiKey;
      try {
        k = await create(name, limitNusd);
      } catch (e) {
        if (!(e instanceof NearAiError && e.status === 409)) throw e;
        // nom déjà pris (création précédente dont on a perdu la réponse, donc le secret) : on la révoque et on recrée
        const old = (await listKeys()).find((x) => x.name === name);
        if (old) await revoke(old.id);
        k = await create(`${name}_${randomBytes(2).toString('hex')}`, limitNusd);
      }
      if (!k?.key || !k.id) throw new Error('NEAR AI create key: response without secret');
      return { keyId: k.id, key: k.key, prefix: k.key_prefix || k.key.slice(0, 12), limitNusd };
    },

    async setLimit(keyId, limitNusd) {
      const w = await ws();
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await session.request('PATCH', `/v1/workspaces/${w}/api-keys/${keyId}/spend-limit`, { spendLimit: usd(limitNusd) });
          return;
        } catch (e) {
          if (!transient(e)) throw e;
          last = e;
        }
        await sleep(500 * 2 ** attempt);
        // idempotence : la requête a pu passer malgré l'erreur → relire la clé
        try {
          const k = (await listKeys()).find((x) => x.id === keyId);
          if (k?.spend_limit?.amount === Math.round(limitNusd)) return;
        } catch { /* on retente le PATCH */ }
      }
      throw last;
    },

    async usage(keyIds) {
      const byId = new Map((await listKeys()).map((k) => [k.id, k.usage?.amount ?? 0]));
      return Object.fromEntries(keyIds.map((id) => [id, byId.get(id) ?? 0]));
    },

    chat(key, model, prompt, maxTokens) {
      return streamChat({ base: cfg.NEARAI_BASE, key, fetch: o.fetch,
        body: { model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, ...reasoningParams(model) } });
    },
  };
}

const FRIENDLY_402: Record<string, string> = {
  api_key_limit_exceeded: 'Your key has used all its credits. Compile at a Forge to top it up!',
  insufficient_credits: 'The city reserve is recharging — NEAR AI Cloud credits are paused for a moment. Try again later.',
};

export interface StreamOpts { base: string; key: string; body: Record<string, unknown>; fetch?: Fetch; connectTimeoutMs?: number; idleTimeoutMs?: number }

/** Relais streaming OpenAI-compatible (`stream: true`) → morceaux de `delta.content`. */
export async function* streamChat(o: StreamOpts): AsyncGenerator<string> {
  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(), o.connectTimeoutMs ?? 20_000);
  const bump = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), o.idleTimeoutMs ?? 30_000); };
  try {
    let res: Response;
    try {
      res = await (o.fetch ?? fetch)(`${o.base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${o.key}` },
        body: JSON.stringify({ ...o.body, stream: true }),
        signal: ac.signal,
      });
    } catch {
      fail('UPSTREAM', 'NEAR AI Cloud is not answering right now. Try again in a minute.', 502);
      return;
    }
    if (res.status === 402) {
      const e = await errorFrom(res, 'chat');
      yield FRIENDLY_402[e.code] ?? FRIENDLY_402.api_key_limit_exceeded!;
      return;
    }
    if (res.status === 401) { yield 'Your key is still activating (it takes up to 10 seconds after a compile). Try again!'; return; }
    if (!res.ok || !res.body) {
      const e = await errorFrom(res, 'chat');
      fail('UPSTREAM', `NEAR AI Cloud refused the request (${e.status}).`, 502);
    }
    const decoder = new TextDecoder();
    let buf = '';
    const reader = res.body!.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bump();
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          let j: { choices?: { delta?: { content?: string | null } }[]; error?: { message?: string } };
          try { j = JSON.parse(data); } catch { continue; }
          if (j.error) { yield `\n[NEAR AI: ${String(j.error.message ?? 'error').slice(0, 120)}]`; return; }
          const piece = j.choices?.[0]?.delta?.content;
          if (piece) yield piece;
        }
      }
    } catch {
      yield '\n[stream interrupted]';
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

/** Complétion non streamée (cerveau des marchands). Renvoie `content` (peut être vide). */
export async function chatCompletion(o: { base: string; key: string; body: Record<string, unknown>; fetch?: Fetch; timeoutMs?: number }): Promise<string> {
  const r = await callJson<{ choices?: { message?: { content?: string | null } }[] }>(o.base, 'POST', '/v1/chat/completions',
    { ...o.body, stream: false }, { fetch: o.fetch, timeoutMs: o.timeoutMs ?? 8000, bearer: o.key });
  return r?.choices?.[0]?.message?.content ?? '';
}
