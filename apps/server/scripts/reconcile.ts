// Compare les soldes on-chain (mt_batch_balance_of) avec SQLite pour les comptes actifs. Code de sortie 1 si écart.
// Usage : npm run reconcile   (lit .env et DB_PATH ; ne touche à rien, lecture seule)
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { nearChainClient } from '../src/chain/near.ts';
import { reconcile } from '../src/chain/reconcile.ts';

const cfg = loadConfig();
if (!cfg.NEAR_CONTRACT_ID || !cfg.NEAR_OPERATOR_ID || !cfg.NEAR_OPERATOR_KEY) {
  console.error('NEAR_* manquants dans .env : rien à réconcilier.');
  process.exit(2);
}
const db = openDb(cfg.DB_PATH);
const counts = db.prepare('SELECT status, COUNT(*) n FROM chain_ops GROUP BY status').all() as { status: string; n: number }[];
console.log(`DB ${cfg.DB_PATH} · contrat ${cfg.NEAR_CONTRACT_ID} · ops ${counts.map((c) => `${c.status}=${c.n}`).join(' ')}`);
const r = await reconcile(db, nearChainClient(cfg));
db.close();
console.log(`${r.checked} comptes vérifiés en ${r.ms} ms : ${r.ok ? 'OK, aucun écart' : `${r.mismatches.length} écart(s)`}`);
for (const m of r.mismatches) console.log(`  ${m.account} ${m.token} : chaîne ${m.chain} · attendu ${m.expected} · ops réglées ${m.ledger}`);
process.exit(r.ok ? 0 : 1);
