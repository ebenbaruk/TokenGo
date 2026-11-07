# TokenGo — Spec (index)

**Jeu géolocalisé navigateur : marcher dans Paris, capturer des éclats d'IA, les échanger avec des marchands IA à wallet NEAR,
les forger en vrais crédits NEAR AI Cloud.** NEAR HACKATHON, tracks `games` + `agents`. Deadline **2026-11-14 23:59 UTC**.

| # | Document | Contenu |
|---|---|---|
| 01 | [vision](01-vision.md) | Pitch, pourquoi ça gagne, principes non négociables |
| 02 | [game-design](02-game-design.md) | Glossaire, éclats, 3 boucles, nœuds, progression, onboarding, modes de déplacement |
| 03 | [economy](03-economy.md) | Réserve réelle, rendement de Forge, recettes, prix des marchands, faillite, patronage, agent, simulateur |
| 04 | [world-geo](04-world-geo.md) | Données Paris, génération des nœuds, H3, affinités, carte, géoloc, « partout » |
| 05 | [architecture](05-architecture.md) | Stack, arborescence, schéma SQL, API, env, déploiement |
| 06 | [blockchain](06-blockchain.md) | Contrat NEP-245, comptes custodial, settlement, preuves, Intents |
| 07 | [nearai-credits-and-npc](07-nearai-credits-and-npc.md) | Auth NEP-413, clés à plafond, invariant, playground, cerveau des marchands |
| 08 | [security-anticheat](08-security-anticheat.md) | Menaces, contrôles de mouvement, rate limits, RGPD, checklist |
| 09 | [ux-ui-design](09-ux-ui-design.md) | Direction artistique, tokens, écrans, composants, textes |
| 10 | [demo-and-judging](10-demo-and-judging.md) | Jugement, README, comptes démo, vidéo, post X, soumission |
| 11 | [roadmap](11-roadmap.md) | Plan jour par jour J1–J8, priorités, plan de coupe |
| 12 | [testing](12-testing.md) | Unitaires, e2e, vérification, `npm run verify` |
| — | [HUMAN-TODO](HUMAN-TODO.md) | Ce que seul le propriétaire peut faire (comptes, paiements, publication) |

Sources externes clés : https://nearhackathon.com/HACKATHON.md (règles, à relire avant soumission) ·
https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/09-games.md · https://docs.near.org/llms.txt ·
https://docs.near.ai/llms.txt · https://docs.near-intents.org/llms.txt · skills `npx skills add near/agent-skills`.

## Journal des décisions
| Date | Décision | Raison |
|---|---|---|
| 2026-11-06 | Concept : éclats par famille de modèles réels, rareté = prix réel ; marchands IA à prix locaux → arbitrage par la marche | La track juge l'économie comme gameplay ; relie déplacement réel et marché |
| 2026-11-06 | Seule porte vers le réel = Forge (recettes multi-familles) ; Flux jamais convertible | Protège la Réserve de 10 € tout en rendant le marché utile |
| 2026-11-06 | Rendement = fraction du restant (géométrique) + invariant Σ limites ≤ solde | NEAR AI ne compare pas les limites de clés au solde ; solvabilité par construction |
| 2026-11-06 | Crédits via clés API par joueur avec `spendLimit` (pas de transfert org→org) | Transfert désactivé par défaut côté NEAR AI ; clés = zéro friction joueur |
| 2026-11-06 | Session NEAR AI obtenue par signature NEP-413 d'un compte mainnet dédié | Seule façon pour un serveur de gérer les clés (sk- = inférence seulement) |
| 2026-11-06 | Login : Google (arctic) + invité ; comptes NEAR testnet custodial créés par le serveur | FastAuth déprécié, solutions tierces expérimentales ou verrouillantes ; anti-sybil côté serveur |
| 2026-11-06 | Contrat NEP-245 maison (~200 lignes), opérateur backend, settlement par lots, burn synchrone avant crédit | Pas de crate NEP-245 publié ; latence zéro en jeu ; chaque $ réel a une preuve |
| 2026-11-06 | MapLibre direct + OpenFreeMap (style dark retravaillé), H3 res 9, Paris précalculé depuis OSM | Gratuit sans clé, performant, extensible au monde |
| 2026-11-06 | Monolithe Fastify + SQLite + SSE ; front Vite/React/Zustand | Simplicité, 1 dev, 8 jours |
| 2026-11-06 | Démo HTTPS via Tailscale Funnel (plan B Fly.io) | Gratuit ; HTTPS requis pour géoloc et OAuth |
| 2026-11-06 | Mode dégradé sans secrets (crédits simulés, chaîne off) obligatoire | Le juge IA doit pouvoir lancer le projet |
| 2026-11-06 | Révision après relecture critique : relays 5–10 ƒ + 0–1 éclat, frais de Forge 40/120/300, exports des marchands (puits d'éclats), loyer seulement si actif, trésoreries 900–2 400 ƒ | Éviter l'inondation d'éclats et de Flux qui écrase les prix et tue l'arbitrage |
| 2026-11-06 | Poches : Main 4.5 / Welcome 2 (gated, 4 par heure) / Judge 1.5 / NPC 1 / Safety 2.5 ; overshoot $0.05 par clé dans l'invariant | Le Welcome Pool était vidable en un jour ; les juges doivent toujours voir de vrais crédits |
| 2026-11-06 | Patronage simplifié en « sauvetage » (titre Patron + spread réduit), parts et dividendes en P2 ; contrats anti-farm | La NAV et les dividendes étaient manipulables ; trop de périmètre pour 8 jours |
| 2026-11-06 | Runners-agents (24 bots) dans le monde en direct (P1) ; objectif épinglé ; Demo Walk à 30 km/h + Jump | Sinon le marché a l'air mort pendant le jugement ; il faut un but à chaque instant ; la démo doit être rapide |
| 2026-11-06 | DA « Pixel Pop Paris » : sprites pixel art (Sweetie 16, contours encre, grilles texte rendues par le code) + carte/UI cartoon plat de jour, boutons chunky à ombre dure, Pixelify Sans + Nunito ; nuit en P2 | Demande du propriétaire : « un peu pixel art mais pas trop, coloré, fun » + référence `Docs/design-ref/` |
| 2026-11-06 | Hébergement de la démo : Railway (Docker + volume SQLite) préparé, choix final par le propriétaire plus tard ; Tailscale Funnel abandonné | Demande du propriétaire ; Vercel (serverless) ne garde ni SQLite ni SSE |
| 2026-11-06 | Coupes : Beacons, Daily Route, Codex, districts complets, Intents, boussole, partout → P2 ; Aura en P1 ; simulateur avancé au J2 | Périmètre réaliste pour 8 jours en solo |
| 2026-11-06 | Prix des marchands : chaque unité est valorisée au stock **après** l'échange (acheter à stock s paie mid(s−1)) ; un marchand *closing* n'achète plus | Sinon acheter puis revendre au même marchand rapportait (rareté ^0.6 > spread) ; testé sur 500 tirages |
| 2026-11-06 | Marchands espacés de **600 m** (pas 450) → 153 marchands ; 2 marchands éditoriaux près du Louvre (`data/paris/extra-markets.json`) | À 450 m on obtenait 240 marchands ; la démo exige ≥ 2 marchands < 600 m du départ |
| 2026-11-06 | Marchand en difficulté pré-semé à **120 ƒ** (pas 200), choisi > 250 m du départ | À 200 ƒ (> seuil 150) il redevenait « open » au premier tick ; les 2 marchands de la démo restent sains |
| 2026-11-06 | Proof of walk : crédit plafonné à 6 km/h de temps réel (pas 3) | À 3 km/h une marche normale n'était créditée qu'à 60 % |
| 2026-11-06 | Ids marchands = slug URL-safe `m-node-123` (= nom du sous-compte NEAR `m-node-123.tokengo.testnet`) ; `AFFINITY_RULES` dans `economy/affinity.ts` (réexporté) | Les ids OSM contiennent « / » (routes cassées) ; rules.ts reste centré sur les nombres |
| 2026-11-06 | Contrat déployé sur **`tokengo.testnet`** (opérateur = contrat), sous-comptes sans clé (custodial par l'opérateur) | Coût mesuré ≈ 0,007 NEAR par sous-compte ; 7,7 NEAR restants ≈ 1 000 joueurs |
| 2026-11-06 | P0 ancré : `P0 ← 0.95·P0 + 0.05·P0_initial·médiane(scarcity)`, borné [0.6, 1.4] × P0_initial | L'ancienne dérive suivait les prix milieu (∝ P0) → emballement : DeepSeek 10 → 18,9 ƒ en 36 h puis plancher, 99 % des marchands fermés au jour 3 (sim 7 j × 200, graine 42) |
| 2026-11-06 | Exports = « demande de la ville » : ½ du surplus au-delà de 1,5 × BASE_TARGET racheté à 0,75 × P0 (avant : tout au-delà de 2 × cible à 0,5 × P0) | Les marchands perdaient sur chaque export (achat ≈ 0,62 P0, revente 0,5 P0) : aucun revenu lié à l'activité. Seuil commun → écart de prix entre voisins 7 % → 19 % |
| 2026-11-06 | ALPHA 0,6 → 1,1 ; stocks initiaux 60–100 % → 80–125 % ; loyer 8 → 4 ƒ/h | Écart médian < 1 km ≥ 15 % (sinon pas d'arbitrage) ; prix de départ ≈ P0 ; le loyer seul vidait les caisses (14 j : 78 % fermés à 3 ƒ/h sans demande de la ville, 2 % sans loyer). Final : 2,6–6,5 % fermés en 7 j, 16–20 % en 14 j |
| 2026-11-06 | Relais 5–10 → 3–7 ƒ ; frais Spark 40 → 60, Prism 120 → 160 ; cible « Flux joueurs » < 10 %/j (au lieu de 5 %) | Puits de Flux réalistes une fois que les walkers forgent : croissance 7 j = 2,8–6,5 %/j (14 j : ≈ 1 %/j) ; 5 %/j inatteignable pendant la montée en charge depuis 50 ƒ de départ |
| 2026-11-06 | Cap global Forge 10 % → 5,5 % de la poche Main par jour | Argent réel : la poche Main se vidait de 52 %/semaine (cap atteint chaque jour) ; maintenant 32,6 %/semaine |
| 2026-11-06 | Poids de spawn DeepSeek 41 / Qwen 27 / Gemini 19 (au lieu de 42/28/17) | Chaque Spark exige 2 Gemini : Gemini montait à ~2× P0 ; sim seeds 42/1/2/3 à 7 et 14 j : toutes les cibles de santé vertes |
| 2026-11-06 | `TRUST_PROXY` (nombre de proxys de confiance, défaut 1 en prod, 0 sinon) au lieu de `trustProxy: true` | Avec `true`, n'importe quel client choisissait son IP via `X-Forwarded-For` et contournait les limites par IP (invités, pass démo, flux publics) |
| 2026-11-06 | Judge Pool réservé aux comptes `DEMO_TOKEN` ; `judgeOpen` ne sert plus qu'au message de l'UI | Pendant la fenêtre juges, tout invité pouvait puiser dans le Judge Pool : un script d'invités le vidait |
| 2026-11-06 | Connexion Google : seul un invité GPS est promu ; un invité démo (avec ou sans pass) repart d'un compte Google neuf | Le mode démo (kit, téléportation, pas de contrôle de vitesse) ne doit pas se convertir en compte éligible au Main Pool avec sa progression |
| 2026-11-06 | `DEMO_TOKEN` comparé à temps constant ; 1 compte pass démo par IP hachée et par jour (429 sinon) | Un lien de démo qui fuit ne doit pas fabriquer des comptes Judge Pool à la chaîne ; pas de fuite du token par timing |
| 2026-11-06 | Suppression de compte : tombstone hachée (sub + email normalisé, flag, bonus de bienvenue reçu) | Supprimer puis recréer son compte Google ne doit ni effacer un flag anti-triche ni redonner le bonus de bienvenue ; seuls des hachés salés sont gardés (RGPD) |
| 2026-11-07 | Codex = variantes **cosmétiques** (Classic / Night / Landmark / Overclocked / Shiny × 5 familles = 25 cases), tirées par le serveur (`rollVariant`, graine HMAC, `CODEX` dans rules.ts) ; l'inventaire reste `shard:<famille>` | Raison de revenir (collection, titres) sans toucher à l'économie : prix, Forge et Réserve inchangés, pas besoin de re-simuler. Seule XP : +15 par case découverte (375 max, une fois) |
| 2026-11-07 | Nuit = heure **solaire** (longitude/15), landmark = ≤ 300 m d'une Forge, overclocked = PERFECT à combo ≥ 3, shiny 1/40 | Marche dans n'importe quelle ville générée sans fuseau ni liste de lieux propre à Paris ; relie le Codex au skill (combo) |
| 2026-11-07 | Daily Route : 3–5 nœuds génériques (≥ 1 marchand + 1 relais, ≤ 1 forge, espacés de 120 m) à ≤ 500 m du centre de la cellule H3 r8 du joueur, graine (jour, cellule) ; arrêts validés par `/api/move` ; récompense 200 XP + 60 ƒ (+10 ƒ/jour de série, max +30) + 1 Gemini, une fois par jour | Même route pour tout un quartier (social), indépendante de Paris ; ancrée sur la position serveur (pas sur un paramètre client) ; 700 m donnait des arrêts à ~900 m du joueur |
| 2026-11-07 | Cartes partageables 1200×675 en canvas (ticket de crédit, Codex, route) ; Web Share API niveau 2, sinon téléchargement du PNG | Format X ; aucun service tiers, rien ne quitte l'appareil sans geste du joueur |
| 2026-11-07 | `E2E_PORT` (playwright + helpers) : base `var/e2e-<port>.db` | Plusieurs copies du repo lancent l'e2e en parallèle |
