// Échanges avec les marchands : vue, devis (20 s, liés à la version du marchand), trade, contrats, sauvetage.
import {
  MERCHANT, UNLOCKS, XP, applyTrade, deliverContract, quote as priceQuote, rescue as rescueRule, shardToken,
  type Family, type MerchantState, type MerchantView, type QuoteRequest, type QuoteResponse, type TradeResponse, FAMILIES,
} from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { randomId } from './crypto.ts';
import { addXp, balance, credit, debit, getUser, levelOf, markTutorial, meView, moveStateOf, tutorialOf } from './players.ts';
import { getMerchant, getP0, merchantView, recordSeenPrices, saveMerchant } from './merchants.ts';
import { assertCanAct } from './actions.ts';

const QUOTE_ERRORS: Record<string, string> = {
  CLOSED: 'This shop is closed.',
  NOT_BUYING: "I'm liquidating — not buying right now.",
  MERCHANT_NO_FLUX: "I'm short on Flux — come back later or invest in me.",
  OUT_OF_STOCK: "I don't have that many.",
  CONTRACT_LOCK: "I'm keeping those for my contract — find them elsewhere!",
  BAD_QTY: 'Pick a quantity between 1 and 50.',
};

function isPatron(ctx: Ctx, merchantId: string, userId: string): boolean {
  return !!ctx.db.prepare('SELECT 1 FROM rescues WHERE merchant_id = ? AND user_id = ? AND at > ?').get(merchantId, userId, ctx.now() - MERCHANT.patronPerkMs);
}

function load(ctx: Ctx, merchantId: string) {
  const cur = getMerchant(ctx, merchantId);
  if (!cur) fail('NOT_FOUND', 'Unknown merchant.', 404);
  return cur!;
}

export function viewMerchant(ctx: Ctx, userId: string, merchantId: string): MerchantView {
  const { m, node } = load(ctx, merchantId);
  const u = getUser(ctx, userId)!;
  const pos = moveStateOf(u).last ?? undefined;
  const view = merchantView(ctx, m, node, userId, { patron: isPatron(ctx, m.id, userId), ...(pos ? { pos } : {}) });
  recordSeenPrices(ctx, userId, view);
  return view;
}

interface StoredQuote { id: string; userId: string; merchantId: string; version: number; req: QuoteRequest; total: number; unitPrices: number[]; expiresAt: number }
const quotes = new Map<string, StoredQuote>();

function canTrade(ctx: Ctx, userId: string) {
  const u = getUser(ctx, userId)!;
  if (levelOf(u) < UNLOCKS.trade && tutorialOf(u).traded) fail('LEVEL_LOCKED', `Markets unlock at level ${UNLOCKS.trade}.`);
  return u;
}

export function makeQuote(ctx: Ctx, userId: string, merchantId: string, req: QuoteRequest): QuoteResponse {
  const u = canTrade(ctx, userId);
  const { m, version, node } = load(ctx, merchantId);
  assertCanAct(ctx, u, 'market', node);
  if (req.side === 'sell' && u.demo_token) fail('DEMO_CANNOT_SELL', 'Demo passes can buy, forge and invest — but not sell.');
  if (!FAMILIES.includes(req.family)) fail('BAD_REQUEST', 'Unknown shard.');
  const q = priceQuote(getP0(ctx)[req.family], m, req.side, req.family, req.qty, { patron: isPatron(ctx, m.id, userId) });
  if ('error' in q) return fail(q.error, QUOTE_ERRORS[q.error] ?? 'Not possible.');
  if (req.side === 'sell' && balance(ctx, userId, shardToken(req.family)) < req.qty) fail('INSUFFICIENT', "You don't have that many shards.");
  if (req.side === 'buy' && balance(ctx, userId, 'flux') < q.total) fail('INSUFFICIENT', `You need ${q.total} ƒ.`, 400, { total: q.total });
  const now = ctx.now();
  for (const [k, s] of quotes) if (s.expiresAt < now) quotes.delete(k);
  const id = randomId(9);
  const stored: StoredQuote = { id, userId, merchantId, version, req, total: q.total, unitPrices: q.unitPrices, expiresAt: now + 20_000 };
  quotes.set(id, stored);
  return { quoteId: id, side: req.side, family: req.family, qty: req.qty, unitPrices: q.unitPrices, total: q.total, expiresAt: stored.expiresAt };
}

export function executeTrade(ctx: Ctx, userId: string, merchantId: string, quoteId: string): TradeResponse {
  const s = quotes.get(quoteId);
  const now = ctx.now();
  if (!s || s.userId !== userId || s.merchantId !== merchantId) fail('EXPIRED', 'Quote expired — get a new price.');
  if (s!.expiresAt < now) { quotes.delete(quoteId); fail('EXPIRED', 'Quote expired — get a new price.'); }
  const u = canTrade(ctx, userId);
  const { node } = load(ctx, merchantId);
  assertCanAct(ctx, u, 'market', node);
  return ctx.db.transaction((): TradeResponse => {
    const cur = load(ctx, merchantId);
    const q = priceQuote(getP0(ctx)[s!.req.family], cur.m, s!.req.side, s!.req.family, s!.req.qty, { patron: isPatron(ctx, merchantId, userId) });
    if ('error' in q) return fail(q.error, QUOTE_ERRORS[q.error] ?? 'Not possible.');
    if (cur.version !== s!.version && q.total !== s!.total) {
      quotes.delete(quoteId);
      fail('PRICE_MOVED', 'Prices just moved — here is the new total.', 409, { total: q.total });
    }
    quotes.delete(quoteId);
    const token = shardToken(q.family);
    const tradeId = randomId(10);
    const memo = `trade:${tradeId}`;
    if (q.side === 'sell') {
      debit(ctx, userId, token, q.qty, memo, merchantId);
      credit(ctx, userId, 'flux', q.total, memo, merchantId);
    } else {
      debit(ctx, userId, 'flux', q.total, memo, merchantId);
      credit(ctx, userId, token, q.qty, memo, merchantId);
    }
    const next: MerchantState = applyTrade(cur.m, q, now);
    saveMerchant(ctx, next);
    ctx.db.prepare('INSERT INTO trades (id, at, user_id, merchant_id, side, token_id, qty, flux_total, unit_prices) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(tradeId, now, userId, merchantId, q.side, token, q.qty, q.total, JSON.stringify(q.unitPrices));
    const xp = XP.tradePerShard * q.qty;
    const levelUp = addXp(ctx, userId, xp);
    markTutorial(ctx, userId, 'traded');
    ctx.bus.publish('trade', `${u.handle} ${q.side === 'sell' ? 'sold' : 'bought'} ${q.qty} ${q.family} ${q.side === 'sell' ? 'to' : 'from'} ${next.name} · ${q.total} ƒ`,
      { merchantId, family: q.family, qty: q.qty, total: q.total, side: q.side });
    return { ok: true, side: q.side, family: q.family, qty: q.qty, total: q.total, xp, levelUp, me: meView(ctx, userId), merchant: viewMerchant(ctx, userId, merchantId) };
  })();
}

export function deliver(ctx: Ctx, userId: string, merchantId: string) {
  const u = getUser(ctx, userId)!;
  const { node } = load(ctx, merchantId);
  assertCanAct(ctx, u, 'market', node);
  return ctx.db.transaction(() => {
    const { m } = load(ctx, merchantId);
    const c = m.contract;
    if (!c) fail('NO_CONTRACT', 'No contract right now.');
    if (balance(ctx, userId, shardToken(c!.family)) < c!.qty) fail('INSUFFICIENT', `You need ${c!.qty} ${c!.family} shards.`);
    const r = deliverContract(m, ctx.now());
    if ('error' in r) return fail(r.error, r.error === 'MERCHANT_NO_FLUX' ? "I can't pay that contract right now." : 'Contract unavailable.');
    const memo = `contract:${c!.id}`;
    debit(ctx, userId, shardToken(c!.family), c!.qty, memo, merchantId);
    credit(ctx, userId, 'flux', r.reward, memo, merchantId);
    saveMerchant(ctx, r.m);
    const levelUp = addXp(ctx, userId, XP.contract);
    ctx.bus.publish('contract', `${u.handle} delivered ${c!.qty} ${c!.family} to ${m.name} · +${r.reward} ƒ`, { merchantId });
    return { reward: r.reward, xp: XP.contract, levelUp, me: meView(ctx, userId), merchant: viewMerchant(ctx, userId, merchantId) };
  })();
}

export function rescue(ctx: Ctx, userId: string, merchantId: string, amount: number) {
  const u = getUser(ctx, userId)!;
  if (levelOf(u) < UNLOCKS.rescue && !u.demo_token) fail('LEVEL_LOCKED', `Rescuing merchants unlocks at level ${UNLOCKS.rescue}.`);
  const { node } = load(ctx, merchantId);
  assertCanAct(ctx, u, 'market', node);
  return ctx.db.transaction(() => {
    const { m } = load(ctx, merchantId);
    const r = rescueRule(m, amount, ctx.now());
    if ('error' in r) return fail(r.error, r.error === 'NOT_STRUGGLING' ? 'This shop is doing fine.' : `Minimum ${MERCHANT.rescueMin} ƒ.`);
    debit(ctx, userId, 'flux', amount, `rescue:${merchantId}`, merchantId);
    saveMerchant(ctx, r.m);
    ctx.db.prepare('INSERT INTO rescues (merchant_id, user_id, at, amount) VALUES (?, ?, ?, ?)').run(merchantId, userId, ctx.now(), amount);
    const xp = Math.min(XP.rescueMax, Math.floor(amount / 2) * XP.rescuePer2Flux);
    const levelUp = addXp(ctx, userId, xp);
    if (r.events.some((e) => e.kind === 'reopened')) {
      const n = (ctx.db.prepare('SELECT COUNT(DISTINCT user_id) n FROM rescues WHERE merchant_id = ? AND at >= ?').get(merchantId, m.closingSince ?? 0) as { n: number }).n;
      ctx.bus.publish('merchant.reopened', `${m.name} reopened thanks to ${n} patron${n > 1 ? 's' : ''}`, { merchantId });
    } else {
      ctx.bus.publish('rescue', `${u.handle} invested ${amount} ƒ in ${m.name}`, { merchantId });
    }
    return { xp, levelUp, me: meView(ctx, userId), merchant: viewMerchant(ctx, userId, merchantId) };
  })();
}

export type { Family };
