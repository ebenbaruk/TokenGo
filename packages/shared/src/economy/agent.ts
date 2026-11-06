// IA des marchands : le LLM propose, ces fonctions bornent. Le LLM ne déplace jamais de valeur.
import { FAMILIES, type Family } from '../types.ts';
import { AGENT_BOUNDS, FAMILY_INFO } from './rules.ts';
import { targetOf, type MerchantState } from './pricing.ts';

export interface AgentDecision {
  spread: number;
  targetMult: Record<Family, number>;
  contract: { family: Family; qty: number } | null;
  mood: string;
  reasoning: string;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** Variation bornée à ±30 % autour de la valeur précédente, puis bornes absolues. */
const bounded = (prev: number, next: number, lo: number, hi: number) => {
  const d = AGENT_BOUNDS.maxChangePerReflection;
  return clamp(clamp(next, prev * (1 - d), prev * (1 + d)), lo, hi);
};
const cleanText = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '';

/** Rend une sortie LLM (non fiable, déjà parsée en JSON ou non) sûre. Tout champ invalide → valeur précédente. */
export function clampDecision(m: MerchantState, raw: unknown): AgentDecision {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const spread = isNum(r.spread) ? bounded(m.spread, r.spread, AGENT_BOUNDS.spreadMin, AGENT_BOUNDS.spreadMax) : m.spread;
  const tmRaw = (r.targetMultipliers && typeof r.targetMultipliers === 'object' ? r.targetMultipliers : {}) as Record<string, unknown>;
  const targetMult = {} as Record<Family, number>;
  for (const f of FAMILIES) {
    const v = tmRaw[f];
    targetMult[f] = isNum(v) ? bounded(m.targetMult[f], v, AGENT_BOUNDS.targetMultMin, AGENT_BOUNDS.targetMultMax) : m.targetMult[f];
  }
  let contract: AgentDecision['contract'] = null;
  const c = r.contract as Record<string, unknown> | undefined;
  if (c && typeof c === 'object' && FAMILIES.includes(c.family as Family) && isNum(c.qty)) {
    contract = { family: c.family as Family, qty: clamp(Math.round(c.qty), 1, 5) };
  }
  return {
    spread,
    targetMult,
    contract,
    mood: cleanText(r.mood, AGENT_BOUNDS.moodMaxChars),
    reasoning: cleanText(r.reasoning, AGENT_BOUNDS.reasoningMaxChars),
  };
}

/** Politique déterministe quand le LLM est absent / en échec / hors budget. Même interface. */
export function fallbackPolicy(m: MerchantState, forgeDemand: Partial<Record<Family, number>> = {}): AgentDecision {
  // caisse basse → marge plus haute pour se refaire ; caisse pleine → marge plus basse pour attirer
  const spread = m.flux < 400 ? m.spread * 1.2 : m.flux > 2000 ? m.spread * 0.9 : m.spread;
  const targetMult = {} as Record<Family, number>;
  for (const f of FAMILIES) targetMult[f] = 1 + Math.min(0.6, 0.15 * (forgeDemand[f] ?? 0));
  let worst: Family = 'deepseek';
  let ratio = Infinity;
  for (const f of FAMILIES) {
    const x = m.stock[f] / targetOf(m, f);
    if (x < ratio) { ratio = x; worst = f; }
  }
  const demanded = (Object.entries(forgeDemand) as [Family, number][]).sort((a, b) => b[1] - a[1])[0];
  const why = demanded ? `Forges nearby want ${FAMILY_INFO[demanded[0]].name}.` : `Low on ${FAMILY_INFO[worst].name}.`;
  return clampDecision(m, {
    spread,
    targetMultipliers: targetMult,
    contract: { family: worst, qty: FAMILY_INFO[worst].rarity === 'epic' ? 1 : 3 },
    mood: '',
    reasoning: `Rules-based: ${why} Till at ${m.flux} ƒ.`,
  });
}

/** Applique une décision bornée à l'état du marchand (hors contrat, créé à part avec makeContract). */
export const applyDecision = (m: MerchantState, d: AgentDecision): MerchantState => ({
  ...m, spread: d.spread, targetMult: d.targetMult, mood: d.mood || m.mood,
});
