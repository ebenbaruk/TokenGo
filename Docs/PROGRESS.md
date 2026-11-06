# Avancement

Mettre à jour à la fin de chaque bloc de travail. Le plus récent en haut.

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
