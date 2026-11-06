# 11 — Plan de build (2026-11-07 → 2026-11-14)

Règle : **toujours avoir une version jouable de bout en bout**, puis l'enrichir. Chaque bloc se termine par : tests verts, parcours e2e
principal vert, captures d'écran revues, commit local (git init au J1), mise à jour de `Docs/PROGRESS.md` (et du journal des décisions si besoin).
Priorités : **P0** = sans ça on ne soumet pas · **P1** = fait la différence · **P2** = seulement s'il reste du temps.

## J1 — 7 nov · Fondations + risques levés
- P0 `git init`, monorepo (npm workspaces), TS strict, Vitest, Playwright, scripts `dev/test/e2e/sim/verify/check:secrets`.
- P0 Vérifier les versions (`05` §3 « À vérifier J1 ») en installant réellement.
- P0 `packages/shared/economy/rules.ts` + pricing / forge / reserve / spawns / progression en fonctions pures + tests.
- P0 **Spike NEAR AI** : signature NEP-413 → `POST /v1/auth/near` → créer une clé de test → PATCH limite → révoquer. Sans `NEARAI_AUTH_*` :
  coder contre la spec, `SimulatedCredits`, et rappeler `HUMAN-TODO` 1-2.
- P0 **Spike NEAR** : `cargo-near`, `near-cli-rs`, `rustup target add wasm32-unknown-unknown` ; compte `tokengo.testnet` (faucet) ; contrat minimal
  déployé ; appel via near-kit depuis Node.
- P0 `build-world.ts` (Relays, Markets, Forges, districts, affinités) → `data/world/paris.json` + test. 2ᵉ requête Overpass (marchands).
## J2 — 8 nov · Boucle 30 s jouable + simulateur
- P0 Serveur : Fastify, SQLite + migrations, sessions (cookies dev/prod), invité, `/api/me`, `/api/move` + anti-triche, `/api/world`, spawns, catch.
- P0 Web : carte MapLibre stylée, avatar + traînée, géoloc + Demo Walk (tap-to-walk 30 km/h + Jump), éclats, mini-jeu, HUD, inventaire.
- P0 **Simulateur CLI** (`sim.ts`, bots, scénarios) : on règle l'économie **tôt** (cibles de santé de `03` §8).
- P0 E2E : invité → démo → capture (assertions sur le DOM et l'état exposé `window.__tg`, pas sur le canvas WebGL).
## J3 — 9 nov · Boucle 5 min
- P0 Relays, marchands (prix, devis, trade, « Why this price? », comparateur), jobs (imports, exports, loyer, faillite, dérive de P0, ticks).
- P0 Objectif épinglé (« Spark @ Louvre 4/6 … »).
- P1 Contrats (anti-farm). P1 Google OAuth (arctic) derrière un flag si `GOOGLE_*` est disponible, + proof of walk.
## J4 — 10 nov · Forge & crédits réels
- P0 Forges + recettes du jour (Spark, Prism ; Aura en P1), compile → burn → octroi (`CreditsProvider` réel ou simulé), pools, invariant avec overshoot.
- P0 Écrans Forge (animation) et Credits (clé, reveal/copy, usage, équivalences) + Playground (streaming, `max_tokens` borné).
- P0 Tutoriel → First Compile (gating capture + sync + trade).
## J5 — 11 nov · Chaîne & agents
- P0 Contrat NEP-245 complet + tests ; settler par lots (événements agrégés) ; comptes paresseux ; burn de Forge synchrone avec flush ; Proofs.
- P0 Cerveau des marchands (réflexion bornée, fallback, journal, ≤ 150 appels/jour) + salutations.
- P1 Runners-agents (24 bots en continu). P1 Sauvetage des marchands (Patron).
## J6 — 12 nov · Monde vivant + mise en ligne
- P0 Economy Lab (Web Worker, graphes, scénarios). P0 Pulse (SSE + heartbeat, ticker, index, réserve, on-chain).
- P0 Déploiement HTTPS (Funnel, ou Fly si l'humain accepte) + service systemd + surveillance `/healthz` ; test GPS réel par l'humain si possible.
- P1 Onboarding complet à bulles ; classement simple des districts.
## J7 — 13 nov · Polish & robustesse
- P0 Passe design écran par écran (2 tailles, états vides / erreur / chargement), sons, haptique, micro-animations, PWA manifest.
- P0 Checklist sécurité (`08` §6), `/code-review`, `/security-review`, perf carte.
- P0 README final, `npm run verify`, `npm run shots`.
- P2 Aura si pas fait, Beacons, Daily Route, Codex, districts complets, Intents dry-run (`/reserve`), « Export my NEAR account », `WORLD_ANYWHERE`, boussole.
## J8 — 14 nov · Livraison (deadline 23:59 UTC = 00:59 à Paris le 15)
- P0 Vidéo (script `10` §4), brouillons du post X et du champ `idea`, soumission **avec confirmation humaine**. Viser une soumission avant 18:00 UTC.
- Gel des fonctionnalités à 12:00 UTC ; ensuite, uniquement des corrections de bugs.

## Plan de coupe (si retard, couper dans cet ordre)
1. Tous les P2.
2. Les runners-agents (remplacés par 4–6 trades scriptés par heure pour que les prix bougent).
3. Les contrats.
4. Le sauvetage des marchands (garder la faillite visible).
5. Google OAuth : invité seul ; le Main Pool reste inutilisé et le Judge Pool couvre la démo.
6. La chaîne en continu : garder le contrat déployé, le burn de Forge on-chain et quelques settlements démontrables.

**Ne jamais couper** : la boucle capture / marchand / forge, les crédits réels (au moins la First Compile et le Judge Pool), l'Economy Lab,
le README vérifiable, le mode sans secrets.

## Mode de travail (autonomie)
- Paralléliser avec des sous-agents les chantiers indépendants (ex. contrat Rust et UI), avec des briefs précis et des fichiers séparés ;
  intégrer et revoir soi-même. Workflows multi-agents autorisés par le propriétaire pour la revue de code, les passes e2e et la revue design.
- Après chaque fonctionnalité : test unitaire, e2e, puis capture d'écran examinée. Corriger avant de passer à la suite.
- Ne pas attendre l'humain : ses actions sont dans `HUMAN-TODO.md` et un mode dégradé existe en attendant.
