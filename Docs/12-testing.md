# 12 — Stratégie de test

## Unitaires (Vitest, `packages/shared` & `apps/server`)
- **Économie** : prix (rareté bornée, glissement monotone par unité, buy < sell), faillite → closing → closed → réouverture, NAV et parts
  (investir puis retirer immédiatement = perte de 5 % exactement, dividendes conservent la valeur), contrats, dérive P0 bornée.
- **Réserve** : invariant de solvabilité (property test : séquences aléatoires de compiles/usages ne le violent jamais), rendement géométrique,
  caps joueur/global, min payout, pools séparés.
- **Spawns** : déterminisme (même seed/cellule/fenêtre → mêmes spawns), distribution (sur 10 000 tirages, familles ≈ poids ± 2 %), affinités, `h`.
- **Anti-triche** : vitesse, transit, saut suspect, retour d'arrière-plan, distance d'action avec précision, plafond de perfect, proof of walk.
- **Agent** : clamps (valeurs hors bornes, champs manquants, JSON invalide → fallback), variation ≤ 30 %.
- **Simulation** : 7 jours × 200 bots, seed fixe → résultat identique ; aucune valeur NaN/négative ; critères de santé de `03` §8.
- **API** (Fastify `inject`) : chaque route, codes d'erreur, rate limits, Origin check, sessions.
- **Contrat** : tests Rust (`cargo test`) : operator only, settlement idempotent, burn > solde refusé, events.

## E2E (Playwright, `e2e/`, viewport 390×844, géolocalisation simulée, serveur lancé sur une DB temporaire, `FEATURE_REAL_CREDITS=0`)
1. `onboarding.spec` : guest → tutoriel complet → First Compile → clé simulée visible → playground répond.
2. `catch.spec` : marcher (setGeolocation par pas de 10 m) vers un éclat → capture → inventaire +1 ; trop loin → message.
3. `market.spec` : vendre/acheter, tooltip « Why this price? », PRICE_MOVED géré, marchand fermé non utilisable.
4. `forge.spec` : recette incomplète désactivée avec raison ; complète → compile → ticket.
5. `anticheat.spec` : téléportation 5 km → actions bloquées + message neutre.
6. `lab.spec` : simulate 1 week → graphes remplis, ≥ 1 événement faillite dans le scénario flood.
7. `pulse.spec` : ticker reçoit un événement SSE après un trade.
8. `security.spec` : en-têtes CSP, cookie `HttpOnly/Secure/SameSite`, POST sans Origin valide → 403.
Captures d'écran à chaque étape clé dans `e2e/__shots__/` (revues à l'œil par Claude, pas de diff pixel strict).

## Vérification manuelle par Claude (avant de dire « fini »)
- Playwright MCP sur `http://localhost:5173` : parcours complet, console sans erreur, réseau sans 4xx/5xx inattendus.
- Mobile 390×844 et 412×915. `prefers-reduced-motion`. Réseau lent (throttling) pour les états de chargement.

## `npm run verify` (pour le juge IA)
`npm ci && npm test && npm run build && npm run e2e -- --project=smoke` → sortie claire « ✔ TokenGo verified: N unit tests, M e2e flows ».
