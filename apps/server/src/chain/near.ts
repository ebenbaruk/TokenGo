// Client NEAR (near-kit) du contrat tokengo-mt, derrière une interface injectable (tests sans réseau : client factice).
import { Near } from 'near-kit';
import type { Config } from '../config.ts';

export type ChainOp =
  | { kind: 'mint' | 'burn'; owner_id: string; token_id: string; amount: string; memo?: string }
  | { kind: 'transfer'; from: string; to: string; token_id: string; amount: string; memo?: string };

export interface SettleResult { txHash: string; gasBurnt: number; ms: number }

/**
 * Erreur classée : `already` = settlement_id déjà appliqué (succès idempotent) ; `contract` = panique du contrat
 * (déterministe, rejouer à l'identique échouera encore) ; `network` = le reste (timeout, RPC…), à rejouer.
 */
export class ChainError extends Error {
  kind: 'already' | 'contract' | 'network';
  constructor(kind: ChainError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface ChainClient {
  contractId: string;
  /** `onSigned` reçoit le hash avant l'envoi (reprise après timeout). `final` = attendre la finalité (Forge). */
  settle(ops: ChainOp[], settlementId: string, opts?: { final?: boolean; onSigned?: (hash: string) => void }): Promise<SettleResult>;
  isSettled(settlementId: string): Promise<boolean>;
  /** Crée le sous-compte (sans clé : garde par le compte contrat). Renvoie null s'il existait déjà. */
  createAccount(accountId: string): Promise<{ txHash: string | null }>;
  balances(accountId: string, tokenIds: readonly string[]): Promise<bigint[]>;
}

export const explorerTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
export const explorerAccount = (id: string) => `https://testnet.nearblocks.io/address/${id}`;

export function classify(e: unknown): ChainError {
  if (e instanceof ChainError) return e;
  const msg = String((e as Error)?.message ?? e);
  if (/settlement already applied/.test(msg)) return new ChainError('already', msg);
  if (/panicked|Smart contract|FunctionCallError|ExecutionError|MethodNotFound/i.test(msg)) return new ChainError('contract', msg);
  return new ChainError('network', msg);
}

/** Client réel. Une seule clé d'accès → toutes les transactions sont sérialisées (pas de conflit de nonce). */
export function nearChainClient(cfg: Config): ChainClient {
  const contract = cfg.NEAR_CONTRACT_ID!;
  const operator = cfg.NEAR_OPERATOR_ID!;
  const near = new Near({
    network: cfg.NEAR_NETWORK as 'testnet',
    rpcUrl: cfg.NEAR_RPC_URL,
    privateKey: cfg.NEAR_OPERATOR_KEY as `ed25519:${string}`,
    defaultSignerId: operator,
  });
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  };
  return {
    contractId: contract,
    settle: (ops, settlementId, opts = {}) => serial(async () => {
      try {
        const tx = near.transaction(operator).functionCall(contract, 'op_settle', { ops, settlement_id: settlementId }, { gas: '300 Tgas' });
        await tx.sign();
        const hash = tx.getHash()!;
        opts.onSigned?.(hash);
        const t0 = performance.now();
        const out = await tx.send({ waitUntil: opts.final ? 'FINAL' : 'EXECUTED_OPTIMISTIC' });
        const gasBurnt = out.transaction_outcome.outcome.gas_burnt + out.receipts_outcome.reduce((s, r) => s + r.outcome.gas_burnt, 0);
        // near-kit lève sur une panique ; ceinture et bretelles si un échec passe quand même
        const failure = out.receipts_outcome.find((r) => typeof r.outcome.status === 'object' && 'Failure' in (r.outcome.status as object));
        if (failure) throw new Error(`Smart contract panicked: ${JSON.stringify(failure.outcome.status)}`);
        return { txHash: out.transaction.hash ?? hash, gasBurnt, ms: Math.round(performance.now() - t0) };
      } catch (e) {
        throw classify(e);
      }
    }),
    isSettled: async (id) => !!(await near.view<boolean>(contract, 'is_settled', { settlement_id: id }, { finality: 'optimistic' })),
    createAccount: (accountId) => serial(async () => {
      if (await near.accountExists(accountId, { finality: 'optimistic' })) return { txHash: null };
      // INCLUDED (~1 s) plutôt qu'EXECUTED : ne pas monopoliser la file de transactions (une Forge peut attendre derrière).
      // near-kit 0.20.2 n'arrive pas à parser la réponse INCLUDED (statut « Unknown ») alors que la tx est bien partie :
      // on garde le hash signé et on tolère cette erreur de parsing (zod « invalid_union »).
      const tx = near.transaction(contract).createAccount(accountId);
      await tx.sign();
      const hash = tx.getHash()!;
      try {
        await tx.send({ waitUntil: 'INCLUDED' });
      } catch (e) {
        if (!/invalid_union|invalid_value/.test(String((e as Error)?.message))) throw classify(e);
      }
      return { txHash: hash };
    }),
    balances: async (accountId, tokenIds) => {
      const r = await near.view<string[]>(contract, 'mt_batch_balance_of', { account_id: accountId, token_ids: tokenIds }, { finality: 'optimistic' });
      return (r ?? []).map((x) => BigInt(x));
    },
  };
}
