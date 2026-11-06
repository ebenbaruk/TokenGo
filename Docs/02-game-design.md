# 02 — Game design

Tous les nombres de ce document sont des **valeurs initiales** ; ils vivent dans `packages/shared/src/economy/rules.ts`
(source unique) et peuvent être réglés après simulation (`npm run sim`). Toute valeur changée → mettre à jour ce doc.

## 1. Fiction (courte, jamais envahissante)
Les data centers débordent : du **calcul perdu** se condense dans la ville sous forme d'**éclats** (*shards*).
Les **Runners** (joueurs) les capturent. Des **marchands** — des IA indépendantes installées sur des lieux réels —
les achètent et les revendent. Les **Forges**, sur les monuments, compilent les éclats en **crédits de calcul réels**.
La **Réserve** de la ville contient tout le calcul réel disponible : quand elle baisse, les éclats rares se font rares.

Ton : malin, chaleureux, coloré, un brin rétro (pixel art). Jamais « crypto bro ». Les marchands ont de l'humour.

## 2. Glossaire (noms utilisés dans l'UI, en anglais)
| Terme | Définition |
|---|---|
| **Runner** | Le joueur. |
| **Shard** | Objet collecté. 5 familles (tableau §3). Token NEP-245. |
| **Flux (ƒ)** | Monnaie douce du jeu. Token NEP-245 `flux`. Ne se convertit **jamais** directement en argent réel. |
| **Node** | Lieu réel sur la carte. 3 types : **Relay**, **Market**, **Forge**. |
| **Relay** | Nœud fréquent (stations, fontaines, statues…). « Sync » toutes les 5 min → Flux + éclats. |
| **Market** | Nœud avec un **marchand IA** : achète/vend des éclats, publie des contrats, peut être sauvé par les joueurs s'il fait faillite. |
| **Forge** | Monument. Compile une **recette** d'éclats en **crédits réels** sur la clé API du joueur. |
| **Recipe** | Ensemble d'éclats exigé par une Forge. Change chaque jour, différent par Forge. |
| **Reserve** | Le solde réel (USD) du compte NEAR AI Cloud du jeu, moins les engagements. Visible partout. |
| **Credits** | Ce que le joueur gagne pour de vrai : du solde sur **sa** clé API NEAR AI Cloud, affiché en $ et en tokens équivalents. |
| **Contract** | Quête publiée par un marchand : « apporte 3 GPT avant 18:00 → 120 ƒ ». |
| **Patron** | Plus gros contributeur au sauvetage d'un marchand (nom affiché sur le nœud). |
| **Beacon** | Leurre posé sur un Relay : +spawns pour tout le monde pendant 30 min. |
| **District** | Arrondissement (Paris) / zone admin équivalente ailleurs. Classement hebdo. |

## 3. Les éclats (Shards)
La rareté en jeu suit **le prix réel** des modèles : plus un modèle coûte cher, plus son éclat est rare et précieux.

| id token | Nom UI | Rareté | Couleur (token design) | Poids spawn base | Prix réf. P0 (ƒ) | Affinités de lieu |
|---|---|---|---|---|---|---|
| `shard:deepseek` | DeepSeek Shard | Common | `--shard-deepseek` cyan | 42 | 10 | partout, commerces, rues denses |
| `shard:qwen` | Qwen Shard | Common | `--shard-qwen` violet | 28 | 14 | campus tech, coworkings, Station F, marchés |
| `shard:gemini` | Gemini Shard | Uncommon | `--shard-gemini` bleu | 17 | 26 | parcs, jardins, eau (Seine, canaux), musées de sciences |
| `shard:gpt` | GPT Shard | Rare | `--shard-gpt` vert-lime | 9 | 48 | gares, quartiers d'affaires, grands axes |
| `shard:claude` | Claude Shard | Epic | `--shard-claude` ambre | 4 | 95 | bibliothèques, universités, librairies, théâtres |

Règles :
- Les **affinités** multiplient le poids d'une famille ×3 dans une cellule dont les POI correspondent (calcul : `04-world-geo.md`).
  Résultat : pour compléter une recette il faut **visiter des types de lieux différents** → exploration.
- Les familles rares (`gpt`, `claude`) ont leur poids multiplié par la **santé de la Réserve**
  `h = clamp(R_avail / R_initial, 0.3, 1)`. Réserve basse → rares plus rares → prix des rares montent chez les marchands.
- Pas de logos de marques. Icônes originales (cristaux de formes différentes : DeepSeek = prisme hexagonal,
  Qwen = losange, Gemini = double pointe, GPT = octaèdre, Claude = étoile à 8 branches facettée).

## 4. Les trois boucles

### Boucle 30 secondes — « Marcher & capturer »
1. La carte montre les éclats dans un rayon de **250 m** (personnels : chaque joueur a ses propres instances).
2. À **≤ 40 m** (jusqu'à 60 m si la précision GPS est mauvaise, cf. `08-security-anticheat.md`), l'éclat pulse : tap.
3. **Mini-jeu « Lock-on »** (≈ 2 s) : l'éclat flotte au centre ; un anneau se resserre ; tap quand l'anneau touche la cible.
   - **Perfect** (fenêtre ±7 %) : capture + 25 % de chance d'un éclat bonus de la même famille + 15 XP.
   - **Good** (±20 %) : capture + 10 XP.
   - **Miss** : l'anneau repart (3 essais). Après chaque miss, chance de fuite : Common 0 %, Uncommon 10 %, Rare 20 %, Epic 30 %.
   - Plus l'éclat est rare, plus l'anneau est rapide (1,4 s → 0,8 s) et la fenêtre étroite.
   - Le **serveur** décide du résultat final (le client envoie le timing ; le serveur borne l'avantage, voir anti-triche).
4. **Combo** : chaque capture dans les 90 s qui suivent la précédente augmente le combo (max ×5) → +2 XP par niveau de combo
   et barre de combo visible. Récompense la marche continue.
5. **Objectif épinglé** : une puce en haut de la carte montre toujours la prochaine étape concrète, ex.
   « Spark @ Louvre 4/6 — need 2 Gemini · park 280 m » (recette la plus proche de l'achèvement + lieu d'affinité le plus proche
   pour l'éclat manquant, ou « Best price for Gemini: Café Oz 71 ƒ · 520 m »). Tap → itinéraire en pointillés sur la carte.
6. Feedback : particules couleur famille, son cristallin, compteur d'inventaire qui « saute », toast « +1 Claude Shard ».

Spawns : chaque cellule H3 (≈ 175 m) génère 0–3 éclats par **fenêtre de 10 minutes**, de façon déterministe
(`HMAC(secret, cellId, window)`), densité modulée par la richesse en POI. Un joueur qui marche à 5 km/h croise
≈ 8–14 éclats en 15 minutes.

### Boucle 5 minutes — « Relais, marchands, contrats »
- **Relay — Sync** (à ≤ 40 m, recharge **5 min** par joueur et par relay) : animation de « synchronisation » (disque qui tourne,
  swipe pour lancer) → **5–10 ƒ** + **50 % de chance d'1 éclat** tiré selon l'affinité du lieu + 25 XP. (Les captures restent la source principale d'éclats.) Première visite d'un relay : +20 XP « New node ».
- **Market — Trade** (à ≤ 40 m) : écran marchand (voir `09-ux-ui-design.md` §Écran Marchand) :
  - Portrait + nom + humeur du marchand (une ligne générée par son IA).
  - Pour chaque famille : prix d'**achat** (il te paie) / prix de **vente** (tu paies), stock, flèche de tendance 24 h.
  - **Tooltip « Why this price? »** : le raisonnement exact, chiffré, issu des règles (« Je n'ai que 2 Claude pour un objectif de 4 → ×1,62 »),
    reformulé avec la voix du marchand.
  - Achat / vente par quantité (stepper), confirmation par **glisser** (pas de double tap accidentel).
  - **Comparateur** : « Best known price » — le meilleur prix vu par le joueur dans les marchands visités il y a < 2 h,
    avec distance. C'est l'outil d'arbitrage (n'affiche que des prix déjà « vus », pas d'omniscience).
- **Contracts** : chaque marchand publie 1 contrat actif (famille, quantité 1–5, récompense, échéance). Le livrer = vente au prix
  du contrat (en général +30 à +50 % au-dessus du prix de rachat) + 100 XP.
  Les contrats apparaissent sur la carte comme un badge sur le marchand → objectifs de déplacement.

### Boucle session (20–40 min) — « Forger, investir, défendre son quartier »
- **Forge — Compile** (à ≤ 60 m d'une Forge) : la Forge affiche ses **3 recettes du jour** (Spark / Prism / Aura).
  Le joueur voit en direct quels éclats il a / lui manquent, et le **rendement** actuel en $ et en tokens équivalents.
  Compiler = brûler les éclats + payer les frais en Flux → la clé API du joueur reçoit des crédits réels.
  Animation forte : les éclats volent dans la Forge, fusion, un « ticket de crédit » sort avec le montant
  « +$0.054 · ≈ 36 DeepSeek chats · ≈ 55k DeepSeek tokens · ≈ 6.7k Claude Sonnet tokens » (toujours calculé depuis `MODEL_EQUIV`).
- **Playground** (onglet Credits) : chat minimal avec le modèle de son choix, sur sa clé : la preuve immédiate que c'est réel.
  + « Copy API key » + snippet `curl` / OpenAI SDK.
- **Patronage** (Market, niveau 6 ; P1) : contribuer des Flux pour **sauver** un marchand en difficulté ou fermé → il rouvre à 600 ƒ ;
  le plus gros contributeur devient **Patron** (pseudo affiché sur le nœud), et les contributeurs ont un spread réduit de moitié pendant 7 jours (`03-economy.md` §5).
- **District** (P2 ; P1 = simple classement) : chaque compilation, contrat et capture rapporte des points à l'arrondissement du joueur (choisi au premier
  lancement, modifiable 1×/semaine ; par défaut celui où il joue le plus). Classement hebdomadaire ;
  **le district gagnant reçoit +20 % de spawns la semaine suivante** (bonus visible sur la carte : hachures dorées).

### Boucle long terme
- **Niveaux 1–20** (XP), avec des déblocages qui rythment l'apprentissage (tableau §6).
- **Codex** (P2) : carnet de collection — nombre de nœuds visités par type, familles capturées, forges compilées, records
  (plus gros arbitrage, plus long combo). Badges.
- **Daily Route** (P2) : chaque jour, 3 nœuds proposés formant une boucle de ≈ 2 km autour du joueur → récompense bonus
  (60 ƒ + 1 éclat Uncommon garanti). Série de jours (streak) visible.

## 5. Les nœuds (Nodes)
| Type | Densité cible (Paris) | Source | Interaction | Rayon |
|---|---|---|---|---|
| Relay | 1 pour ~170 m | POI OSM (stations, fontaines, statues, œuvres d'art, églises, places, monuments mineurs) | Sync (cooldown 5 min) | 40 m |
| Market | 1 pour ~500 m (≈ 15 % des nœuds) | POI « commerce / café / marché / librairie » notables | Trade, Contracts, Patronage | 40 m |
| Forge | ~10 à Paris | Liste éditoriale (Paris) ; ailleurs : top POI `tourism=attraction` + `wikidata` | Compile | 60 m |

**Forges de Paris** (liste éditoriale, `data/paris/forges.json`) : Tour Eiffel, Louvre (Pyramide), Notre-Dame,
Sacré-Cœur, Panthéon, Arc de Triomphe, Bastille (Colonne de Juillet), Centre Pompidou, Station F,
Bibliothèque François-Mitterrand. Chaque Forge a un nom de lieu + un « thème » qui biaise ses recettes
(ex. Panthéon & BnF favorisent Claude, Station F favorise Qwen/DeepSeek, Tour Eiffel favorise GPT).

## 6. Progression
XP pour passer du niveau L à L+1 : `round(100 × L^1.5)` (cumul : L2 = 100, L3 = 383, L5 = 1 703, L7 = 4 291, L10 = 11 106).
Les étapes du tutoriel **ignorent les verrous de niveau** (trade et First Compile possibles dès le niveau 1). Les badges de contrat n'apparaissent sur la carte qu'à partir du niveau 4.

| Niveau | Déblocage |
|---|---|
| 1 | Capture, Relays |
| 2 | Markets (trade) |
| 3 | **Forge — recette Spark** (crédits réels, si « proof of walk » OK) |
| 4 | Contracts |
| 5 | Recette Prism |
| 6 | Patronage (sauver un marchand) |
| 7 | Recette Aura |
| 8 | Beacons (P2) |
| 10+ | Cosmétiques de profil (couleurs de traînée), titres |

Gains d'XP : capture 10 (+5 perfect, +2/niveau de combo), sync 25, première visite 20, trade 2 par éclat,
contrat 100, compile Spark/Prism/Aura 150/300/600, Daily Route 200.

**Proof of walk** (comptes Google) : compiler des crédits réels exige ≥ 1,5 km de déplacement validé (trace plausible) sur le
compte. Les invités ont droit à la First Compile (Welcome Pool), puis au **Judge Pool** pendant la période de jugement ou avec `DEMO_TOKEN` (cf. `03-economy.md` §2).

## 7. Onboarding (« premier crédit réel en < 3 min » en mode démo)
1. Splash (logo + « Walk Paris. Catch AI. Spend it for real. ») → **Continue with Google** / **Play as guest**.
2. Permission de localisation expliquée avant la demande système (écran custom). Refus/indisponible → **Demo Walk**
   automatique (départ au Louvre — Cour Napoléon).
3. **Tutoriel guidé par un marchand** (« Margot », du marchand le plus proche) en 5 étapes à bulles, sautables :
   a. Un éclat garanti apparaît à 20 m → capture (mini-jeu expliqué).
   b. Relay le plus proche → Sync.
   c. Marchand → vendre 1 éclat, acheter 1 éclat (montre le tooltip « Why this price? »).
   d. Forge → recette tutoriel spéciale (« First Compile », payée par le Welcome Pool ; exige d'avoir fait a, b et c) → **crédits réels**.
   e. Playground → première question à Claude/DeepSeek avec ses propres crédits. Confettis.
4. Choix du District (pré-sélectionné selon la position).

En mode Démo, le joueur démarre avec un kit (niveau 3, 60 ƒ, 4 éclats) pour atteindre la Forge vite.

## 8. Modes de déplacement
- **GPS (Explorer)** : `watchPosition` haute précision, avatar orienté (boussole si dispo), traînée lumineuse.
- **Demo Walk** : *tap-to-walk* — on touche un point de la carte, l'avatar s'y rend à **30 km/h** en suivant une ligne droite. **Jump** : en mode démo, toucher un nœud à < 2 km propose « Jump here » (trajet animé de 3 s)
  (interpolation côté client, positions envoyées au serveur comme du GPS). Bouton « 🎯 Demo » visible si `?demo=1`, compte
  invité, ou GPS refusé. Les comptes démo sont marqués `mode='demo'` côté serveur : gains réels
  limités au Welcome/Judge Pool. En mode démo, le serveur ne vérifie pas la vitesse (les jumps sont autorisés) mais vérifie toujours les distances d'action.
- **In transit** : vitesse > 25 km/h (GPS) → bandeau « In transit — catching paused », capture/sync désactivés, carte visible.

## 9. Social & live
- **City Pulse** (onglet / page `/pulse`) : carte de Paris avec heatmap des prix par famille, ticker des derniers trades,
  faillites/réouvertures, compilations (« Lina compiled an Aura recipe at the Panthéon · +$0.11 »), jauge de Réserve,
  flux on-chain (liens explorer). C'est aussi le **mode spectateur** des juges.
- **Leaderboards** : Districts (hebdo), Runners (XP semaine), Patrons (Flux contribués aux sauvetages), Traders (profit d'arbitrage semaine).
- Pseudonymes uniquement (générés : « NeonPigeon », modifiables, filtrés).

## 10. Ce qu'on ne fait pas (pour rester simple)
Pas de combat, pas de chat entre joueurs, pas d'échange joueur↔joueur direct (tout passe par les marchands : c'est le
marché), pas d'éclats « shiny », pas de météo. Stretch possibles listés dans `11-roadmap.md`.
