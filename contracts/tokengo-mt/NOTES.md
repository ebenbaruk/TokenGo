# tokengo-mt — notes de mise en place (2026-11-06)

## Outillage (installé dans `~/.cargo/bin`)
| Outil | Version | Installation |
|---|---|---|
| rustc / cargo | 1.99.1 stable, cible `wasm32-unknown-unknown` | déjà là |
| cargo-near | **0.23.0** | asset GitHub `cargo-near-v0.23.0/cargo-near-aarch64-unknown-linux-gnu.tar.gz` (sha256 vérifié `31da5638…`) → `install -m755 cargo-near ~/.cargo/bin/` |
| near-cli-rs | **0.31.1** (binaire `near`) | asset GitHub `v0.31.1/near-cli-rs-aarch64-unknown-linux-gnu.tar.gz` (sha256 vérifié `13d3103a…`) → `install -m755 near ~/.cargo/bin/` |
| near-sdk | 5.30.1 | Cargo.toml |
| near-kit (Node) | 0.20.2 | `npm i -w @tokengo/server near-kit@0.20.2` |

## Commandes
```
cd contracts/tokengo-mt
cargo test                                   # 11 tests unitaires (testing_env!)
cargo near build non-reproducible-wasm       # → target/near/tokengo_mt.wasm (~225 Ko, wasm-opt inclus)

# compte (faucet testnet, clé dans ~/.near-credentials/testnet/tokengo.testnet.json)
near account create-account sponsor-by-faucet-service tokengo.testnet autogenerate-new-keypair \
  save-to-legacy-keychain network-config testnet create
# déploiement + init
near contract deploy tokengo.testnet use-file target/near/tokengo_mt.wasm with-init-call new \
  json-args '{"owner_id":"tokengo.testnet","operator_id":"tokengo.testnet"}' prepaid-gas '30 Tgas' \
  attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
# redéploiement du code seul (sans init) :
near contract deploy tokengo.testnet use-file target/near/tokengo_mt.wasm without-init-call \
  network-config testnet sign-with-legacy-keychain send
# vues
near contract call-function as-read-only tokengo.testnet mt_batch_balance_of \
  json-args '{"account_id":"tokengo.testnet","token_ids":["flux","shard:deepseek"]}' network-config testnet now
# spike Node (racine du repo)
node apps/server/scripts/near-spike.ts [p-xxx]   # settle + idempotence + sous-compte p-xxx.tokengo.testnet
```

## Comptes / réseau
- Contrat = owner = operator : **`tokengo.testnet`** (faucet : 10 NEAR). Clé dans `.env` (`NEAR_OPERATOR_KEY`) et dans le keychain legacy.
- Deploy tx : `4dfcPt6e4hurHzQK46foNx6d8DNaRZDEaZ5bNig1u8bF`.
- Sous-comptes de test : `p-test1`, `p-test2` (avec clé full access), `p-test3` (sans clé) `.tokengo.testnet`.
- RPC : `https://test.rpc.fastnear.com` (OK, protocole 88) ; fallback `https://rpc.testnet.near.org` (OK aussi).

## Coûts mesurés
| Quoi | Coût |
|---|---|
| Stockage du code (225,7 Ko) | ≈ 2,26 NEAR bloqués (1 Ko = 0,01 NEAR) |
| `op_settle` 3 ops | 3,5 Tgas ≈ **0,00033 NEAR** de gas |
| Stockage par `settlement_id` | ≈ 65 o ≈ 0,00065 NEAR (le LookupSet grossit pour toujours) |
| Stockage par nouveau couple (compte, token) | ≈ 100 o ≈ 0,001 NEAR |
| Sous-compte joueur (`createAccount` [+ `addKey`]) | **≈ 0,0071 NEAR** brûlés (8,3 Tgas, quasi identique sans clé) ; **0 NEAR de dépôt** : compte « zero-balance » (NEP-448, < 770 o) accepté |
→ avec ~7,7 NEAR libres : ~1000 sous-comptes + beaucoup de settlements. Re-fauceter si besoin (autres comptes faucet → transfert).

## Latence
- `op_settle` avec `waitUntil: "FINAL"` : **3,3–3,5 s** ; défaut near-kit (`EXECUTED_OPTIMISTIC`) : **1,2–1,6 s**.
- `createAccount` FINAL : 3,7–8,7 s.
Pour la Forge : attendre `FINAL` (≈ 3 s) avant d'octroyer les crédits ; pour le settler en tâche de fond, `EXECUTED_OPTIMISTIC` suffit.

## near-kit 0.20.2 — appels qui marchent
```ts
import { Near, generateKey } from "near-kit";
const near = new Near({ network: "testnet", rpcUrl: env.NEAR_RPC_URL,
  privateKey: env.NEAR_OPERATOR_KEY as `ed25519:${string}`, defaultSignerId: env.NEAR_OPERATOR_ID });

// vue
const bals = await near.view<string[]>(contract, "mt_batch_balance_of", { account_id, token_ids });

// settle (hash + logs via le builder ; near.call(...) existe aussi mais renvoie la valeur décodée)
const out = await near.transaction(operator)
  .functionCall(contract, "op_settle", { ops, settlement_id }, { gas: "50 Tgas" })
  .send({ waitUntil: "FINAL" });
out.transaction.hash;                                   // → https://testnet.nearblocks.io/txns/<hash>
out.receipts_outcome.flatMap((r) => r.outcome.logs);    // EVENT_JSON:…
// ops : { kind: "mint"|"burn", owner_id, token_id, amount: "3", memo? } | { kind: "transfer", from, to, token_id, amount, memo? }

// erreurs contrat : exception, message "Contract call failed: tokengo.testnet.op_settle - Smart contract panicked: settlement already applied"

// sous-compte joueur, signé par le compte contrat
const key = generateKey();   // key.publicKey.toString(), key.secretKey → à chiffrer (AES-256-GCM) si on garde la clé
await near.transaction(contract).createAccount(`p-${id}.${contract}`)
  .addKey(key.publicKey.toString(), { type: "fullAccess" }).send({ waitUntil: "FINAL" });
await near.accountExists(`p-${id}.${contract}`);
```
- `near.getAccount()` renvoie des montants **formatés** (« 9.98 ») : pour mesurer des coûts, interroger le RPC brut (`view_account`).
- Parallélisme : `RotatingKeyStore` (non testé ici) — nécessite d'ajouter plusieurs clés d'accès à `tokengo.testnet`. Avec une seule clé, sérialiser les tx (le settler fait 1 tx / 8 s, ça suffit).

## Pièges / décisions
- Les remboursements de gas arrivent en différé : mesurer un coût par différence de solde exige d'attendre quelques secondes (sinon coût « négatif »). Mieux : sommer `tokens_burnt` des outcomes.
- Le compte joueur n'a pas besoin de NEAR : les soldes MT vivent dans le contrat. Une clé sur le sous-compte n'est utile que pour « Export my account » / `mt_transfer` signé par le joueur ; sinon `createAccount` seul suffit (même coût).
- `mt_transfer` utilisateur : le stockage du destinataire est payé par le contrat (pas de storage deposit) — acceptable en custodial, à surveiller.
- `mt_transfer_call` / `mt_batch_transfer_call` : panic « mt_transfer_call not supported ». Approvals non supportées (doivent être `null`).
- `memo` absent → champ omis dans l'événement (NEP-245 : optionnel). Burn/transfer opérateur : `authorized_id` = operator.
- Vues utiles en plus du standard : `get_config`, `is_settled(settlement_id)` (le settler peut vérifier avant de rejouer après un timeout).
- `near-workspaces` (sandbox) non essayé : tests unitaires `testing_env!` suffisants (cf. Docs/06 §2).
