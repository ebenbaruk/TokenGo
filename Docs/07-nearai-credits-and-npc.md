# 07 — NEAR AI Cloud : crédits réels & cerveau des marchands

Vérifié le 2026-11-06 dans le code de `github.com/nearai/cloud-api` (branche main) et `docs.near.ai`. Revérifier les détails au build
(skill `near-ai-cloud` : `npx skills add near/agent-skills`).

## 1. Faits clés
- API **compatible OpenAI** : base `https://cloud-api.near.ai/v1`. Modèles : Claude (Haiku/Sonnet/Opus 5.5…), GPT-5/6, DeepSeek V4.1,
  Gemini, Qwen, GLM, Kimi, Grok. Liste + prix publics : `GET /v1/model/list` (prix par token en `{amount, scale:9}` USD).
- **Gestion (clés, limites, usage, solde) = jeton de session uniquement.** Une clé `sk-…` ne marche que pour l'inférence.
- **Obtenir une session côté serveur** : `POST /v1/auth/near` avec un message signé **NEP-413** par une **clé full-access d'un compte NEAR mainnet** :
  ```json
  { "signed_message": { "accountId": "...", "publicKey": "ed25519:...", "signature": "<base64>" },
    "payload": { "message": "Sign in to NEAR AI Cloud", "nonce": "<32 octets: 8 premiers = Date.now() big-endian, 24 aléatoires; base64>",
                 "recipient": "cloud.near.ai" } }
  ```
  Nonce < 5 min. En-tête **`User-Agent` obligatoire et constant** (le refresh le vérifie). Réponse : `{access_token (JWT 1 h),
  refresh_token (7 j), refresh_token_expiration, user}`. Refresh : `POST /v1/users/me/access-tokens` avec `Authorization: Bearer <refresh>`
  → nouvelle paire (l'ancien refresh est invalidé → persister le nouveau en DB, chiffré). Si tout expire : re-signer.
  **Refresh sérialisé par un mutex** et nouveau refresh token persisté *avant* utilisation. Vérifier au spike que la clé de signature est bien
  listée full-access sur mainnet (`view_access_key_list`).
  Signer un message NEP-413 **n'est pas une transaction** (aucune dépense) — autorisé sans confirmation.
  Implémentation NEP-413 : borsh(`{tag: 2^31+413 (u32 LE), message, nonce[32], recipient, callbackUrl: Option<String>}`) → sha256 → signature ed25519
  (near-kit ou `@near-js/crypto` + `@noble/hashes`). Tester contre la vraie API dès J1 (point de risque n°1).
- **Créer une clé joueur** : `POST /v1/workspaces/{ws}/api-keys`
  `{"name":"tg_<userId>","expires_at":"<RFC3339 2026-12-31>","spendLimit":{"amount":<nano-USD>,"currency":"USD"}}` (**camelCase `spendLimit`**,
  $1 = 1 000 000 000). Réponse : `key` (secret, **une seule fois**), `id`, `key_prefix`, `spend_limit`, `usage`. Active après ≤ 10 s.
- **Augmenter la limite** : `PATCH /v1/workspaces/{ws}/api-keys/{keyId}/spend-limit` `{"spendLimit":{"amount":N,"currency":"USD"}}`.
- **Révoquer** : `DELETE …/api-keys/{keyId}` (204). **Lister avec usage** : `GET …/api-keys?limit&offset&order_by=usage`.
  Historique : `GET …/api-keys/{keyId}/usage/history`. **Solde org** : `GET /v1/organizations/{org}/usage/balance` → `remaining` (nano-USD).
- **Limites** : la limite de clé n'est PAS comparée au solde de l'org → **c'est à nous de garantir l'invariant** (`03-economy.md` §2).
  Clé au-delà de sa limite → 402 `api_key_limit_exceeded`. Org vide → toutes les clés en 402 (y compris le cerveau des marchands !).
  La vérification est a posteriori : une requête en cours peut dépasser un peu → d'où la marge de sécurité de $1.
- Débit : 1 000 req/min par clé ; **64 requêtes concurrentes par org** (partagées par toutes les clés joueurs + PNJ).
- **Transfert de crédits org→org** : existe (`POST /v1/organizations/{org}/credit/transfer`) mais **désactivé par défaut**
  (`sender_not_enabled`, activation par un admin NEAR) → **non utilisé**. Mentionné en stretch (« withdraw to your own NEAR AI account »).

## 2. Cycle de vie de la clé d'un joueur
1. Première compilation réussie (ou First Compile) → création de la clé avec `spendLimit = payout`. Clé chiffrée (AES-GCM, `MASTER_KEY`)
   stockée dans `api_keys` (pour pouvoir la ré-afficher ; le joueur peut aussi la « rotate » = révoquer + recréer avec limite = restant).
2. Compilations suivantes → `PATCH spend-limit` à `limit + payout`. Ordre strict, dans une fonction `grantCredits(userId, amount, pool, compileId)` :
   a. vérifier l'invariant avec le dernier solde org connu (< 5 min, sinon le rafraîchir) ;
   b. écrire `grants(status='pending')` ;
   c. appel PATCH (ou POST create) avec retry idempotent (relire la clé : si la limite vaut déjà la cible, considérer fait) ;
   d. `grants.status='done'`, `api_keys.limit_nusd` mis à jour, événement SSE `compile.granted`.
   Échec définitif → `failed`, le joueur récupère ses éclats ? **Non** (le burn on-chain est fait) → on crédite à la place
   une « IOU » rejouée par un job toutes les 2 min jusqu'au succès ; l'UI affiche « Credit pending ».
3. Job « usage » toutes les 10 min : lit les usages par clé (liste triée par usage) → `api_keys.usage_nusd` → recalcul de l'engagement restant.
4. Expiration des clés : 2026-12-31 (le jeu promet « valable jusqu'à fin 2026 » ; écrit dans l'UI Credits).

En `FEATURE_REAL_CREDITS=0` : même interface `CreditsProvider` avec implémentation `SimulatedCredits` (clé factice `sk-sim-…`, playground
qui répond via la clé NPC du jeu ou un texte fixe). Test d'intégration commun aux deux implémentations (le réel derrière un flag d'env).

## 3. Playground (preuve que c'est réel)
Onglet Credits › « Try your credits » : sélecteur de modèle (3 suggestions : un pas cher, un moyen, un premium, ex.
`deepseek/deepseek-v4.1-flash`, `openai/gpt-5.4-mini`, `anthropic/claude-sonnet-5-5`), champ de prompt, réponse en streaming,
coût de la requête affiché (« −$0.0004 · 1,231 tokens ») et solde qui descend. Le serveur relaie avec **la clé du joueur**
(pas de dépense du jeu). Max 4 000 tokens de sortie, rate-limit 10 req/min. + bloc « Use it anywhere » : `curl` et snippet OpenAI SDK
avec `baseURL` et la clé masquée (bouton copier). Badge « Private inference in TEE · verifiable » avec lien vers la vérification NEAR AI.

## 4. Cerveau des marchands (agents bornés)
- Clé dédiée du jeu `NEARAI_NPC_KEY` avec **spendLimit = poche NPC Brain ($1)**. Modèle : `z-ai/glm-5.3-flash` (TEE, $0.08/$0.50 par M)
  avec repli `openai/gpt-5-nano`. ≈ 600 tokens par appel → ~$0.0003 → le budget couvre > 3 000 appels.
- **Réflexion** (toutes les 3 h par marchand ouvert, étalée dans le temps ; ~140 marchands → ~1 100 appels/jour : trop → n'appeler le
  LLM que pour les marchands ayant eu ≥ 1 trade/visite dans les 6 h ; les autres utilisent `fallbackPolicy`). Plafond dur **150 appels/jour**, salutations comprises (≈ $0.05/jour → tient jusqu'au 25 nov dans la poche de $1).
- Prompt système (par archétype) : « You are <name>, a <archetype> shard merchant at <place>, Paris. You set strategy only through the JSON
  fields. You never promise anything. Keep mood under 90 chars, witty, PG. » + données chiffrées (JSON) + schéma de sortie.
  Utiliser `response_format: {type: "json_schema", ...}` si supporté par le modèle ; sinon extraction JSON robuste + validation zod.
- **Salutation** à l'ouverture de l'écran marchand : 1 phrase contextualisée (heure, météo non, ce que le joueur porte, contrat en cours).
  Cache 10 min (marchand × joueur), 1 appel/min/joueur, dans le plafond global de 150/jour, sinon phrases préécrites par archétype (8 × 6 phrases dans `merchantLines.ts`).
- **Sécurité** : aucune entrée joueur libre n'est envoyée au LLM (pas de chat libre avec les marchands → pas d'injection de prompt).
  Le pseudo du joueur est filtré (alphanumérique) avant d'apparaître dans un prompt. Sorties : texte affiché échappé, longueur bornée,
  filtre basique de mots interdits ; en cas de doute → phrase préécrite.
- Journal `merchant_thoughts` visible (« Last thought, 14:00 — raised GPT target: the Eiffel Forge wants 2 GPT today ») = transparence pour les juges.
