// Branchement de la chaîne dans le serveur : settler + réconciliation périodique + vues « Proofs ».
import { kvGet, kvSet } from '../db.ts';
import type { Ctx } from '../game/context.ts';
import { accountPrefix, labelFor } from './accounts.ts';
import { explorerAccount, explorerTx, nearChainClient, type ChainClient } from './near.ts';
import { TOKENS, reconcile, type ReconcileReport } from './reconcile.ts';
import { createSettler, type SettlerOptions } from './settler.ts';

const RECONCILE_EVERY = 10 * 60_000;

/** Démarre le settler si la chaîne est active (ou si un client est injecté, tests). Renvoie la fonction d'arrêt. */
export function startChain(ctx: Ctx, client: ChainClient | undefined, opts: SettlerOptions = {}): () => Promise<void> {
  if (!client && !ctx.cfg.chain) return async () => {};
  const c = client ?? nearChainClient(ctx.cfg);
  const settler = createSettler(ctx, c, opts);
  ctx.chain = settler;
  settler.start();
  const log = opts.log ?? (() => {});
  const runReconcile = async () => {
    try {
      const r = await reconcile(ctx.db, c, { exclusive: settler.exclusive });
      const prev = kvGet<ReconcileReport>(ctx.db, 'chain-reconcile');
      kvSet(ctx.db, 'chain-reconcile', { ...r, mismatches: r.mismatches.slice(0, 20), mismatchCount: r.mismatches.length });
      if (!r.ok) {
        log('warn', `reconcile: ${r.mismatches.length} mismatches on ${r.checked} accounts, e.g. ${JSON.stringify(r.mismatches[0])}`);
        if (!prev || prev.ok) ctx.bus.publish('chain.alert', `Reconcile found ${r.mismatches.length} on-chain balance differences`, { count: r.mismatches.length });
      } else log('info', `reconcile ok (${r.checked} accounts, ${r.ms} ms)`);
    } catch (e) {
      log('warn', `reconcile failed: ${(e as Error).message}`);
    }
  };
  const t = setInterval(() => void runReconcile(), RECONCILE_EVERY);
  t.unref();
  return async () => {
    clearInterval(t);
    await settler.stop();
    ctx.chain = undefined;
  };
}

export interface ProofsView {
  enabled: boolean;
  contract: string | null;
  rpcUrl: string;
  tokens: readonly string[];
  account: string | null;
  accountCreated: boolean;
  accountUrl: string | null;
  pending: number;
  ops: { id: number; kind: string; direction: 'in' | 'out'; token: string; amount: number; memo: string | null; counterparty: string | null; txHash: string | null; url: string | null; at: number | null }[];
}

export function proofsView(ctx: Ctx, userId: string): ProofsView {
  const owner = `user:${userId}`;
  const contract = ctx.chain?.client.contractId ?? ctx.cfg.NEAR_CONTRACT_ID ?? null;
  const row = ctx.db.prepare('SELECT account_id, status FROM near_accounts WHERE owner = ?').get(owner) as { account_id: string; status: string } | undefined;
  const account = row?.account_id ?? (contract ? `${labelFor(owner, accountPrefix(ctx.cfg))}.${contract}` : null);
  const nearOf = ctx.db.prepare('SELECT account_id FROM near_accounts WHERE owner = ?');
  const ops = (ctx.db.prepare(`SELECT o.id, o.kind, o.from_acc, o.to_acc, o.token_id, o.amount, o.memo, o.tx_hash, s.settled_at
      FROM chain_ops o LEFT JOIN chain_settlements s ON s.id = o.settlement_id
      WHERE o.status = 'final' AND (o.from_acc = @o OR o.to_acc = @o) ORDER BY o.id DESC LIMIT 10`).all({ o: owner }) as
    { id: number; kind: string; from_acc: string | null; to_acc: string | null; token_id: string; amount: number; memo: string | null; tx_hash: string | null; settled_at: number | null }[])
    .map((o) => {
      const other = o.kind === 'transfer' ? (o.to_acc === owner ? o.from_acc : o.to_acc) : null;
      return {
        id: o.id, kind: o.kind, direction: (o.to_acc === owner ? 'in' : 'out') as 'in' | 'out', token: o.token_id, amount: o.amount, memo: o.memo,
        counterparty: other ? ((nearOf.get(other) as { account_id: string } | undefined)?.account_id ?? null) : null,
        txHash: o.tx_hash, url: o.tx_hash ? explorerTx(o.tx_hash) : null, at: o.settled_at,
      };
    });
  const pending = (ctx.db.prepare("SELECT COUNT(*) n FROM chain_ops WHERE status IN ('pending','sent','failed') AND (from_acc = @o OR to_acc = @o)").get({ o: owner }) as { n: number }).n;
  return {
    enabled: !!ctx.chain, contract, rpcUrl: ctx.cfg.NEAR_RPC_URL, tokens: TOKENS,
    account, accountCreated: row?.status === 'created', accountUrl: account && row?.status === 'created' ? explorerAccount(account) : null,
    pending, ops,
  };
}
