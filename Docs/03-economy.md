# 03 — Économie

Source unique du code : `packages/shared/src/economy/` (fonctions **pures**, sans I/O, déterministes à graine égale).
Utilisée par : le serveur (vérité), le simulateur (`npm run sim`, Economy Lab) et l'UI (tooltips « Why this price? »).
Ce fichier = la référence lisible demandée par la track (« merchant pricing rules live in one readable file »).
Le fichier `rules.ts` doit rester lisible par un humain : constantes nommées, commentaires courts, pas de magie.

## 1. Les deux couches de valeur
| Couche | Unité | Où | Convertible ? |
|---|---|---|---|
| **Jeu** | Éclats (5 familles) + Flux ƒ | NEP-245 testnet + miroir SQLite | Entre eux, via les marchands |
| **Réel** | USD de crédits NEAR AI Cloud (nano-USD) | Solde de l'organisation NEAR AI du jeu | **Une seule porte : la Forge** (brûle des éclats → crédits) |

Flux n'est **jamais** convertible en réel. Seules les recettes de Forge, qui exigent des éclats de plusieurs familles et lieux,
créent de la valeur réelle. C'est ce qui protège la Réserve tout en rendant le marché utile.

## 2. La Réserve (argent réel, budget total 10 € ≈ $11.5)
Le solde est lu sur NEAR AI Cloud (`GET /v1/organizations/{org}/usage/balance` → `remaining`, nano-USD) toutes les 5 min.

Partition logique (config `RESERVE_PARTITION`, en $). Colonne « +$10 » = répartition supplémentaire si l'humain réclame les $10 NEAR Builders.
| Poche | Initial | +$10 | Usage |
|---|---|---|---|
| **Main Pool** | 4.50 | +6.00 | Compilations des joueurs vérifiés (Google + proof of walk) |
| **Welcome Pool** | 2.00 | — | « First Compile » ($0.03, une fois par compte, invités compris) **seulement après** 1 capture + 1 sync + 1 trade ; max **4 octrois/heure au global** |
| **Judge Pool** | 1.50 | +2.00 | Ouvert du 16 au 18 nov (et sur `DEMO_TOKEN`) : compilations des invités/démo (cap $0.20 par compte) pour que les juges voient de vrais crédits même si le Welcome Pool est vide |
| **NPC Brain** | 1.00 | — | Appels LLM des marchands (≤ 150 appels/jour, salutations comprises) |
| **Safety margin** | 2.50 | +2.00 | Absorbe les dépassements de clés (vérif NEAR AI a posteriori) |
Total ≈ $11.5. Invités au-delà de la First Compile (hors Judge Pool) : la compilation réussit mais paie **XP seulement**, avec le message
« Sign in with Google and walk 1.5 km to earn real credits ».

**Invariant de solvabilité (testé, vérifié à chaque octroi, alerte sinon)** :
```
Σ_joueurs (spend_limit − usage)  +  OVERSHOOT × nb_clés_actives  +  NPC_budget_restant  +  safety_margin   ≤   org.remaining
OVERSHOOT = $0.05   (dépassement possible d'une requête en vol par clé)
```
Le solde org **et** les usages des clés sont relus ensemble (même instant, < 60 s) juste avant chaque octroi — jamais deux lectures décalées.
Playground : `max_tokens` calculé à partir du solde restant de la clé et du prix du modèle ; invités limités aux modèles bon marché dans le Playground.
Job « over-limit » : toute clé dont l'usage dépasse sa limite + $0.10 est révoquée (le joueur peut en recréer une avec le restant).
Si l'invariant échouerait après un octroi → l'octroi est refusé (« The Forge is cooling down — reserve too low ») et l'UI le dit.

`R_avail` (utilisé partout) = solde de la poche concernée moins ce qui est déjà promis.
`R_initial` = valeur de départ de la poche. `h = clamp(R_avail / R_initial, 0.3, 1)` = **santé de la Réserve**.

## 3. Rendement de la Forge (crédits réels)
Chaque recette a un **poids** `w` : Spark 1, Prism 3, Aura 8.
```
payout_usd = min( R_avail(Main) × y × w ,  cap_player_day_restant ,  cap_global_day_restant )
y = 0.004                           # 0.4 % de la poche par unité de poids
cap_player_day = $0.25              # par joueur, glissant 24 h ; au-delà : compilation payée en XP seulement
cap_global_day = 5,5 % × R_avail    # recalculé à minuit Europe/Paris → poche Main vidée d'au plus ≈ 33 %/semaine
min_payout = $0.002                 # en dessous : compilation acceptée mais payée en XP seulement, message clair
```
Avec la poche pleine ($4.50) : Spark ≈ **$0.018**, Prism ≈ **$0.054**, Aura ≈ **$0.14** (avec +$10 : ×2,3).
Comme chaque paiement est une **fraction de ce qui reste**, la poche décroît géométriquement et ne peut pas tomber à zéro :
c'est solvable par construction. Le rendement baisse quand la Réserve baisse → les premiers forgerons sont mieux payés →
urgence, et visible en direct (« Forge yield ▼ 3 % today »).

Affichage en tokens équivalents (table `MODEL_EQUIV`, prix 1:3 entrée/sortie, rafraîchis depuis `/v1/model/list` ;
vérifiés le 06/11 : DeepSeek V4.1 Flash ≈ $0.98/M mixte, gpt-5-nano ≈ $0.31/M, Claude Sonnet 5.5 ≈ $8/M) :
$0.02 ≈ 20 k tokens DeepSeek V4.1 Flash ≈ 64 k gpt-5-nano ≈ 2.5 k Claude Sonnet 5.5.
L'UI montre d'abord une unité parlante — **« ≈ 13 DeepSeek chats »** (1 chat ≈ 1 500 tokens) — puis 3 équivalences en tokens
(pas cher / moyen / premium). Toujours calculer depuis la table, jamais de chiffres en dur dans l'UI.

**Recharge** : n'importe qui peut recharger le compte NEAR AI (admin) → la Réserve monte → rendement et rares remontent.
La page Pulse affiche « Reserve refilled +$5 » (événement visible : l'économie réagit sans patch).

## 4. Recettes de Forge
Chaque Forge a 3 recettes par jour (minuit Europe/Paris), générées de façon déterministe : `seed = HMAC(secret, forgeId, date)`.
| Tier | Niveau | Composition (base) | Frais ƒ | Poids |
|---|---|---|---|---|
| Spark | 3 | 6 éclats : 4 Common (DeepSeek/Qwen) + 2 Uncommon (Gemini) | 60 | 1 |
| Prism | 5 | 8 éclats : 3 Common + 3 Uncommon + 2 Rare (GPT) | 160 | 3 |
| Aura (P1) | 7 | 9 éclats : 2 Common + 3 Uncommon + 2 Rare + 2 Epic (Claude) | 300 | 8 |

Variation : la répartition exacte entre familles d'un même rang varie selon le **thème de la Forge**
(ex. Panthéon : Common = Qwen plutôt que DeepSeek). Effet voulu : chaque jour, certaines familles sont très demandées
à certains endroits → les prix des marchands proches montent → arbitrage.
**First Compile** (tutoriel) : 2 DeepSeek + 1 Qwen, gratuit, payé par le Welcome Pool ($0.03), une fois par compte.

## 5. Marchands — règles de prix (le cœur du marché)
État d'un marchand `m` : `flux` (trésorerie), `stock[f]`, `target[f]`, `spread`, `status` (open/closing/closed),
`shares` (parts), `personality` (texte + biais), `specialty` (1–2 familles, via les affinités du lieu).

### Prix
```
P0[f]        = prix de référence global de la famille (§7)
scarcity     = clamp( (target[f] / max(stock[f], 0.5)) ^ ALPHA , 0.35 , 3.0 )      ALPHA = 1.1
mid[f]       = P0[f] × scarcity
buy[f]       = floor( mid × (1 − spread) )   # ce que le marchand PAIE au joueur
sell[f]      = ceil ( mid × (1 + spread) )   # ce que le joueur PAIE
spread       ∈ [0.03, 0.12], défaut 0.06 ; spécialité : spread − 0.02 et target × 1.5
```
- Chaque unité est valorisée au stock **après** l'échange : acheter à stock s se paie `sell` calculé à s−1, vendre à stock s se paie `buy` calculé à s+1 → acheter puis revendre au même marchand perd toujours.
- Un marchand *closing* n'achète plus (il liquide).
- Prix **recalculé après chaque unité** (vendre 5 éclats d'un coup = prix qui glisse, l'UI affiche le total exact avant validation).
- Un marchand **n'achète pas** s'il n'a pas les Flux (« I'm short on Flux — come back later or invest in me »).
- Un marchand **ne vend pas** en dessous de stock 0.
- Cibles initiales `target` : DeepSeek 24, Qwen 18, Gemini 10, GPT 6, Claude 3 (× 1.5 si spécialité).
  Stocks initiaux = 80–125 % de la cible (centrés sur la cible : prix de départ ≈ P0) (aléatoire déterministe). Trésorerie initiale = **900–2 400 ƒ** (aléatoire déterministe,
  pour que les marchands ne fassent pas tous faillite à la même heure).

### Tooltip « Why this price? » (généré par les règles, jamais par le LLM)
Le serveur renvoie une structure `PriceExplanation` : `{ P0, stock, target, scarcity, spread, specialty, trend24h, lastTrades }`.
L'UI la rend en phrase : « Base 48 ƒ × scarcity 1.42 (I hold 3, I want 6) × my margin 6 % → I sell at 73 ƒ, I buy at 64 ƒ. »
Le LLM du marchand peut ajouter **une** ligne d'ambiance (« GPT is flying off my shelves since the Eiffel Forge opened. »),
mais les chiffres viennent toujours des règles.

### Approvisionnement (« imports ») et coûts
- Toutes les **heures**, pour chaque famille où `stock < 0.5 × target`, le marchand importe 1 unité au prix `P0 × 1.3`, payé
  en Flux (puits de Flux). S'il n'a pas les Flux, il n'importe pas.
- **Exports = demande de la ville** (puits d'éclats, source de Flux pour les marchands) : toutes les heures, la ville rachète
  **la moitié** du surplus au-delà de `1.5 × BASE_TARGET[f]` (seuil identique pour tous les marchands) à `0.75 × P0`
  (les éclats sont détruits). Un marchand sur-stocké a acheté sous ce prix → il gagne sur le surplus : son revenu suit l'activité.
  Le seuil ne dépend pas de la cible réglée par l'agent : un marchand qui « veut » plus (spécialité, forges voisines) paie plus cher
  au même stock → écarts de prix entre voisins, donc arbitrage.
- **Loyer** : 4 ƒ / heure, **seulement si le marchand a eu ≥ 1 trade dans les 24 h** (boutique active). Les faillites viennent donc
  de ce que font les joueurs (inonder un marchand de ventes vide sa caisse), pas d'une horloge commune.
- **Marchand en difficulté pré-semé** : au premier lancement du monde, un marchand à 250–1 200 m du Louvre démarre à 120 ƒ (status closing)
  pour que la démo montre la faillite/le sauvetage.

### Faillite et réouverture
- `flux < 150` → status **closing** (bandeau orange, prix de vente −10 % pour liquider) pendant 2 h de jeu.
- Toujours `< 150` après 2 h → **closed** : ne commerce plus, stock gelé, apparaît grisé avec un cadenas sur la carte et
  « Needs an investor » + barre de progression.
- **Réouverture** : des joueurs investissent ; dès que `flux ≥ 600`, le marchand rouvre (événement Pulse : « Chez Margot reopened
  thanks to 3 patrons »).

### Patronage (marchés possédés par les joueurs) — version simple (P1)
- **Sauvetage** : un marchand *closing* ou *closed* accepte des contributions en Flux (minimum 50 ƒ). Les Flux vont dans sa caisse.
  Dès que `flux ≥ 600`, il rouvre (événement Pulse : « Chez Margot reopened thanks to 3 patrons »).
- **Récompense des sauveteurs** (pas de parts ni de dividendes : pas de NAV à manipuler) :
  - le titre **Patron** de ce marchand, avec le nom du plus gros contributeur affiché sur le nœud ;
  - un **spread personnel réduit de moitié** chez ce marchand, valable 7 jours ;
  - de l'XP (1 XP par 2 ƒ contribués, plafonné à 300).
- Contribuer est un **puits** de Flux pour les joueurs, et c'est un vrai choix : garder ses Flux, ou rouvrir le marchand qui sert son quartier.
- P2 (si temps) : parts et dividendes, avec NAV calculée au prix P0, moyenne 24 h, high-water mark et versement depuis le Flux réalisé uniquement.

### Marchandage (mini-jeu de cartes, borné) — `economy/haggle.ts`, constantes `HAGGLE` dans `rules.ts`
Sur un achat ou une vente d'**au moins 3 éclats**, le joueur peut marchander au lieu de glisser pour payer.
- **Déroulé** : 3 manches, une carte par manche parmi 3 (manche 1 : « rival » si le joueur a vu un concurrent ≤ 2 h, sinon « bluff » ;
  ensuite « walk away » est toujours proposée). Cartes : *Bulk deal*, *I'll come back daily*, *Your rival X sells/pays N ƒ*,
  *Cheaper down the street* (bluff), *Compliment the shop*, *Lowball*, *Walk away*. « Deal » est possible à tout moment.
- **Ce qui décide** (table `cardEffect`, lisible) : le **trait** du marchand, déterministe par archétype (greedy : gambler, hoarder, hustler,
  trendchaser · friendly : grandma, nightowl · proud : purist, scholar), son **état réel** (besoin = sur-stock quand on achète, manque quand on vend ;
  « desperate » = closing ou caisse < 300 ƒ), la **réputation** du joueur chez lui et, pour la carte rival, la **vérité** : le prix réel actuel
  du concurrent doit battre le prix de ce marchand (savoir d'arbitrage récompensé : +2 à +4 % ; note fausse ou périmée : patience −2).
- **Patience** : 3 au départ (+1 friendly, −1 proud, + réputation/3, max 5). À zéro, le marchand **boude** 20 min : plus de marchandage chez lui
  et ses devis normaux sont **3 % moins bons** pour ce joueur (`souredQuote`), réputation −2.
- **Bornes de l'issue** (pure, `haggledQuote`, testée par tirages) : offre ∈ [0, plafond] avec plafond = 5 % + 0,3 point par point de
  réputation, **≤ 8 %** ; le total marchandé n'est jamais pire que le devis normal et ne dépasse jamais le **plancher de coût** =
  Σ prix milieu au stock après chaque unité × (1 ± 1 %). Même raisonnement que la règle anti-aller-retour : acheter puis revendre
  (ou toute boucle fermée chez un même marchand) **perd toujours**, marchandage ou pas (potentiel Φ(s) = Σ mid).
- **Anti-farm** : 2 séances par marchand et 6 au total par joueur et par jour de Paris ; séance de 90 s (TTL glissant), une à la fois, liée au
  joueur et au marchand ; « Deal » sérialisé par joueur (verrou) et à usage unique ; devis relu dans la transaction (`PRICE_MOVED`).
- **Réputation** (`merchant_relations`, bornée [−5, 10]) : +1 par jour où l'on commerce chez lui (on devient un habitué jour après jour),
  +1 par marchandage conclu, −2 s'il perd patience. Un habitué a plus de patience, un plafond plus haut, et « I'll come back daily » le convainc.
- **Répliques** : écrites à la main par trait et par événement (choix déterministe). Avec de vrais crédits, **une** réplique LLM par séance au plus
  (la poignée de main, sans chiffres), demandée en arrière-plan, plafonnée à 30/jour **dans** le plafond NPC de 150 appels/jour.
- **Simulateur** : 10 % des trades de bots d'au moins 3 éclats sont marchandés (offre tirée dans [0, 5 %]) ; toutes les cibles de santé restent
  vertes (graines 42/1/2/3, 7 et 14 j).

### Contrats
Un contrat actif par marchand ouvert. Généré à chaque « réflexion » de l'agent (§6) :
- **famille** : celle où `stock/target` est le plus bas ;
- **quantité** : 1–5 ;
- **récompense** : `qty × sell[f] × (1.05 … 1.15)`, sur une échéance de 2 à 12 h.

Anti-farm : **le marchand ne vend pas la famille demandée tant que le contrat est ouvert**, donc il faut la trouver ailleurs.
Le gain d'un contrat vient surtout de l'XP (100) et du fait de vendre au-dessus du prix de vente.
Si personne ne livre, le contrat expire et un nouveau est publié à la réflexion suivante.

## 6. L'agent marchand (IA bornée)
Toutes les **3 heures** de jeu (et à la demande dans l'Economy Lab), chaque marchand ouvert « réfléchit » :
1. Le serveur construit un **résumé chiffré** : trésorerie, stocks/cibles, volumes 24 h, prix voisins (3 marchands les plus proches),
   recettes des Forges dans un rayon de 2 km, personnalité.
   Budget : **≤ 150 appels LLM par jour au total** (réflexions et salutations confondues), répartis en priorité sur les marchands actifs.
2. Appel LLM NEAR AI Cloud (modèle pas cher, `response_format: json_schema`) qui renvoie :
   ```json
   { "spread": 0.07, "targetMultipliers": {"gpt": 1.4, "claude": 1.0, ...}, "contract": {"family":"gpt","qty":3},
     "mood": "Eiffel wants GPT today. So do I.", "reasoning": "<= 280 chars" }
   ```
3. **Clamp** déterministe : spread ∈ [0.03, 0.12], multiplicateurs ∈ [0.5, 2.0] et variation ≤ ±30 % par réflexion,
   qty ∈ [1, 5]. Tout champ invalide → valeur précédente. Échec LLM / budget NPC épuisé → politique déterministe
   `fallbackPolicy()` (même interface). Le LLM ne déplace **jamais** de valeur directement.
4. La réflexion est journalisée (`merchant_thoughts`) et visible dans l'écran marchand (« Margot's last thought »).

Dialogue : à l'ouverture de l'écran marchand, une salutation contextuelle (cache 10 min par marchand et par joueur,
max 1 appel/min/joueur), modèle le moins cher. Budget dur : poche NPC Brain ; au-delà, phrases préécrites.

## 7. Prix de référence global (dérive sans patch)
Toutes les heures : `P0[f] ← 0.95 × P0[f] + 0.05 × P0_initial[f] × median(scarcity[f] des marchands ouverts)`,
borné à `[0.6, 1.4] × P0_initial[f]`. Ancré sur `P0_initial` : suivre la médiane des prix milieu (eux-mêmes ∝ P0) faisait
s'auto-alimenter P0 (+1,6 %/h, ×1,9 en 36 h en simulation) puis s'effondrer au plancher.
Affiché comme **Paris Shard Index** (sparkline 7 jours par famille) sur Pulse.

## 8. Sources et puits de Flux
| Sources ƒ | Puits ƒ |
|---|---|
| Sync Relay (3–7 ƒ) | Frais de compilation (60 / 160 / 300) |
| Vendre des éclats aux marchands | Imports des marchands (`P0 × 1.3`) |
| Contrats | Loyer des marchands actifs (4 ƒ/h) |
| Demande de la ville (exports, vers la caisse du marchand) | Contributions de sauvetage, Beacons (P2, 120 ƒ) |

Ordres de grandeur (simulation) : un joueur à 5 km/h fait ≈ 12 syncs/h (≈ 60 ƒ, ≈ 6 éclats) et ≈ 20 captures/h.
**Les captures sont la source principale d'éclats.** Une recette Spark prend ≈ 20 min de marche, ou moins avec du commerce malin.

Cibles de santé (vérifiées en simulation, à régler dans `rules.ts`) :
- la masse de Flux des joueurs croît de < 10 %/jour à régime constant (mesuré sur la 2ᵉ moitié de la simulation ; relâché de 5 % : les walkers gardent une partie de leurs gains) ;
- les prix moyens des marchands restent entre 0,6 et 1,8 × P0 (si tout le monde est au plancher, il n'y a plus d'arbitrage) ;
- l'écart médian de prix pour une même famille entre deux marchands à < 1 km est ≥ 15 % (sinon marcher ne rapporte rien) ;
- chaque semaine, ≥ 1 marchand sur 10 est en difficulté (sinon l'économie est « morte »), et ≤ 30 % sont fermés ;
- P0 reste dans ±40 % de sa valeur initiale ; la poche Main ne se vide pas de plus de ≈ 35 % par semaine.

Réglage du 2026-11-06 (`npm run sim`, 200 bots, graines 42/1/2/3, 7 et 14 jours) : toutes les cibles passent en `baseline`
(ex. graine 42 sur 7 j : Flux +6,5 %/j, prix 0,91–1,53 × P0, écart 19 %, 12 % en difficulté, 6,5 % fermés, P0 0,98–1,40, Main −33 %/sem).
Les bots sont réalistes : les walkers forgent aussi (Spark), achètent ≤ 3 éclats manquants et ne vendent que le reste.

Si une cible échoue, on ajuste les constantes et on consigne le réglage dans le journal des décisions.

## 8 bis. Runners-agents (vie du monde en direct, P1)
Avec quelques joueurs seulement, les prix ne bougeraient jamais. On fait donc tourner en continu **24 runners-agents** dans le monde réel du jeu :
- **qui ils sont** : les profils Walker, Arbitrageur, Forger et Flooder du simulateur, chacun avec un compte NEAR `r-<nom>.tokengo.testnet` ;
- **ce qu'ils font** : ils se déplacent à vitesse de marche entre des nœuds réels, capturent, vendent, achètent et livrent des contrats ;
- **ce qu'ils ne font pas** : ils ne compilent jamais de crédits réels (leurs compilations brûlent les éclats sans octroi), et un plafond horaire limite leur volume de trades ;
- **leur rôle** : c'est l'activité de fond du marché, et cela répond directement à la piste « agent NPCs » ;
- **dans l'interface** : un badge « agent » dans le ticker Pulse, et des points discrets sur la carte (désactivables).

## 9. Spawns & émission
- Probabilité de famille par spawn : poids de base (§3 du game design) × affinité du lieu (×3) × `h` pour GPT/Claude.
- Nombre de spawns par cellule et par fenêtre de 10 min : `Poisson(λ)` avec `λ = 0.8 + 0.25 × poiRichness (0..6)`, max 3,
  × 1.2 si district gagnant de la semaine, × 1.5 autour d'un Beacon actif (rayon 150 m).

## 10. Simulateur & Economy Lab
`packages/shared/src/economy/sim.ts` : boucle à pas fixe (1 pas = 10 min de jeu) qui fait agir N bots :
- profils de bots : **Walker** (capture + sync, vend tout au plus proche), **Arbitrageur** (achète bas / vend haut entre marchands
  à < 1,5 km), **Forger** (vise des recettes), **Patron** (investit dans les marchands en difficulté), **Flooder** (scénario : inonde
  une famille).
- sorties : séries temporelles (P0 par famille, prix par marchand, Flux en circulation, Réserve, nb marchands fermés,
  paiements réels), événements (faillites, réouvertures).
- CLI : `npm run sim -- --days 7 --players 200 --scenario flood-deepseek --seed 42` → tableau récapitulatif + JSON.
- **Economy Lab** (`/lab`, UI) : mêmes fonctions exécutées **dans le navigateur** (Web Worker) sur une copie de l'état actuel
  de Paris : boutons « Simulate 1 week » (≈ 10 s, animé), scénarios (« Flood DeepSeek », « Reserve refill +$5 »,
  « Everyone forges Aura »), graphiques (Recharts ou uPlot) et carte des marchands qui ferment/rouvrent pendant la lecture.
  Aucun effet sur le monde réel. C'est l'outil de démonstration n°1 pour les juges.

Tests obligatoires (Vitest) : invariant de solvabilité (avec overshoot), glissement de prix monotone, clamps de l'agent,
faillite→sauvetage→réouverture, anti-farm des contrats (le marchand ne vend pas la famille du contrat), simulation déterministe
(même seed → même résultat), 7 jours × 200 bots sans NaN ni prix ≤ 0, cibles de santé du §8.
Exploits à tester explicitement : acheter puis revendre au même marchand ne rapporte jamais (buy < sell après glissement) ;
farm de Welcome Pool (gating + plafond horaire) ; comptes DEMO_TOKEN qui ne peuvent pas vendre.
