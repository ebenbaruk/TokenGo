// Cerveau LLM des marchands (Docs/07 §4, Docs/03 §6) : propose une stratégie en JSON, le serveur la borne (clampDecision).
// Budget dur : 150 appels/jour (réflexions + salutations), seulement les marchands actifs < 6 h, timeout 8 s, échec → null (repli).
// Aucune entrée libre du joueur n'est envoyée au LLM.
import { AGENT_BOUNDS, FAMILIES, RESERVE_PARTITION, type MerchantState } from '@tokengo/shared';
import { kvGet, kvSet } from '../db.ts';
import type { Ctx } from '../game/context.ts';
import { makeCipher } from '../game/crypto.ts';
import type { Brain } from '../game/merchants.ts';
import { parisDay } from '../game/reserve.ts';
import { NearAiError, callJson, type Fetch } from './http.ts';
import { chatCompletion, reasoningParams, type NearAiCredits } from './provider.ts';

export const NPC_DAILY_CAP = AGENT_BOUNDS.llmCallsPerDay; // 150
export const ACTIVE_WINDOW_MS = 6 * 3600_000;
const CALL_TIMEOUT_MS = 8000;
const GREET_TTL_MS = 10 * 60_000;
const GREET_PER_PLAYER_MS = 60_000;
const KV_CALLS = 'npc-llm-calls';
const KV_NPC_KEY = 'nearai:npc-key';

const PERSONA: Record<string, string> = {
  gambler: 'a flamboyant risk-lover who talks in odds and bets',
  hoarder: 'a possessive collector who hates letting shards go',
  scholar: 'a precise, bookish economist who loves footnotes',
  hustler: 'a fast-talking street trader, always in a hurry',
  grandma: 'a warm, teasing grandmother who mothers every runner',
  purist: 'a strict perfectionist who trusts only the rules',
  trendchaser: 'a hype-driven trend follower who reads the Pulse all day',
  nightowl: 'a mysterious late-night trader who loves the quiet hours',
};

/** Marchand ayant eu un trade ou une visite (écran ouvert) dans la fenêtre. */
export function merchantActive(ctx: Ctx, merchantId: string, windowMs = ACTIVE_WINDOW_MS): boolean {
  const since = ctx.now() - windowMs;
  return !!(ctx.db.prepare('SELECT 1 FROM trades WHERE merchant_id = ? AND at >= ? LIMIT 1').get(merchantId, since) ??
    ctx.db.prepare('SELECT 1 FROM price_seen WHERE merchant_id = ? AND at >= ? LIMIT 1').get(merchantId, since));
}

/** Réserve un appel LLM dans le plafond du jour (Europe/Paris). false = budget épuisé. */
export function takeNpcCall(ctx: Ctx, cap = NPC_DAILY_CAP): boolean {
  const day = parisDay(ctx.now());
  const cur = kvGet<{ day: string; n: number }>(ctx.db, KV_CALLS);
  const n = cur?.day === day ? cur.n : 0;
  if (n >= cap) return false;
  kvSet(ctx.db, KV_CALLS, { day, n: n + 1 });
  return true;
}
export const npcCallsToday = (ctx: Ctx): number => {
  const cur = kvGet<{ day: string; n: number }>(ctx.db, KV_CALLS);
  return cur?.day === parisDay(ctx.now()) ? cur.n : 0;
};

const BANNED = /\b(fuck\w*|shit\w*|bitch\w*|cunt|nigg\w*|fag\w*|retard\w*|whore|slut|rape\w*|nazi\w*|kill yourself|kys|porn\w*|sex\w*|crypto ?scam|guaranteed (profit|return)s?|airdrop|seed phrase|private key)\b/i;

/** Texte affichable : sans <> ni caractères de contrôle, une ligne, borné ; null si vide ou mot interdit. */
export function sanitizeLine(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  let t = s.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!t || BANNED.test(t)) return null;
  if (t.length > max) t = `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return t;
}

/** Extraction JSON robuste (blocs ```json, texte autour, balises de raisonnement). */
export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  for (let end = cleaned.lastIndexOf('}'); end > start; end = cleaned.lastIndexOf('}', end - 1)) {
    try {
      const v = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch { /* essayer une accolade plus tôt */ }
  }
  return null;
}

export const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['spread', 'targetMultipliers', 'contract', 'mood', 'reasoning'],
  properties: {
    spread: { type: 'number' },
    targetMultipliers: { type: 'object', additionalProperties: false, required: [...FAMILIES], properties: Object.fromEntries(FAMILIES.map((f) => [f, { type: 'number' }])) },
    contract: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['family', 'qty'], properties: { family: { type: 'string', enum: [...FAMILIES] }, qty: { type: 'integer' } } }] },
    mood: { type: 'string' },
    reasoning: { type: 'string' },
  },
} as const;

export function systemPrompt(m: MerchantState, place: string): string {
  return [
    `You are ${m.name}, a ${m.archetype} shard merchant at ${place || 'a street corner'}, Paris — ${PERSONA[m.archetype] ?? 'a shard trader'}.`,
    'You set strategy only through the JSON fields. You never promise anything. You never mention real money, crypto prices or investments.',
    `Keep mood under ${AGENT_BOUNDS.moodMaxChars} chars, witty, PG, in English. reasoning: one plain sentence under 200 chars explaining the change.`,
  ].join(' ');
}

const placeOf = (ctx: Ctx, m: MerchantState): string => {
  const r = ctx.db.prepare('SELECT node_id FROM merchants WHERE id = ?').get(m.id) as { node_id: string } | undefined;
  return (r && ctx.world.byId.get(r.node_id)?.name) ?? '';
};

const parisHour = (t: number) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(t));
const timeOfDay = (h: number) => (h < 6 ? 'late night' : h < 12 ? 'morning' : h < 14 ? 'lunchtime' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : 'night');

// ── capacités des modèles (structured outputs), liste publique /v1/model/list ──
let features: Promise<Map<string, string[]>> | null = null;
export function modelFeatures(base: string, f?: Fetch): Promise<Map<string, string[]>> {
  features ??= callJson<{ models: { modelId: string; metadata?: { supportedFeatures?: string[] } }[] }>(base, 'GET', '/v1/model/list?limit=500', undefined, { fetch: f, timeoutMs: 8000 })
    .then((r) => new Map((r?.models ?? []).map((m) => [m.modelId, m.metadata?.supportedFeatures ?? []])))
    .catch(() => { features = null; return new Map(); });
  return features;
}

export interface NpcBrain {
  brain: Brain;
  /** Salutation contextuelle (1 phrase) ou null → l'appelant utilise greetingFor(). */
  greet(m: MerchantState, userId: string): Promise<string | null>;
}
export interface NpcBrainOpts {
  key: () => Promise<string | null>;
  models?: string[];
  fetch?: Fetch;
  /** Désactive la détection des structured outputs (tests). */
  structured?: (model: string) => Promise<boolean>;
}

export function createNpcBrain(ctx: Ctx, o: NpcBrainOpts): NpcBrain {
  const base = ctx.cfg.NEARAI_BASE;
  const models = o.models ?? [ctx.cfg.NPC_MODEL, ctx.cfg.NPC_MODEL_FALLBACK];
  const structured = o.structured ?? (async (model: string) => (await modelFeatures(base, o.fetch)).get(model)?.includes('structured_outputs') ?? false);

  /** Un appel borné : modèle principal, puis repli seulement si le modèle est refusé (4xx/5xx), dans le budget et le délai. */
  const complete = async (build: (model: string) => Promise<Record<string, unknown>>): Promise<string | null> => {
    const key = await o.key().catch(() => null);
    if (!key) return null;
    const deadline = Date.now() + CALL_TIMEOUT_MS;
    for (const model of models) {
      const left = deadline - Date.now();
      if (left < 1500 || !takeNpcCall(ctx)) return null;
      try {
        return await chatCompletion({ base, key, fetch: o.fetch, timeoutMs: left, body: { model, ...(await build(model)), ...reasoningParams(model) } });
      } catch (e) {
        if (!(e instanceof NearAiError) || e.status === 402 || e.status === 401) return null; // timeout, budget, clé : on n'insiste pas
      }
    }
    return null;
  };

  const brain: Brain = async (m, input) => {
    if (!merchantActive(ctx, m.id)) return null;
    const place = placeOf(ctx, m);
    const trades24h = (ctx.db.prepare('SELECT COUNT(*) n FROM trades WHERE merchant_id = ? AND at >= ?').get(m.id, ctx.now() - 24 * 3600_000) as { n: number }).n;
    const summary = {
      ...(input && typeof input === 'object' ? input : {}),
      status: m.status, specialty: m.specialty, spread: m.spread, targetMultipliers: m.targetMult, currentContract: m.contract ? { family: m.contract.family, qty: m.contract.qty } : null,
      trades24h, timeOfDay: timeOfDay(parisHour(ctx.now())),
      bounds: { spread: [AGENT_BOUNDS.spreadMin, AGENT_BOUNDS.spreadMax], targetMultipliers: [AGENT_BOUNDS.targetMultMin, AGENT_BOUNDS.targetMultMax], maxChangePerReflection: AGENT_BOUNDS.maxChangePerReflection, contractQty: [1, 5] },
    };
    const text = await complete(async (model) => ({
      messages: [
        { role: 'system', content: systemPrompt(m, place) },
        { role: 'user', content: `Shop data (JSON): ${JSON.stringify(summary)}\nDecide your strategy for the next 3 hours. Reply with ONLY a JSON object: {"spread": number, "targetMultipliers": {${FAMILIES.map((f) => `"${f}": number`).join(', ')}}, "contract": {"family": one of ${JSON.stringify(FAMILIES)}, "qty": 1-5} or null, "mood": string, "reasoning": string}.` },
      ],
      max_tokens: 400,
      temperature: 0.7,
      ...((await structured(model)) ? { response_format: { type: 'json_schema', json_schema: { name: 'merchant_decision', strict: true, schema: DECISION_SCHEMA } } } : {}),
    }));
    if (!text) return null;
    const raw = extractJson(text);
    if (!raw) return null;
    return { raw: { ...raw, mood: sanitizeLine(raw.mood, AGENT_BOUNDS.moodMaxChars) ?? '', reasoning: sanitizeLine(raw.reasoning, AGENT_BOUNDS.reasoningMaxChars) ?? '' }, source: 'llm' };
  };

  const cache = new Map<string, { at: number; text: string }>();
  const lastByPlayer = new Map<string, number>();
  const greet = async (m: MerchantState, userId: string): Promise<string | null> => {
    const now = ctx.now();
    const ck = `${m.id}:${userId}`;
    const hit = cache.get(ck);
    if (hit && now - hit.at < GREET_TTL_MS) return hit.text;
    if (m.status !== 'open' || now - (lastByPlayer.get(userId) ?? 0) < GREET_PER_PLAYER_MS) return null;
    lastByPlayer.set(userId, now);
    const carries = (ctx.db.prepare("SELECT token_id, amount FROM inventory WHERE user_id = ? AND token_id LIKE 'shard:%' AND amount > 0 ORDER BY amount DESC LIMIT 2")
      .all(userId) as { token_id: string; amount: number }[]).map((r) => r.token_id.slice(6));
    const context = {
      timeOfDay: timeOfDay(parisHour(now)), place: placeOf(ctx, m), yourMood: m.mood || null,
      yourContract: m.contract && m.contract.expiresAt > now ? { wants: m.contract.family, qty: m.contract.qty } : null,
      runnerCarries: carries, yourSpecialty: m.specialty,
    };
    const text = await complete(async () => ({
      messages: [
        { role: 'system', content: `${systemPrompt(m, context.place)} Now you only speak.` },
        { role: 'user', content: `A runner walks into your shop. Context (JSON): ${JSON.stringify(context)}\nGreet them in ONE short in-character sentence (max 100 characters). No quotes, no emoji, no prices, no promises.` },
      ],
      max_tokens: 60,
      temperature: 0.9,
    }));
    const line = sanitizeLine(text?.split('\n').find((l) => l.trim()) ?? '', 120);
    if (!line) return null;
    cache.set(ck, { at: now, text: line });
    if (cache.size > 5000) for (const [k, v] of cache) if (now - v.at >= GREET_TTL_MS) cache.delete(k);
    return line;
  };

  return { brain, greet };
}

/**
 * Clé `sk-` des marchands : NEARAI_NPC_KEY, sinon clé déjà créée (kv, chiffrée), sinon création unique
 * avec spendLimit = poche NPC Brain (si une session NEAR AI existe). null = pas de LLM (repli).
 */
export function npcKeyResolver(ctx: Ctx, credits?: NearAiCredits): () => Promise<string | null> {
  let memo: Promise<string | null> | null = null;
  const cipher = () => makeCipher(ctx.cfg.MASTER_KEY, ctx.cfg.SESSION_SECRET);
  const resolve = async (): Promise<string | null> => {
    if (ctx.cfg.NEARAI_NPC_KEY) return ctx.cfg.NEARAI_NPC_KEY;
    const stored = kvGet<{ keyId: string; enc: string }>(ctx.db, KV_NPC_KEY);
    if (stored) return cipher().decrypt(stored.enc);
    if (!credits) return null;
    const k = await credits.createKey('tokengo_npc_brain', RESERVE_PARTITION.npc);
    kvSet(ctx.db, KV_NPC_KEY, { keyId: k.keyId, enc: cipher().encrypt(k.key) });
    return k.key;
  };
  return () => {
    memo ??= resolve().catch(() => { memo = null; return null; });
    return memo;
  };
}
