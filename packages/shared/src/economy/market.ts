// Vie des marchands : création, tick horaire (imports, exports, loyer, faillite), sauvetage, contrats, dérive de P0.
import { ARCHETYPES, FAMILIES, type Archetype, type Family } from '../types.ts';
import { pick, randInt, randRange, rngFrom, type Rng } from '../rng.ts';
import {
  ARCHETYPE_BIAS, BASE_TARGET, CONTRACT, FAMILY_INFO, INITIAL_STOCK_RATIO, INITIAL_TREASURY, MERCHANT, P0_DRIFT, PRICING,
} from './rules.ts';
import { midAt, targetOf, unitSellPrice, type MerchantContract, type MerchantState } from './pricing.ts';

const FIRST_NAMES = [
  'Margot', 'Bao', 'Inès', 'Lucien', 'Yasmine', 'Théo', 'Odile', 'Malik', 'Clémence', 'Hugo', 'Aïcha', 'Gaspard',
  'Nour', 'Félix', 'Rosalie', 'Kenji', 'Camille', 'Sacha', 'Léonie', 'Amadou', 'Zoé', 'Bastien', 'Mireille', 'Ilyes',
];
const TITLES: Record<Archetype, string[]> = {
  gambler: ['the Gambler', 'Lucky Hands', 'the Dice'],
  hoarder: ['the Hoarder', 'Deep Pockets', 'the Magpie'],
  scholar: ['the Scholar', 'the Archivist', 'Footnotes'],
  hustler: ['the Hustler', 'Fast Lane', 'the Fixer'],
  grandma: ['Mamie', 'Granny Bytes', 'the Knitter'],
  purist: ['the Purist', 'Old School', 'the Curator'],
  trendchaser: ['the Trendsetter', 'Hype Scout', 'the Wave'],
  nightowl: ['Night Owl', 'Moonlight', 'the Insomniac'],
};

const famRecord = (fn: (f: Family) => number): Record<Family, number> =>
  Object.fromEntries(FAMILIES.map((f) => [f, fn(f)])) as Record<Family, number>;

/** Crée l'état initial d'un marchand, déterministe à partir de son id. */
export function createMerchant(secret: string, nodeId: string, specialty: Family[]): MerchantState {
  const rng = rngFrom(secret, 'merchant', nodeId);
  const archetype = pick(rng, ARCHETYPES);
  const bias = ARCHETYPE_BIAS[archetype];
  const spec = specialty.slice(0, 2);
  const baseTarget = famRecord((f) =>
    Math.max(1, Math.round(BASE_TARGET[f] * bias.targetMult * (spec.includes(f) ? PRICING.specialtyTargetMult : 1))));
  const stock = famRecord((f) => Math.round(baseTarget[f] * randRange(rng, INITIAL_STOCK_RATIO[0], INITIAL_STOCK_RATIO[1])));
  return {
    id: `m:${nodeId}`,
    name: `${pick(rng, FIRST_NAMES)} ${pick(rng, TITLES[archetype])}`,
    archetype,
    specialty: spec,
    flux: randInt(rng, INITIAL_TREASURY[0], INITIAL_TREASURY[1]),
    stock,
    baseTarget,
    targetMult: famRecord(() => 1),
    spread: bias.spread,
    status: 'open',
    closingSince: null,
    lastTradeAt: null,
    contract: null,
    mood: '',
  };
}

export type MerchantEvent =
  | { kind: 'import'; family: Family; qty: number; cost: number }
  | { kind: 'export'; family: Family; qty: number; gain: number }
  | { kind: 'rent'; cost: number }
  | { kind: 'closing' }
  | { kind: 'closed' }
  | { kind: 'reopened' }
  | { kind: 'contract-expired'; contractId: string };

/** Tick horaire : imports, exports, loyer, puis transitions de statut. Renvoie le nouvel état + les événements. */
export function hourlyTick(m0: MerchantState, p0: Record<Family, number>, now: number): { m: MerchantState; events: MerchantEvent[] } {
  const m: MerchantState = { ...m0, stock: { ...m0.stock } };
  const events: MerchantEvent[] = [];
  if (m.contract && m.contract.expiresAt <= now) {
    events.push({ kind: 'contract-expired', contractId: m.contract.id });
    m.contract = null;
  }
  if (m.status !== 'closed') {
    for (const f of FAMILIES) {
      const target = targetOf(m, f);
      if (m.stock[f] < MERCHANT.importBelowRatio * target) {
        const cost = Math.ceil(p0[f] * MERCHANT.importPriceMult);
        if (m.flux >= cost) {
          m.flux -= cost;
          m.stock[f] += 1;
          events.push({ kind: 'import', family: f, qty: 1, cost });
        }
      }
      const surplus = Math.floor(m.stock[f] - MERCHANT.exportAboveRatio * target);
      if (surplus > 0) {
        const gain = Math.floor(surplus * p0[f] * MERCHANT.exportPriceMult);
        m.stock[f] -= surplus;
        m.flux += gain;
        events.push({ kind: 'export', family: f, qty: surplus, gain });
      }
    }
    if (m.lastTradeAt !== null && now - m.lastTradeAt < MERCHANT.activeWindowMs) {
      const cost = Math.min(m.flux, MERCHANT.rentPerHour);
      m.flux -= cost;
      if (cost > 0) events.push({ kind: 'rent', cost });
    }
  }
  return applyStatus(m, now, events);
}

/** Transitions open → closing → closed → open selon la trésorerie. */
export function applyStatus(m0: MerchantState, now: number, events: MerchantEvent[] = []): { m: MerchantState; events: MerchantEvent[] } {
  const m = { ...m0 };
  if (m.status === 'open' && m.flux < MERCHANT.closingBelow) {
    m.status = 'closing';
    m.closingSince = now;
    events.push({ kind: 'closing' });
  } else if (m.status === 'closing') {
    if (m.flux >= MERCHANT.closingBelow) {
      m.status = 'open';
      m.closingSince = null;
      events.push({ kind: 'reopened' });
    } else if (m.closingSince !== null && now - m.closingSince >= MERCHANT.closingGraceMs) {
      m.status = 'closed';
      m.contract = null;
      events.push({ kind: 'closed' });
    }
  } else if (m.status === 'closed' && m.flux >= MERCHANT.reopenAt) {
    m.status = 'open';
    m.closingSince = null;
    events.push({ kind: 'reopened' });
  }
  return { m, events };
}

/** Sauvetage : un joueur verse des Flux dans la caisse d'un marchand en difficulté. */
export function rescue(m: MerchantState, amount: number, now: number): { m: MerchantState; events: MerchantEvent[] } | { error: 'NOT_STRUGGLING' | 'BAD_AMOUNT' } {
  if (m.status === 'open') return { error: 'NOT_STRUGGLING' };
  if (!Number.isInteger(amount) || amount < MERCHANT.rescueMin) return { error: 'BAD_AMOUNT' };
  const next = { ...m, flux: m.flux + amount };
  if (next.flux >= MERCHANT.reopenAt) {
    return { m: { ...next, status: 'open', closingSince: null }, events: [{ kind: 'reopened' }] };
  }
  return applyStatus(next, now);
}

/** Nouveau contrat : la famille la plus en manque, 1–5 unités, récompense au-dessus du prix de vente. */
export function makeContract(rng: Rng, m: MerchantState, p0: Record<Family, number>, now: number, prefer?: Family): MerchantContract {
  let family: Family = FAMILIES[0];
  let worst = Infinity;
  for (const f of FAMILIES) {
    const ratio = m.stock[f] / targetOf(m, f);
    if (ratio < worst) { worst = ratio; family = f; }
  }
  if (prefer) family = prefer;
  const qty = randInt(rng, CONTRACT.qtyMin, Math.min(CONTRACT.qtyMax, FAMILY_INFO[family].rarity === 'epic' ? 2 : CONTRACT.qtyMax));
  const unit = unitSellPrice(p0[family], { ...m, status: 'open' }, family, Math.max(1, m.stock[family]));
  const reward = Math.round(qty * unit * randRange(rng, CONTRACT.rewardMultMin, CONTRACT.rewardMultMax));
  const duration = Math.round(randRange(rng, CONTRACT.durationMinMs, CONTRACT.durationMaxMs) / 60_000) * 60_000;
  return { id: `c:${m.id}:${now}`, family, qty, reward, expiresAt: now + duration };
}

/** Livraison d'un contrat : le marchand paie la récompense (s'il peut) et reçoit les éclats. */
export function deliverContract(m: MerchantState, now: number): { m: MerchantState; reward: number } | { error: 'NO_CONTRACT' | 'EXPIRED' | 'MERCHANT_NO_FLUX' | 'CLOSED' } {
  const c = m.contract;
  if (!c) return { error: 'NO_CONTRACT' };
  if (m.status === 'closed') return { error: 'CLOSED' };
  if (c.expiresAt <= now) return { error: 'EXPIRED' };
  if (m.flux < c.reward) return { error: 'MERCHANT_NO_FLUX' };
  return {
    m: { ...m, flux: m.flux - c.reward, stock: { ...m.stock, [c.family]: m.stock[c.family] + c.qty }, contract: null, lastTradeAt: now },
    reward: c.reward,
  };
}

/** Dérive horaire du prix de référence vers la médiane des prix milieu des marchands ouverts. */
export function driftP0(p0: Record<Family, number>, merchants: MerchantState[]): Record<Family, number> {
  const out = { ...p0 };
  const open = merchants.filter((m) => m.status !== 'closed');
  if (open.length === 0) return out;
  for (const f of FAMILIES) {
    const vals = open.map((m) => midAt(p0[f], m, f, m.stock[f])).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)]!;
    const initial = FAMILY_INFO[f].p0;
    const next = P0_DRIFT.keep * p0[f] + P0_DRIFT.follow * median;
    out[f] = Math.min(initial * P0_DRIFT.maxMult, Math.max(initial * P0_DRIFT.minMult, next));
  }
  return out;
}

export const initialP0 = (): Record<Family, number> => famRecord((f) => FAMILY_INFO[f].p0);

/** Graine stable pour les décisions d'un marchand à un instant donné (contrats, fallback). */
export const merchantRng = (secret: string, m: MerchantState, at: number): Rng => rngFrom(secret, 'm-rng', m.id, at);
