# Avancement

Mettre à jour à la fin de chaque bloc de travail. Le plus récent en haut.

## 2026-11-07 (après-midi) — Playtest « juge » et polish UX
- **Fait** : cadre de téléphone + panneau d'explication sur ordinateur (Remote Scout en premier sans écran tactile) ; « Fly there » et objectif
  cliquable en Remote Scout (plus de bouton mort) ; tutoriel qui ne fait plus vendre l'éclat de la First Compile ; Splash (3 étapes, boutons
  sur une ligne, badge Judge pass) ; About (« Play in 5 minutes », « Two ways to play ») ; relais au tap, anneau de capture visible, objectif
  sur 2 lignes, réponse du Playground dans la vue, plus de « wallet » dans la boucle. Décisions dans `00-INDEX.md`.
- **Vérif** : typecheck, `npm test` 206/206, build, `E2E_PORT=8797 npx playwright test --project=full` 28/28, `check:secrets` vert.
- **Reste** : marcheurs/bulles à juger sur vrai téléphone ; QR code vers la démo dans le panneau ordinateur une fois l'URL publique connue.

## 2026-11-07 (soir) — Intégration des 4 fonctionnalités dans `main`
- **Fait** : merges « Jouer partout + Remote Scout » puis « Carte vivante » par-dessus « juice/Codex/Daily Route » et « marchandage ».
  `/api/move` = batterie du Scout (vol refusé : rien d'autre) → présence anonymisée (`seen_cell`) → arrêts de Daily Route ; `/api/world` =
  route + événement + statut de région ; `/api/walkers` remplace les runners de `/api/world`. Événements de ville appliqués aussi au
  marchandage (`pricingFor`, même P0 que le devis) ; `PRICE_MOVED` du marchandage sur tout changement de total. HUD iPhone désencombré
  (Daily Route en bas à gauche, le haut reste aux alertes : au sol, repérage, événement). Événement de Paris masqué à > 25 km.
  Overpass : procédural jouable après 8 s, vraie carte OSM qui remplace le quartier en fond s'il est frais (`regionFresh`, < 15 min, aucun
  lien joueur ↔ lieu) ; client qui réinterroge tant que `region.upgrading`. Migrations 005/006 appliquées sur une base déjà en 007/008 (test).
- **Vérif** : typecheck ; `npm test` 206/206 (+ `db.test.ts` migrations, `regions-upgrade.test.ts` remplacement OSM et règle `regionFresh`,
  marchandage pendant un flash crash) ; build ; `E2E_PORT=8790 npx playwright test --project=full` 28/28 (anti-triche rendu indépendant de
  la fenêtre de spawn) ; passe manuelle iPhone 14 : Remote Scout, combo ×2, bulles, flash crash admin + marchandage, Daily Route, GPS à
  Lisbonne (procédural immédiat puis « Real map loaded », 73 nœuds OSM) ; `npm run verify`, `check:secrets`.
- **Reste** : vrai test GPS hors Paris au téléphone (HTTPS) ; marchandage parfois « rock-bottom » sur les éclats à bas prix (attendu : plancher Σ mid).

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
- **Limites connues** : les miroirs Overpass publics sont lents (20–90 s mesurés) → voir l'intégration : procédural après 8 s, remplacé par OSM
  en fond tant que le quartier est frais ; une r7 en bordure de Paris compte comme « Paris » même si sa partie hors Paris est vide.
- **Prochaine étape** : déploiement HTTPS (GPS réel), tester un vrai quartier hors Paris au téléphone.

## 2026-11-07 (soir) — « Banger pass » : jouer partout, carte vivante, marchandage, juice, vidéo, soumission prête
- **Contexte** : le propriétaire a testé (« pas mal »), veut un jeu « banger », **track games uniquement**, et n'avoir plus qu'à soumettre.
- **Fait** (4 chantiers en parallèle + intégration + revue sécurité + playtest « juge ») :
  jouer partout en vrai GPS (régions OSM/Overpass générées autour du joueur, repli procédural en 8 s puis remplacement par les vrais
  lieux si la région est encore vierge) ; **Remote Scout** (pigeon, batterie serveur) qui remplace Demo Walk et explique la marche réelle ;
  carte vivante (marcheurs, bulles des marchands, événements de ville bornés) ; **marchandage** (cartes, ±8 % max, plancher de coût) ;
  juice (combo, haptique, sons), **Codex** 25 variantes, **Daily Route**, cartes PNG à partager ; ordinateur : cadre de téléphone +
  QR « joue sur ton téléphone » ; 3 failles corrigées (ancrage des régions, /64 IPv6, confidentialité des marcheurs) ;
  **vidéo de démo** 83 s (paysage + portrait, `npm run video`) ; README track games + disclosure ; `scripts/submit.ts` ; image Docker testée en prod.
- **Vérif** : 211 tests unitaires, e2e 28/28 (deux passes), `npm run verify` vert, `check:secrets` vert, conteneur prod OK (pass juge niveau 7).
- **Reste (humain, ~45 min, `Docs/SUBMISSION.md`)** : Railway (+ volume `/data`, variables), crédits NEAR AI réels (facultatif mais
  recommandé ; si fait, `npm run video` re-filme avec de vrais crédits), repo public + tag, post X avec la vidéo, `node scripts/submit.ts --send`.

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

## 2026-11-07 (jour) — Carte vivante
- **Fait** : marcheurs animés sur la carte (24 runners-agents au trajet réel à 5 km/h, étiquette au tap avec leur dernière action ;
  joueurs réels anonymisés : cellule H3 ± 60 m, sans nom), `GET /api/walkers` (≤ 12, 30/min) ; bulles de BD des marchands dérivées
  de leur état (≤ 3, sans chevauchement ni HUD) ; événements de ville bornés dans `rules.ts` (flash crash, forge hype, gold rush,
  grève) : zone + bannière + jingle + Pulse, prix via `explainPrice`/`quote` (« Why this price? » le cite), vague bonus d'éclats,
  planification par les jobs (≤ 6/j), `POST /api/admin/event` (+ `/end`) ; simulateur avec événements (cibles vertes, graines 42/1/2/3).
  Migration `006_living.sql`. Correctifs au passage : caméra qui s'arrêtait avant la fin d'une Demo Walk ; devis exécuté à un autre
  prix que celui affiché (maintenant `PRICE_MOVED`).
- **Vérif** : `npm test` 142/142, typecheck, `E2E_PORT=8792 npx playwright test --project=full` 21/21 (dont `living.spec.ts` 3/3), `check:secrets` vert.
- **Prochaine étape** : montrer un événement dans la vidéo (`POST /api/admin/event` avec `ADMIN_TOKEN`), tester les marcheurs avec de vrais téléphones.

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
