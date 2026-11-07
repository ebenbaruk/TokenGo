// Marchandage côté serveur (Docs/03 §5 bis) : séance (id, TTL), cartes, issue décidée par les règles pures de
// packages/shared/src/economy/haggle.ts, règlement par le même chemin que le trade normal. Le client n'envoie que la carte.
import {
  FAMILIES, FAMILY_INFO, HAGGLE, HAGGLE_CARDS, explainPrice, haggledQuote, maxBp, motivation, playCard, quote as priceQuote,
  rngFrom, shardToken, startHaggle, traitOf,
  type Family, type HaggleCard, type HaggleDealResponse, type HaggleEvent, type HaggleFace, type HaggleOutcome, type HaggleRival,
  type HaggleSituation, type HaggleState, type HaggleView, type MerchantState, type QuoteRequest,
} from '@tokengo/shared';
import { kvGet, kvSet } from '../db.ts';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { randomId } from './crypto.ts';
import { assertCanAct } from './actions.ts';
import { balance } from './players.ts';
import { getMerchant } from './merchants.ts';
import { QUOTE_ERRORS, canTrade, load, pricingFor, settleTrade, viewMerchant } from './market.ts';
import { bumpRep, hagglesLeft, relationOf, sour } from './relations.ts';
import { haggleLine } from './haggleLines.ts';
import { parisDay } from './reserve.ts';

/** Ce dont le marchandage a besoin du cerveau LLM : au plus UNE réplique par séance (jamais de chiffres). */
export interface HaggleLlm { haggleLine?: (m: MerchantState, info: { side: 'buy' | 'sell'; family: string; qty: number; trait: string }) => Promise<string | null> }

interface Session {
  id: string;
  userId: string;
  merchantId: string;
  version: number;
  req: QuoteRequest;
  baseTotal: number;
  sit: HaggleSituation;
  state: HaggleState;
  line: string;
  lineSource: 'lines' | 'llm';
  face: HaggleFace;
  event: HaggleEvent;
  last: HaggleView['last'];
  hints: string[];
  expiresAt: number;
  llmAsked: boolean;
  llmLine: string | null;
}
const sessions = new Map<string, Session>();
const HAGGLE_SEEN_MS = 2 * 3600_000;
const KV_LLM = 'npc-haggle-calls';

const rngFor = (ctx: Ctx, s: { id: string }, round: number) => rngFrom(ctx.cfg.SPAWN_SECRET, 'haggle', s.id, round);
const firstName = (m: MerchantState) => m.name.split(' ')[0] ?? m.name;

/** Meilleur concurrent vu par le joueur (≤ 2 h) pour cette famille et ce côté, avec son prix réel actuel. */
function rivalFor(ctx: Ctx, userId: string, m: MerchantState, req: QuoteRequest): HaggleRival | null {
  const rows = ctx.db.prepare('SELECT merchant_id, prices FROM price_seen WHERE user_id = ? AND at > ? AND merchant_id != ?')
    .all(userId, ctx.now() - HAGGLE_SEEN_MS, m.id) as { merchant_id: string; prices: string }[];
  let best: HaggleRival | null = null;
  for (const r of rows) {
    const seen = (JSON.parse(r.prices) as Record<Family, { buy: number | null; sell: number | null }>)[req.family];
    const claimed = req.side === 'buy' ? seen?.sell : seen?.buy;
    if (claimed === null || claimed === undefined) continue;
    if (best && (req.side === 'buy' ? claimed >= best.claimed : claimed <= best.claimed)) continue;
    const cur = getMerchant(ctx, r.merchant_id);
    if (!cur) continue;
    const pr = pricingFor(ctx, userId, cur.m.id, req.family, cur.node); // prix réel chez le rival (événement compris)
    const e = explainPrice(pr.p0, cur.m, req.family, pr.opts);
    best = { merchant: firstName(cur.m), place: cur.node.name, claimed, real: req.side === 'buy' ? e.sell : e.buy };
  }
  return best;
}

function hintsFor(m: MerchantState, sit: HaggleSituation, f: Family): string[] {
  const out: string[] = [];
  const name = FAMILY_INFO[f].name;
  if (sit.need >= 0.5) out.push(sit.side === 'buy' ? `Overstocked on ${name}` : `Short on ${name}`);
  else if (sit.need >= 0.3) out.push(sit.side === 'buy' ? `A bit heavy on ${name}` : `Could use ${name}`);
  if (m.status === 'closing') out.push('Closing down');
  else if (sit.desperate) out.push('Till running low');
  if (sit.rep >= 3) out.push('Knows you well');
  return out;
}

/** Totaux actuels (devis normal, marchandé, meilleur possible) recalculés sur l'état courant du marchand. */
function totals(ctx: Ctx, s: Session): { base: number; total: number; best: number } {
  const cur = getMerchant(ctx, s.merchantId);
  if (!cur) return { base: s.baseTotal, total: s.baseTotal, best: s.baseTotal };
  const { p0, opts } = pricingFor(ctx, s.userId, s.merchantId, s.req.family, cur.node);
  const q = priceQuote(p0, cur.m, s.req.side, s.req.family, s.req.qty, opts);
  if ('error' in q) return { base: s.baseTotal, total: s.baseTotal, best: s.baseTotal };
  return { base: q.total, total: haggledQuote(p0, cur.m, q, s.state.bp).total, best: haggledQuote(p0, cur.m, q, maxBp(s.sit.rep)).total };
}

function view(ctx: Ctx, s: Session, phase: HaggleView['phase'] = s.state.phase): HaggleView {
  const t = totals(ctx, s);
  return {
    haggleId: s.id, merchantId: s.merchantId, side: s.req.side, family: s.req.family, qty: s.req.qty,
    baseTotal: t.base, total: t.total, bestTotal: t.best,
    offerBp: s.state.bp, maxBp: maxBp(s.sit.rep), patience: s.state.patience, patienceMax: HAGGLE.patienceMax,
    round: s.state.round, rounds: HAGGLE.rounds, phase,
    hand: s.state.hand.map((card) => (card === 'rival' && s.sit.rival
      ? { card, rival: { merchant: s.sit.rival.merchant, place: s.sit.rival.place, price: s.sit.rival.claimed } }
      : { card })),
    line: s.line, lineSource: s.lineSource, face: s.face, event: s.event, last: s.last,
    trait: s.sit.trait, rep: s.sit.rep, hints: s.hints, expiresAt: s.expiresAt,
  };
}

function getSession(ctx: Ctx, userId: string, merchantId: string, haggleId: string): Session {
  const s = sessions.get(haggleId);
  if (!s || s.userId !== userId || s.merchantId !== merchantId) return fail('EXPIRED', 'This haggle is over — start a new one.');
  if (s.expiresAt < ctx.now()) {
    sessions.delete(haggleId);
    ctx.db.prepare("UPDATE haggles SET outcome = 'expired' WHERE id = ? AND outcome = 'open'").run(haggleId);
    return fail('EXPIRED', 'Too slow — the merchant moved on. Start a new haggle.');
  }
  return s;
}

/** Réserve une réplique LLM de marchandage (plafond propre, en plus du plafond NPC global partagé). */
export function takeHaggleLlm(ctx: Ctx): boolean {
  const day = parisDay(ctx.now());
  const cur = kvGet<{ day: string; n: number }>(ctx.db, KV_LLM);
  const n = cur?.day === day ? cur.n : 0;
  if (n >= HAGGLE.llmLinesPerDay) return false;
  kvSet(ctx.db, KV_LLM, { day, n: n + 1 });
  return true;
}

export function startHaggleSession(ctx: Ctx, userId: string, merchantId: string, req: QuoteRequest): HaggleView {
  const u = canTrade(ctx, userId);
  const { m, version, node } = load(ctx, merchantId);
  assertCanAct(ctx, u, 'market', node);
  if (req.side === 'sell' && u.demo_token) fail('DEMO_CANNOT_SELL', 'Demo passes can buy, forge and invest — but not sell.');
  if (!FAMILIES.includes(req.family)) fail('BAD_REQUEST', 'Unknown shard.');
  if (!Number.isInteger(req.qty) || req.qty < HAGGLE.minQty || req.qty > 50) fail('BAD_QTY', `Haggling starts at ${HAGGLE.minQty} shards.`);
  const now = ctx.now();
  const rel = relationOf(ctx, userId, merchantId);
  if ((rel.sourUntil ?? 0) > now) {
    fail('HAGGLE_SOUR', `${firstName(m)} is sulking — no haggling for ${Math.ceil((rel.sourUntil! - now) / 60_000)} min.`, 400, { until: rel.sourUntil });
  }
  const lim = hagglesLeft(ctx, userId, merchantId);
  if (lim.perMerchant === 0) fail('RATE_LIMITED', 'Enough haggling here today.', 429, { quota: 'haggles at this shop', limit: HAGGLE.perMerchantDay });
  if (lim.perPlayer === 0) fail('RATE_LIMITED', 'Enough haggling today.', 429, { quota: 'haggles', limit: HAGGLE.perPlayerDay });
  const { p0, opts } = pricingFor(ctx, userId, m.id, req.family, node);
  const q = priceQuote(p0, m, req.side, req.family, req.qty, opts);
  if ('error' in q) return fail(q.error, QUOTE_ERRORS[q.error] ?? 'Not possible.');
  const best = haggledQuote(p0, m, q, maxBp(rel.rep));
  if (best.total === q.total) fail('HAGGLE_NO_ROOM', 'That’s already my rock-bottom price.');
  if (req.side === 'sell' && balance(ctx, userId, shardToken(req.family)) < req.qty) fail('INSUFFICIENT', "You don't have that many shards.");
  if (req.side === 'buy' && balance(ctx, userId, 'flux') < best.total) fail('INSUFFICIENT', `You need at least ${best.total} ƒ.`, 400, { total: best.total });

  const { need, desperate } = motivation(m, req.side, req.family);
  const sit: HaggleSituation = {
    trait: traitOf(m.archetype), rep: rel.rep, side: req.side, qty: req.qty, need, desperate,
    base: q.unitPrices[0]!, rival: rivalFor(ctx, userId, m, req),
  };
  const id = randomId(9);
  for (const [k, s] of sessions) if (s.userId === userId || s.expiresAt < now) sessions.delete(k); // une séance à la fois
  const s: Session = {
    id, userId, merchantId, version, req: { side: req.side, family: req.family, qty: req.qty }, baseTotal: q.total, sit,
    state: startHaggle(rngFor(ctx, { id }, 1), sit),
    line: haggleLine(sit.trait, 'opened', `${id}:0`), lineSource: 'lines', face: 'neutral', event: 'opened', last: null,
    hints: hintsFor(m, sit, req.family), expiresAt: now + HAGGLE.sessionTtlMs, llmAsked: false, llmLine: null,
  };
  ctx.db.prepare('INSERT INTO haggles (id, at, user_id, merchant_id, side, family, qty, base_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, now, userId, merchantId, req.side, req.family, req.qty, q.total);
  sessions.set(id, s);
  return view(ctx, s);
}

export function playHaggleCard(ctx: Ctx, userId: string, merchantId: string, haggleId: string, card: HaggleCard, llm?: HaggleLlm | null): HaggleView {
  if (!HAGGLE_CARDS.includes(card)) fail('BAD_REQUEST', 'Unknown card.');
  const s = getSession(ctx, userId, merchantId, haggleId);
  const r = playCard(rngFor(ctx, s, s.state.round + 1), s.state, card, s.sit);
  if ('error' in r) return r.error === 'OVER' ? fail('EXPIRED', 'This haggle is over.') : fail('BAD_REQUEST', 'That card is not in your hand.');
  const o: HaggleOutcome = r.outcome;
  s.state = r.state;
  s.event = o.event;
  s.face = o.face;
  s.last = { card: o.card, gainedBp: o.gainedBp, deltaPatience: o.deltaPatience };
  s.line = haggleLine(s.sit.trait, o.event, `${s.id}:${s.state.used.length}`, { rival: s.sit.rival?.merchant, place: s.sit.rival?.place });
  s.lineSource = 'lines';
  s.expiresAt = ctx.now() + HAGGLE.sessionTtlMs;
  ctx.db.prepare('UPDATE haggles SET cards = ? WHERE id = ?').run(JSON.stringify(s.state.used), s.id);
  if (s.state.phase === 'sour' || s.state.phase === 'walked') {
    sessions.delete(s.id);
    ctx.db.prepare('UPDATE haggles SET outcome = ? WHERE id = ?').run(s.state.phase, s.id);
    if (s.state.phase === 'sour') sour(ctx, userId, merchantId);
    return view(ctx, s);
  }
  // une seule réplique LLM par séance, demandée en arrière-plan à la 1re carte, utilisée pour la poignée de main
  if (llm?.haggleLine && !s.llmAsked) {
    s.llmAsked = true;
    const cur = getMerchant(ctx, merchantId);
    if (cur && cur.m.status !== 'closed' && takeHaggleLlm(ctx)) {
      llm.haggleLine(cur.m, { side: s.req.side, family: s.req.family, qty: s.req.qty, trait: s.sit.trait })
        .then((line) => { s.llmLine = line; }).catch(() => {});
    }
  }
  return view(ctx, s);
}

export function dealHaggle(ctx: Ctx, userId: string, merchantId: string, haggleId: string): HaggleDealResponse {
  const s = getSession(ctx, userId, merchantId, haggleId);
  const u = canTrade(ctx, userId);
  const { node } = load(ctx, merchantId);
  assertCanAct(ctx, u, 'market', node);
  return ctx.db.transaction((): HaggleDealResponse => {
    if (sessions.get(haggleId) !== s) return fail('EXPIRED', 'This haggle is over — start a new one.');
    const cur = load(ctx, merchantId);
    const { p0, opts } = pricingFor(ctx, userId, merchantId, s.req.family, cur.node);
    const q = priceQuote(p0, cur.m, s.req.side, s.req.family, s.req.qty, opts);
    if ('error' in q) { sessions.delete(haggleId); return fail(q.error, QUOTE_ERRORS[q.error] ?? 'Not possible.'); }
    const hq = haggledQuote(p0, cur.m, q, s.state.bp);
    // prix bougé (autre trade, dérive de P0, événement de ville qui démarre ou finit) : le joueur confirme à nouveau
    if (q.total !== s.baseTotal) {
      s.version = cur.version; // l'offre (en %) reste valable sur le nouveau prix : le joueur confirme à nouveau
      s.baseTotal = q.total;
      fail('PRICE_MOVED', 'Prices just moved — here is the new haggled total.', 409, { total: hq.total });
    }
    if (hq.side === 'sell' && hq.total > cur.m.flux) fail('MERCHANT_NO_FLUX', QUOTE_ERRORS.MERCHANT_NO_FLUX!);
    const saved = Math.abs(q.total - hq.total);
    const bestTotal = haggledQuote(p0, cur.m, q, maxBp(s.sit.rep)).total;
    if (saved > 0) bumpRep(ctx, userId, merchantId, HAGGLE.repPerDeal);
    const res = settleTrade(ctx, u, merchantId, cur.m, hq, saved > 0 ? ` (haggled ${hq.side === 'buy' ? '−' : '+'}${saved} ƒ)` : '');
    ctx.db.prepare("UPDATE haggles SET outcome = 'deal', final_total = ? WHERE id = ?").run(hq.total, s.id);
    sessions.delete(haggleId); // après succès : un 2e « Deal » sur la même séance → EXPIRED
    s.face = 'happy';
    if (s.llmLine) { s.line = s.llmLine; s.lineSource = 'llm'; } else s.line = haggleLine(s.sit.trait, saved > 0 ? 'deal' : 'deal-flat', `${s.id}:deal`);
    s.baseTotal = q.total;
    const hv = { ...view(ctx, s, 'done'), baseTotal: q.total, total: hq.total, bestTotal };
    return { ...res, merchant: viewMerchant(ctx, userId, merchantId), haggle: hv, saved };
  })();
}

/** Tests : vide les séances en mémoire. */
export const _resetHaggles = () => sessions.clear();
