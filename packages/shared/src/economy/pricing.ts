// Prix des marchands : rareté locale × prix de référence ± marge. Fonctions pures.
// Règle anti-aller-retour : chaque unité est valorisée au stock APRÈS l'échange
// (acheter à stock s se paie mid(s−1), revendre ensuite se paie mid(s)) → acheter puis revendre perd toujours.
import { FAMILIES, type Family } from '../types.ts';
import { PRICING } from './rules.ts';

export type MerchantStatus = 'open' | 'closing' | 'closed';

export interface MerchantContract {
  id: string;
  family: Family;
  qty: number;
  reward: number;      // Flux payés pour la livraison complète
  expiresAt: number;
}

export interface MerchantState {
  id: string;
  name: string;
  archetype: string;
  specialty: Family[];
  flux: number;                          // trésorerie (entier)
  stock: Record<Family, number>;         // entiers ≥ 0
  baseTarget: Record<Family, number>;    // cible de départ (spécialité + archétype inclus)
  targetMult: Record<Family, number>;    // réglé par l'agent, borné [0.5, 2]
  spread: number;                        // réglé par l'agent, borné [0.03, 0.12]
  status: MerchantStatus;
  closingSince: number | null;
  lastTradeAt: number | null;
  contract: MerchantContract | null;
  mood: string;
}

export const targetOf = (m: MerchantState, f: Family): number => m.baseTarget[f] * m.targetMult[f];

export function scarcity(target: number, stock: number): number {
  const raw = (target / Math.max(stock, PRICING.stockFloor)) ** PRICING.alpha;
  return Math.min(PRICING.scarcityMax, Math.max(PRICING.scarcityMin, raw));
}

/** Marge effective pour une famille (spécialité, avantage Patron). Toujours > 0. */
export function effectiveSpread(m: MerchantState, f: Family, opts: { patron?: boolean } = {}): number {
  let s = m.spread;
  if (m.specialty.includes(f)) s -= PRICING.specialtySpreadDiscount;
  s = Math.max(0.01, s);
  if (opts.patron) s *= 0.5;
  return s;
}

/** Prix « milieu » à un stock donné. */
export const midAt = (p0: number, m: MerchantState, f: Family, stock: number): number =>
  p0 * scarcity(targetOf(m, f), stock);

export interface PriceExplanation {
  family: Family;
  p0: number;
  stock: number;
  target: number;
  scarcity: number;
  spread: number;
  specialty: boolean;
  closing: boolean;
  /** ce que le marchand paie pour 1 éclat (null = n'achète pas) */
  buy: number | null;
  /** ce que le joueur paie pour 1 éclat (null = ne vend pas) */
  sell: number | null;
  /** raison quand buy/sell est null */
  buyBlocked?: 'closed' | 'closing' | 'no-flux';
  sellBlocked?: 'closed' | 'empty' | 'contract' | 'strike';
  /** événement de ville en cours qui multiplie le prix de base de cette famille ici (p0 ci-dessus = avant l'événement) */
  event?: { label: string; mult: number };
}

/** Options de prix : avantage Patron, effet d'un événement de ville (multiplicateur de P0 borné), grève. */
export interface PriceOpts { patron?: boolean; event?: { label: string; mult: number } | null; strike?: boolean }
const p0With = (p0: number, opts: PriceOpts) => p0 * (opts.event?.mult ?? 1);

/** Prix unitaire que le marchand PAIE si on lui vend 1 éclat de plus (stock s → s+1). */
export function unitBuyPrice(p0: number, m: MerchantState, f: Family, stockBefore: number, opts: { patron?: boolean } = {}): number {
  return Math.max(1, Math.floor(midAt(p0, m, f, stockBefore + 1) * (1 - effectiveSpread(m, f, opts))));
}

/** Prix unitaire que le joueur PAIE pour 1 éclat (stock s → s−1). */
export function unitSellPrice(p0: number, m: MerchantState, f: Family, stockBefore: number, opts: { patron?: boolean } = {}): number {
  let price = midAt(p0, m, f, stockBefore - 1) * (1 + effectiveSpread(m, f, opts));
  if (m.status === 'closing') price *= 1 - PRICING.closingSellDiscount;
  return Math.max(1, Math.ceil(price));
}

export function explainPrice(p0Base: number, m: MerchantState, f: Family, opts: PriceOpts = {}): PriceExplanation {
  const p0 = p0With(p0Base, opts);
  const stock = m.stock[f];
  const target = targetOf(m, f);
  const e: PriceExplanation = {
    family: f, p0: p0Base, stock, target, scarcity: scarcity(target, stock),
    spread: effectiveSpread(m, f, opts), specialty: m.specialty.includes(f), closing: m.status === 'closing',
    buy: null, sell: null,
    ...(opts.event ? { event: { label: opts.event.label, mult: opts.event.mult } } : {}),
  };
  if (m.status === 'closed') { e.buyBlocked = 'closed'; e.sellBlocked = 'closed'; return e; }
  const buy = unitBuyPrice(p0, m, f, stock, opts);
  if (m.status === 'closing') e.buyBlocked = 'closing';
  else if (m.flux < buy) e.buyBlocked = 'no-flux';
  else e.buy = buy;
  if (stock <= 0) e.sellBlocked = 'empty';
  else if (opts.strike) e.sellBlocked = 'strike';
  else if (m.contract && m.contract.family === f) e.sellBlocked = 'contract';
  else e.sell = unitSellPrice(p0, m, f, stock, opts);
  return e;
}

export type Side = 'sell' | 'buy'; // du point de vue du JOUEUR : 'sell' = je vends au marchand, 'buy' = j'achète

export type QuoteError = 'CLOSED' | 'NOT_BUYING' | 'MERCHANT_NO_FLUX' | 'OUT_OF_STOCK' | 'CONTRACT_LOCK' | 'BAD_QTY' | 'STRIKE';
export interface Quote {
  side: Side;
  family: Family;
  qty: number;
  unitPrices: number[];
  total: number;
}

/** Devis exact d'un échange de `qty` unités (le prix glisse après chaque unité). */
export function quote(p0Base: number, m: MerchantState, side: Side, f: Family, qty: number, opts: PriceOpts = {}): Quote | { error: QuoteError } {
  const p0 = p0With(p0Base, opts);
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) return { error: 'BAD_QTY' };
  if (m.status === 'closed') return { error: 'CLOSED' };
  const unitPrices: number[] = [];
  let stock = m.stock[f];
  let total = 0;
  if (side === 'sell') {
    if (m.status === 'closing') return { error: 'NOT_BUYING' };
    for (let i = 0; i < qty; i++) {
      const p = unitBuyPrice(p0, m, f, stock, opts);
      unitPrices.push(p);
      total += p;
      stock++;
    }
    if (total > m.flux) return { error: 'MERCHANT_NO_FLUX' };
  } else {
    if (opts.strike) return { error: 'STRIKE' };
    if (m.contract && m.contract.family === f) return { error: 'CONTRACT_LOCK' };
    if (stock < qty) return { error: 'OUT_OF_STOCK' };
    for (let i = 0; i < qty; i++) {
      const p = unitSellPrice(p0, m, f, stock, opts);
      unitPrices.push(p);
      total += p;
      stock--;
    }
  }
  return { side, family: f, qty, unitPrices, total };
}

/** Applique un devis à l'état du marchand (copie). Le serveur vérifie l'inventaire du joueur à part. */
export function applyTrade(m: MerchantState, q: Quote, now: number): MerchantState {
  const stock = { ...m.stock };
  let flux = m.flux;
  if (q.side === 'sell') { stock[q.family] += q.qty; flux -= q.total; }
  else { stock[q.family] -= q.qty; flux += q.total; }
  return { ...m, stock, flux, lastTradeAt: now };
}

/** Prix milieu courant par famille (pour P0, tendances, Pulse). */
export function mids(p0: Record<Family, number>, m: MerchantState): Record<Family, number> {
  const out = {} as Record<Family, number>;
  for (const f of FAMILIES) out[f] = midAt(p0[f], m, f, m.stock[f]);
  return out;
}
