// Settler : vide l'outbox `chain_ops` vers le contrat, par lots `op_settle`, dans l'ordre strict des ids (Docs/06 §3).
// - Lot = ≤ 50 ops consécutives (et ≤ ~12 Ko de log par type d'événement), settlement_id déterministe s-<dbid>-<premier>-<dernier>.
// - pending → sent → final (hash) ; erreur réseau → failed + retry exponentiel (alerte au 5e échec) ;
//   panique du contrat liée à une op (solde insuffisant…) → bissection jusqu'à isoler l'op fautive, marquée `rejected` (alerte).
// - Idempotence : un lot déjà tenté est vérifié via `is_settled` avant d'être renvoyé ; « already applied » = succès.
// - Forge : `flush(opId)` force le règlement jusqu'à cette op et attend sa finalité (borné).
import { randomBytes } from 'node:crypto';
import { kvGet, kvSet, type DB } from '../db.ts';
import type { Ctx } from '../game/context.ts';
import { accountFor, accountPrefix, accountsToCreate, markCreated } from './accounts.ts';
import { classify, explorerTx, type ChainClient, type ChainOp } from './near.ts';

export interface OpRow {
  id: number; kind: 'mint' | 'burn' | 'transfer'; from_acc: string | null; to_acc: string | null; token_id: string; amount: number;
  memo: string | null; status: string; settlement_id: string | null; tx_hash: string | null; tries: number; created_at: number;
}
interface SettlementRow {
  id: string; first_op: number; last_op: number; n_ops: number; status: 'sent' | 'final' | 'failed'; tx_hash: string | null;
  tries: number; next_try_at: number | null; error: string | null; gas_burnt: number | null; ms: number | null; created_at: number; settled_at: number | null;
}

export interface SettlerOptions {
  cap?: number;             // ops max par lot
  intervalMs?: number;      // tick régulier
  triggerPending?: number;  // tick anticipé si autant d'ops attendent
  accountsPerTick?: number; // créations de sous-comptes par tick
  maxLogBytes?: number;     // taille estimée max d'un EVENT_JSON (limite NEAR : 16 Ko par log)
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export interface Settler {
  start(): void;
  stop(): Promise<void>;
  tick(): Promise<void>;
  /** Règle tout jusqu'à l'op `opId` incluse ; renvoie le hash du lot qui la contient, ou null si délai dépassé / op rejetée. */
  flush(opId: number, timeoutMs: number): Promise<string | null>;
  /** Exécute `fn` settler à l'arrêt (réconciliation cohérente). */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  client: ChainClient;
}

const MAX_BACKOFF = 5 * 60_000;
const ALERT_AFTER = 5;
/** Paniques qui dépendent d'une op précise (on peut isoler et écarter l'op) ; les autres (paused, only operator…) bloquent tout. */
const OP_PANIC = /insufficient balance|burn exceeds balance|unknown token_id|amount must be positive|sender and receiver must differ|invalid account|AccountId/i;
const KEEP_TOGETHER = /^(forge|trade|contract):/;

export function dbChainId(db: DB): string {
  let id = kvGet<string>(db, 'chain-db-id');
  if (!id) {
    id = randomBytes(4).toString('hex');
    kvSet(db, 'chain-db-id', id);
  }
  return id;
}

/** Taille approximative d'une entrée d'événement NEP-245 (JSON). */
const entryBytes = (op: ChainOp) =>
  110 + op.token_id.length + (op.memo?.length ?? 0) + (op.kind === 'transfer' ? op.from.length + op.to.length + 40 : op.owner_id.length + (op.kind === 'burn' ? 40 : 0));

export function createSettler(ctx: Ctx, client: ChainClient, opts: SettlerOptions = {}): Settler {
  const { db } = ctx;
  const CAP = opts.cap ?? 50;
  const intervalMs = opts.intervalMs ?? 8000;
  const triggerPending = opts.triggerPending ?? 50;
  const accountsPerTick = opts.accountsPerTick ?? 3;
  const maxLogBytes = opts.maxLogBytes ?? 12_000;
  const log = opts.log ?? (() => {});
  const contract = client.contractId;
  const prefix = accountPrefix(ctx.cfg);
  const dbId = dbChainId(db);

  let cap = CAP;
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let held = false;
  let lastTick = 0;
  let timer: NodeJS.Timeout | null = null;
  const waiters = new Set<{ opId: number; done: (h: string | null) => void }>();

  const acc = (logical: string | null) => accountFor(db, logical!, contract, prefix);
  const toChainOp = (r: OpRow): ChainOp => {
    const memo = r.memo ? { memo: r.memo } : {};
    if (r.kind === 'transfer') return { kind: 'transfer', from: acc(r.from_acc), to: acc(r.to_acc), token_id: r.token_id, amount: String(r.amount), ...memo };
    return { kind: r.kind, owner_id: acc(r.kind === 'mint' ? r.to_acc : r.from_acc), token_id: r.token_id, amount: String(r.amount), ...memo };
  };

  const current = () =>
    db.prepare("SELECT * FROM chain_settlements WHERE status IN ('sent','failed') ORDER BY first_op LIMIT 1").get() as SettlementRow | undefined;

  /** Nouveau lot : ops `pending` consécutives, sans couper un groupe forge/trade, sous les limites de log. */
  function createBatch(): SettlementRow | null {
    return db.transaction(() => {
      const rows = db.prepare("SELECT * FROM chain_ops WHERE status = 'pending' ORDER BY id LIMIT ?").all(cap + 20) as OpRow[];
      const take: OpRow[] = [];
      const bytes = { mint: 0, burn: 0, transfer: 0 };
      for (const r of rows) {
        const last = take.at(-1);
        const sameGroup = !!(last && r.memo && r.memo === last.memo && KEEP_TOGETHER.test(r.memo));
        if (take.length >= cap && !sameGroup) break;
        const b = entryBytes(toChainOp(r));
        if (take.length && bytes[r.kind] + b > maxLogBytes) break;
        bytes[r.kind] += b;
        take.push(r);
      }
      if (!take.length) return null;
      const first = take[0]!.id;
      const last = take.at(-1)!.id;
      const id = `s-${dbId}-${first}-${last}`;
      db.prepare("INSERT INTO chain_settlements (id, first_op, last_op, n_ops, status, created_at) VALUES (?, ?, ?, ?, 'sent', ?)")
        .run(id, first, last, take.length, ctx.now());
      db.prepare("UPDATE chain_ops SET status = 'sent', settlement_id = ? WHERE id BETWEEN ? AND ? AND status = 'pending'").run(id, first, last);
      return db.prepare('SELECT * FROM chain_settlements WHERE id = ?').get(id) as SettlementRow;
    })();
  }

  function finalize(b: SettlementRow, hash: string | null, gas: number | null, ms: number | null) {
    db.transaction(() => {
      db.prepare("UPDATE chain_settlements SET status = 'final', tx_hash = ?, gas_burnt = ?, ms = ?, settled_at = ?, error = NULL WHERE id = ?")
        .run(hash, gas, ms, ctx.now(), b.id);
      db.prepare("UPDATE chain_ops SET status = 'final', tx_hash = ? WHERE settlement_id = ?").run(hash, b.id);
      db.prepare(`UPDATE compiles SET burn_tx = ? WHERE burn_tx IS NULL AND id IN
        (SELECT substr(memo, 7) FROM chain_ops WHERE settlement_id = ? AND kind = 'burn' AND memo LIKE 'forge:%')`).run(hash, b.id);
    })();
    cap = Math.min(CAP, cap * 2);
    log('info', `settled ${b.id} (${b.n_ops} ops) ${hash ? explorerTx(hash) : '(hash unknown)'}${gas ? ` · ${(gas / 1e12).toFixed(1)} Tgas` : ''}${ms ? ` · ${ms} ms` : ''}`);
  }

  function fail(b: SettlementRow, err: string) {
    const tries = b.tries + 1;
    const next = ctx.now() + Math.min(intervalMs * 2 ** (tries - 1), MAX_BACKOFF);
    db.transaction(() => {
      db.prepare("UPDATE chain_settlements SET status = 'failed', tries = ?, next_try_at = ?, error = ? WHERE id = ?").run(tries, next, err.slice(0, 500), b.id);
      db.prepare("UPDATE chain_ops SET status = 'failed', tries = tries + 1 WHERE settlement_id = ?").run(b.id);
    })();
    log('warn', `settlement ${b.id} failed (try ${tries}): ${err.slice(0, 200)}`);
    if (tries === ALERT_AFTER) {
      ctx.bus.publish('chain.alert', `On-chain sync is lagging — ${b.n_ops} operations waiting, retrying`, { settlementId: b.id, error: err.slice(0, 200) });
    }
  }

  /** Panique due à une op : on défait le lot et on retente avec moitié moins d'ops ; seule, l'op est écartée. */
  function bisect(b: SettlementRow, err: string) {
    db.transaction(() => {
      db.prepare('DELETE FROM chain_settlements WHERE id = ?').run(b.id);
      if (b.n_ops === 1) {
        db.prepare("UPDATE chain_ops SET status = 'rejected', settlement_id = NULL WHERE settlement_id = ?").run(b.id);
      } else {
        db.prepare("UPDATE chain_ops SET status = 'pending', settlement_id = NULL WHERE settlement_id = ?").run(b.id);
      }
    })();
    if (b.n_ops === 1) {
      log('error', `op ${b.first_op} rejected by the contract: ${err.slice(0, 200)}`);
      ctx.bus.publish('chain.alert', `One operation was rejected on-chain (op #${b.first_op}) — see reconcile`, { opId: b.first_op, error: err.slice(0, 200) });
      cap = CAP;
    } else {
      cap = Math.ceil(b.n_ops / 2);
    }
  }

  /** Envoie un lot. Renvoie false s'il faut attendre (backoff). */
  async function process(b: SettlementRow): Promise<boolean> {
    if (b.status === 'failed' && (b.next_try_at ?? 0) > ctx.now()) return false;
    const prevHash = b.tx_hash;
    if (prevHash || b.tries > 0) {
      try {
        if (await client.isSettled(b.id)) { finalize(b, prevHash, null, null); return true; }
      } catch (e) {
        fail(b, `is_settled: ${(e as Error).message}`);
        return false;
      }
    }
    const rows = db.prepare('SELECT * FROM chain_ops WHERE settlement_id = ? ORDER BY id').all(b.id) as OpRow[];
    const ops = rows.map(toChainOp);
    const wantFinal = [...waiters].some((w) => w.opId <= b.last_op);
    try {
      const r = await client.settle(ops, b.id, {
        final: wantFinal,
        onSigned: (h) => db.prepare('UPDATE chain_settlements SET tx_hash = ? WHERE id = ?').run(h, b.id),
      });
      finalize(b, r.txHash, r.gasBurnt, r.ms);
      return true;
    } catch (e) {
      const ce = classify(e);
      if (ce.kind === 'already') { finalize(b, prevHash, null, null); return true; }
      if (ce.kind === 'contract' && OP_PANIC.test(ce.message)) { bisect(b, ce.message); return true; }
      fail(b, ce.message);
      return false;
    }
  }

  function checkWaiters() {
    for (const w of waiters) {
      const r = db.prepare('SELECT status, tx_hash FROM chain_ops WHERE id = ?').get(w.opId) as { status: string; tx_hash: string | null } | undefined;
      if (!r || r.status === 'rejected') w.done(null);
      else if (r.status === 'final') w.done(r.tx_hash);
    }
  }

  async function createAccounts() {
    for (const a of accountsToCreate(db, accountsPerTick)) {
      if (stopped || waiters.size) return;
      try {
        const t0 = Date.now();
        const r = await client.createAccount(a.account_id);
        markCreated(db, a.account_id, a.owner, r.txHash);
        log('info', `account ${a.account_id} ${r.txHash ? `created ${explorerTx(r.txHash)}` : 'already existed'} · ${Date.now() - t0} ms`);
      } catch (e) {
        log('warn', `createAccount ${a.account_id} failed: ${(e as Error).message.slice(0, 200)}`);
        return;
      }
    }
  }

  async function doTick() {
    lastTick = Date.now();
    for (let n = 0; n < 200 && !stopped && !held; n++) {
      const b = current() ?? createBatch();
      if (!b) break;
      const ok = await process(b);
      checkWaiters();
      if (!ok) break;
    }
    checkWaiters();
    if (!stopped && !held && !waiters.size) await createAccounts();
  }

  const tick = (): Promise<void> => {
    if (stopped || held) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        try { await doTick(); } catch (e) { log('error', `settler tick: ${(e as Error).stack ?? e}`); break; }
      } while (again && !stopped && !held);
    })().finally(() => { running = null; });
    return running;
  };

  const pendingCount = db.prepare("SELECT COUNT(*) n FROM chain_ops WHERE status = 'pending'");

  return {
    client,
    tick,
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => {
        if (running) return;
        if (Date.now() - lastTick >= intervalMs || (pendingCount.get() as { n: number }).n >= triggerPending) void tick();
      }, 1000);
      timer.unref();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      for (const w of waiters) w.done(null);
      await running;
    },
    flush(opId, timeoutMs) {
      return new Promise((resolve) => {
        const w = {
          opId,
          done: (h: string | null) => { clearTimeout(t); waiters.delete(w); resolve(h); },
        };
        const t = setTimeout(() => w.done(null), timeoutMs);
        waiters.add(w);
        checkWaiters();
        if (waiters.has(w)) void tick();
      });
    },
    async exclusive(fn) {
      while (held) await new Promise((r) => setTimeout(r, 50));
      held = true;
      try {
        while (running) await running;
        return await fn();
      } finally {
        held = false;
      }
    },
  };
}

// ── vues ──

export interface ChainStatus {
  enabled: boolean;
  contract: string | null;
  pending: number;
  inFlight: number;
  rejected: number;
  lagMs: number;
  lastSettlement: { id: string; txHash: string | null; url: string | null; ops: number; at: number; gasTgas: number | null; ms: number | null } | null;
  retrying: { id: string; tries: number; error: string | null; nextTryAt: number | null } | null;
  settled: { batches: number; ops: number };
  reconcile: unknown;
}

export function chainStatus(ctx: Ctx): ChainStatus {
  const { db } = ctx;
  const counts = Object.fromEntries((db.prepare('SELECT status, COUNT(*) n FROM chain_ops GROUP BY status').all() as { status: string; n: number }[])
    .map((r) => [r.status, r.n])) as Record<string, number>;
  const oldest = db.prepare("SELECT MIN(created_at) t FROM chain_ops WHERE status IN ('pending','sent','failed')").get() as { t: number | null };
  const last = db.prepare("SELECT * FROM chain_settlements WHERE status = 'final' ORDER BY settled_at DESC, first_op DESC LIMIT 1").get() as SettlementRow | undefined;
  const retry = db.prepare("SELECT * FROM chain_settlements WHERE status = 'failed' ORDER BY first_op LIMIT 1").get() as SettlementRow | undefined;
  const tot = db.prepare("SELECT COUNT(*) b, COALESCE(SUM(n_ops), 0) o FROM chain_settlements WHERE status = 'final'").get() as { b: number; o: number };
  return {
    enabled: !!ctx.chain,
    contract: ctx.chain?.client.contractId ?? ctx.cfg.NEAR_CONTRACT_ID ?? null,
    pending: counts.pending ?? 0,
    inFlight: (counts.sent ?? 0) + (counts.failed ?? 0),
    rejected: counts.rejected ?? 0,
    lagMs: oldest.t === null ? 0 : Math.max(0, ctx.now() - oldest.t),
    lastSettlement: last ? {
      id: last.id, txHash: last.tx_hash, url: last.tx_hash ? explorerTx(last.tx_hash) : null, ops: last.n_ops, at: last.settled_at!,
      gasTgas: last.gas_burnt ? Math.round(last.gas_burnt / 1e11) / 10 : null, ms: last.ms,
    } : null,
    retrying: retry ? { id: retry.id, tries: retry.tries, error: retry.error, nextTryAt: retry.next_try_at } : null,
    settled: { batches: tot.b, ops: tot.o },
    reconcile: kvGet(db, 'chain-reconcile'),
  };
}
