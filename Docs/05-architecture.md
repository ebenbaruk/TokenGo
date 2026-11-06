# 05 — Architecture technique

## 1. Principes
- **Monolithe simple** : 1 serveur Node, 1 fichier SQLite, 1 front statique servi par le même serveur en prod. Pas de Redis, pas de queue externe.
- **Serveur autoritaire** : le client n'envoie que des intentions (`move`, `catch`, `sync`, `trade`, `compile`…). Toute valeur est calculée serveur.
- **Règles pures partagées** dans `packages/shared` : testables, réutilisées par le simulateur et l'UI.
- **Écritures atomiques** : chaque action de jeu = 1 transaction SQLite (better-sqlite3 est synchrone → pas de course entre requêtes).
- Montants **entiers** partout (Flux et éclats = entiers ; USD = nano-USD en `INTEGER`). Jamais de float pour de la valeur.

## 2. Arborescence
```
TokenGo/
  CLAUDE.md  README.md  LICENSE (MIT)  .env.example  package.json (npm workspaces)  Dockerfile  fly.toml
  Docs/                          ← cette spec
  data/raw/ data/scripts/ data/world/paris.json  data/paris/forges.json
  packages/shared/src/
    economy/rules.ts             ← TOUTES les constantes + formules (fichier lisible, demandé par la track)
    economy/pricing.ts market.ts forge.ts reserve.ts spawns.ts progression.ts agent.ts sim.ts
    geo.ts (haversine, h3 helpers)  types.ts  rng.ts (PRNG seedé, ex. mulberry32 + HMAC via @noble/hashes)
  apps/server/src/
    index.ts (Fastify bootstrap)  config.ts (env validé par zod)  db.ts (connexion + migrations SQL)
    migrations/001_init.sql …
    auth/ (google.ts guest.ts session.ts)
    routes/ (me.ts world.ts actions.ts market.ts forge.ts credits.ts pulse.ts lab.ts admin.ts)
    game/ (movement.ts anticheat.ts spawns.ts relays.ts market.ts forge.ts contracts.ts patronage.ts districts.ts)
    chain/ (near.ts settler.ts reconcile.ts accounts.ts crypto.ts)
    nearai/ (session.ts keys.ts reserve.ts llm.ts)
    jobs.ts (boucles : settler 8 s, reserve 5 min, merchants hourly/3h, P0 hourly, daily 00:00 & 04:00 Europe/Paris)
    sse.ts (bus d'événements)
    scripts/ (build-world.ts sim-cli.ts reconcile.ts seed-dev.ts)
  apps/web/src/
    main.tsx App.tsx  routes: / (jeu)  /pulse  /lab  /proofs  /reserve  /about
    map/ (GameMap.tsx layers.ts style)  sprites/ (grilles texte + renderSprite + Sprite.tsx)  screens/ (Catch Relay Merchant Forge Credits Profile Onboarding)
    ui/ (composants design system)  state/ (store.ts zustand, api.ts, sse.ts)  geo/ (useGeolocation, demoWalk, compass)
    fx/ (particles, sounds, haptics)  styles/ (tokens.css global.css)
  contracts/tokengo-mt/ (Cargo.toml src/lib.rs tests)
  e2e/ (playwright specs)
```

## 3. Dépendances (versions vérifiées le 2026-11-06 ; épingler exactement)
Front : `react` 19, `react-dom`, `vite`, `typescript`, `maplibre-gl@6.16.0`, `h3-js@4.5.0`, `zustand`, `motion` (ex framer-motion),
`uplot` (graphes Lab/Pulse, léger) ou `recharts` (plus simple — choisir **uplot** si perf, sinon recharts), `clsx`,
`@fontsource/pixelify-sans@5.3.0`, `@fontsource/nunito@5.3.0`, `lucide-react`. Sprites pixel art : code maison (`apps/web/src/sprites/`), aucun asset externe.
Serveur : `fastify@5.12.x`, `@fastify/cookie@11.1.x`, `@fastify/rate-limit@11.2.x`, `@fastify/static`, `better-sqlite3@13.0.x`, `zod`,
`arctic@3.7.x` (Google OAuth), `near-kit@0.20.x`, `@noble/hashes`, `h3-js`, `pino` (logs Fastify).
Dev : `vitest`, `@playwright/test`, `tsx`, `concurrently`, `@types/*`.
Rust : `near-sdk 5.30.x`, `cargo-near 0.23.0`, `near-cli-rs 0.31.x`.
Ne **pas** ajouter de dépendance sans raison écrite dans le commit.
**À vérifier J1** (`npm view`, installation réelle sur ARM64/Node 24) : `maplibre-gl@6.16`, `better-sqlite3@13` (repli : `node:sqlite` intégré),
`near-kit@0.20`, existence du style OpenFreeMap `dark` (sinon partir de `positron` ou `liberty`).

## 4. Modèle de données (SQLite, `001_init.sql`)
```sql
users(id TEXT PK, kind TEXT CHECK(kind IN('google','guest')), google_sub TEXT UNIQUE, email TEXT, handle TEXT UNIQUE,
      district INTEGER, level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, mode TEXT DEFAULT 'gps', -- 'gps'|'demo'
      near_account TEXT, walked_m INTEGER DEFAULT 0, created_at INTEGER, banned_until INTEGER, flags TEXT)
sessions(id_hash TEXT PK, user_id TEXT, created_at INTEGER, last_seen INTEGER, expires_at INTEGER, ua TEXT)
positions(user_id TEXT PK, lat REAL, lng REAL, acc REAL, at INTEGER, cell TEXT, speed_kmh REAL, in_transit INTEGER)
inventory(user_id TEXT, token_id TEXT, amount INTEGER, PRIMARY KEY(user_id, token_id))   -- miroir jeu ; flux = token 'flux'
catches(user_id TEXT, spawn_id TEXT, at INTEGER, family TEXT, quality TEXT, PRIMARY KEY(user_id, spawn_id))
nodes(id TEXT PK, kind TEXT, name TEXT, lat REAL, lng REAL, h3 TEXT, district INTEGER, affinities TEXT, data TEXT)  -- chargé depuis data/world
relay_syncs(user_id TEXT, node_id TEXT, at INTEGER)  -- index (user_id,node_id,at)
visits(user_id TEXT, node_id TEXT, first_at INTEGER, PRIMARY KEY(user_id,node_id))
merchants(id TEXT PK, node_id TEXT UNIQUE, name TEXT, archetype TEXT, near_account TEXT, flux INTEGER, stock TEXT /*json*/,
          target TEXT, spread REAL, status TEXT, closing_since INTEGER, total_shares INTEGER, mood TEXT, updated_at INTEGER)
merchant_shares(merchant_id TEXT, holder TEXT /*user id ou 'city'*/, shares INTEGER, PRIMARY KEY(merchant_id, holder))
merchant_thoughts(id INTEGER PK, merchant_id TEXT, at INTEGER, input TEXT, output TEXT, applied TEXT, source TEXT /*'llm'|'fallback'*/)
trades(id TEXT PK, at INTEGER, user_id TEXT, merchant_id TEXT, side TEXT, token_id TEXT, qty INTEGER, flux_total INTEGER, unit_prices TEXT)
price_ticks(merchant_id TEXT, at INTEGER, token_id TEXT, mid INTEGER)   -- 1/h/famille, pour tendances & Pulse
ref_prices(at INTEGER, token_id TEXT, p0 INTEGER)
contracts(id TEXT PK, merchant_id TEXT, token_id TEXT, qty INTEGER, reward INTEGER, expires_at INTEGER, status TEXT, filled_by TEXT)
forge_days(forge_id TEXT, day TEXT, recipes TEXT /*json*/, PRIMARY KEY(forge_id, day))
compiles(id TEXT PK, at INTEGER, user_id TEXT, forge_id TEXT, tier TEXT, inputs TEXT, fee INTEGER, pool TEXT,
         payout_nusd INTEGER, status TEXT /*'burning'|'granted'|'failed'*/, burn_tx TEXT, grant_ref TEXT)
api_keys(user_id TEXT PK, nearai_key_id TEXT, key_enc TEXT /*AES-GCM, montré une fois puis re-montrable via déchiffrement*/,
         key_prefix TEXT, limit_nusd INTEGER, usage_nusd INTEGER, usage_at INTEGER)
reserve_state(id INTEGER PK CHECK(id=1), org_remaining_nusd INTEGER, at INTEGER, pools TEXT /*json par poche*/)
grants(id TEXT PK, at INTEGER, user_id TEXT, pool TEXT, amount_nusd INTEGER, compile_id TEXT, status TEXT)
chain_ops(id INTEGER PK, kind TEXT, from_acc TEXT, to_acc TEXT, token_id TEXT, amount INTEGER, memo TEXT,
          status TEXT, settlement_id TEXT, tx_hash TEXT, tries INTEGER, created_at INTEGER)
near_accounts(account_id TEXT PK, owner TEXT, key_enc TEXT, status TEXT, created_tx TEXT)
events(id INTEGER PK, at INTEGER, kind TEXT, payload TEXT)   -- alimente Pulse (ticker) + SSE
district_scores(week TEXT, district INTEGER, points INTEGER, PRIMARY KEY(week, district))
beacons(id TEXT PK, node_id TEXT, user_id TEXT, until INTEGER)
daily_routes(user_id TEXT, day TEXT, nodes TEXT, done TEXT, PRIMARY KEY(user_id, day))
```
Migrations : fichiers SQL numérotés appliqués au démarrage (table `schema_version`). Mode WAL, `foreign_keys=ON`.

## 5. API HTTP (JSON, préfixe `/api`, cookie de session)
Auth : `GET /auth/google` → redirect ; `GET /auth/google/callback` ; `POST /auth/guest` ; `POST /auth/logout`.
| Méthode & route | Rôle |
|---|---|
| `GET /api/me` | profil, niveau, inventaire, crédits, flags (mode demo, proof of walk), tutoriel |
| `POST /api/move {lat,lng,acc,heading?,t}` | met à jour la position ; renvoie `{ok, inTransit, warnings}` |
| `GET /api/world?lat&lng` | nodes + spawns visibles (r ≈ 250 m) + marchands (statut, badge contrat) + beacons + forges proches |
| `POST /api/catch/start {spawnId}` | vérifie distance ; renvoie `{attemptId, ringMs, windowPct}` (paramètres du mini-jeu) |
| `POST /api/catch/resolve {attemptId, taps:[{t, offsetPct}]}` | le serveur décide : `{result:'perfect'|'good'|'fled'|'miss', loot}` |
| `POST /api/relay/sync {nodeId}` | cooldown, distance → loot |
| `GET /api/merchant/:id` | état, prix buy/sell par famille, explications, contrat, parts, dernière pensée, best-known-prices |
| `POST /api/merchant/:id/quote {side, tokenId, qty}` | devis exact (glissement), `quoteId` valable 20 s |
| `POST /api/merchant/:id/trade {quoteId}` | exécute si prix inchangé (sinon 409 + nouveau devis) |
| `POST /api/merchant/:id/contract/deliver` · `/invest {flux}` · `/withdraw {shares}` · `GET /greet` (salutation IA) |
| `GET /api/forge/:id` | recettes du jour, ce qui manque, rendement actuel, état Réserve |
| `POST /api/forge/:id/compile {tier}` | → `{compileId}` puis événements SSE `compile.burning` → `compile.granted {payout, equiv, burnTx}` |
| `GET /api/credits` | clé (préfixe), limite, usage, solde restant, équivalences, historique des grants |
| `POST /api/credits/reveal` | renvoie la clé en clair (rate-limit 5/h, ré-auth récente pour Google) |
| `POST /api/credits/playground {model, messages}` | proxy streaming vers NEAR AI **avec la clé du joueur** (le serveur ne paie pas) |
| `GET /api/pulse` · `GET /api/pulse/stream` (SSE) | ticker, index, réserve, faillites, settlements |
| `GET /api/lab/snapshot` | état économique actuel (pour simulation côté navigateur) |
| `GET /api/leaderboards` · `POST /api/me/district` · `POST /api/me/handle` · `POST /api/beacon {nodeId}` |
| `GET /api/proofs` | compte NEAR, ops réglées avec tx, liens explorer |
| `GET /api/stream` (SSE) | événements du joueur (grants, contrats, settlements) |
| `DELETE /api/me` | suppression du compte (anonymisation, révocation de la clé) |
| `POST /api/admin/forge/pause` · `/resume` | kill switch Forge (en-tête `Authorization: Bearer ADMIN_TOKEN`) |
| `GET /healthz` | santé (DB, settler lag, reserve age, invariant de solvabilité OK) |
Toutes les réponses d'erreur : `{error: {code, message}}` avec codes stables (`TOO_FAR`, `COOLDOWN`, `IN_TRANSIT`, `LEVEL_LOCKED`,
`INSUFFICIENT`, `PRICE_MOVED`, `RESERVE_LOW`, `RATE_LIMITED`, `SUSPICIOUS_MOVE`…). L'UI a un message humain par code.

Temps réel : **SSE** `/api/stream` (par joueur : grants, contrats, settlements de ses ops) + `/api/pulse/stream` (public).
Pas de WebSocket (inutile ici). SSE : **heartbeat toutes les 20 s** (commentaire `:ping`), route exclue de toute compression, en-tête `X-Accel-Buffering: no`.

## 6. Configuration (`.env`, validée par zod au démarrage ; `.env.example` commité)
```
PORT=8787  PUBLIC_URL=https://…  NODE_ENV  SESSION_SECRET  MASTER_KEY (32 octets base64, chiffre clés NEAR & API)
SPAWN_SECRET  DB_PATH=./var/tokengo.db
GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET
NEAR_NETWORK=testnet  NEAR_RPC_URL  NEAR_CONTRACT_ID=tokengo.testnet  NEAR_OPERATOR_KEY (ed25519:…)
NEARAI_BASE=https://cloud-api.near.ai  NEARAI_AUTH_ACCOUNT (compte MAINNET dédié)  NEARAI_AUTH_KEY (clé full-access de ce compte)
NEARAI_ORG_ID  NEARAI_WORKSPACE_ID  NEARAI_NPC_KEY (clé sk- du jeu pour les appels LLM marchands)
NEARAI_REFRESH_TOKEN (fallback si la connexion NEP-413 échoue)  NPC_MODEL=z-ai/glm-5.3-flash  NPC_MODEL_FALLBACK=openai/gpt-5-nano
FEATURE_REAL_CREDITS=1   (0 = crédits simulés : tout le reste marche sans compte NEAR AI, utile pour dev/tests/CI)
WORLD_ANYWHERE=0  DEMO_TOKEN  ADMIN_TOKEN
```
**Mode dégradé obligatoire** : sans `NEARAI_*` → `FEATURE_REAL_CREDITS=0`, octrois simulés (marqués « simulated » dans l'UI) ;
sans `NEAR_OPERATOR_KEY` → settler désactivé (ops restent `pending`, badge « chain offline »). Le jeu doit tourner en local avec **zéro secret**
(c'est ce que lancera le juge IA).

## 7. Exécution & déploiement
- Dev : `npm run dev` (Vite :5173 avec proxy `/api` → :8787). Accès `http://surface:5173` (la géoloc n'y marchera pas : HTTP non-localhost →
  utiliser Demo Walk ; tester le GPS réel via le déploiement HTTPS).
- Prod : `npm run build` → front buildé dans `apps/web/dist`, servi par Fastify (`@fastify/static`) ; 1 process.
- **Hébergement de la démo publique (HTTPS obligatoire pour la géoloc et Google OAuth)** — décision :
  1. **Par défaut : Tailscale Funnel depuis « surface »** (gratuit, déjà en place) → `https://surface.<tailnet>.ts.net` (Funnel n'expose que
     les ports 443/8443/10000 côté public ; mapper 443 → port local du jeu). Prérequis humain : activer HTTPS certificates + Funnel dans l'admin
     Tailscale (voir `HUMAN-TODO.md`). Service systemd `--user tokengo` pour tenir jusqu'au 25 nov. **Ajouter le port du jeu à la liste `SKIP`
     de `~/.local/bin/surface-ports`** (sinon il pourrait faire `tailscale serve … off` dessus à son redémarrage) ; ne pas toucher à `surface-web`
     (cf. `~/CLAUDE.md`). Risque : la disponibilité d'un hôte WSL2 jusqu'au 25 nov → surveiller `/healthz` (cron + notification `surface-notify`).
  2. **Plan B / recommandé si l'humain accepte ~$5 : Fly.io** (≈ $5/mois, plus fiable pour la période de jugement ; Dockerfile + volume 1 Go pour SQLite, `fly deploy --remote-only` évite l'ARM→amd64).
     Le Dockerfile et `fly.toml` sont écrits dès J6 pour que la bascule prenne 10 min.
- Sauvegarde : `sqlite3 .backup` quotidien dans `var/backups/` (job).
