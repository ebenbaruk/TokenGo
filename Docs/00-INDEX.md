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
| 2026-11-06 | Coupes : Beacons, Daily Route, Codex, districts complets, Intents, boussole, partout → P2 ; Aura en P1 ; simulateur avancé au J2 | Périmètre réaliste pour 8 jours en solo |
