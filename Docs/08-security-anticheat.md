# 08 — Sécurité & anti-triche

Contexte : de l'argent réel (petit) est en jeu et la géolocalisation navigateur est falsifiable en 10 secondes.
Objectif réaliste : **on ne peut pas empêcher toute triche, on borne ce qu'elle rapporte** et on rend les abus visibles.

## 1. Modèle de menace & réponses
| Menace | Réponse |
|---|---|
| Faux GPS (devtools, extension) | Contrôles de cohérence (§2), plafonds de gains, proof of walk, revue des comptes flaggés. Gain max d'un tricheur borné par `cap_player_day` ($0.25) et l'âge du compte. |
| Multi-comptes (sybil) | Google uniquement pour le Main Pool (1 `sub` Google = 1 joueur, `email_verified` requis, normalisation gmail points/`+tag`) ; invités limités au Welcome Pool ($0.03 une fois) ; création d'invités 3/h/IP ; Welcome Pool global plafonné. Seul un invité **GPS** est promu à la connexion Google (un invité démo ou pass démo repart d'un compte Google neuf). Suppression de compte → **tombstone** hachée (sub + email normalisé) : une identité qui revient garde son flag et n'a pas de second bonus de bienvenue. |
| Bots / scripts sur l'API | Rate limits par route, mini-jeu avec timing (le bot n'y gagne que le bonus), quotas par jour, détection de régularité parfaite des taps (log). |
| Rejouer / dupliquer une action | Chaque spawn = `catches(user_id, spawn_id)` PK ; devis à usage unique ; `Idempotency-Key` sur compile ; settlement_id unique on-chain. |
| Course sur les prix | Transactions SQLite sérialisées ; devis lié à la version du marchand (`updated_at`) → `PRICE_MOVED`. |
| Farm du marchandage | Issue choisie par le serveur (le client n'envoie que la carte) ; séance liée au joueur et au marchand, TTL 90 s, « Deal » à usage unique sous verrou par joueur ; remise ≤ 8 % et jamais sous le plancher de coût (aucun profit d'aller-retour, testé par tirages) ; 2 séances/marchand, 6/jour ; bouderie après échec. |
| Requêtes concurrentes (compile, octrois) | `compile` sérialisée par joueur (verrou async en mémoire, serveur mono-processus) ; tutoriel et caps relus dans la transaction du burn, octroi réservé (`grants.status = 'reserved'`) dans cette même transaction → visible des compilations concurrentes. Clé API : verrou par joueur, limite cible = Σ octrois `done` + celui-ci (jamais « limite en cache + montant »), clé créée une seule fois ; la reprise IOU ignore les comptes supprimés. |
| Monde « partout » détourné (génération de quartiers à distance, épuisement du plafond global) | `/api/world` ne crée une région que si `lat/lng` est à ≤ 1 km de la **position serveur** du joueur reçue par `/api/move` il y a ≤ 5 min (`WORLD_GEN.anchorMaxM/anchorFreshMs`) ; plafonds 12 régions/jour par réseau, 300/jour au global ; Overpass : URLs de config seulement (pas de SSRF), requête construite depuis l'id H3, ≤ 900 éléments. Résiduel assumé : un attaquant avec ~25 réseaux (VPN) peut encore épuiser le plafond global d'un jour — kill switch `WORLD_ANYWHERE=0`. |
| Espionnage de présence (carte vivante) | Joueurs réels publiés à la cellule H3 r9 ± 60 m, sans nom ; `/api/walkers` ne renvoie de joueurs qu'autour de la position serveur récente du demandeur (pas d'un `lat/lng` arbitraire) et leur id opaque change toutes les 10 min (pas de suivi d'un trajet sur la journée). |
| IP falsifiée (`X-Forwarded-For`) | `TRUST_PROXY` = nombre de proxys de confiance (défaut 1 en prod, 0 sinon) : l'IP client est l'entrée ajoutée par notre proxy, jamais celle fournie par le client. |
| Vol de session | Prod : cookie `__Host-tg_sess` `HttpOnly; Secure; SameSite=Lax; Path=/` ; **dev/HTTP** (`http://surface:5173`, localhost, WebKit) : cookie `tg_sess` sans préfixe ni `Secure` (sinon la connexion casse) ; id 256 bits haché en base, rotation à la connexion, expiration 30 j / inactivité 7 j. |
| CSRF | SameSite=Lax + **vérification d'`Origin`** sur toute requête non-GET (liste blanche = `PUBLIC_URL` ; en dev aussi `http://localhost:5173`, `http://surface:5173`). |
| XSS | React échappe ; jamais de `dangerouslySetInnerHTML` ; textes LLM et pseudos traités comme texte ; CSP stricte (`default-src 'self'` ; `connect-src` self + tiles.openfreemap.org (tuiles, glyphs, sprites) + RPC testnet (« Verify my balance » depuis le navigateur) ; `img-src` self data: blob: tiles ; `worker-src blob:` pour MapLibre). |
| Injection de prompt dans les PNJ | Pas d'entrée libre vers le LLM ; sorties bornées et validées ; le LLM ne déplace jamais de valeur (§6 de `03-economy.md`). |
| Fuite de secrets | `.env` hors git, `gitleaks` ou grep de contrôle avant chaque commit (script `npm run check:secrets`), clés NEAR et NEAR AI chiffrées en base (AES-256-GCM, `MASTER_KEY`). Les logs ne contiennent jamais de clé (redaction pino). |
| Abus du playground | Utilise la clé du joueur (c'est son argent) ; rate-limit 10/min ; taille de prompt bornée (8 k caractères). |
| Drain de la Réserve | Invariant de solvabilité vérifié avant tout octroi ; rendement proportionnel au restant ; cap global/jour ; kill switch `ADMIN_TOKEN` → `POST /api/admin/forge/pause`. |
| Compte NEAR AI (mainnet) compromis | Compte dédié, **sans fonds NEAR** (juste la clé de connexion), clé uniquement en env, jamais loggée. Le solde de crédits est le seul actif (≈ 10 €). |

## 2. Contrôles de mouvement (`game/anticheat.ts`, fonctions pures testées)
Pour chaque `POST /api/move` :
- `dt = t_serveur − t_précédent` ; `d = haversine` ; `v = d / dt`.
- Précision : `acc > 60 m` → position ignorée pour les actions (affichée seulement).
- Vitesse (le **transit** se décide sur la **moyenne glissante 60 s**, jamais sur un seul segment : 20 m de jitter GPS en 3 s ressemblent à 24 km/h) :
  - `v_60s ≤ 25 km/h` → normal.
  - `25 < v ≤ 200 km/h` → **in transit** (actions désactivées tant que la vitesse moyenne sur 60 s > 25 km/h). Pas une sanction.
  - `v > 200 km/h` et `d > 1 km` → **saut suspect**. Si `dt` ≥ temps plausible (d / 50 km/h, retour d'app en arrière-plan) → accepté
    comme « retour », sinon **cooldown de 10 min** sur les actions (soft-lock, message neutre « Re-syncing your position… ») + compteur
    `suspicious_jumps`. ≥ 3 en 24 h → compte `flagged` (plus de Main Pool jusqu'à revue manuelle via `npm run admin -- review`).
- Mode démo : pas de contrôle de vitesse (tap-to-walk 30 km/h et « Jump » autorisés), mais distances d'action vérifiées ; gains réels limités
  au Welcome Pool (et au Judge Pool pour les pass démo) ; le **Judge Pool est réservé aux comptes `DEMO_TOKEN`** (la fenêtre juges
  ne sert plus qu'au message de l'UI, `judgeOpen`) ; les comptes `DEMO_TOKEN` **ne peuvent pas vendre** aux marchands (ils peuvent acheter, forger et contribuer), et un même
  token ne crée qu'un compte par IP (hachée) et par jour de Paris (`demo_passes`, sinon 429 `RATE_LIMITED`) — pour qu'un lien de démo ne
  puisse pas inonder le marché réel. Le token est comparé à temps constant (sha256 + `timingSafeEqual`).
- **Distance d'action** : calculée serveur entre la dernière position acceptée (< 30 s) et la cible : spawn ≤ 40 m (+ min(acc, 20)),
  relay/market ≤ 40 m (+ min(acc, 20)), forge ≤ 60 m (+ min(acc, 20)).
- **Proof of walk** : `walked_m` n'augmente que pour des segments `v ≤ 8 km/h` et `acc ≤ 30 m`, plafonné à 3 km/h de temps réel.

## 3. Mini-jeu de capture (sans faire confiance au client)
- `catch/start` renvoie `ringMs`, `windowPct` et un `attemptId` (expire 15 s, lié au spawn et au joueur).
- `catch/resolve` envoie les taps. Le serveur vérifie la durée réelle (≥ 300 ms après start, ≤ 15 s) et que les offsets sont cohérents avec la
  courbe de l'anneau (temps relatif). Il calcule la qualité ; puis **plafonne** : max 40 % de « perfect » sur une fenêtre glissante de
  30 captures (au-delà → traité comme « good », sans message), **dès la première capture** : le ratio se calcule sur max(captures, 5)
  (un compte neuf a au plus 2 perfect sur ses 5 premières captures). La capture de base est garantie (« good ») si le joueur tape
  au moins une fois dans la fenêtre large ; la fuite des rares est tirée côté serveur.

## 4. Limites de débit (`@fastify/rate-limit`, mémoire)
`/auth/*` 10/min/IP · `POST /auth/guest` 3/h/IP · `/api/move` 30/min/user · `catch/*` 30/min · `relay/sync` 20/min · `trade` 30/min ·
`compile` 6/min · `credits/reveal` 5/h · `playground` 10/min · `greet` 30/min (appel LLM seulement si le joueur est à ≤ 200 m du marchand,
sinon réplique écrite) · public (`/pulse`, `/lab/snapshot`) 60/min/IP.
SSE simultanés : 3 `/api/stream` par joueur, 20 `/api/pulse/stream` par IP, 500 au total → 429.
Les limites par IP reposent sur `req.ip` : voir `TRUST_PROXY` (§1). Clé « réseau » (`netKey`) : IPv4 telle quelle, **IPv6 réduite à son /64**
(un abonné reçoit un /64 entier) — création d'invités, pass démo, plafond de régions, SSE public, limites par IP.
Quotas jour : 400 captures, 200 syncs, 60 compiles (jeu), plafond $ selon §3 de l'économie.

## 5. Données personnelles (RGPD minimal)
Stocker le strict nécessaire : `google_sub`, email (pour contact/anti-sybil, jamais affiché), pseudo. Positions : on garde **la dernière**
seulement (+ segments agrégés pour `walked_m`), pas d'historique de trajet. Page `/about` : ce qui est stocké, pourquoi, suppression
du compte (`DELETE /api/me` → anonymise, révoque la clé API ; ne garde qu'une tombstone : hachés salés du `google_sub` et de l'email
normalisé, flag de revue, bonus de bienvenue reçu ou non). Aucun tracker tiers, aucune analytics externe.

## 6. Checklist sécurité avant soumission (`11-roadmap.md` J7)
- [ ] `npm run check:secrets` vert sur tout l'historique git (`git log -p | grep -E 'ed25519:|sk-[A-Za-z0-9]{20}|BEGIN PRIVATE'`)
- [ ] Origin check + CSP actifs en prod (test e2e qui vérifie les en-têtes)
- [ ] Tests anti-triche verts (saut, transit, distance, double capture, perfect cap)
- [ ] Invariant de solvabilité testé + vérifié en prod (`/healthz` public = `{ok, invariantOk, chain, simulatedCredits}` ; chiffres seulement avec `Authorization: Bearer ADMIN_TOKEN`)
- [ ] Kill switch Forge testé
- [ ] Revue `/code-review` + `/security-review` des diffs majeurs
