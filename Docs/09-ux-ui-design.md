# 09 — UX / UI & direction artistique

> **Référence du propriétaire (2026-11-06)** : `Docs/design-ref/ref-pixel-sprite.jpg`, un sprite pixel art d'un personnage cartoon
> sur fond bleu uni. **On reprend le style, jamais le personnage** : c'est un fan-art d'une œuvre protégée, gardé hors git (`.gitignore`).
> Sa demande : « un peu pixel art, mais pas trop, assez coloré, fun ». La structure des écrans (§4) ne dépend pas de la DA.

## 1. Direction artistique : « Pixel Pop Paris »
**Les personnages et objets sont en pixel art ; tout le reste est en cartoon plat moderne.**
Les sprites (éclats, marchands, avatar, nœuds, icônes de loot) sont en vrai pixel art. La carte, les panneaux et le texte sont en aplats
vectoriels nets, avec la même grammaire : contours sombres épais, couleurs franches, aucun dégradé réaliste.
Ce mélange garde le charme rétro sans sacrifier la lisibilité d'une app mobile. C'est la ligne « un peu pixel art, mais pas trop ».

Grammaire visuelle tirée de la référence :
| Trait de la référence | Règle TokenGo |
|---|---|
| Gros pixels, grille visible | Sprites dessinés sur une grille de **16×16** (petits objets) ou **24×24 / 32×32** (marchands, avatar), affichés à l'échelle entière ×3 ou ×4, `image-rendering: pixelated`. Jamais d'échelle fractionnaire. |
| Contour noir épais | Contour **1 pixel** `--ink` (#1A1C2C) sur tous les sprites. L'UI reprend l'équivalent : bordures de 2–3 px `--ink`. |
| Aplats, 3–4 tons par couleur | Chaque sprite a au plus 4 tons par teinte (ombre, base, clair, reflet blanc). Pas d'anti-aliasing ni de dégradé dans les sprites. |
| Fond uni très saturé | Écrans de récompense, capture et Forge sur des **aplats vifs** (bleu ciel, violet, jaune) avec un motif de pixels discret, pas sur la carte floutée. |
| Pose expressive et cartoon | Marchands et avatar animés en **2–4 frames** : rebond idle, clin d'œil, sursaut à la vente. |
| Ombres portées dures | Ombre décalée pleine (`4px 4px 0 var(--ink)`) sous les boutons et les cartes, jamais d'ombre floue. |

Inspirations (style, rien à copier) :
- Les écrans de récompense de *Pokémon GO*, pour le rythme.
- L'UI de *Stardew Valley*, pour la chaleur des panneaux.
- *Eastward*, pour le pixel art coloré avec une finition moderne.
- *Celeste* et *A Short Hike*, pour la lisibilité et les palettes douces.
- Les boutons « chunky » à ombre dure des jeux mobiles casual.

### Palette de base : **Sweetie 16** (Lospec)
Une palette pixel art connue, gaie et cohérente. Tous les sprites n'utilisent **que** ces couleurs, plus le blanc pur. L'UI en dérive ses tokens.
```
#1a1c2c ink    #5d275d plum    #b13e53 berry   #ef7d57 orange  #ffcd75 sun     #a7f070 lime    #38b764 green   #257179 teal
#29366f navy   #3b5dc9 blue    #41a6f6 sky     #73eff7 cyan    #f4f4f4 white   #94b0c2 mist    #566c86 slate   #333c57 night
```

### Carte : de jour, cartoon plat
On part du style OpenFreeMap `liberty` ou `positron`, téléchargé et réécrit dans `apps/web/public/map/style.json`.
- **Couleurs** : sol crème `#F6EFD9` ; eau `--sky` #41a6f6, berges d'un bleu plus sombre ; parcs `--lime` #a7f070, bois `--green` #38b764.
- **Routes** : blanches avec un contour `--mist` (principales 2 px, mineures 1 px).
- **Bâtiments** : aplat beige rosé `#EAD9C6` avec contour fin. Pas de 3D, ou une extrusion basse en option (P2).
- **Labels** : seulement les quartiers et les grands monuments, en Pixelify Sans, couleur `--night`.
- **Repère** : la Seine bleue doit se reconnaître immédiatement.
- **Mode nuit** (P2) : même structure, palette `--night`/`--navy`, activé après le coucher du soleil, comme dans Pokémon GO.

### Sprites (tous générés par le code, aucun asset externe)
**Format.** Les sprites sont écrits en **grilles texte** dans `apps/web/src/sprites/*.ts` : un caractère par pixel, mappé sur la palette.
```ts
// exemple 8×8 (les vrais sprites font 16×16+) — '.' = transparent
export const sparkle = sprite(`
..k..k..
.kYk.kYk
..k..k..
`, { k: INK, Y: SUN });
```
**Rendu.** Une fonction `renderSprite(grid, palette, scale) → HTMLCanvasElement` sert :
- dans l'UI, via un composant `<Sprite name scale anim />` ;
- dans MapLibre, via `map.addImage(name, imageData, {pixelRatio})`.

Les animations sont des tableaux de frames. Avantage : tout est versionné, modifiable en texte et cohérent. Claude dessine et itère, en regardant des captures agrandies.

**Liste des sprites et leur design :**
- **Éclats** (16×16, 2 frames de scintillement), une silhouette distincte par famille :
  - DeepSeek : prisme hexagonal cyan/teal ;
  - Qwen : losange plum/violet ;
  - Gemini : double pointe sky/blue ;
  - GPT : octaèdre lime/green ;
  - Claude : étoile facettée orange/sun.

  Tous ont un reflet blanc 1 px. Sur la carte : rebond de 2 px, ombre ovale `--ink` à 25 %. Plus ils sont rares, plus ils ont de pixels « sparkle » qui clignotent autour.
- **Avatar joueur** (24×24, 4 directions × 2 frames de marche) : petit runner rond et sympathique (casquette, écharpe), couleurs personnalisables.
  Pas de personnage existant, pas d'oiseau bleu façon Mordecai.
- **Marchands** (32×32, 3 frames : idle, parle, joie) : **8 archétypes**, chacun avec une silhouette et une palette propres.

  Le portrait est généré à partir de l'archétype. La couleur d'accent et l'accessoire (chapeau, lunettes) dépendent de l'id, donc chaque marchand est unique.

  Les archétypes et leur accessoire :

  | Archétype | Accessoire |
  |---|---|
  | Gambler | visière |
  | Hoarder | sac à dos |
  | Scholar | lunettes rondes |
  | Hustler | casquette à l'envers |
  | Grandma | chignon |
  | Purist | béret |
  | Trendchaser | lunettes de soleil |
  | Night Owl | capuche |

  Les animaux anthropomorphes originaux sont autorisés (chat, pigeon parisien, renard), à condition de rester originaux.
- **Nœuds** (24×24) :
  - Relay : petite borne-antenne avec une lumière qui tourne ; grisée pendant la recharge, avec un arc de progression vectoriel.
  - Market : échoppe à auvent rayé de la couleur de l'archétype, avec le visage du marchand en médaillon et un badge contrat (losange `--sun`).
  - Marchand fermé : volets baissés et cadenas.
  - Forge (32×32, visible dès le zoom 13) : enclume-monument dorée avec des étincelles animées.
- **UI** : icônes de loot, Flux (pièce `--sun` gravée « ƒ »), XP (étoile `--lime`), cadenas, flèches. Icônes de navigation : Lucide en trait épais de 2,5 px, pour rester lisibles.

### Typographie
Polices auto-hébergées via `@fontsource`, pas de CDN, à cause de la CSP.
- **Pixelify Sans** (`@fontsource/pixelify-sans` 5.3.0) : titres, gros chiffres de récompense, noms de lieux, boutons. Toujours ≥ 18 px.
- **Nunito** (`@fontsource/nunito` 5.3.0, graisses 600/800) : texte d'UI, ronde et amicale, 15–17 px de base.
- Les prix et montants sont en Nunito 800, `font-variant-numeric: tabular-nums`. Le monospace (JetBrains Mono, petit) est réservé aux hashes et à la clé API.

## 2. Design tokens (`apps/web/src/styles/tokens.css`)
```css
:root {
  /* palette Sweetie 16 */
  --ink:#1a1c2c; --plum:#5d275d; --berry:#b13e53; --orange:#ef7d57; --sun:#ffcd75; --lime:#a7f070; --green:#38b764; --teal:#257179;
  --navy:#29366f; --blue:#3b5dc9; --sky:#41a6f6; --cyan:#73eff7; --white:#f4f4f4; --mist:#94b0c2; --slate:#566c86; --night:#333c57;
  /* rôles */
  --bg: #F6EFD9;               /* crème carte / fond d'app */
  --panel: #FFFDF6;            /* cartes et feuilles */
  --panel-alt: #E8F4FF;        /* zones secondaires */
  --text: var(--ink); --text-dim: var(--slate); --text-on-color: var(--white);
  --primary: var(--sky);       /* action principale (bouton contextuel) */
  --primary-press: var(--blue);
  --xp: var(--lime); --flux: var(--sun); --credits: var(--orange);  /* crédits réels = orange chaud + bordure sun */
  --danger: var(--berry); --warn: var(--orange); --ok: var(--green);
  --shard-deepseek: var(--cyan); --shard-qwen: var(--plum); --shard-gemini: var(--sky); --shard-gpt: var(--lime); --shard-claude: var(--orange);
  /* forme */
  --border: 3px solid var(--ink); --border-thin: 2px solid var(--ink);
  --radius-s: 6px; --radius-m: 10px; --radius-l: 16px;      /* petits arrondis : on garde l'esprit pixel */
  --shadow-hard: 4px 4px 0 var(--ink); --shadow-hard-s: 2px 2px 0 var(--ink);
  --space: 4px;
  --ease-pop: cubic-bezier(.34,1.56,.64,1); --ease-out: cubic-bezier(.2,.8,.2,1);
  --step: steps(4, end);       /* animations « pixel » saccadées pour sprites et compteurs de loot */
}
```
Le thème est **clair et coloré par défaut** ; la nuit est en P2. Contraste du texte ≥ 4.5:1 (encre sur crème ou blanc, blanc seulement sur
`--blue`, `--berry`, `--plum`, `--night`, `--teal` ; jamais de blanc sur `--sun`, `--lime` ou `--cyan`). Avec `prefers-reduced-motion` : pas de rebond, sprites figés sur la frame 1.

**Composants façon « chunky »** : boutons avec `--border` et `--shadow-hard`. À l'appui, translate(2px,2px) et ombre `--shadow-hard-s` : l'effet bouton physique.
Les feuilles basses ont un bord supérieur crénelé de pixels (motif SVG 4 px). Les toasts sont des bulles de dialogue rétro avec une petite queue pixel.
Les compteurs de récompense défilent en `--step`.

## 3. Principes UX
1. **Zone du pouce** : toutes les actions primaires dans le tiers bas de l'écran. Cibles ≥ 48 px.
2. **Un seul bouton contextuel** : le gros bouton central montre l'action la plus proche (« Catch », « Sync », « Trade », « Compile »).
3. **Feedback < 100 ms** sur chaque tap (état pressé + son court) ; résultat serveur animé (optimiste seulement pour l'UI, jamais pour la valeur).
4. **Chiffres qui roulent** : chaque changement de Flux/XP/crédits est un compteur animé (300–600 ms) + « +12 ƒ » qui monte et s'efface.
5. **Toujours dire pourquoi** : action indisponible → raison claire et ce qu'il faut faire (« 42 m away — walk 8 m closer », « Recharging · 3:12 »).
6. **Pas de mur de texte** : tutoriel en bulles d'1 phrase, sautables. Max 2 lignes de texte par carte.
7. **Hors-ligne / GPS faible** : bandeau discret en haut, jamais de modal bloquante.
8. **Sons** (WebAudio, < 30 Ko au total, coupables) : capture (cristal), perfect (accord), sync (whoosh), trade (caisse douce), forge (grondement → chime).
   **Haptique** : `navigator.vibrate` (Android seulement ; iOS ignoré silencieusement).

## 4. Écrans
### Carte (accueil)
```
┌──────────────────────────────┐
│ (Lv 7 ◔)  ƒ 1,284   ⚡ $0.21 │  ← haut : anneau de niveau/XP, Flux, crédits réels (doré)
│ [Reserve ▮▮▮▮▯ $4.12] [11ᵉ]   │  ← pilule Réserve (tap → feuille Réserve) + district
│ ◎ Spark@Louvre 4/6 · 2 Gemini │  ← objectif épinglé (prochaine étape concrète, tap → itinéraire)
│                              │
│        carte 3D inclinée      │  ← éclats, nœuds, avatar, traînée ; badge contrat ; zone beacon
│            ◈   ✦              │
│              ▲                │
│                              │
│  [Bag]     ( CATCH )   [Quest]│  ← bas : Bag (inventaire) · bouton contextuel · Quests (recettes du jour, contrats)
│  ───── combo ×3 ▮▮▮▯▯ ─────   │  ← barre de combo quand active
└──────────────────────────────┘
```
Menu (avatar en haut à gauche) : Profile (Codex en P2), Credits, Pulse, Lab, Proofs, Settings, About.
Toasts empilés en haut (max 2), loot en « burst » au-dessus du bouton.

### Capture (plein écran par-dessus la carte floutée)
Fond aplat de la couleur de la famille avec un motif de pixels ; l'éclat au centre en sprite ×8 ; l'anneau qui se resserre ; zone cible en pointillés ; 3 points d'essais ; nom + rareté en haut ;
résultat : explosion de particules + carte « +1 Claude Shard · PERFECT » ; fuite : l'éclat se dissout en pixels. Durée totale < 4 s.

### Relay (feuille basse)
Nom du lieu + photo-less illustration (icône du type) ; grand disque « Swipe to sync » ; loot qui jaillit ; état recharge avec compte à rebours.

### Marchand (feuille plein hauteur, onglets)
- En-tête : portrait, nom, archétype, humeur (bulle IA), statut (Open / Closing / Closed), lien « Merchant wallet ↗ » discret.
- Onglet **Trade** : 5 lignes famille : icône · stock / cible (mini-jauge) · **Sell to me** (il paie) · **Buy** (tu paies) · tendance 24 h (sparkline) ·
  ⓘ « Why this price? » (popover avec la décomposition chiffrée). Sélection → stepper quantité → récap exact (prix qui glisse) →
  **slide to confirm**. Indicateur « Best known price: 71 ƒ at Café Oz · 640 m » (comparateur).
- Onglet **Contract** : carte contrat (famille, qty, récompense, timer) + « Deliver » si possédé.
- Onglet **Rescue** (si closing/closed) : « Needs 600 ƒ to reopen » + barre de progression, contributeurs, slider de contribution, avantages
  (Patron, spread réduit 7 j). Ouvert : Patron actuel + avantages actifs.
- Pied : « Last thought (14:00) » repliable.

### Forge (plein écran, la scène la plus spectaculaire)
Enclume-monument pixel art dorée sur fond aplat violet `--plum` avec étincelles ; 3 recettes en cartes horizontales (Spark/Prism/Aura) avec les emplacements d'éclats (remplis/vides),
frais, rendement actuel « ≈ $0.06 · ≈ 60k DeepSeek tokens » et cadenas de niveau. Bouton « Compile » (hold 1 s pour confirmer).
Animation : les éclats volent dans le sceau → fusion (lumière) pendant le burn on-chain (2–3 s) → **ticket de crédit** (carte crème bordée `--sun`, ombre dure) qui sort :
montant en gros (Pixelify Sans), 3 équivalences modèles, « Burn proof ↗ ». CTA : « Try it now » → Playground.

### Credits
Carte « Your API key » (préfixe masqué, Reveal/Copy, Rotate), solde restant (limite − usage) en gros, barre d'usage, équivalences,
Playground (chat), snippets `curl`/SDK, historique des grants (date, forge, montant, preuve).

### Profile & Codex
Pseudo, district, niveau, stats (km marchés, captures, meilleur arbitrage), badges, collection (nœuds visités par type, familles),
lien Proofs.

### Pulse (`/pulse`, aussi accessible sans compte)
Bureau : carte de Paris à gauche (marchands colorés par prix d'une famille choisie, faillites qui clignotent), à droite :
Paris Shard Index (5 sparklines), jauge Réserve + Proof of Reserve, ticker live (SSE), derniers settlements avec liens tx, classement districts.
Mobile : sections empilées.

### Economy Lab (`/lab`)
Panneau de contrôle (bots 50–500, jours 1–14, scénario, seed) → « Run » : barre de progression, carte de Paris où les marchands
changent de couleur au fil des jours simulés, graphiques (prix par famille, Flux en circulation, Réserve et rendement, marchands fermés),
journal d'événements (« Day 3 14:00 — Chez Margot went bankrupt », « Day 4 — reopened by 3 patrons »). Bouton « Explain » qui affiche
les règles (rendu lisible de `rules.ts`).

### Onboarding
Splash animé (tour Eiffel en pixel art, éclats qui rebondissent autour, fond `--sky`) → choix connexion → explication localisation (illustration + 1 phrase)
→ tutoriel à bulles par Margot (game design §7) → choix du district (carte des arrondissements, pré-sélection) → jeu.

## 5. Composants (`apps/web/src/ui/`)
`Button` (primary/secondary/ghost/gold, états pressed/loading/disabled+raison), `Sheet` (feuille basse draggable, 3 hauteurs), `Pill`,
`Counter` (nombre animé), `ShardIcon` (famille, taille, glow, rareté), `PriceTag` (mono, couleur hausse/baisse), `Sparkline`, `Gauge`,
`SlideToConfirm`, `HoldButton`, `Toast`, `Tooltip/Popover`, `Stepper`, `Tabs`, `Avatar` (génératif), `EmptyState`, `Skeleton`.
Chaque composant : une page de démo dans `/dev/ui` (route dev only) pour vérifier visuellement avec Playwright.

## 6. Textes (anglais, ton)
Court, chaleureux, un peu malicieux. Exemples :
- Capture : « Locked. +1 Gemini Shard. » / Perfect : « Clean lock! Bonus shard. »
- Trop loin : « 47 m away — get a bit closer. » · Recharge : « Relay recharging · 3:12 »
- Marchand fauché : « My till is empty. Sell me nothing, invest in me everything. »
- Forge : « Compiled. This is real compute now. » · Réserve basse : « The city's reserve is low — rare shards are hiding. »
- Mots interdits en jeu : blockchain, wallet, gas, transaction, NFT, crypto.

## 7. Qualité visuelle — définition de « fini »
Pour chaque écran : capture Playwright en 390×844 (iPhone 14) et 412×915 (Android), vérification des états (vide, chargement, erreur,
désactivé, succès), pas de débordement de texte, pas de saut de layout, 60 fps perçus sur la carte (pas de re-render React à chaque frame :
l'animation d'avatar/éclats passe par MapLibre ou CSS).
