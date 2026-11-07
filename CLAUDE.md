# TokenGo — instructions projet

Jeu géolocalisé **navigateur uniquement** (mobile d'abord) pour le **NEAR HACKATHON**, track `games` (+ `agents`).
On marche dans Paris, on capture des **éclats de calcul**, on les échange avec des **marchands IA** dont les prix
bougent selon l'offre et la demande, et on les **forge** en **vrais crédits d'inférence NEAR AI Cloud**
(Claude, GPT, DeepSeek, Gemini, Qwen…) sur une clé API personnelle.

- **Deadline : 2026-11-14 23:59 UTC.** Jugement 16-18 nov. Démo hébergée à garder en ligne jusqu'au 25 nov.
- **La spec fait foi : `Docs/`** (commencer par `Docs/00-INDEX.md`). Si le code et la spec divergent, corriger l'un ou l'autre
  *et* noter la décision dans `Docs/00-INDEX.md` § Journal des décisions.
- Le propriétaire (solo) a délégué **toutes** les décisions produit/tech à Claude : travailler en autonomie, ne pas poser de
  questions sauf pour ce qui est listé dans « Jamais sans confirmation ».

## Routine de chaque session
1. Lire `Docs/PROGRESS.md` (où on en est), puis `Docs/00-INDEX.md`, `Docs/11-roadmap.md` (jour courant) et `Docs/HUMAN-TODO.md`.
2. Vérifier ce que l'humain a débloqué (`.env`, cases cochées) et activer les vraies intégrations correspondantes.
3. Travailler le jour courant du plan ; en fin de bloc : tests + e2e + captures, puis mettre à jour `Docs/PROGRESS.md`
   (fait / en cours / bloqué / prochaine étape) et le journal des décisions si besoin.

## Posture attendue
- **Dev senior pragmatique** : code simple, lisible, typé, testé. Pas d'abstraction tant qu'il n'y a pas 2 usages réels.
  Pas d'ORM, pas de framework d'état lourd, pas de micro-services. Une fonction pure vaut mieux qu'une classe.
- **Game designer + designer UI** : chaque écran doit être beau, lisible au pouce, avec du feedback « juicy »
  (animations, compteurs qui roulent, sons courts). DA **« Pixel Pop Paris »** : sprites pixel art (palette Sweetie 16, contour encre,
  grilles texte dans `apps/web/src/sprites/`) sur une carte/UI cartoon plat, colorée, de jour. Respecter `Docs/09-ux-ui-design.md`.
  Ne jamais reproduire un personnage existant (la référence `Docs/design-ref/` est un fan-art : style seulement).
- **Vérifier soi-même** : chaque fonctionnalité est testée de bout en bout dans Playwright (viewport mobile, géolocalisation
  simulée) avant d'être déclarée finie. Captures d'écran pour juger le rendu. Ne jamais dire « ça marche » sans l'avoir vu.
- **Sécurité par défaut** : le serveur est autoritaire sur tout (position, spawns, prix, inventaire, crédits).
  Le client n'envoie que des intentions. Le LLM ne décide jamais d'un mouvement de valeur hors des bornes du fichier de règles.

## Stack (détails : `Docs/05-architecture.md`)
- `apps/web` : Vite + React + TypeScript, MapLibre GL, Zustand, Motion. Pas de CSS framework lourd : CSS modules + tokens.
- `apps/server` : Node 24 + TypeScript, Fastify, SQLite (better-sqlite3, SQL écrit à la main), SSE pour le temps réel.
- `packages/shared` : types + **règles d'économie pures** (`economy/rules.ts`) partagées serveur / simulateur / UI.
- `contracts/tokengo-mt` : contrat Rust NEP-245 sur **testnet**.
- Tests : Vitest (règles, anti-triche, API) + Playwright (parcours E2E).

## Commandes (à garder à jour)
```
npm install            # racine (workspaces)
npm run dev            # web :5173 + server :8787  → http://surface:5173
npm test               # vitest
npm run e2e            # playwright
npm run sim -- --days 7 --players 200   # simulateur d'économie (CLI)
npm run verify         # ce que lancera le juge IA : tests + build + e2e smoke (sans secrets)
npm run shots          # captures d'écran clés → docs-assets/
npm run video          # vidéo de démo (Playwright + ffmpeg) → docs-assets/video/
E2E_PORT=8790 npx playwright test --project=full   # e2e sur un autre port (suites en parallèle)
npx playwright test -c playwright.prod.config.ts   # parcours complet sur la démo EN LIGNE (chaîne, burn, Verify) — crée 1 invité
node scripts/submit.ts # valide la soumission (var/submission.json) ; --send = envoi (HUMAIN uniquement)
npm run reconcile      # compare chaîne et SQLite
npm run check:secrets  # aucun secret dans le repo ni l'historique
npm run build-world    # régénère data/world/paris.json depuis data/raw (OSM)
node apps/server/scripts/nearai-spike.ts  # teste NEAR AI réel (< $0.001) une fois NEARAI_AUTH_* dans .env
# Pause Forge : POST /api/admin/forge/pause (Bearer ADMIN_TOKEN)
```

## Jamais sans confirmation explicite de l'humain
- Soumettre au hackathon, poster sur X, rendre le repo public, push / force-push.
- Signer quoi que ce soit sur **mainnet**, dépenser de l'argent réel, recharger le compte NEAR AI.
- Committer un secret. Les clés vont dans `.env` (jamais commité ; `.env.example` à jour).
Testnet, déploiements de démo et crédits NEAR AI déjà alloués au Reserve : autorisés.

## Pièges connus
- Machine « surface » (ARM64, sans écran) : donner les URLs en `http://surface:PORT`, ports < 32768.
  Dans Playwright, utiliser `http://localhost:PORT`.
- La géolocalisation navigateur exige HTTPS (sauf localhost) : la démo publique doit être en HTTPS.
- Base de dev : `var/tokengo.db` (chemin résolu depuis la racine). Avec `.env` chargé, la chaîne est active (comptes `dev-…`) : `FEATURE_CHAIN=0` pour l'éviter.
- E2E : gestes de glisser via CDP `Input.dispatchTouchEvent` et attendre ~700 ms la fin de l'animation des feuilles.
- Settler bloqué avec « Server error » / `LackBalanceForState` : `tokengo.testnet` manque de NEAR **de test** pour le stockage du contrat →
  `node apps/server/scripts/fund-testnet.ts 3` (faucet testnet, +10 NEAR par compte jetable). Le règlement reprend tout seul.
- Budget réel total : **10 €** de crédits NEAR AI. Le Reserve ne doit **jamais** promettre plus que son solde
  (invariant : somme des `spend_limit` restants ≤ solde de l'organisation − marge).
