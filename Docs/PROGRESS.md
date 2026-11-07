# Avancement

Mettre à jour à la fin de chaque bloc de travail. Le plus récent en haut.

## 2026-11-07 (jour) — Jouer partout + Remote Scout
- **Fait** :
  - **Monde « partout »** : un joueur GPS hors de Paris déclenche la génération de son quartier (cellule H3 r7) en fond — Overpass
    (2 miroirs, budget 35 s, User-Agent poli) → même sélection que Paris (code extrait dans `game/worldgen.ts`, `paris.json` reconstruit à
    l'identique), sinon repli procédural déterministe ; persistance `regions` (migration 005), marchands semés comme à Paris, caps
    300/jour et 12/jour/IP. UI : carte « Scouting your neighbourhood… » puis toast « Your neighbourhood is live ». Vérifié en réel à Lisbonne
    (823 POI → 2 forges, 8 marchands, 63 relais ; `node apps/server/scripts/region-spike.ts`).
  - **Remote Scout** remplace Demo Walk : pigeon-coursier à hélice (nouveau sprite), batterie et plafond de vitesse vérifiés par le serveur
    (`economy/scout.ts`, constantes `SCOUT`), badge Scout/Walking + batterie dans le HUD, « Dash » (ex-Jump) avec coût affiché, Splash à deux
    choix (« Remote Scout » / « Play for real · GPS ») + « TokenGo is meant to be played walking — Remote Scout lets you try it from your couch ».
    Récompenses inchangées pour les comptes démo.
  - Tests : 131 unitaires/API (+18 : batterie, génération, fallback, caps, persistance, partie complète à Lisbonne), e2e 20/20
    (nouveau `e2e/anywhere.spec.ts`), `E2E_PORT` pour lancer plusieurs suites en parallèle.
- **Limites connues** : les miroirs Overpass publics sont lents (20–90 s mesurés) → au-delà de 35 s le quartier est procédural (définitif pour
  cette région) ; une r7 en bordure de Paris compte comme « Paris » même si sa partie hors Paris est vide.
- **Prochaine étape** : déploiement HTTPS (GPS réel), tester un vrai quartier hors Paris au téléphone.
## 2026-11-07 — Game feel + raisons de revenir (Codex, Daily Route, cartes partageables)
- **Fait** : passe « juice » sur la capture (combo ressenti : son qui monte, aura/flamme, secousse + confettis PERFECT,
  révélation de variante, XP qui roule, éclat → sac), vibrations par événement + réglage ; Codex de 25 variantes cosmétiques
  (serveur autoritaire, migration `007_codex.sql`, `GET /api/codex`) avec silhouettes, titres, records ; Daily Route
  déterministe par (jour, quartier H3 r8) sur les nœuds génériques du monde, validée par `/api/move`, fête + série ;
  cartes PNG 1200×675 (ticket, Codex, route) via Web Share / téléchargement. `E2E_PORT` pour l'e2e en parallèle.
- **Vérif** : 133 tests unitaires/API, e2e 20/20 (dont `juice.spec.ts`), typecheck, `check:secrets`.
- **Reste** : sons et vibrations à juger sur un vrai téléphone ; la nuit/landmark dépendent du lieu et de l'heure réels.

## 2026-11-07 — Marchandage avec les marchands (mini-jeu de cartes)
- **Fait** : `economy/haggle.ts` (fonctions pures : traits greedy/friendly/proud par archétype, besoin réel du marchand, cartes, patience,
  `haggledQuote` borné ≤ 8 % et jamais sous le plancher de coût Σ mid × (1 ± 1 %), `souredQuote`), constantes `HAGGLE` dans `rules.ts` ;
  serveur `game/haggle.ts` (séance id + TTL 90 s, le client n'envoie que la carte, Deal sous verrou par joueur, règlement partagé avec le trade
  normal via `settleTrade`), `game/relations.ts` + migration `008_haggle.sql` (réputation, bouderie, journal des séances) ; réplique LLM unique
  par séance (plafond 30/jour dans le plafond NPC) ; écran `HaggleGame` (portrait qui réagit, patience, prix qui défile, tampon DEAL!) ;
  simulateur avec 10 % de trades marchandés (santé verte) ; `E2E_PORT` pour les suites parallèles.
- **Tests** : 11 unitaires de bornes (tirages : aucun aller-retour ni boucle fermée rentable, total borné, bouderie jamais favorable),
  7 tests API (rival vrai → Deal appliqué, double Deal concurrent, TTL / mauvaise séance, limites, bouderie, LLM unique et plafonné),
  e2e `haggle.spec.ts` (3 parcours) + captures `haggle-0x`.
- **Prochaine étape** : brancher la réplique LLM sur de vrais crédits quand ils existent (aucun code à changer).

## 2026-11-07 (nuit) — Fin du build : produit complet, vérifié
- **Fait depuis le bloc précédent** : revue sécurité indépendante → 9 correctifs (courses sur les octrois, XFF, Judge Pool réservé aux passes démo,
  tombstones, plafonds SSE…) avec tests de régression ; 18 parcours e2e (capture, marché, PRICE_MOVED, forge, anti-triche, Lab, Pulse SSE,
  sécurité) qui ont révélé et fait corriger 3 bugs (statiques rate-limités, message anti-triche, prix périmés) ; polish design (chiffres jamais
  en pixel, cadrage carte, écran de capture) ; Lab « avec vs sans scénario » (flood : −49 % sur DeepSeek) ; lien juges `?k=` ; `npm run shots` ;
  brouillons de soumission (`Docs/SUBMISSION.md`).
- **État** : `npm run verify` vert (113 unitaires + smoke), `npm run e2e` 18/18, `check:secrets` vert. Démo locale : http://surface:5173.
  Commits locaux non poussés (le push automatique a été refusé par le garde-fou : à faire par l'humain, `git push`).
- **Reste (humain)** : hébergement (Railway prêt : voir `Docs/SUBMISSION.md`), crédits réels NEAR AI (HUMAN-TODO 1–3, puis
  `node apps/server/scripts/nearai-spike.ts`), Google OAuth (après l'URL finale), repo public, vidéo + post X, soumission avec « oui ».
- **Reste (Claude, si on lui redonne la main)** : brancher les vrais identifiants dès qu'ils existent, déployer, tests GPS réels, P2 (Beacons, Daily Route, Codex, Intents dry-run).

## 2026-11-06 (soir) — Build J1→J6 en une session (autonomie totale)
- **Fait** :
  - J1 : monorepo (npm workspaces, TS 7, Vitest, Playwright), `rules.ts` + fonctions pures (prix, marchands, forge, réserve, spawns, capture, agent, anti-triche), monde Paris (`data/world/paris.json` : 1 060 relais, 153 marchands, 10 forges), contrat NEP-245 déployé sur `tokengo.testnet`.
  - J2–J4 : serveur Fastify autoritaire (SQLite, sessions, Origin/CSP, rate limits, quotas) ; boucle complète capture → relais → marchand → First Compile → clé + playground ; simulateur + réglage de l'économie (toutes les cibles de santé vertes, seeds 42/1/2/3, 7 et 14 j).
  - J5 : settler on-chain par lots + preuve de burn synchrone, sous-comptes paresseux, reconcile, Proofs ; NEAR AI Cloud réel (NEP-413, clés à plafond, cerveau des marchands borné, salutations) codé contre la source de cloud-api (pas encore testé faute d'identifiants) ; 24 runners-agents ; Google OAuth derrière flag.
  - J6 : front complet (carte cartoon, sprites pixel codés, tutoriel Margot, marchand, forge, crédits, Pulse SSE, Economy Lab en Web Worker depuis l'état réel, Proofs avec vérif RPC navigateur, profil/classements, About) ; illustrations via Codex imagegen ; Dockerfile + railway.json ; README.
  - Vérif : `npm run verify` vert (100 tests unitaires + e2e du parcours complet, gestes tactiles réels via CDP) ; `check:secrets` vert.
- **En cours** : passe de polish design (chiffres lisibles, cadrage carte, écran de capture), specs e2e restantes, revue sécurité indépendante.
- **Bloqué par l'humain** : crédits réels (HUMAN-TODO 1–3) ; hébergement (Railway prêt, choix « plus tard » du propriétaire) ; Google OAuth (après l'URL finale).
- **Prochaine étape** : intégrer revue sécurité + e2e, polish, puis J7 (checklist sécurité, perf carte, captures `npm run shots`) et J8 (vidéo/post/soumission avec confirmation).

## 2026-11-06 — Spec (session de cadrage)
- **Fait** : recherche hackathon (règles, track games, jury, soumission), recherches techniques vérifiées (NEAR AI Cloud gestion des clés + auth NEP-413,
  NEP-245/near-kit/cargo-near, login social, carte/OSM/H3/hébergement), spec complète `Docs/01…12` (révisée après une relecture critique indépendante : économie, exploits, périmètre), `HUMAN-TODO.md`, `CLAUDE.md`, mémoire.
  Données Paris brutes dans `data/raw/` (POI OSM + arrondissements).
- **Repo** : https://github.com/ebenbaruk/TokenGo (privé, branche `main`, commit initial = spec). Push autorisé par l'humain pour ce repo privé ; le rendre public reste soumis à confirmation.
- **Pas encore fait** : aucun code.
- **Prochaine étape** : J1 de `11-roadmap.md` (monorepo, règles d'économie + tests, spikes NEAR AI et NEAR, build-world Paris).
- **Bloqué par l'humain** : voir `HUMAN-TODO.md` (1–5). Démarrer en mode dégradé.
