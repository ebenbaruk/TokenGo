// Génération du monde (fonctions pures) : sélection des Nodes depuis des POI OSM, cellules (richesse, affinités),
// et régions « partout » (cellule H3 r7) depuis une réponse Overpass ou, à défaut, de façon procédurale.
// Utilisé par scripts/build-world.ts (Paris, précalculé) et game/regions.ts (régions générées à la volée).
// Déterministe : même entrée (réponse OSM, id de région) → même sortie.
import { cellToBoundary, cellToChildren, cellToLatLng, cellToParent, gridDisk, latLngToCell } from 'h3-js';
import {
  FAMILIES, H3_RES, WORLD_GEN, affinitiesOfTags, nodeCategory, offsetM, pick, rngFrom,
  type Family, type NodeKind, type OsmTags, type Rng, type WorldFile, type WorldNode,
} from '@tokengo/shared';

// ── Paramètres de sélection (Docs/04 §2) ───────────────────────────────────
export const SELECT = {
  dedupeM: 50,            // même nom normalisé à < 50 m → un seul
  relayMinM: 170,         // espacement glouton des Relays
  marketMinM: 600,        // espacement glouton des Markets
  relayClearOfMarketM: 60,
  clearOfForgeM: 80,
} as const;

// ── Types d'entrée ─────────────────────────────────────────────────────────
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
export interface Poi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tags: OsmTags;
  category: string;
  wikidata: boolean;
}

// ── Géométrie ──────────────────────────────────────────────────────────────
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Index spatial en grille (cellule = rayon de recherche) : « y a-t-il un point à < r m ? ». `refLat` : latitude de la zone. */
export function makeGrid(cellM: number, refLat = 48.86) {
  const M_PER_DEG_LAT = 111_195, M_PER_DEG_LNG = 111_195 * Math.cos((refLat * Math.PI) / 180);
  const cells = new Map<string, { lat: number; lng: number }[]>();
  const key = (gx: number, gy: number) => `${gx},${gy}`;
  const coords = (lat: number, lng: number) => [Math.floor((lng * M_PER_DEG_LNG) / cellM), Math.floor((lat * M_PER_DEG_LAT) / cellM)] as const;
  return {
    add(lat: number, lng: number) {
      const [gx, gy] = coords(lat, lng);
      const k = key(gx, gy);
      const list = cells.get(k) ?? [];
      list.push({ lat, lng });
      cells.set(k, list);
    },
    hasWithin(lat: number, lng: number, r: number): boolean {
      const [gx, gy] = coords(lat, lng);
      const span = Math.ceil(r / cellM);
      for (let dx = -span; dx <= span; dx++)
        for (let dy = -span; dy <= span; dy++)
          for (const q of cells.get(key(gx + dx, gy + dy)) ?? []) if (haversineM(lat, lng, q.lat, q.lng) < r) return true;
      return false;
    },
  };
}

// ── Normalisation ──────────────────────────────────────────────────────────
export const normName = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Élément OSM → POI nommé (fontaines même anonymes), ou null. `categorize` : catégorie lisible (défaut : nodeCategory). */
export function toPoi(e: OsmElement, categorize: (t: OsmTags) => string = nodeCategory): Poi | null {
  const tags = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
  if (lat === undefined || lng === undefined) return null;
  if (tags.amenity === 'drinking_water') return null;
  if (tags.historic === 'plaque' || (tags.historic === 'memorial' && tags.memorial === 'plaque')) return null;
  const isFountain = tags.amenity === 'fountain';
  const name = tags.name?.trim() || (isFountain ? 'Fontaine' : '');
  if (!name) return null;
  return {
    id: `osm:${e.type}/${e.id}`,
    name,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    tags,
    category: categorize(tags),
    wikidata: !!tags.wikidata,
  };
}

/** Rang de priorité des Relays (petit = d'abord). Docs/04 §2.3. */
export function relayRank(c: string): number {
  if (c === 'metro' || c === 'train') return 0;
  if (c === 'attraction' || c === 'museum') return 1;
  if (['park', 'garden', 'library', 'university', 'viewpoint', 'coworking'].includes(c)) return 2;
  if (['fountain', 'monument', 'station', 'theatre', 'worship', 'townhall'].includes(c)) return 3;
  if (c === 'artwork') return 4;
  return 5; // memorial, tombes, divers
}
/** Rang de priorité des Markets : marchés couverts > lieux notables > librairies/théâtres > cafés/bars/galeries > boutiques. */
export function marketRank(poi: Poi): number {
  const c = poi.category;
  if (c === 'marketplace') return 0;
  if (poi.wikidata && ['cafe', 'bar', 'restaurant', 'bookshop', 'theatre', 'gallery'].includes(c)) return 1;
  if (c === 'bookshop' || c === 'theatre') return 2;
  if (c === 'cafe' || c === 'gallery' || c === 'tech_shop') return 3;
  if (c === 'bar' || c === 'restaurant') return 4;
  return 5; // boulangeries, autres
}
export const MARKET_CATEGORIES = new Set(['marketplace', 'cafe', 'bar', 'restaurant', 'bookshop', 'theatre', 'gallery', 'tech_shop', 'bakery']);
export const RELAY_EXCLUDED = new Set([...MARKET_CATEGORIES].filter((c) => c !== 'theatre'));

export const byRank = <T extends Poi>(rank: (x: T) => number) => (a: T, b: T) =>
  rank(a) - rank(b) || Number(b.wikidata) - Number(a.wikidata) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function dedupe(pois: Poi[]): Poi[] {
  const groups = new Map<string, Poi[]>();
  const out: Poi[] = [];
  for (const poi of pois) {
    const k = poi.name === 'Fontaine' ? `${poi.id}` : normName(poi.name);
    const kept = groups.get(k) ?? [];
    if (kept.some((q) => haversineM(poi.lat, poi.lng, q.lat, q.lng) < SELECT.dedupeM)) continue;
    kept.push(poi);
    groups.set(k, kept);
    out.push(poi);
  }
  return out;
}

export function greedy<T extends { lat: number; lng: number }>(sorted: T[], minM: number, refLat?: number): T[] {
  const grid = makeGrid(minM, refLat);
  const out: T[] = [];
  for (const x of sorted) {
    if (grid.hasWithin(x.lat, x.lng, minM)) continue;
    grid.add(x.lat, x.lng);
    out.push(x);
  }
  return out;
}

// ── Cellules (Docs/04 §3–§4) ───────────────────────────────────────────────
/** Richesse et affinités d'une cellule r9 d'après les Nodes de la cellule et de ses voisines immédiates. */
export function cellInfoAt(cell: string, nodesIn: (c: string) => readonly WorldNode[]): { richness: number; affinities: Family[] } {
  const own = nodesIn(cell);
  const neigh = gridDisk(cell, 1).filter((k) => k !== cell).flatMap((k) => nodesIn(k));
  const richness = Math.round(Math.min(6, own.length + 0.5 * neigh.length) * 10) / 10;
  const count = new Map<Family, number>();
  for (const n of [...own, ...neigh]) for (const f of n.affinities) count.set(f, (count.get(f) ?? 0) + 1);
  const affinities = [...count.entries()]
    .sort((a, b) => b[1] - a[1] || FAMILIES.indexOf(a[0]) - FAMILIES.indexOf(b[0]))
    .slice(0, 2)
    .map(([f]) => f);
  return { richness, affinities };
}

/** Cellules à recalculer autour de ces Nodes (leur cellule + voisines). */
export const touchedCells = (nodes: readonly WorldNode[]): string[] => {
  const s = new Set<string>();
  for (const n of nodes) for (const k of gridDisk(n.h3, 1)) s.add(k);
  return [...s].sort();
};

/** Toute cellule r9 contenant un Node ou voisine d'une telle cellule. */
export function buildCells(nodes: WorldNode[]): WorldFile['cells'] {
  const byCell = new Map<string, WorldNode[]>();
  for (const n of nodes) byCell.set(n.h3, [...(byCell.get(n.h3) ?? []), n]);
  const cells: WorldFile['cells'] = {};
  for (const cell of touchedCells(nodes)) cells[cell] = cellInfoAt(cell, (c) => byCell.get(c) ?? []);
  return cells;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ── Régions « partout » ────────────────────────────────────────────────────
export const regionOf = (lat: number, lng: number): string => latLngToCell(lat, lng, WORLD_GEN.regionRes);

/** Régions (r7) touchées par un disque de `radiusM` autour du point ; la région du point d'abord. */
export function regionsAround(lat: number, lng: number, radiusM: number = WORLD_GEN.ensureRadiusM): string[] {
  const own = regionOf(lat, lng);
  const out = new Set<string>([own]);
  const k = Math.ceil(radiusM / 300);
  for (const c of gridDisk(latLngToCell(lat, lng, H3_RES), k)) {
    const [clat, clng] = cellToLatLng(c);
    if (haversineM(lat, lng, clat, clng) <= radiusM) out.add(cellToParent(c, WORLD_GEN.regionRes));
  }
  return [own, ...[...out].filter((r) => r !== own).sort()];
}

/** Boîte englobante [sud, ouest, nord, est] d'une région (pour la requête Overpass). */
export function regionBBox(regionId: string): [number, number, number, number] {
  const b = cellToBoundary(regionId);
  const lats = b.map((p) => p[0]), lngs = b.map((p) => p[1]);
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  return [r(Math.min(...lats)), r(Math.min(...lngs)), r(Math.max(...lats)), r(Math.max(...lngs))];
}

/** Requête Overpass QL : lieux nommés utiles (relais, marchands, forges) dans la boîte de la région. */
export function overpassQuery(regionId: string): string {
  const bb = regionBBox(regionId).join(',');
  const sel = [
    '["amenity"~"^(cafe|marketplace|library|university|college|theatre|fountain|place_of_worship|townhall|coworking_space|arts_centre)$"]["name"]',
    '["shop"~"^(books|bakery|computer|electronics)$"]["name"]',
    '["tourism"~"^(museum|gallery|attraction|viewpoint|artwork)$"]["name"]',
    '["historic"~"^(monument|memorial|castle|church|ruins|fort|building)$"]["name"]',
    '["leisure"~"^(park|garden)$"]["name"]',
    '["railway"="station"]["name"]',
    '["office"="coworking"]["name"]',
  ];
  return `[out:json][timeout:30];(${sel.map((s) => `nwr${s}(${bb});`).join('')});out center tags ${WORLD_GEN.overpassMaxElements};`;
}

/** Catégorie lisible hors Paris : + lieux de culte et mairies (candidats Forge). */
export function regionCategory(tags: OsmTags): string {
  if (tags.amenity === 'place_of_worship') return 'worship';
  if (tags.amenity === 'townhall') return 'townhall';
  if (tags.historic === 'castle' || tags.historic === 'fort') return 'monument';
  return nodeCategory(tags);
}
const LANDMARK = new Set(['attraction', 'museum', 'worship', 'townhall', 'monument', 'viewpoint']);
/** Rang des candidats Forge : attractions/musées > lieux de culte/mairies > monuments > points de vue. */
const landmarkRank = (p: Poi): number =>
  ({ attraction: 0, museum: 0, worship: 1, townhall: 1, monument: 2, viewpoint: 3 } as Record<string, number>)[p.category] ?? 9;

/** Thème d'une Forge générée : ses affinités, complétées de façon déterministe jusqu'à 2 familles. */
function forgeTheme(rng: Rng, base: Family[]): Family[] {
  const theme = base.slice(0, 2);
  while (theme.length < 2) {
    const f = pick(rng, FAMILIES);
    if (!theme.includes(f)) theme.push(f);
  }
  return theme;
}

const toNode = (x: { id: string; name: string; lat: number; lng: number; category: string }, kind: NodeKind, region: string, affinities: Family[]): WorldNode => ({
  id: x.id, kind, name: x.name.slice(0, 80), lat: x.lat, lng: x.lng, h3: latLngToCell(x.lat, x.lng, H3_RES), district: 0,
  category: x.category, affinities, region,
});

export interface GeneratedRegion { id: string; source: 'osm' | 'procedural'; nodes: WorldNode[] }

/**
 * Région depuis une réponse Overpass (même pipeline que Paris : priorité, déduplication, glouton), ou null si trop pauvre.
 * Seuls les POI dont la cellule r9 appartient à la région sont gardés (pas de doublon entre régions voisines).
 */
export function selectRegion(regionId: string, elements: readonly OsmElement[]): GeneratedRegion | null {
  const [refLat] = cellToLatLng(regionId);
  const seen = new Set<string>();
  const pois: Poi[] = [];
  for (const e of elements) {
    const poi = toPoi(e, regionCategory);
    if (!poi || seen.has(poi.id)) continue;
    if (cellToParent(latLngToCell(poi.lat, poi.lng, H3_RES), WORLD_GEN.regionRes) !== regionId) continue;
    seen.add(poi.id);
    pois.push(poi);
  }
  pois.sort(byId);
  const rng = rngFrom('tokengo-region', regionId);

  // Forges : repères (wikidata d'abord), espacés d'au moins 1 km
  const landmarks = dedupe(pois.filter((p) => LANDMARK.has(p.category)).sort(byRank(landmarkRank)));
  const forgePois = greedy(landmarks, WORLD_GEN.forgeMinSpacingM, refLat).slice(0, WORLD_GEN.maxForges);
  const used = new Set(forgePois.map((f) => f.id));
  const forgeGrid = makeGrid(SELECT.clearOfForgeM, refLat);
  for (const f of forgePois) forgeGrid.add(f.lat, f.lng);

  const markets = greedy(dedupe(pois.filter((p) => MARKET_CATEGORIES.has(p.category) && !used.has(p.id)).sort(byRank(marketRank))), SELECT.marketMinM, refLat)
    .filter((m) => !forgeGrid.hasWithin(m.lat, m.lng, SELECT.clearOfForgeM))
    .slice(0, WORLD_GEN.maxMarkets);
  const marketGrid = makeGrid(SELECT.relayClearOfMarketM, refLat);
  for (const m of markets) { marketGrid.add(m.lat, m.lng); used.add(m.id); }

  const relays = greedy(dedupe(pois.filter((p) => !RELAY_EXCLUDED.has(p.category) && !used.has(p.id)).sort(byRank((x) => relayRank(x.category)))), SELECT.relayMinM, refLat)
    .filter((r) => !marketGrid.hasWithin(r.lat, r.lng, SELECT.relayClearOfMarketM) && !forgeGrid.hasWithin(r.lat, r.lng, SELECT.clearOfForgeM))
    .slice(0, WORLD_GEN.maxRelays);

  if (relays.length < WORLD_GEN.minOsmRelays || markets.length < WORLD_GEN.minOsmMarkets) return null;
  // pas de repère : le meilleur relais devient la Forge du quartier
  if (!forgePois.length) forgePois.push(relays.shift()!);

  const nodes: WorldNode[] = [
    ...forgePois.map((f) => {
      const theme = forgeTheme(rng, affinitiesOfTags(f.tags));
      return { ...toNode({ ...f, id: `forge:${f.id.replace(/^osm:/, 'osm-').replace('/', '-')}`, category: 'forge' }, 'forge', regionId, theme), theme };
    }),
    ...markets.map((m) => toNode(m, 'market', regionId, affinitiesOfTags(m.tags))),
    ...relays.map((r) => toNode(r, 'relay', regionId, affinitiesOfTags(r.tags))),
  ].sort(byId);
  return { id: regionId, source: 'osm', nodes };
}

// ── Repli procédural (Overpass injoignable ou quartier trop pauvre en POI) ──
const RELAY_KINDS: { category: string; tags: OsmTags; nouns: string[] }[] = [
  { category: 'park', tags: { leisure: 'park' }, nouns: ['Park', 'Gardens', 'Green', 'Square'] },
  { category: 'fountain', tags: { amenity: 'fountain' }, nouns: ['Fountain', 'Well', 'Spring'] },
  { category: 'library', tags: { amenity: 'library' }, nouns: ['Library', 'Reading Room', 'Archive'] },
  { category: 'station', tags: { railway: 'station' }, nouns: ['Station', 'Halt', 'Junction'] },
  { category: 'monument', tags: { historic: 'monument' }, nouns: ['Monument', 'Obelisk', 'Arch', 'Statue'] },
  { category: 'artwork', tags: { tourism: 'artwork' }, nouns: ['Mural', 'Sculpture', 'Mosaic'] },
  { category: 'coworking', tags: { amenity: 'coworking_space' }, nouns: ['Hub', 'Lab', 'Workshop'] },
];
const MARKET_KINDS: { category: string; tags: OsmTags; nouns: string[] }[] = [
  { category: 'cafe', tags: { amenity: 'cafe' }, nouns: ['Café', 'Coffee Bar', 'Tea Room'] },
  { category: 'bookshop', tags: { shop: 'books' }, nouns: ['Books', 'Bookshop'] },
  { category: 'tech_shop', tags: { shop: 'electronics' }, nouns: ['Electronics', 'Repair Shop'] },
  { category: 'marketplace', tags: { amenity: 'marketplace' }, nouns: ['Market', 'Bazaar'] },
  { category: 'bakery', tags: { shop: 'bakery' }, nouns: ['Bakery', 'Bakehouse'] },
];
const ADJ = ['Old', 'Little', 'Corner', 'Sunny', 'Lantern', 'Copper', 'Willow', 'Harbour', 'Hilltop', 'Clock', 'Pigeon', 'Velvet',
  'Signal', 'Maple', 'Pixel', 'Riverside', 'Quiet', 'Golden', 'Blue Door', 'Echo'];
const FORGE_NAMES = ['The Clocktower', 'Old Town Hall', 'Lighthouse Steps', 'The Great Arch', 'Bell Tower Square', 'The Observatory'];

/** Région procédurale : déterministe à partir de l'id (aucune donnée réseau). */
export function proceduralRegion(regionId: string): GeneratedRegion {
  const rng = rngFrom('tokengo-procedural', regionId);
  const [refLat] = cellToLatLng(regionId);
  const names = new Set<string>();
  const nameOf = (nouns: string[]) => {
    for (let i = 0; i < 20; i++) {
      const n = `${pick(rng, ADJ)} ${pick(rng, nouns)}`;
      if (!names.has(n)) { names.add(n); return n; }
    }
    return `${pick(rng, ADJ)} ${pick(rng, nouns)} ${names.size}`;
  };
  // points candidats : centres des cellules r9 de la région, mélangés (Fisher–Yates) puis légèrement décalés
  const cells = cellToChildren(regionId, H3_RES).sort();
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j]!, cells[i]!];
  }
  const jitter = (c: string) => {
    const [lat, lng] = cellToLatLng(c);
    const p = offsetM({ lat, lng }, (rng() - 0.5) * 100, (rng() - 0.5) * 100);
    return { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
  };
  const P = WORLD_GEN.procedural;
  const [clat, clng] = cellToLatLng(regionId);
  const forges = [{ id: `forge:gen-${regionId}`, name: pick(rng, FORGE_NAMES), lat: clat, lng: clng, category: 'forge' }].slice(0, P.forges);
  const taken = makeGrid(150, refLat);
  for (const f of forges) taken.add(f.lat, f.lng);
  const out: WorldNode[] = forges.map((f) => {
    const theme = forgeTheme(rng, []);
    return { ...toNode(f, 'forge', regionId, theme), theme };
  });
  let m = 0, r = 0;
  const marketGrid = makeGrid(500, refLat);
  for (const c of cells) {
    if (m >= P.markets && r >= P.relays) break;
    const p = jitter(c);
    if (taken.hasWithin(p.lat, p.lng, 150)) continue;
    if (m < P.markets && !marketGrid.hasWithin(p.lat, p.lng, 500)) {
      const k = pick(rng, MARKET_KINDS);
      out.push(toNode({ id: `gen:${regionId}:m${m}`, name: nameOf(k.nouns), ...p, category: k.category }, 'market', regionId, affinitiesOfTags(k.tags)));
      marketGrid.add(p.lat, p.lng);
      taken.add(p.lat, p.lng);
      m++;
    } else if (r < P.relays) {
      const k = pick(rng, RELAY_KINDS);
      out.push(toNode({ id: `gen:${regionId}:r${r}`, name: nameOf(k.nouns), ...p, category: k.category }, 'relay', regionId, affinitiesOfTags(k.tags)));
      taken.add(p.lat, p.lng);
      r++;
    }
  }
  return { id: regionId, source: 'procedural', nodes: out.sort(byId) };
}

/** OSM si la réponse est assez riche, sinon procédural. `elements` null = Overpass injoignable. */
export const generateRegion = (regionId: string, elements: readonly OsmElement[] | null): GeneratedRegion =>
  (elements && selectRegion(regionId, elements)) || proceduralRegion(regionId);
