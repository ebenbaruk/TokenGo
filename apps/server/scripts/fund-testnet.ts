// Recharge tokengo.testnet en NEAR de TEST (faucet testnet, 10 NEAR par compte jetable, supprimé au profit du contrat).
// Le contrat bloque du NEAR pour son stockage ; « LackBalanceForState » dans les logs du settler = lancer ceci.
// Usage : node apps/server/scripts/fund-testnet.ts [nombre de comptes, défaut 3]
import { generateKey, Near } from 'near-kit';
const RPC = 'https://test.rpc.fastnear.com';
const bal = async (a: string) => Number(BigInt(((await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'optimistic', account_id: a } }) })).json()) as { result: { amount: string } }).result.amount) / 10n ** 21n) / 1000;
console.log('avant', await bal('tokengo.testnet'));
for (let i = 0; i < Number(process.argv[2] ?? 3); i++) {
  const kp = generateKey();
  const id = `tgfund${Date.now()}${i}.testnet`;
  const r = await fetch('https://helper.nearprotocol.com/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.publicKey.toString() }) });
  if (!r.ok) { console.log('faucet', r.status, (await r.text()).slice(0, 150)); break; }
  await new Promise((res) => setTimeout(res, 3000));
  const got = await bal(id);
  const near = new Near({ network: 'testnet', rpcUrl: RPC, privateKey: kp.secretKey as `ed25519:${string}`, defaultSignerId: id });
  await near.transaction(id).deleteAccount({ beneficiary: 'tokengo.testnet' }).send({ waitUntil: 'EXECUTED_OPTIMISTIC' });
  console.log(id, 'reçu', got, 'NEAR → tokengo.testnet');
}
await new Promise((res) => setTimeout(res, 3000));
console.log('après', await bal('tokengo.testnet'));
