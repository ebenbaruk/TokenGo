// Réconciliation chaîne ↔ SQLite (Docs/06 §3) : pour chaque compte actif, solde on-chain attendu =
// solde SQLite − effet des ops pas encore réglées. Les ops `rejected` ne sont pas déduites : elles apparaissent comme écarts.
// `ledger` (somme des ops réglées) aide au diagnostic : chain = ledger ≠ expected → divergence SQLite/outbox (bug de jeu) ;
// chain ≠ ledger → divergence chaîne/outbox (autre base sur les mêmes comptes, op rejetée…).
import { FAMILIES, shardToken } from '@tokengo/shared';
import type { DB } from '../db.ts';
import type { ChainClient } from './near.ts';

export const TOKENS: readonly string[] = ['flux', ...FAMILIES.map((f) => shardToken(f))];

export interface Mismatch { account: string; owner: string; token: string; chain: string; expected: string; ledger: string }
export interface ReconcileReport { at: number; checked: number; ok: boolean; mismatches: Mismatch[]; ms: number }

interface Snap { account: string; owner: string; expected: Map<string, bigint>; ledger: Map<string, bigint> }

function sqliteBalances(db: DB, owner: string): Map<string, bigint> {
  const m = new Map<string, bigint>(TOKENS.map((t) => [t, 0n]));
  if (owner.startsWith('user:')) {
    for (const r of db.prepare('SELECT token_id, amount FROM inventory WHERE user_id = ?').all(owner.slice(5)) as { token_id: string; amount: number }[]) {
      m.set(r.token_id, BigInt(r.amount));
    }
  } else {
    const r = db.prepare('SELECT state FROM merchants WHERE id = ?').get(owner.slice(9)) as { state: string } | undefined;
    if (r) {
      const s = JSON.parse(r.state) as { flux: number; stock: Record<string, number> };
      m.set('flux', BigInt(s.flux));
      for (const f of FAMILIES) m.set(shardToken(f), BigInt(s.stock[f] ?? 0));
    }
  }
  return m;
}

function opsDelta(db: DB, owner: string, statuses: string[]): Map<string, bigint> {
  const rows = db.prepare(`SELECT token_id, COALESCE(SUM(CASE WHEN to_acc = @o THEN amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN from_acc = @o THEN amount ELSE 0 END), 0) d
    FROM chain_ops WHERE status IN (${statuses.map((s) => `'${s}'`).join(',')}) AND (to_acc = @o OR from_acc = @o) GROUP BY token_id`).all({ o: owner }) as { token_id: string; d: number }[];
  return new Map(rows.map((r) => [r.token_id, BigInt(r.d)]));
}

function snapshot(db: DB, owners?: string[]): Snap[] {
  return db.transaction(() => {
    const rows = db.prepare(`SELECT a.account_id, a.owner FROM near_accounts a
      WHERE EXISTS (SELECT 1 FROM chain_ops o WHERE o.status = 'final' AND (o.from_acc = a.owner OR o.to_acc = a.owner)) ORDER BY a.owner`)
      .all() as { account_id: string; owner: string }[];
    return rows.filter((r) => !owners || owners.includes(r.owner)).map((r) => {
      const sql = sqliteBalances(db, r.owner);
      const pending = opsDelta(db, r.owner, ['pending', 'sent', 'failed']);
      const ledger = opsDelta(db, r.owner, ['final']);
      return {
        account: r.account_id, owner: r.owner,
        expected: new Map(TOKENS.map((t) => [t, sql.get(t)! - (pending.get(t) ?? 0n)])),
        ledger: new Map(TOKENS.map((t) => [t, ledger.get(t) ?? 0n])),
      };
    });
  })();
}

async function compare(client: ChainClient, snaps: Snap[], concurrency: number): Promise<Mismatch[]> {
  const out: Mismatch[] = [];
  let i = 0;
  const worker = async () => {
    while (i < snaps.length) {
      const s = snaps[i++]!;
      let chain: bigint[] = [];
      for (let attempt = 0; ; attempt++) { // RPC public : 429 fréquents → petit retry
        try { chain = await client.balances(s.account, TOKENS); break; } catch (e) {
          if (attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
      TOKENS.forEach((t, k) => {
        const c = chain[k] ?? 0n;
        if (c !== s.expected.get(t)) out.push({ account: s.account, owner: s.owner, token: t, chain: String(c), expected: String(s.expected.get(t)), ledger: String(s.ledger.get(t)) });
      });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

/**
 * Compare la chaîne et SQLite. `exclusive` (settler.exclusive) gèle le settler pendant la mesure ;
 * sans lui (CLI pendant que le serveur tourne), les écarts sont re-vérifiés une fois après `recheckMs`.
 */
export async function reconcile(db: DB, client: ChainClient, opts: { exclusive?: <T>(fn: () => Promise<T>) => Promise<T>; recheckMs?: number; concurrency?: number } = {}): Promise<ReconcileReport> {
  const t0 = Date.now();
  const run = (owners?: string[]) => {
    const go = async () => { const s = snapshot(db, owners); return { n: s.length, mm: await compare(client, s, opts.concurrency ?? 3) }; };
    return opts.exclusive ? opts.exclusive(go) : go();
  };
  const first = await run();
  let mismatches = first.mm;
  if (mismatches.length && !opts.exclusive) {
    await new Promise((r) => setTimeout(r, opts.recheckMs ?? 5000));
    mismatches = (await run([...new Set(mismatches.map((m) => m.owner))])).mm;
  }
  return { at: Date.now(), checked: first.n, ok: mismatches.length === 0, mismatches, ms: Date.now() - t0 };
}
