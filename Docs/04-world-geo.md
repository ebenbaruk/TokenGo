# 04 — Monde, carte & géographie

## 1. Données disponibles dans le repo
| Fichier | Contenu | Source |
|---|---|---|
| `data/raw/paris-osm-pois.json` | 8 052 éléments OSM (Overpass, `out center tags`), 2,9 Mo | Requête `data/scripts/paris-pois.overpass` (2026-11-06) |
| `data/raw/paris-arrondissements.geojson` | 20 arrondissements (props `c_ar`, `c_arinsee`, `l_ar`) | opendata.paris.fr dataset `arrondissements` |
| `data/scripts/select-nodes-prototype.py` | Prototype de sélection gloutonne (référence, à porter en TS) | — |

Répartition (nommés) : artwork 2 420 (1 232), historic memorial/plaque 1 463 (594), historic autres 1 126 (896),
drinking_water 1 047, parcs 706 (537), attractions 351, fontaines 286, métro 257, bibliothèques 147, musées 147,
viewpoints 44, RER/train 32, cafés avec wikidata 26.

**À compléter au build** (2ᵉ requête Overpass, même zone, sauvegarder `data/raw/paris-osm-poi-extra.json`) pour les **marchands**
et les **affinités** : `amenity~"cafe|marketplace|bar|restaurant"` avec `name` *et* (`wikidata` OU `opening_hours`) — limiter côté script —,
`shop~"books|bakery|computer|electronics"`, `amenity~"university|college"`, `office~"coworking"` + `amenity="coworking_space"`,
`leisure~"garden"`, `tourism="gallery"`, `amenity="theatre"`. Endpoint `https://overpass-api.de/api/interpreter`,
User-Agent `TokenGo-hackathon/0.1`, retry avec backoff (souvent « at capacity » : réessayer, ~1 min).
Si Overpass refuse durablement : construire les marchands à partir des POI déjà présents (cafés wikidata + musées + attractions).

## 2. Génération des Nodes (`apps/server/scripts/build-world.ts` → `data/world/paris.json`, commité)
1. Normaliser : point = node ou `center` des ways/relations ; garder les éléments **nommés** (+ fontaines même anonymes).
   Jeter `drinking_water`, plaques commémoratives anonymes, `historic=memorial` de type `plaque`.
2. Dédupliquer : même nom normalisé à < 50 m → un seul.
3. Priorité : gares/métro > attractions/musées (wikidata d'abord) > parcs/bibliothèques/universités > reste.
4. Sélection gloutonne avec distance minimale **170 m** (cible ≈ 950 Relays pour Paris, ~9/km²).
5. **Markets** : parmi les POI commerciaux/culturels (cafés, librairies, marchés, galeries, théâtres), sélection gloutonne à **600 m**
   → cible ≈ 120–160 marchands. Un Market ne peut pas être à < 60 m d'un Relay (sinon on retire le Relay).
6. **Forges** : `data/paris/forges.json` (éditorial, 10 entrées : id, nom, coordonnées précises de l'esplanade accessible, thème).
7. Pour chaque Node : `id` stable = `osm:<type>/<id>` (Forges : `forge:<slug>`), `name`, `lat`, `lng`, `kind`, `h3_r9`, `district`
   (point-dans-polygone arrondissement), `tags` utiles, `affinities` (familles favorisées, §4).
8. Sortie validée par un test (comptes dans les fourchettes, pas de doublons < 50 m, tous dans Paris).

Marchands : à la création du monde, chaque Market reçoit un **merchant** : nom généré (prénom + métier, ex. « Margot the Fixer »,
« Bao, Shard Broker ») + personnalité (1 parmi 8 archétypes : Gambler, Hoarder, Scholar, Hustler, Grandma, Purist, Trendchaser, Night Owl),
déterministe à partir de l'id. Archétype = biais initial (spread, cibles), ton de voix pour le LLM.

## 3. Cellules H3 (h3-js 4.5)
- **Résolution 9** (~174 m d'arête, 0,105 km²) pour les spawns. `gridDisk(cell, 1)` autour du joueur (~7 cellules) puis **filtre haversine 250 m** côté serveur = zone de visibilité. (k=2 couvrirait ~600 m.)
- **Résolution 7** (~5 km²) = tuile de cache pour le monde « ailleurs » (§6).
- `poiRichness(cell)` (0..6) = min(6, nombre de Nodes dans la cellule + ½ × voisins) — précalculé pour Paris.

## 4. Affinités (lieu → familles d'éclats)
Table `AFFINITY_RULES` (dans `shared/economy/rules.ts`) : tags OSM → famille favorisée.
| Tags | Famille |
|---|---|
| `amenity=library|university|college`, `shop=books`, `amenity=theatre` | Claude |
| `railway=station`, `public_transport=station`, grands boulevards (`highway=primary|trunk` à proximité — optionnel) | GPT |
| `leisure=park|garden`, `natural=water`, `waterway`, `amenity=fountain`, musées de sciences | Gemini |
| `office=coworking`, `amenity=coworking_space`, `shop=computer|electronics`, Station F | Qwen |
| `amenity=cafe|bar|restaurant|marketplace`, `shop=*` | DeepSeek |
L'affinité d'une cellule = familles des Nodes de la cellule et des voisins immédiats (max 2 familles). Cellule sans Node = pas d'affinité.

## 5. Carte (front)
- **maplibre-gl 6.16** en direct (pas react-map-gl) dans un composant `GameMap` (`useRef` + `useEffect`), tout en **sources GeoJSON +
  couches symbol/circle** (pas de marqueurs DOM, sauf l'avatar si animé en CSS — sinon couche aussi).
- Tuiles **OpenFreeMap** (sans clé, usage commercial OK, pas de SLA) : partir du style `https://tiles.openfreemap.org/styles/liberty`
  (ou `positron`), le **télécharger** dans `apps/web/public/map/style.json` et le réécrire en **cartoon plat de jour** (`09-ux-ui-design.md` §1 Carte) :
  masquer POI/housenumbers/labels de routes mineures/hillshade/`building-3d` ; sol crème, eau `--sky`, parcs `--lime`, routes blanches à contour,
  bâtiments aplat beige rosé ; labels en Pixelify Sans (glyphs : vérifier que la police est disponible côté serveur de glyphs, sinon labels
  MapLibre en police par défaut + labels clés rendus nous-mêmes en couche symbol avec texte simple). Sprites des éclats/nœuds via `map.addImage`.
  Attribution visible obligatoire : « © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors » (contrôle compact).
- Caméra joueur : `easeTo({center, bearing: heading, pitch: 55, zoom: 17, duration: 600})` à chaque position ; geste utilisateur →
  mode libre 8 s puis recentrage ; bouton recentrer. `maxPitch 70`.
- Plan B tuiles (si OpenFreeMap tombe) : Protomaps PMTiles d'Île-de-France (`pmtiles extract … --bbox=1.44,48.12,3.56,49.24`), servi
  en statique — documenté, non implémenté sauf besoin.

## 6. « Partout » : régions générées (implémenté, `WORLD_ANYWHERE=1` par défaut)
Code : `apps/server/src/game/worldgen.ts` (pur, partagé avec `build-world.ts`), `game/regions.ts` (file, caps, persistance),
`game/world.ts` (`addRegion`). Constantes : `WORLD_GEN` dans `packages/shared/src/economy/rules.ts`.
- **Région = cellule H3 r7** (~5 km², ~1,2 km de rayon). Paris = les r7 qui contiennent un nœud de `paris.json` : jamais générées.
- **Déclenchement** : `GET /api/world` → `regions.ensure(lat, lng, ipHash)` sur la région du joueur + les r7 touchées par un disque de 600 m.
  La requête ne bloque jamais : réponse immédiate avec `region: { status: 'scouting' | 'ready' | 'capped', source, ids }` ; le client
  affiche « Scouting your neighbourhood… », réinterroge toutes les 1,5 s, puis annonce « Your neighbourhood is live · N relays · M merchants ».
- **Overpass** (serveur, une génération à la fois, User-Agent `TokenGo/1.0 (game; github.com/ebenbaruk/TokenGo)`) : miroirs `OVERPASS_URLS`
  (défaut overpass-api.de puis maps.mail.ru) dans un **budget total de 35 s** ; requête = cafés/marchés/librairies/boulangeries/tech,
  bibliothèques, universités, théâtres, fontaines, lieux de culte, mairies, musées, attractions, points de vue, œuvres, monuments, parcs,
  gares, coworkings, tous **nommés**, `out center tags 900`. Mesuré le 2026-11-07 autour de la Baixa (Lisbonne) : 823 éléments en 44 s →
  2 forges, 8 marchands, 63 relais (`node apps/server/scripts/region-spike.ts [lat] [lng]`).
- **Sélection** (même pipeline que Paris, déterministe pour une même réponse) : POI dont la cellule r9 appartient à la région ;
  Forges = repères (attraction/musée > culte/mairie > monument > point de vue, wikidata d'abord) espacés de 1 km, max 2, thème = affinités
  complétées à 2 familles ; Markets glouton 600 m (max 8) ; Relays glouton 170 m (max 80), dégagés des marchés (60 m) et forges (80 m).
  Pas de repère → le meilleur relais devient la Forge. Cellules (richesse/affinités) recalculées sur les r9 touchées.
- **Repli procédural** (Overpass injoignable/trop lent, ou < 8 relais / < 2 marchés) : déterministe depuis l'id de région — forge au centre,
  5 marchands espacés de 500 m, 36 relais sur les centres r9 mélangés (décalés ≤ 50 m), noms générés (« Corner Tea Room », « Willow Gardens »),
  catégories/affinités via des tags factices (parc → Gemini, librairie → Claude, gare → GPT…).
- **Persistance** : table `regions` (migration `005_regions.sql` : id, source, created_at, ip_hash, osm_elements, nodes JSON) ; rechargée au
  démarrage ; marchands créés avec la même graine que Paris (`createMerchant(SPAWN_SECRET, nodeId, affinités)`), sous-comptes NEAR paresseux
  comme à Paris. `district = 0` hors Paris (classements d'arrondissements inchangés). Runners-agents et Lab : Paris seulement.
- **Garde-fous** : 300 régions/jour au global, 12/jour par IP (hachée), plafonds de nœuds par région ; au-delà → `capped`
  (« No new neighbourhoods today » + lien Remote Scout).
- **Économie / Réserve** : une seule Réserve pour le monde entier (« ville » globale) — les poches, le cap Forge de 5,5 %/jour de la poche et
  l'invariant de solvabilité sont globaux, donc inchangés quel que soit le nombre de régions. Les règles de paiement ne dépendent pas du lieu.
- **Carte** : tuiles vectorielles OpenFreeMap `planet` → le style cartoon s'affiche partout sans changement (CSP inchangée).

## 6 bis. Remote Scout (jouer depuis chez soi)
Remplace « Demo Walk ». Le jeu se joue en marchant ; le **Remote Scout** est un pigeon-coursier à hélice (sprite `sprites/scout.grids.ts`)
piloté au doigt : tap sur la carte = vol à 30 km/h, nœud lointain = « Dash » animé de 3 s. Compte `mode = 'demo'` (inchangé côté données) :
`?demo=1` et le lien juges `?k=` y mènent. Règles serveur (`packages/shared/src/economy/scout.ts`, constantes `SCOUT`) à chaque `/api/move` :
- batterie 0–100 %, **30 %/km** volé, recharge continue **8 %/min** (pleine en 12,5 min) ;
- au-delà de **40 km/h** c'est un Dash : **× 1,5** et jamais plus de **1,5 km** d'un coup (`HOP_TOO_LONG`) ;
- batterie insuffisante → vol refusé (`refused: 'BATTERY_EMPTY'`, la position serveur ne bouge pas) ; sous 10 % le Scout est **au sol**
  jusqu'à 10 % (~75 s) ; sans position depuis 15 min : relance libre (nouvelle session). Ordre de grandeur : ~14 min de vol continu,
  la boucle démo du Louvre (2–3 km) tient sur une batterie.
- Récompenses **identiques à l'ancien mode démo** : pas de poche Main, Judge Pool via pass `DEMO_TOKEN` seulement, First Compile (Welcome).
- HUD : badge « Scout » + batterie (ou « Walking » en GPS), bandeau « Scout recharging · flies again in 0:36 ».

## 7. Géolocalisation (front)
- `watchPosition({enableHighAccuracy: true, maximumAge: 2000, timeout: 15000})`. Exige un **contexte sécurisé** (HTTPS ; localhost OK).
- Filtrer `accuracy > 60 m` (ignorer, afficher « Weak GPS ») ; lisser (moyenne pondérée par la précision sur les 3 derniers fixes).
- Envoi au serveur : au plus 1 position / 3 s, et seulement si déplacement > 5 m ou 15 s écoulées (`POST /api/move`).
- Boussole : iOS `DeviceOrientationEvent.requestPermission()` dans un tap (bouton « Enable compass » dans les réglages / onboarding),
  `webkitCompassHeading` ; Android `deviceorientationabsolute` (`360 − alpha`) ; sinon `coords.heading` en mouvement.
- Wake Lock `navigator.wakeLock.request('screen')` pendant le jeu (re-demander sur `visibilitychange`). Pas de géoloc en arrière-plan :
  à la reprise, le serveur traite le saut comme un « retour » (pas comme une triche) si le temps écoulé rend la vitesse plausible.
- PWA : `manifest.webmanifest` (standalone, icônes 192/512, theme/background sombres), meta `apple-mobile-web-app-*`, invitation discrète
  « Add to Home Screen » sur iOS (Share → Add).
