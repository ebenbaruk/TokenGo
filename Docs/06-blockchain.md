# 06 — NEAR on-chain (testnet)

Objectif : la chaîne est **réelle et auditable** mais **invisible** dans la boucle de jeu. Pas de popup, pas de gas, pas de seed phrase.
Mots interdits dans l'UI de jeu : blockchain, wallet, gas, transaction. Autorisés uniquement dans Profil › « Proofs » et page Pulse › « On-chain ».

## 1. Choix (vérifiés le 2026-11-06)
| Sujet | Décision | Pourquoi |
|---|---|---|
| Standard | **NEP-245** multi-token, contrat maison ~150–200 lignes | `near-contract-standards` 5.30.1 n'a pas de NEP-245 ; `defuse-nep245` (repo near/intents) = traits + events seulement, non publié sur crates.io. On recopie les signatures et le format d'événements. |
| SDK contrat | `near-sdk` 5.30.x, `cargo-near` 0.23.0 (asset aarch64 dispo) | Scaffold : `cargo near new`. Build : `cargo near build non-reproducible-wasm`. |
| CLI | `near-cli-rs` 0.31.x | Création de comptes testnet via faucet. |
| Lib Node | **near-kit** 0.20.x (`RotatingKeyStore` = transactions parallèles sans conflit de nonce) | API plus courte que near-api-js 7.4 pour un opérateur backend. Si blocage, near-api-js 7.4 + file d'attente. |
| Garde des comptes | **Custodial assumé** : sous-compte par joueur `p-<id>.tokengo.testnet`, par marchand `m-<slug>.tokengo.testnet` ; contrat avec rôle `operator` | Identité on-chain réelle et visible sur l'explorer, zéro friction. Clés chiffrées AES-256-GCM (clé maître en env). Dit clairement dans le README. Stretch : « Export my account ». |
| Réseau | **testnet** pour tout ce qui est objet | Autorisé par le règlement (Q-010). Le seul « réel » est NEAR AI Cloud (crédits). |
| RPC | `https://test.rpc.fastnear.com` (fallback `https://rpc.testnet.near.org`) | Vérifier dans docs.near.org/api/rpc/providers au moment du build. |
| Explorer | `https://testnet.nearblocks.io/txns/<hash>` · `/address/<account>` | À vérifier dans un vrai navigateur (Cloudflare bloque curl). |

Comptes : `tokengo.testnet` (ou nom dispo similaire, à créer via `near account create-account sponsor-by-faucet-service`) = contrat + operator.
Le contrat est déployé **sur** ce compte ; sous-comptes créés par lui. Budget testnet ≈ 5–10 NEAR (contrat ~2–3 NEAR de stockage,
~0,01–0,02 NEAR par sous-compte). Plusieurs comptes faucet si besoin, puis transfert vers `tokengo.testnet`.

## 2. Contrat `contracts/tokengo-mt`
Token ids : `flux`, `shard:deepseek`, `shard:qwen`, `shard:gemini`, `shard:gpt`, `shard:claude`. (Le format `shard:<f>` évite le point,
réservé aux comptes ; aligné avec le style `nep141:…` d'intents.)

État :
```rust
owner_id: AccountId,          // admin (peut changer operator, pause)
operator_id: AccountId,       // backend
balances: LookupMap<(AccountId, TokenId), u128>,
supply: LookupMap<TokenId, u128>,
token_ids: IterableSet<TokenId>,  // pour mt_tokens / enumeration
paused: bool,
```
Méthodes NEP-245 (signatures du crate `defuse-nep245`, core.rs) :
`mt_transfer`, `mt_batch_transfer` (`#[payable]` + `assert_one_yocto()`), `mt_token`, `mt_balance_of`, `mt_batch_balance_of`,
`mt_supply`, `mt_batch_supply`, `mt_tokens` (enumeration simple). `mt_transfer_call` : **non implémenté** (panic explicite « not supported »),
documenté dans le README.

Méthodes opérateur (assert `predecessor == operator_id`, `!paused`) — **toutes en batch** pour limiter le nombre de transactions :
```
op_mint_batch(entries: Vec<{owner_id, token_id, amount}>, memo)            → event mt_mint
op_burn_batch(entries: Vec<{owner_id, token_id, amount}>, memo)            → event mt_burn
op_transfer_batch(entries: Vec<{from, to, token_id, amount}>, memo)        → event mt_transfer (authorized_id = operator)
op_settle(ops: Vec<Op>, settlement_id: String)                             → applique mint/burn/transfer d'un lot, idempotent :
                                                                              refuse un settlement_id déjà vu (LookupSet)
```
Événements (**un seul EVENT_JSON agrégé par type** et par appel — un receipt NEAR est limité à ~100 logs / ~16 Ko) : `EVENT_JSON:{"standard":"nep245","version":"1.0.0","event":"mt_mint|mt_burn|mt_transfer","data":[…]}` — amounts en string,
`memo` = référence lisible (`"forge:<compileId>"`, `"trade:<tradeId>"`, `"pickup-batch:<n>"`).

Tests contrat : `near-workspaces` 0.24 (sandbox) **si** ça tourne sur ARM64 ; sinon tests unitaires `#[cfg(test)]` avec `testing_env!`
(suffisant pour la hackathon). Couvrir : opérateur seul autorisé, idempotence settlement, burn > solde refusé, events émis.

## 3. Synchronisation jeu ↔ chaîne (« outbox »)
- **SQLite = vérité de jeu instantanée** (latence zéro pour le joueur). Chaque mutation de valeur écrit, dans la même transaction SQL,
  une ligne `chain_ops(id, kind, from, to, token_id, amount, memo, status='pending')`.
- **Settler** (boucle serveur, toutes les 8 s ou 50 ops) : regroupe les ops `pending` en un `op_settle(ops, settlement_id)` ;
  statut → `sent` → `final` (hash stocké) ou `failed` (retry exponentiel ; après 5 échecs : alerte + l'UI Pulse le montre).
- **Exceptions synchrones** : la **Forge** inclut dans le **même `op_settle`** toutes les ops encore `pending` du joueur (création de compte,
  mints des captures) **puis** le burn de la recette, et n'octroie les crédits réels qu'**après** finalité du burn on-chain de la recette
  (≈ 2–3 s, l'animation de forge couvre l'attente). Ainsi chaque centime réel a une preuve on-chain avant d'exister.
- **Réconciliation** (job toutes les 10 min + commande `npm run reconcile`) : compare `mt_batch_balance_of` on-chain avec SQLite pour
  les comptes actifs ; écart → log + badge sur Pulse. Tests : un écart artificiel est détecté.
- Création des sous-comptes : **paresseuse**, au premier trade ou à la première compilation (évite de créer des comptes pour des visiteurs
  d'un instant). Le joueur joue tout de suite ; ses ops restent `pending` jusque-là, puis le settler crée le compte et rejoue les ops dans l'ordre.

## 4. Ce que le joueur/juge voit de la chaîne
- Profil › **Proofs** : « Your inventory lives on NEAR » → lien vers son compte sur l'explorer, liste de ses 10 dernières
  opérations réglées avec lien tx. Bouton « Verify my balance » qui fait un `view` RPC **depuis le navigateur** et compare avec l'inventaire affiché.
- Écran marchand : petit lien « Merchant wallet ↗ » (compte du marchand sur l'explorer).
- Ticket de Forge : « Burn proof ↗ » (tx du burn) + « Credit grant » (id d'octroi NEAR AI, montant).
- Pulse › On-chain : flux des derniers settlements, total mint/burn par famille, **Proof of Reserve** : Σ crédits octroyés
  (base) = Σ burns de recettes × rendement enregistré, et solde NEAR AI actuel.

## 5. NEAR Intents (léger, honnête)
Pas de testnet Intents. Usage retenu : la **recharge de la Réserve** (« Fund the city ») : page `/reserve` qui affiche un **devis dry-run** 1Click
(`POST https://1click.chaindefuser.com/v0/quote`, `dry: true`, sans clé, ex. « 5 USDC from Arbitrum → NEAR ») montrant comment un sponsor
pourrait remplir la Réserve depuis n'importe quelle chaîne. Aucun envoi réel (mainnet interdit sans confirmation humaine).
Champs requis (OpenAPI) : `dry, swapType, slippageTolerance, originAsset, depositType, destinationAsset, amount, refundTo, refundType,
recipient, recipientType, deadline`. Piège : recipient/refundTo doivent être de vrais comptes mainnet existants, sinon HTTP 500.
Priorité : **stretch** (P2). À mentionner dans le README comme intégration prévue.
