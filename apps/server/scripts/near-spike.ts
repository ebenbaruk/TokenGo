// Spike NEAR testnet avec near-kit : op_settle + lecture des soldes + création d'un sous-compte joueur.
// Usage : node apps/server/scripts/near-spike.ts [sub-account-prefix]   (lit .env à la racine)
import { Near, generateKey } from "near-kit";

process.loadEnvFile?.(".env");
const { NEAR_RPC_URL, NEAR_CONTRACT_ID, NEAR_OPERATOR_ID, NEAR_OPERATOR_KEY } = process.env;
if (!NEAR_CONTRACT_ID || !NEAR_OPERATOR_ID || !NEAR_OPERATOR_KEY) throw new Error("NEAR_* manquants dans .env");

const near = new Near({
  network: "testnet",
  rpcUrl: NEAR_RPC_URL,
  privateKey: NEAR_OPERATOR_KEY as `ed25519:${string}`,
  defaultSignerId: NEAR_OPERATOR_ID,
});
const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
const TOKENS = ["flux", "shard:deepseek"];

// Solde brut en yocto (near.getAccount renvoie des NEAR formatés/arrondis, insuffisant pour mesurer un coût)
async function accountInfo(id: string): Promise<{ amount: bigint; storageBytes: number }> {
  const res = await fetch(NEAR_RPC_URL!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: id } }),
  }).then((r) => r.json());
  return { amount: BigInt(res.result.amount), storageBytes: res.result.storage_usage };
}
const fmt = (yocto: bigint) => `${(Number(yocto) / 1e24).toFixed(6)} NEAR`;

// 1. op_settle : mint 3 shard:deepseek + 10 flux à l'opérateur, puis burn 1 shard:deepseek
const before = await near.view<string[]>(NEAR_CONTRACT_ID, "mt_batch_balance_of", { account_id: NEAR_OPERATOR_ID, token_ids: TOKENS });
const settlementId = `spike-${Date.now()}`;
const ops = [
  { kind: "mint", owner_id: NEAR_OPERATOR_ID, token_id: "shard:deepseek", amount: "3", memo: "pickup-batch:spike" },
  { kind: "mint", owner_id: NEAR_OPERATOR_ID, token_id: "flux", amount: "10", memo: "pickup-batch:spike" },
  { kind: "burn", owner_id: NEAR_OPERATOR_ID, token_id: "shard:deepseek", amount: "1", memo: "forge:spike" },
];
const acc0 = await accountInfo(NEAR_CONTRACT_ID);
let t0 = performance.now();
const settle = await near
  .transaction(NEAR_OPERATOR_ID)
  .functionCall(NEAR_CONTRACT_ID, "op_settle", { ops, settlement_id: settlementId }, { gas: "50 Tgas" })
  .send({ waitUntil: "FINAL" });
const settleMs = Math.round(performance.now() - t0);
const settleHash = settle.transaction.hash;
console.log(`op_settle ${settlementId} → ${settleHash} (${settleMs} ms, FINAL)\n  ${explorer(settleHash)}`);
const logs = settle.receipts_outcome.flatMap((r) => r.outcome.logs);
console.log("  logs:", logs);

const after = await near.view<string[]>(NEAR_CONTRACT_ID, "mt_batch_balance_of", { account_id: NEAR_OPERATOR_ID, token_ids: TOKENS });
console.log(`mt_batch_balance_of(${NEAR_OPERATOR_ID}, ${TOKENS}) : avant ${JSON.stringify(before)} → après ${JSON.stringify(after)}`);

// Idempotence : rejouer le même settlement_id doit échouer
try {
  await near.call(NEAR_CONTRACT_ID, "op_settle", { ops, settlement_id: settlementId }, { gas: "50 Tgas" });
  console.log("!! replay accepté (anormal)");
} catch (e) {
  console.log("replay refusé comme prévu :", (e as Error).message.slice(0, 120));
}

// Latence en EXECUTED_OPTIMISTIC (défaut near-kit) pour comparaison
t0 = performance.now();
const quick = await near
  .transaction(NEAR_OPERATOR_ID)
  .functionCall(NEAR_CONTRACT_ID, "op_settle", { ops: ops.slice(0, 1), settlement_id: `${settlementId}-b` }, { gas: "50 Tgas" })
  .send();
console.log(`op_settle optimistic → ${quick.transaction.hash} (${Math.round(performance.now() - t0)} ms, EXECUTED_OPTIMISTIC)`);

// 2. Sous-compte joueur créé par le compte contrat (custodial)
const sub = `${process.argv[2] ?? "p-test1"}.${NEAR_CONTRACT_ID}`;
if (await near.accountExists(sub)) {
  console.log(`${sub} existe déjà`);
} else {
  const key = generateKey();
  await new Promise((r) => setTimeout(r, 5000)); // laisser arriver les remboursements de gas des tx précédentes
  const acc1 = await accountInfo(NEAR_CONTRACT_ID);
  t0 = performance.now();
  // Zero-balance account (NEP-448) : pas de transfert nécessaire tant que le compte < 770 octets.
  const created = await near
    .transaction(NEAR_CONTRACT_ID)
    .createAccount(sub)
    .addKey(key.publicKey.toString(), { type: "fullAccess" })
    .send({ waitUntil: "FINAL" });
  await new Promise((r) => setTimeout(r, 5000));
  const acc2 = await accountInfo(NEAR_CONTRACT_ID);
  console.log(`createAccount ${sub} → ${created.transaction.hash} (${Math.round(performance.now() - t0)} ms)\n  ${explorer(created.transaction.hash)}`);
  console.log(`  coût pour ${NEAR_CONTRACT_ID} : ${fmt(acc1.amount - acc2.amount)}`);
  console.log(`  état ${sub} :`, await accountInfo(sub));
}

const acc3 = await accountInfo(NEAR_CONTRACT_ID);
console.log(`contrat : coût total du spike ${fmt(acc0.amount - acc3.amount)}, stockage ${acc0.storageBytes} → ${acc3.storageBytes} octets, solde ${fmt(acc3.amount)}`);
