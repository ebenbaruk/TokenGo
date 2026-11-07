// Construit data/world/paris.json à partir des extraits OSM (Docs/04 §2–§4).
// Usage : npm run build-world   (déterministe : même entrée → même sortie, hors builtAt)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLngToCell } from 'h3-js';
import type { Family, ForgeDef, NodeKind, WorldFile, WorldNode } from '@tokengo/shared/types.ts';
import { affinitiesOfTags } from '@tokengo/shared/economy/affinity.ts';
import {
  SELECT, buildCells, byRank, dedupe, greedy, haversineM, makeGrid, marketRank, relayRank, toPoi,
  MARKET_CATEGORIES, RELAY_EXCLUDED, type OsmElement, type Poi,
} from '../src/game/worldgen.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const p = (rel: string) => join(ROOT, rel);

// ── Paramètres (Docs/04 §2) : sélection partagée avec les régions générées (src/game/worldgen.ts) ──
const { relayMinM: RELAY_MIN_M, marketMinM: MARKET_MIN_M, relayClearOfMarketM: RELAY_CLEAR_OF_MARKET_M, clearOfForgeM: CLEAR_OF_FORGE_M } = SELECT;
const EDITORIAL_CLEAR_M = 300; // rayon autour d'un marchand éditorial où l'on retire les marchands gloutons
const H3_RES = 9;

interface ExtraMarket { id: string; name: string; lat: number; lng: number; category: string; affinities: Family[] }
export { haversineM };

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
