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
  = 2 + (numéro de jour mod 3), politique : prend le meilleur modèle dispo pour l'épreuve, technique la plus rentable dans son budget.
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
