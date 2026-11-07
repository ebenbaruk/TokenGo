# 13 — Arène des modèles, Décodage et Maîtrise (« combat pass », 2026-11-08)

Retour de playtest (propriétaire + amis hackers) : « le projet est très bien, mais il manque des mécaniques de jeu : une arène,
une vraie action quand on récupère un éclat, des combats qui ont du sens et un lien avec l'IA ». Réponse : les éclats ne sont plus
seulement une marchandise, ce sont des **modèles d'IA avec une personnalité de combat**. Trois ajouts, un seul univers :

1. **Décodage (« Next token »)** — un 2ᵉ temps de capture, court, qui parle d'IA.
2. **Arène des modèles** — combats tactiques 3 contre 3 aux Forges, avec un **Champion** par arène (contrôle de territoire asynchrone).
3. **Maîtrise** — chaque famille progresse (niveau 1–10) en capturant et en combattant : la collection a un but.

Tout est **serveur-autoritaire, déterministe (graine HMAC), borné** ; les constantes vont dans `packages/shared/src/economy/rules.ts`
(section ARENA / DECODE / MASTERY), les formules en fonctions pures testées (`packages/shared/src/economy/arena.ts`, `decode.ts`).

---

## 1. Catégories d'épreuves et profils des modèles

Six catégories, celles qu'on utilise pour comparer des LLM dans la vraie vie :

| id | Nom | Icône |
|---|---|---|
| `math` | Math | 🧮 |
| `code` | Code | 💻 |
| `writing` | Writing | ✍️ |
| `vision` | Vision | 👁 |
| `speed` | Speed | ⚡ |
| `lang` | Languages | 🌐 |

Profils (1–10, ludiques, inspirés de la réputation publique des familles — **pas** des benchmarks officiels, à dire dans l'UI « game stats ») :

| Famille | math | code | writing | vision | speed | lang | Style |
|---|---|---|---|---|---|---|---|
| Claude | 7 | 9 | 10 | 7 | 5 | 8 | l'écrivain-codeur, lent mais brillant |
| GPT | 8 | 8 | 8 | 9 | 6 | 8 | le polyvalent |
| Gemini | 7 | 7 | 7 | 10 | 7 | 9 | l'œil, contexte long |
| DeepSeek | 9 | 8 | 6 | 4 | 8 | 6 | le matheux pas cher |
| Qwen | 7 | 7 | 6 | 6 | 9 | 10 | le rapide polyglotte |

Les Communs (DeepSeek, Qwen) sont des **spécialistes** redoutables : une équipe de Communs bien jouée bat une équipe de raretés mal jouée.

## 2. Maîtrise (par joueur et par famille)

- XP de maîtrise : +5 par capture de la famille, +5 bonus si Décodage réussi, +10 par manche d'arène jouée avec la famille, +10 si gagnée.
- Niveau `m` (1–10) : seuils `[0, 30, 80, 150, 250, 400, 600, 850, 1150, 1500]`.
- Effet en arène : puissance × `(1 + 0.04 × (m − 1))` (max +36 % au niveau 10).
- Affichage : Sac › chaque famille montre « Mastery m » + barre ; Codex aussi. Une montée de niveau = toast + son.

## 3. Décodage « Next token » (2ᵉ temps de capture)

- Après un Lock-on réussi (good/perfect) :
  - **Rare (GPT) et Épique (Claude)** : le Décodage est **obligatoire**. Bonne réponse → capturé. Mauvaise réponse ou délai dépassé → l'éclat
    « hallucine » et peut fuir (même probabilité que `fleeAfterMiss`), sinon on retente le Lock-on (même compteur d'essais).
  - **Commun / Peu commun** : Décodage **bonus facultatif** affiché après la capture (bouton « Decode bonus », 1 tap pour passer) :
    bonne réponse → +5 XP, +5 maîtrise, et +1 cran de chance de variante (pas d'éclat en plus : aucune inflation).
- Écran : une phrase à compléter + 3 jetons (« tokens ») en gros boutons, **4 s** (5 s pour l'épique, le texte est plus long), barre de temps.
- Banque de questions **par famille** (le style de la famille) : DeepSeek = suites et calcul (« 2, 4, 8, 16, ___ »), Claude = écriture
  (« Roses are red, violets are ___ »), GPT = culture générale, Gemini = emoji/vision (« 🐱 + 🏠 = ___ »), Qwen = langues
  (« Bonjour → ___ »). ≥ 15 questions par famille, en anglais, sans ambiguïté, rien de sensible. Fichier `packages/shared/src/decode-bank.ts`.
- Anti-triche : le serveur choisit la question (graine HMAC(spawn, user, essai)), envoie le texte + 3 choix **mélangés avec des ids opaques**
  et garde la bonne réponse ; la réponse est validée côté serveur avec le délai mesuré côté serveur (+1 s de tolérance réseau).

## 4. Arène des modèles

### Où
- **Chaque Forge est aussi une Arène** (10 à Paris, 1–2 par région générée ailleurs). L'écran de la Forge a deux onglets : **Forge | Arena**.
- Sur la carte, une Forge tenue par un joueur porte une **couronne** + le nom du Champion ; tenue par le Gardien (PNJ), un bouclier.

### Format d'un combat (≈ 60–90 s)
- On aligne **3 familles différentes** dont on possède ≥ 1 éclat (les éclats ne sont **pas** consommés).
- **5 épreuves** tirées au début (graine), révélées une par une. Premier à 3 manches gagnées ; égalité 2–2 après 5 (impossible avec 5
  manches sauf nulles) → total des puissances.
- À chaque manche le joueur choisit **un modèle** + **une technique de prompt** ; l'adversaire choisit en même temps (politique serveur).
- **Rate limit** : un modèle qui vient de jouer est « rate-limited » la manche suivante (il faut faire tourner l'équipe).
- **Budget de tokens** : 10 par combat. Techniques :

| Technique | Coût | Effet |
|---|---|---|
| Zero-shot | 0 | ×1.0 |
| Chain-of-thought | 3 | ×1.5 en math/code, ×1.15 ailleurs ; risque d'hallucination ÷2 |
| Few-shot | 2 | ×1.3 en writing/lang ; variance réduite de moitié |
| Tool use | 2 | +3 puissance en math/vision/code (après multiplicateur) |
| High temperature | 1 | ×1.4 en writing, sinon ×1.0, variance ×2, risque d'hallucination ×2 |

- **Puissance** = `stat[catégorie] × maîtrise × technique × (1 + variance)`, variance ∈ ±12 % (graine), arrondie à 0,1.
  **Hallucination** : 8 % de base → puissance × 0,3 (affiché « hallucinated! »).
- Bonus d'arène : la Forge a ses affinités (ex. Louvre = Gemini & Claude) → +10 % pour ces familles des deux côtés.

### Adversaires
- **Gardien** (PNJ, toujours là si pas de Champion) : « Sentinel of <Forge> », équipe déterministe (graine jour + forge), maîtrise
  = 1 + (numéro de jour mod 2) (réglé par simulation : ~40–50 % de victoires pour une équipe neuve jouée mécaniquement), politique : prend le meilleur modèle dispo pour l'épreuve, technique la plus rentable dans son budget.
- **Champion** (joueur) : son équipe et sa maîtrise sont **figées** au moment où il prend l'arène ; c'est un « fantôme » qui joue avec
  la même politique que le Gardien. Battre le Champion → on devient Champion.
- On ne peut pas défier sa propre arène. Un Champion qui n'a pas joué depuis 48 h est remplacé par le Gardien.

### Récompenses (bornées)
| Résultat | XP | Flux | Autre |
|---|---|---|---|
| Victoire contre le Gardien | 60 | 20 | — |
| Victoire contre un Champion | 100 | 30 | devient Champion, annonce sur le ticker Pulse |
| Défaite | 15 | 0 | — |
| Champion en place | — | +4 ƒ / 10 min tenues | max 240 ƒ / jour / joueur, versé à la défaite ou à la consultation |

- Frais d'entrée : **10 ƒ** (puits de Flux). Limite : **12 combats / joueur / jour de Paris**.
- Débloqué au **niveau 2** (comme le commerce). Remote Scout : peut combattre (récompenses identiques, Flux uniquement — aucun lien avec la Réserve).
- Rien ne touche la Réserve ni les crédits réels.

### Lien avec l'IA (récit)
- Chaque épreuve a un énoncé concret (« Write a haiku about the Seine », « Find the bug in 12 lines of Python », « What is in this
  photo? 🗼🌧 ») et la résolution produit une **ligne de commentaire** générée par gabarits (« Claude's haiku even rhymed — Gemini
  over-explained the rain. »). Avec NEAR AI actif, la ligne finale du combat peut être écrite par le cerveau des marchands (budget NPC),
  sinon gabarits — même interface que le marchandage.

### API
- `GET /api/arena/:forgeId` → arène (champion ou gardien, son équipe visible, mes familles disponibles + maîtrise, combats restants).
- `POST /api/arena/:forgeId/start { team: Family[3] }` → `{ battleId, challenges: [premier seulement], opponent, tokens }` (vérifie
  distance comme la Forge, niveau, frais, quota).
- `POST /api/arena/battle/:battleId/play { family, technique }` → résultat de la manche (choix adverse, puissances, commentaire,
  score) + épreuve suivante ou résultat final (récompenses, nouveau champion).
- Persistance : tables `arenas (forge_id, champion_user, team JSON, mastery JSON, since, last_paid)`, `battles (id, user_id, forge_id,
  seed, team, opp, state JSON, status, created_at)`, `mastery (user_id, family, xp)`. Migration `009_arena.sql` (+ `010_decode.sql` si besoin).

## 5. Boucle de jeu complète (après ce pass)

marcher → **capturer (Lock-on + Décodage)** → monter la **maîtrise** → **combattre** à une Forge-Arène / devenir **Champion** et
défendre son quartier → gagner Flux/XP → commercer / marchander → compiler à la Forge → crédits IA. Chaque verbe nourrit les autres.

---

# Vague 2 (2026-11-08) — jouer ensemble, revenir chaque jour

## 6. Raid « Rogue Model » (boss coopératif de ville)

- **Quoi** : un modèle d'IA devenu incontrôlable (« rogue ») apparaît sur une Forge. Toute la ville se bat contre lui en même temps ;
  une barre de vie commune descend en direct (SSE) sur la carte, l'écran de la Forge et `/pulse`.
- **Noms** (gabarits, rien d'existant) : *GL1TCH-9*, *Overfit Prime*, *The Hallucinator*, *Loop.exe*, *Token Hydra*. Sprite pixel
  « glitché » (grille texte, palette Sweetie 16, contour encre), aura rouge/cyan.
- **Déclenchement** : nouveau type d'événement de ville `rogue` (un seul événement de ville à la fois, comme les autres), 2 fois par jour
  au plus en automatique, + admin `POST /api/admin/event { kind: 'rogue' }`. Durée 45 min. Forge choisie près de l'activité récente.
- **PV** : `800 + 120 × joueurs actifs dans la dernière heure` (borné 800–6 000).
- **Faiblesse** : une catégorie (Math, Code…) tirée par tranche de 10 min (graine), affichée en gros : ×1,5 dégâts dans cette catégorie.
  Le boss résiste à une autre catégorie (×0,6).
- **Attaque** : à ≤ rayon Forge, `POST /api/raid/:eventId/attack { team: Family[3] }` → **un assaut de 3 manches** joué avec le
  moteur de l'Arène (mêmes techniques, budget 6 tokens, rate limit) contre l'équipe du boss (maîtrise 3). Dégâts = somme de mes
  puissances (×faiblesse/résistance), manches gagnées ×1,5. Format API : start renvoie l'assaut, `POST /api/raid/assault/:id/play`
  joue une manche, comme l'Arène. **3 assauts max par joueur et par raid** ; gratuit (pas de frais).
- Les **runners** (bots) attaquent aussi de temps en temps (dégâts modestes) : le boss tombe même avec peu de joueurs, mais les vrais
  joueurs font la différence.
- **Victoire** (PV = 0 avant la fin) : chaque participant reçoit 80 XP + 30 ƒ + maîtrise +20 sur les familles utilisées ; **top 3** des
  dégâts : +40 ƒ ; un titre Codex « Rogue Slayer » au premier raid gagné. Annonce ticker. **Échec** (temps écoulé) : 20 XP de
  consolation. Aucun éclat créé, rien ne touche la Réserve.
- UI : bannière d'événement « ⚠ ROGUE MODEL at Louvre — 3 120 / 4 400 HP — weak to ✍️ Writing », marqueur glitché animé sur la
  carte, onglet **Raid** dans l'écran de la Forge pendant l'événement (barre de PV, faiblesse, classement des dégâts en direct,
  bouton « Attack »), écran d'assaut = écran de combat de l'Arène avec la barre de PV du boss au lieu du score, chiffres de dégâts
  qui volent. Écran de fin collectif (« The city contained Overfit Prime! » + ta part des dégâts).

## 7. Missions du jour

- 3 missions par joueur et par jour de Paris, tirées (graine jour + joueur) dans une liste : *Decode 3 tokens*, *Win an arena battle*,
  *Catch 3 different families*, *Close a haggle deal*, *Sync 4 relays*, *Hit a ×3 combo*, *Play 5 arena rounds*, *Visit 2 shops*,
  *Deal 200 raid damage* (seulement si un raid est en cours), *Catch a Night or Landmark variant*. Au moins une mission « Arène/Décodage ».
- Chaque mission : +40 XP + 15 ƒ. Les 3 → **coffre du jour** : +60 ƒ + 1 Gemini (comme la Daily Route — 1 éclat/jour max, borné).
- Suivi serveur par compteurs incrémentés aux bons endroits (capture, décodage, arène, marchandage, relais, raid). Réclamation
  explicite (bouton « Claim ») → petite célébration.
- UI : en haut de la feuille **Quests**, 3 cartes avec barre de progression ; pastille rouge sur le bouton Quests quand une mission est
  réclamable. Toast « Mission complete! » au moment où le compteur atteint l'objectif.

## 8. Contrôle de la ville

- `/pulse` et la feuille Quests montrent **« Who holds the city »** : la liste des Forges-Arènes avec leur Champion (ou Gardien),
  depuis combien de temps, et un classement **Top Champions** (temps de détention cumulé sur 7 jours).
- Sur la carte, les couronnes portent la **couleur du district** du Champion (s'il en a choisi un) → les quartiers se disputent Paris.
