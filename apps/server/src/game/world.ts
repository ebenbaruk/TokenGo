// Monde en mémoire : Paris (data/world/paris.json, précalculé) + régions générées ailleurs (game/regions.ts),
// indexé par cellule H3 r9.
import { readFileSync } from 'node:fs';
import { cellToParent, gridDisk, latLngToCell } from 'h3-js';
import { haversineM, H3_RES, WORLD_GEN, type CellInfo, type Family, type ForgeDef, type WorldFile, type WorldNode } from '@tokengo/shared';
import { cellInfoAt, touchedCells } from './worldgen.ts';

export type WorldForge = WorldNode & { theme: Family[] };
export interface World {
  nodes: WorldNode[];
  byId: Map<string, WorldNode>;
  byCell: Map<string, WorldNode[]>;
  cells: WorldFile['cells'];
  forges: WorldForge[];
  /** Régions r7 couvertes par Paris (jamais générées). */
  parisRegions: Set<string>;
  /** Régions générées chargées : id → source. */
  regions: Map<string, 'osm' | 'procedural'>;
}

const ROOT = new URL('../../../../', import.meta.url).pathname;

export function loadWorld(path = `${ROOT}data/world/paris.json`): World {
  const file = JSON.parse(readFileSync(path, 'utf8')) as WorldFile;
  const forgesDef = JSON.parse(readFileSync(`${ROOT}data/paris/forges.json`, 'utf8')) as ForgeDef[];
  const themes = new Map(forgesDef.map((f) => [f.id, f.theme]));
  const byId = new Map<string, WorldNode>();
  const byCell = new Map<string, WorldNode[]>();
  for (const n of file.nodes) index(byId, byCell, n);
  const forges = file.nodes.filter((n) => n.kind === 'forge').map((n) => ({ ...n, theme: themes.get(n.id) ?? n.affinities }));
  const parisRegions = new Set(file.nodes.map((n) => cellToParent(n.h3, WORLD_GEN.regionRes)));
  return { nodes: file.nodes, byId, byCell, cells: file.cells, forges, parisRegions, regions: new Map() };
}

function index(byId: Map<string, WorldNode>, byCell: Map<string, WorldNode[]>, n: WorldNode) {
  byId.set(n.id, n);
  const list = byCell.get(n.h3) ?? [];
  list.push(n);
  byCell.set(n.h3, list);
}

/** Ajoute une région générée (idempotent) : nœuds, forges, puis richesse/affinités des cellules touchées. */
export function addRegion(w: World, id: string, source: 'osm' | 'procedural', nodes: WorldNode[]): void {
  if (w.regions.has(id)) return;
  const fresh = nodes.filter((n) => !w.byId.has(n.id));
  for (const n of fresh) {
    w.nodes.push(n);
    index(w.byId, w.byCell, n);
    if (n.kind === 'forge') w.forges.push({ ...n, theme: n.theme ?? n.affinities });
  }
  for (const c of touchedCells(fresh)) w.cells[c] = cellInfoAt(c, (k) => w.byCell.get(k) ?? []);
  w.regions.set(id, source);
}

export const cellOf = (lat: number, lng: number): string => latLngToCell(lat, lng, H3_RES);

/** Nœuds dans un rayon (m), via les cellules H3 voisines. k ≈ rayon / 300 m. */
export function nodesNear(w: World, lat: number, lng: number, radiusM: number): WorldNode[] {
  const k = Math.max(1, Math.ceil(radiusM / 300));
  const out: WorldNode[] = [];
  for (const c of gridDisk(cellOf(lat, lng), k)) {
    for (const n of w.byCell.get(c) ?? []) if (haversineM({ lat, lng }, n) <= radiusM) out.push(n);
  }
  return out;
}

export const cellInfo = (w: World, cell: string): CellInfo => w.cells[cell] ?? { richness: 0, affinities: [] };

/** Point de départ de la démo : Cour Napoléon, au pied de la Pyramide. */
export const DEMO_START = { lat: 48.8611, lng: 2.3358 };
