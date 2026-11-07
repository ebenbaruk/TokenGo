// Marchandage : mini-jeu de cartes borné (Docs/03 §5 bis). Fonctions pures, partagées serveur / simulateur / tests.
//
// Le joueur joue une carte par manche ; la personnalité du marchand (trait), son état réel (stock vs cible, caisse,
// fermeture) et la réputation du joueur décident de l'effet. Le résultat est une offre en points de base (bp),
// toujours ≥ 0 (en faveur du joueur) et ≤ maxBp(réputation) ≤ 8 %.
//
// Anti-aller-retour : le total marchandé reste au-delà de la somme des prix milieu du marchand, évalués au stock APRÈS
// chaque unité (même règle que pricing.ts), avec une marge gardée e = HAGGLE.keepMargin :
//   acheter k unités à stock s paie ≥ min(devis normal, Σ mid(s−i)·(1+e)) ≥ Σ_{i=1..k} mid(s−i)·(1+min(spread, e)),
//   les revendre ensuite (stock s−k → s) rapporte ≤ Σ_{i=0..k−1} mid(s−i)·(1−min(spread, e)) ;
// mid décroît avec le stock et min(spread, e) > 0  ⇒  acheter puis revendre perd toujours, marchandage ou pas
// (plus généralement, toute boucle fermée chez un même marchand perd : potentiel Φ(s) = Σ_{j≤s} mid(j)).
import type { Archetype, Family } from '../types.ts';
import type { Rng } from '../rng.ts';
import { HAGGLE, MERCHANT } from './rules.ts';
import { midAt, targetOf, type MerchantState, type Quote, type Side } from './pricing.ts';

export type HaggleCard = 'bulk' | 'regular' | 'rival' | 'bluff' | 'compliment' | 'lowball' | 'walk';
export const HAGGLE_CARDS: readonly HaggleCard[] = ['bulk', 'regular', 'rival', 'bluff', 'compliment', 'lowball', 'walk'];
export type HaggleTrait = 'greedy' | 'friendly' | 'proud';
export type HagglePhase = 'open' | 'final' | 'sour' | 'walked';
export type HaggleFace = 'neutral' | 'happy' | 'annoyed';
export type HaggleEvent =
  | 'opened' | 'bulk-good' | 'bulk-meh' | 'regular-good' | 'regular-doubt' | 'rival-true' | 'rival-false'
  | 'bluff-works' | 'bluff-caught' | 'compliment-good' | 'compliment-meh' | 'lowball-good' | 'lowball-bad'
  | 'walk-back' | 'walk-bye' | 'sour';

/** Trait de marchandage, déterministe par archétype (la personnalité se lit dans l'écran du marchand). */
export const TRAIT_OF: Record<Archetype, HaggleTrait> = {
  gambler: 'greedy', hoarder: 'greedy', hustler: 'greedy', trendchaser: 'greedy',
  grandma: 'friendly', nightowl: 'friendly',
  purist: 'proud', scholar: 'proud',
};
export const traitOf = (archetype: string): HaggleTrait => TRAIT_OF[archetype as Archetype] ?? 'proud';

/** Un concurrent dont le joueur a vu le prix (≤ 2 h) : prix annoncé par la carte et prix réel actuel (null = ne traite pas). */
export interface HaggleRival { merchant: string; place: string; claimed: number; real: number | null }

export interface HaggleSituation {
  trait: HaggleTrait;
  rep: number;
  side: Side;
  qty: number;
  /** 0..1 : à quel point le marchand a besoin de CE trade (sur-stock quand on achète, manque quand on vend). */
  need: number;
  /** caisse basse ou fermeture : il a besoin de Flux. */
  desperate: boolean;
  /** prix normal de la première unité chez ce marchand */
  base: number;
  rival: HaggleRival | null;
}

export interface HaggleState {
  bp: number;
  patience: number;
  round: number;          // 1..HAGGLE.rounds
  phase: HagglePhase;
  used: HaggleCard[];
  hand: HaggleCard[];
}

export interface HaggleOutcome {
  card: HaggleCard;
  deltaBp: number;        // effet demandé (avant plafond)
  gainedBp: number;       // effet réellement appliqué (après plafond)
  deltaPatience: number;
  event: HaggleEvent;
  face: HaggleFace;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Plafond de l'offre (bp) selon la réputation : 5 % + 0,3 point par point de réputation positive, ≤ 8 %. */
export function maxBp(rep: number): number {
  const pct = Math.min(HAGGLE.maxPct, HAGGLE.basePct + Math.max(0, rep) * HAGGLE.pctPerRep);
  return Math.round(pct * 10_000);
}

export const clampRep = (rep: number): number => clamp(Math.round(rep), HAGGLE.repMin, HAGGLE.repMax);

/** Besoin du marchand pour ce côté de l'échange, et détresse de trésorerie. */
export function motivation(m: MerchantState, side: Side, f: Family): { need: number; desperate: boolean } {
  const ratio = m.stock[f] / Math.max(0.5, targetOf(m, f));
  const need = side === 'buy' ? clamp(ratio - 1, 0, 1) : clamp(1 - ratio, 0, 1);
  return { need: Math.round(need * 100) / 100, desperate: m.status === 'closing' || m.flux < MERCHANT.closingBelow * 2 };
}

export function startPatience(trait: HaggleTrait, rep: number): number {
  const p = HAGGLE.patienceBase + Math.floor(Math.max(0, rep) / 3) + (trait === 'friendly' ? 1 : 0) - (trait === 'proud' ? 1 : 0);
  return clamp(p, 2, HAGGLE.patienceMax);
}

/** La carte « rival » n'est jouable que si le joueur a vu un concurrent ; sinon il ne peut que bluffer. */
const leverCard = (sit: HaggleSituation): HaggleCard => (sit.rival ? 'rival' : 'bluff');
const POOL: readonly HaggleCard[] = ['bulk', 'regular', 'compliment', 'lowball'];

/** Main de la manche : manche 1 = la carte « rival / bluff » + 2 tirées ; ensuite 2 tirées + « walk away ». Déterministe par rng. */
export function dealHand(rng: Rng, sit: HaggleSituation, used: readonly HaggleCard[], round: number): HaggleCard[] {
  const lever = leverCard(sit);
  const avail = [...POOL, lever].filter((c) => !used.includes(c));
  for (let i = avail.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [avail[i], avail[j]] = [avail[j]!, avail[i]!];
  }
  if (round === 1) return [lever, ...avail.filter((c) => c !== lever).slice(0, HAGGLE.handSize - 1)];
  return [...avail.slice(0, HAGGLE.handSize - 1), 'walk'];
}

export function startHaggle(rng: Rng, sit: HaggleSituation): HaggleState {
  return { bp: 0, patience: startPatience(sit.trait, sit.rep), round: 1, phase: 'open', used: [], hand: dealHand(rng, sit, [], 1) };
}

/** Le concurrent fait-il vraiment mieux, maintenant ? (achat : il vend moins cher ; vente : il paie plus). */
export function rivalIsBetter(sit: HaggleSituation): boolean {
  const r = sit.rival;
  if (!r || r.real === null) return false;
  return sit.side === 'buy' ? r.real < sit.base : r.real > sit.base;
}

/** Effet brut d'une carte (sans plafond) — c'est toute la « psychologie » du marchand, en un tableau lisible. */
export function cardEffect(card: HaggleCard, sit: HaggleSituation): Omit<HaggleOutcome, 'gainedBp'> & { phase?: HagglePhase } {
  const { trait, rep, qty, need, desperate } = sit;
  const motivated = need >= 0.5 || desperate;
  const out = (deltaBp: number, deltaPatience: number, event: HaggleEvent, face: HaggleFace, phase?: HagglePhase) =>
    ({ card, deltaBp: Math.round(deltaBp), deltaPatience, event, face, ...(phase ? { phase } : {}) });
  switch (card) {
    case 'bulk': {
      const big = qty >= 6;
      return out((big ? 250 : 120) * (trait === 'greedy' ? 1.5 : 1), 0, big ? 'bulk-good' : 'bulk-meh', big ? 'happy' : 'neutral');
    }
    case 'regular':
      if (rep >= 3) return out(trait === 'friendly' ? 250 : 200, 0, 'regular-good', 'happy');
      if (rep >= 1) return out(trait === 'friendly' ? 150 : 100, 0, 'regular-good', 'neutral');
      return out(0, -1, 'regular-doubt', 'annoyed');
    case 'rival': {
      if (!rivalIsBetter(sit)) return out(0, -2, 'rival-false', 'annoyed');
      const gap = Math.abs(sit.base - sit.rival!.real!) / Math.max(1, sit.base);
      return out(clamp(Math.round(gap * 10_000) + 100, 200, 400), trait === 'proud' ? -1 : 0, 'rival-true', 'neutral');
    }
    case 'bluff':
      if (motivated) return out(150, -1, 'bluff-works', 'neutral');
      return out(0, trait === 'proud' ? -3 : -2, 'bluff-caught', 'annoyed');
    case 'compliment':
      if (trait === 'proud') return out(200, 1, 'compliment-good', 'happy');
      if (trait === 'friendly') return out(150, 1, 'compliment-good', 'happy');
      return out(0, 0, 'compliment-meh', 'neutral');
    case 'lowball':
      if (motivated) return out(400, -1, 'lowball-good', 'neutral');
      if (trait === 'proud') return out(0, -3, 'lowball-bad', 'annoyed');
      return out(100, -2, 'lowball-bad', 'annoyed');
    case 'walk':
      if (need >= 0.3 || desperate || (trait === 'friendly' && rep >= 2)) return out(200, 0, 'walk-back', 'neutral', 'final');
      return out(0, 0, 'walk-bye', 'annoyed', 'walked');
  }
}

export type PlayError = 'NOT_IN_HAND' | 'OVER';

/** Joue une carte : nouvelle offre (bornée), patience, manche suivante ou fin. */
export function playCard(rng: Rng, state: HaggleState, card: HaggleCard, sit: HaggleSituation): { state: HaggleState; outcome: HaggleOutcome } | { error: PlayError } {
  if (state.phase !== 'open') return { error: 'OVER' };
  if (!state.hand.includes(card)) return { error: 'NOT_IN_HAND' };
  const eff = cardEffect(card, sit);
  const cap = maxBp(sit.rep);
  const bp = clamp(state.bp + eff.deltaBp, 0, cap);
  const patience = clamp(state.patience + eff.deltaPatience, 0, HAGGLE.patienceMax);
  const used = [...state.used, card];
  let phase: HagglePhase = eff.phase ?? 'open';
  let event = eff.event;
  let face = eff.face;
  if (patience <= 0) { phase = 'sour'; event = 'sour'; face = 'annoyed'; }
  const round = state.round + 1;
  if (phase === 'open' && round > HAGGLE.rounds) phase = 'final';
  const next: HaggleState = {
    bp: phase === 'sour' || phase === 'walked' ? 0 : bp,
    patience, round: Math.min(round, HAGGLE.rounds), phase, used,
    hand: phase === 'open' ? dealHand(rng, sit, used, round) : [],
  };
  return { state: next, outcome: { card, deltaBp: eff.deltaBp, gainedBp: next.bp - state.bp, deltaPatience: eff.deltaPatience, event, face } };
}

/**
 * Devis marchandé, borné sur le total : jamais pire que le devis normal, jamais au-delà de l'offre `bp` (≤ 8 %),
 * jamais au-delà du plancher de coût = Σ prix milieu au stock après chaque unité, ± 1 % (en réels, arrondi en faveur
 * du marchand). Raisonner sur le total (et non unité par unité) laisse une vraie marge sur les éclats à 10 ƒ.
 * `q` est le devis normal (quote()) calculé sur le même état `m`. Les prix unitaires sont réduits au prorata.
 */
export function haggledQuote(p0: number, m: MerchantState, q: Quote, bp: number): Quote {
  const pct = clamp(bp, 0, HAGGLE.maxPct * 10_000) / 10_000;
  let stock = m.stock[q.family];
  let floorReal = 0;
  for (let i = 0; i < q.qty; i++) {
    if (q.side === 'buy') { floorReal += midAt(p0, m, q.family, stock - 1) * (1 + HAGGLE.keepMargin); stock--; }
    else { floorReal += midAt(p0, m, q.family, stock + 1) * (1 - HAGGLE.keepMargin); stock++; }
  }
  const base = q.total;
  const total = q.side === 'buy'
    ? Math.min(base, Math.max(Math.ceil(floorReal), Math.ceil(base * (1 - pct))))
    : Math.max(base, Math.min(Math.floor(floorReal), Math.floor(base * (1 + pct))));
  return { ...q, unitPrices: spreadTotal(q.unitPrices, total), total };
}

/** Répartit un total sur les unités au prorata des prix normaux (somme exacte, chaque unité ≥ 1). */
function spreadTotal(units: number[], total: number): number[] {
  const base = units.reduce((a, b) => a + b, 0);
  if (base === total) return [...units];
  const out = units.map((u) => Math.max(1, Math.floor((u * total) / base)));
  let rest = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rest !== 0 && i < out.length * 4; i++) {
    const k = i % out.length;
    if (rest > 0) { out[k]!++; rest--; } else if (out[k]! > 1) { out[k]!--; rest++; }
  }
  return out;
}

/** Devis « boudé » (après un marchandage raté) : 3 % moins bon pour le joueur, jamais l'inverse. */
export function souredQuote(q: Quote): Quote {
  const unitPrices = q.unitPrices.map((p) =>
    q.side === 'buy' ? Math.ceil(p * (1 + HAGGLE.sourPct)) : Math.max(1, Math.floor(p * (1 - HAGGLE.sourPct))));
  return { ...q, unitPrices, total: unitPrices.reduce((a, b) => a + b, 0) };
}
