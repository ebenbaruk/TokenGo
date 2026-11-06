// Équivalences parlantes d'un montant en crédits réels (toujours calculées depuis MODEL_EQUIV).
import { MODEL_EQUIV, NUSD_PER_USD, TOKENS_PER_CHAT } from './rules.ts';

export interface Equivalence { model: string; label: string; tokens: number }
export function equivalences(nusd: number): { chats: number; tokens: Equivalence[] } {
  const usd = nusd / NUSD_PER_USD;
  const tokens = MODEL_EQUIV.map((m) => ({ model: m.id, label: m.label, tokens: Math.floor((usd / m.usdPerMTok) * 1_000_000) }));
  const cheapest = tokens[0]!;
  return { chats: Math.floor(cheapest.tokens / TOKENS_PER_CHAT), tokens };
}

export const formatUsd = (nusd: number, digits = 3): string => `$${(nusd / NUSD_PER_USD).toFixed(digits)}`;
export const formatTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`);
