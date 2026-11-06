// Construit data/world/paris.json à partir des extraits OSM (Docs/04 §2–§4).
// Usage : npm run build-world   (déterministe : même entrée → même sortie, hors builtAt)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLngToCell, gridDisk } from 'h3-js';
import { FAMILIES, type Family, type ForgeDef, type NodeKind, type WorldFile, type WorldNode } from '@tokengo/shared/types.ts';
import { affinitiesOfTags, nodeCategory, type OsmTags } from '@tokengo/shared/economy/affinity.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const p = (rel: string) => join(ROOT, rel);

// ── Paramètres (Docs/04 §2) ────────────────────────────────────────────────
const DEDUPE_M = 50;          // même nom normalisé à < 50 m → un seul
const RELAY_MIN_M = 170;      // espacement glouton des Relays
const MARKET_MIN_M = 600;     // espacement glouton des Markets (spec : 450 m → 240 marchands ; 600 m → ~150, dans la cible 120–160)
const RELAY_CLEAR_OF_MARKET_M = 60;
const CLEAR_OF_FORGE_M = 80;
const EDITORIAL_CLEAR_M = 300; // rayon autour d'un marchand éditorial où l'on retire les marchands gloutons
const H3_RES = 9;

// ── Types d'entrée ─────────────────────────────────────────────────────────
interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
interface Poi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tags: OsmTags;
  category: string;
  wikidata: boolean;
}
interface ExtraMarket { id: string; name: string; lat: number; lng: number; category: string; affinities: Family[] }

// ── Géométrie ──────────────────────────────────────────────────────────────
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Index spatial en grille (cellule = rayon de recherche) : « y a-t-il un point à < r m ? ». */
function makeGrid(cellM: number) {
  const M_PER_DEG_LAT = 111_195, M_PER_DEG_LNG = 111_195 * Math.cos((48.86 * Math.PI) / 180);
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

type Ring = number[][];
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number], [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  const [outer, ...holes] = rings;
  return !!outer && inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h));
}
function loadDistricts(): (lat: number, lng: number) => number {
  const gj = JSON.parse(readFileSync(p('data/raw/paris-arrondissements.geojson'), 'utf8')) as {
    features: { properties: { c_ar: number }; geometry: { type: string; coordinates: unknown } }[];
  };
  const polys = gj.features.map((f) => ({
    district: Number(f.properties.c_ar),
    polygons: f.geometry.type === 'Polygon' ? [f.geometry.coordinates as Ring[]] : (f.geometry.coordinates as Ring[][]),
  }));
  return (lat, lng) => polys.find((d) => d.polygons.some((rings) => inPolygon(lng, lat, rings)))?.district ?? 0;
}

// ── Normalisation ──────────────────────────────────────────────────────────
export const normName = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function toPoi(e: OsmElement): Poi | null {
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
    category: nodeCategory(tags),
    wikidata: !!tags.wikidata,
  };
}

/** Rang de priorité des Relays (petit = d'abord). Docs/04 §2.3. */
function relayRank(c: string): number {
  if (c === 'metro' || c === 'train') return 0;
  if (c === 'attraction' || c === 'museum') return 1;
  if (['park', 'garden', 'library', 'university', 'viewpoint', 'coworking'].includes(c)) return 2;
  if (['fountain', 'monument', 'station', 'theatre'].includes(c)) return 3;
  if (c === 'artwork') return 4;
  return 5; // memorial, tombes, divers
}
/** Rang de priorité des Markets : marchés couverts > lieux notables > librairies/théâtres > cafés/bars/galeries > boutiques. */
function marketRank(poi: Poi): number {
  const c = poi.category;
  if (c === 'marketplace') return 0;
  if (poi.wikidata && ['cafe', 'bar', 'restaurant', 'bookshop', 'theatre', 'gallery'].includes(c)) return 1;
  if (c === 'bookshop' || c === 'theatre') return 2;
  if (c === 'cafe' || c === 'gallery' || c === 'tech_shop') return 3;
  if (c === 'bar' || c === 'restaurant') return 4;
  return 5; // boulangeries, autres
}
const MARKET_CATEGORIES = new Set(['marketplace', 'cafe', 'bar', 'restaurant', 'bookshop', 'theatre', 'gallery', 'tech_shop', 'bakery']);
const RELAY_EXCLUDED = new Set([...MARKET_CATEGORIES].filter((c) => c !== 'theatre'));

const byRank = <T extends Poi>(rank: (x: T) => number) => (a: T, b: T) =>
  rank(a) - rank(b) || Number(b.wikidata) - Number(a.wikidata) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function dedupe(pois: Poi[]): Poi[] {
  const groups = new Map<string, Poi[]>();
  const out: Poi[] = [];
  for (const poi of pois) {
    const k = poi.name === 'Fontaine' ? `${poi.id}` : normName(poi.name);
    const kept = groups.get(k) ?? [];
    if (kept.some((q) => haversineM(poi.lat, poi.lng, q.lat, q.lng) < DEDUPE_M)) continue;
    kept.push(poi);
    groups.set(k, kept);
    out.push(poi);
  }
  return out;
}

function greedy<T extends { lat: number; lng: number }>(sorted: T[], minM: number): T[] {
  const grid = makeGrid(minM);
  const out: T[] = [];
  for (const x of sorted) {
    if (grid.hasWithin(x.lat, x.lng, minM)) continue;
    grid.add(x.lat, x.lng);
    out.push(x);
  }
  return out;
}

// ── Pipeline ───────────────────────────────────────────────────────────────
export function buildWorld(): { world: WorldFile; dropped: Record<string, number> } {
  const districtOf = loadDistricts();
  const read = (rel: string) => (JSON.parse(readFileSync(p(rel), 'utf8')) as { elements: OsmElement[] }).elements;
  const raw = [...read('data/raw/paris-osm-pois.json'), ...read('data/raw/paris-osm-poi-extra.json')];
  const forges = JSON.parse(readFileSync(p('data/paris/forges.json'), 'utf8')) as ForgeDef[];
  const extraPath = p('data/paris/extra-markets.json'); // optionnel : marchands éditoriaux (ex. démo au Louvre)
  const extraMarkets = existsSync(extraPath) ? (JSON.parse(readFileSync(extraPath, 'utf8')) as ExtraMarket[]) : [];
  const dropped = { outsideParis: 0, duplicates: 0, nearMarket: 0, nearForge: 0 };

  // 1. normaliser (un élément peut sortir des 2 requêtes : on garde la 1ʳᵉ occurrence de l'id)
  const seen = new Set<string>();
  let pois: Poi[] = [];
  for (const e of raw) {
    const poi = toPoi(e);
    if (!poi || seen.has(poi.id)) continue;
    seen.add(poi.id);
    pois.push(poi);
  }
  const before = pois.length;
  pois = pois.filter((x) => districtOf(x.lat, x.lng) > 0);
  dropped.outsideParis = before - pois.length;

  // 2–4. Relays : priorité, déduplication, glouton 170 m
  const relayCandidates = pois.filter((x) => !RELAY_EXCLUDED.has(x.category)).sort(byRank((x) => relayRank(x.category)));
  const relayPool = dedupe(relayCandidates);
  // 5. Markets : POI commerciaux/culturels, glouton (MARKET_MIN_M) + marchands éditoriaux (data/paris/extra-markets.json)
  const marketCandidates = pois.filter((x) => MARKET_CATEGORIES.has(x.category)).sort(byRank(marketRank));
  const marketPool = dedupe(marketCandidates);
  dropped.duplicates = relayCandidates.length - relayPool.length + marketCandidates.length - marketPool.length;
  const editorial: Poi[] = extraMarkets.map((m) => ({ ...m, tags: {}, wikidata: true }));
  // Les éditoriaux sont forcés (hors règle des 600 m) ; les marchands gloutons trop proches d'eux s'effacent.
  const markets = [
    ...editorial,
    ...greedy(marketPool, MARKET_MIN_M).filter(
      (m) => !editorial.some((e) => e.id === m.id || haversineM(m.lat, m.lng, e.lat, e.lng) < EDITORIAL_CLEAR_M),
    ),
  ];
  const marketIds = new Set(markets.map((m) => m.id));

  const forgeGrid = makeGrid(CLEAR_OF_FORGE_M);
  for (const f of forges) forgeGrid.add(f.lat, f.lng);
  const marketGrid = makeGrid(RELAY_CLEAR_OF_MARKET_M);
  for (const m of markets) marketGrid.add(m.lat, m.lng);

  const relays = greedy(relayPool, RELAY_MIN_M).filter((r) => {
    if (marketIds.has(r.id) || marketGrid.hasWithin(r.lat, r.lng, RELAY_CLEAR_OF_MARKET_M)) return dropped.nearMarket++, false;
    if (forgeGrid.hasWithin(r.lat, r.lng, CLEAR_OF_FORGE_M)) return dropped.nearForge++, false;
    return true;
  });
  const keptMarkets = markets.filter((m) => !forgeGrid.hasWithin(m.lat, m.lng, CLEAR_OF_FORGE_M) || (dropped.nearForge++, false));

  // 7. sortie
  const editorialAff = new Map(extraMarkets.map((m) => [m.id, m.affinities]));
  const toNode = (x: Poi, kind: NodeKind): WorldNode => ({
    id: x.id,
    kind,
    name: x.name,
    lat: x.lat,
    lng: x.lng,
    h3: latLngToCell(x.lat, x.lng, H3_RES),
    district: districtOf(x.lat, x.lng),
    category: x.category,
    affinities: editorialAff.get(x.id) ?? affinitiesOfTags(x.tags),
  });
  const nodes: WorldNode[] = [
    ...forges.map((f): WorldNode => ({
      id: f.id, kind: 'forge', name: f.name, lat: f.lat, lng: f.lng,
      h3: latLngToCell(f.lat, f.lng, H3_RES), district: districtOf(f.lat, f.lng), category: 'forge', affinities: f.theme.slice(0, 2),
    })),
    ...keptMarkets.map((m) => toNode(m, 'market')),
    ...relays.map((r) => toNode(r, 'relay')),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { world: { version: 1, city: 'paris', builtAt: new Date().toISOString(), nodes, cells: buildCells(nodes) }, dropped };
}

/** Docs/04 §3–§4 : richesse et affinités pour toute cellule r9 contenant un Node ou voisine d'une telle cellule. */
export function buildCells(nodes: WorldNode[]): WorldFile['cells'] {
  const byCell = new Map<string, WorldNode[]>();
  for (const n of nodes) byCell.set(n.h3, [...(byCell.get(n.h3) ?? []), n]);
  const targets = new Set<string>();
  for (const c of byCell.keys()) for (const k of gridDisk(c, 1)) targets.add(k);

  const cells: WorldFile['cells'] = {};
  for (const cell of [...targets].sort()) {
    const own = byCell.get(cell) ?? [];
    const neigh = gridDisk(cell, 1).filter((k) => k !== cell).flatMap((k) => byCell.get(k) ?? []);
    const richness = Math.round(Math.min(6, own.length + 0.5 * neigh.length) * 10) / 10;
    const count = new Map<Family, number>();
    for (const n of [...own, ...neigh]) for (const f of n.affinities) count.set(f, (count.get(f) ?? 0) + 1);
    const affinities = [...count.entries()]
      .sort((a, b) => b[1] - a[1] || FAMILIES.indexOf(a[0]) - FAMILIES.indexOf(b[0]))
      .slice(0, 2)
      .map(([f]) => f);
    cells[cell] = { richness, affinities };
  }
  return cells;
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const { world, dropped } = buildWorld();
  const out = p('data/world/paris.json');
  mkdirSync(dirname(out), { recursive: true });
  const json = JSON.stringify(world);
  writeFileSync(out, json + '\n');

  const tally = (f: (n: WorldNode) => string | number, list = world.nodes) => {
    const m = new Map<string | number, number>();
    for (const n of list) m.set(f(n), (m.get(f(n)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ');
  };
  console.log(`paris.json — ${world.nodes.length} nodes, ${Object.keys(world.cells).length} cells, ${(json.length / 1024).toFixed(0)} Ko, ${Date.now() - t0} ms`);
  console.log('kind     ', tally((n) => n.kind));
  console.log('relays   ', tally((n) => n.category, world.nodes.filter((n) => n.kind === 'relay')));
  console.log('markets  ', tally((n) => n.category, world.nodes.filter((n) => n.kind === 'market')));
  console.log('district ', tally((n) => n.district));
  console.log('affinity ', tally((n) => n.affinities[0] ?? '-'));
  console.log('dropped  ', JSON.stringify(dropped));
}
