// Onglet Credits : clé du joueur, solde, historique, playground (relais avec la clé du joueur).
import { MODEL_EQUIV, NUSD_PER_USD, type CreditsView } from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { makeCipher } from './crypto.ts';
import { markTutorial } from './players.ts';

export const PLAYGROUND_MODELS: CreditsView['models'] = [
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', tier: 'cheap' },
  { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 mini', tier: 'mid' },
  { id: 'anthropic/claude-sonnet-5-5', label: 'Claude Sonnet 5.5', tier: 'premium' },
];

interface KeyRow { nearai_key_id: string; key_enc: string; key_prefix: string; limit_nusd: number; usage_nusd: number; simulated: number }
const keyOf = (ctx: Ctx, userId: string) => ctx.db.prepare('SELECT * FROM api_keys WHERE user_id = ?').get(userId) as KeyRow | undefined;

export function creditsView(ctx: Ctx, userId: string): CreditsView {
  const k = keyOf(ctx, userId);
  const grants = ctx.db.prepare(`SELECT g.at, g.amount_nusd, g.pool, c.forge_id, c.tier, c.burn_tx FROM grants g JOIN compiles c ON c.id = g.compile_id
    WHERE g.user_id = ? AND g.status != 'failed' ORDER BY g.at DESC LIMIT 20`).all(userId) as
    { at: number; amount_nusd: number; pool: string; forge_id: string; tier: string; burn_tx: string | null }[];
  return {
    hasKey: !!k,
    keyPrefix: k ? `${k.key_prefix}…` : null,
    limitNusd: k?.limit_nusd ?? 0,
    usageNusd: k?.usage_nusd ?? 0,
    remainingNusd: k ? Math.max(0, k.limit_nusd - k.usage_nusd) : 0,
    simulated: k ? k.simulated === 1 : ctx.credits.simulated,
    expiresAt: '2026-12-31',
    baseUrl: `${ctx.cfg.NEARAI_BASE}/v1`,
    models: PLAYGROUND_MODELS,
    grants: grants.map((g) => ({ at: g.at, amountNusd: g.amount_nusd, forge: ctx.world.byId.get(g.forge_id)?.name ?? g.forge_id, tier: g.tier, pool: g.pool, burnTx: g.burn_tx })),
  };
}

export function revealKey(ctx: Ctx, userId: string): { key: string } {
  const k = keyOf(ctx, userId);
  if (!k) fail('NOT_FOUND', 'No API key yet — compile at a Forge first.', 404);
  return { key: makeCipher(ctx.cfg.MASTER_KEY, ctx.cfg.SESSION_SECRET).decrypt(k!.key_enc) };
}

/** Relais streaming : le joueur dépense SES crédits. max_tokens borné par le solde restant. */
export async function* playground(ctx: Ctx, userId: string, model: string, prompt: string): AsyncIterable<string> {
  const k = keyOf(ctx, userId);
  if (!k) fail('NOT_FOUND', 'No API key yet — compile at a Forge first.', 404);
  if (!PLAYGROUND_MODELS.some((m) => m.id === model)) fail('BAD_REQUEST', 'Unknown model.');
  const text = String(prompt ?? '').slice(0, 8000);
  if (!text.trim()) fail('BAD_REQUEST', 'Ask something!');
  const remainingUsd = Math.max(0, k!.limit_nusd - k!.usage_nusd) / NUSD_PER_USD;
  const price = model.includes('claude') ? 15 : model.includes('gpt') ? 4 : MODEL_EQUIV[0].usdPerMTok * 2; // $/M sortie, prudence
  const maxTokens = Math.max(16, Math.min(4000, Math.floor((remainingUsd / price) * 1_000_000 * 0.8)));
  const key = makeCipher(ctx.cfg.MASTER_KEY, ctx.cfg.SESSION_SECRET).decrypt(k!.key_enc);
  markTutorial(ctx, userId, 'playground');
  yield* ctx.credits.chat(key, model, text, maxTokens);
}
