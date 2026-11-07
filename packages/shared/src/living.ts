// Carte vivante : trajets des marcheurs, anonymisation des joueurs réels, bulles des marchands. Fonctions pures.
import { cellToLatLng } from 'h3-js';
import { FAMILIES, type Family } from './types.ts';
import { bearingDeg, haversineM, offsetM, type LatLng } from './geo.ts';
import { rngFrom } from './rng.ts';
import { FAMILY_INFO, LIVING } from './economy/rules.ts';
import { scarcity, targetOf, type MerchantState } from './economy/pricing.ts';
import { eventStrikes, inEventZone, isEventActive, type CityEvent } from './economy/events.ts';

// ───────────────────────────── Trajets ─────────────────────────────

/** Un tronçon de marche à vitesse constante (runners : entre deux nœuds réels). */
export interface WalkLeg { from: LatLng; to: LatLng; departAt: number; arriveAt: number }

/** Position sur le tronçon à l'instant `now` (bornée aux extrémités) + cap et état « en marche ». */
export function legPosition(leg: WalkLeg, now: number): LatLng & { moving: boolean; heading: number } {
  const heading = haversineM(leg.from, leg.to) > 0.5 ? bearingDeg(leg.from, leg.to) : 0;
  if (now >= leg.arriveAt || leg.arriveAt <= leg.departAt) return { lat: leg.to.lat, lng: leg.to.lng, moving: false, heading };
  const k = Math.max(0, (now - leg.departAt) / (leg.arriveAt - leg.departAt));
  return { lat: leg.from.lat + (leg.to.lat - leg.from.lat) * k, lng: leg.from.lng + (leg.to.lng - leg.from.lng) * k, moving: now >= leg.departAt, heading };
}

// ───────────────────────────── Vie privée ─────────────────────────────

/**
 * Position publique d'un joueur réel : centre de sa cellule H3 r9 (~175 m de côté) + décalage pseudo-aléatoire ≤ 60 m,
 * stable pendant 10 min. Ne dépend QUE de la cellule : sa position exacte n'entre jamais dans le calcul.
 */
export function anonymisedPosition(secret: string, userId: string, cell: string, now: number): LatLng {
  const [lat, lng] = cellToLatLng(cell);
  const rng = rngFrom(secret, 'walker-jitter', userId, cell, Math.floor(now / LIVING.privacyWindowMs));
  const r = LIVING.playerJitterM * Math.sqrt(rng());
  const a = rng() * 2 * Math.PI;
  const p = offsetM({ lat, lng }, r * Math.cos(a), r * Math.sin(a));
  return { lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 };
}

// ───────────────────────────── Bulles des marchands ─────────────────────────────

export type BubbleTone = 'deal' | 'buy' | 'help' | 'thanks' | 'contract' | 'event';
export interface Bubble { text: string; tone: BubbleTone; prio: number; family?: Family }

const T: Record<string, string[]> = {
  closed: ['Closed… need an investor!', 'My till is empty — help?', 'Rescue me, runner!'],
  closing: ['Closing soon… help!', 'Flux running low — invest?', 'Last days of my shop…'],
  strike: ['On strike! Buying only.', 'No sales today — solidarity!', 'Strike! I only buy.'],
  reopened: ['Back in business, thanks!', 'Reopened! Thank you, patrons!', 'I’m back! Come trade!'],
  crash: ['Flash crash! {F} {P}', '{F} at crash prices!', 'Dumping {F} — {P}!'],
  hype: ['Paying {P} for {F}!', '{F} fever — I pay more!', 'Bring {F}, top Flux!'],
  rush: ['Gold rush! {F} nearby!', '{F} shards everywhere!', 'Go catch {F}, quick!'],
  contract: ['Need {Q} {F} — bonus pay!', 'Contract: {Q} {F} wanted!', 'Who has {Q} {F}?'],
  cheap: ['Selling {F} cheap!', 'Cheap {F} here!', '{F} sale — too much stock!'],
  buy: ['Buying {F} — top price!', 'Bring me {F}, I pay well!', 'Short on {F}… paying up!'],
};

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

function fill(key: string, seed: string, vars: { F?: string; P?: string; Q?: number }): string {
  const list = T[key]!;
  return list[hash(seed) % list.length]!.replace('{F}', vars.F ?? '').replace('{P}', vars.P ?? '').replace('{Q}', String(vars.Q ?? ''));
}

export interface BubbleContext {
  pos: LatLng;                     // position du marchand
  event?: CityEvent | null;
  reopenedAt?: number | null;      // dernière réouverture connue
}

/**
 * Ce que dit un marchand, dérivé de son état réel (statut, contrat, stock vs cible, événement) — ou null s'il n'a rien
 * de notable à dire. La formulation varie toutes les 10 min (déterministe par marchand).
 */
export function merchantBubble(m: MerchantState, now: number, c: BubbleContext): Bubble | null {
  const seed = `${m.id}|${Math.floor(now / 600_000)}`;
  if (m.status === 'closed') return { text: fill('closed', seed, {}), tone: 'help', prio: 5 };
  if (m.status === 'closing') return { text: fill('closing', seed, {}), tone: 'help', prio: 5 };
  const e = isEventActive(c.event, now) && inEventZone(c.event, c.pos) ? c.event : null;
  if (e && eventStrikes(e, c.pos, now)) return { text: fill('strike', seed, {}), tone: 'event', prio: 4 };
  if (c.reopenedAt && now - c.reopenedAt < LIVING.reopenedBubbleMs) return { text: fill('reopened', seed, {}), tone: 'thanks', prio: 4 };
  if (e && e.family) {
    const F = FAMILY_INFO[e.family].name;
    if (e.kind === 'gold_rush') return { text: fill('rush', seed, { F }), tone: 'event', prio: 4, family: e.family };
    if (e.priceMult !== null) {
      const P = `${e.priceMult < 1 ? '−' : '+'}${Math.round(Math.abs(e.priceMult - 1) * 100)}%`;
      return { text: fill(e.priceMult < 1 ? 'crash' : 'hype', seed, { F, P }), tone: 'event', prio: 4, family: e.family };
    }
  }
  if (m.contract && m.contract.expiresAt > now) {
    return { text: fill('contract', seed, { F: FAMILY_INFO[m.contract.family].name, Q: m.contract.qty }), tone: 'contract', prio: 3, family: m.contract.family };
  }
  // le plus marquant entre « je solde » (stock bien au-dessus de la cible) et « je rachète cher » (stock bien en dessous)
  let cheap: { f: Family; s: number } | null = null;
  let dear: { f: Family; s: number } | null = null;
  for (const f of FAMILIES) {
    const s = scarcity(targetOf(m, f), m.stock[f]);
    if (m.stock[f] > 0 && s <= 0.8 && (!cheap || s < cheap.s)) cheap = { f, s };
    if (s >= 1.35 && (!dear || s > dear.s)) dear = { f, s };
  }
  const useCheap = cheap && (!dear || 1 / cheap.s >= dear.s);
  if (useCheap) return { text: fill('cheap', seed, { F: FAMILY_INFO[cheap!.f].name }), tone: 'deal', prio: 2, family: cheap!.f };
  if (dear) return { text: fill('buy', seed, { F: FAMILY_INFO[dear.f].name }), tone: 'buy', prio: 2, family: dear.f };
  return null;
}

export interface BubbleCandidate extends LatLng { id: string; bubble: Bubble }

/**
 * Bulles à afficher maintenant : marchands à ≤ 400 m, au plus 3. Les urgences (prio ≥ 4) d'abord, puis les autres
 * tournent toutes les 7 s pour que chacun ait son tour sans encombrer la carte.
 */
export function pickBubbles(cands: BubbleCandidate[], pos: LatLng, now: number, max: number = LIVING.bubblesMax): BubbleCandidate[] {
  const near = cands
    .map((c) => ({ c, d: haversineM(pos, c) }))
    .filter((x) => x.d <= LIVING.bubbleRadiusM)
    .sort((a, b) => b.c.bubble.prio - a.c.bubble.prio || a.d - b.d || (a.c.id < b.c.id ? -1 : 1));
  const urgent = near.filter((x) => x.c.bubble.prio >= 4).slice(0, max);
  const rest = near.filter((x) => x.c.bubble.prio < 4);
  const slots = max - urgent.length;
  const out = urgent.map((x) => x.c);
  if (slots > 0 && rest.length) {
    const slot = Math.floor(now / LIVING.bubbleSlotMs);
    const start = rest.length > slots ? (slot * slots) % rest.length : 0;
    for (let i = 0; i < Math.min(slots, rest.length); i++) out.push(rest[(start + i) % rest.length]!.c);
  }
  return out;
}
