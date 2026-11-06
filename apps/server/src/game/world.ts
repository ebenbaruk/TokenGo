// Monde chargé en mémoire depuis data/world/paris.json, indexé par cellule H3 r9.
import { readFileSync } from 'node:fs';
import { gridDisk, latLngToCell } from 'h3-js';
import { haversineM, H3_RES, type CellInfo, type ForgeDef, type WorldFile, type WorldNode } from '@tokengo/shared';

export interface World {
  nodes: WorldNode[];
  byId: Map<string, WorldNode>;
  byCell: Map<string, WorldNode[]>;
  cells: WorldFile['cells'];
  forges: (WorldNode & { theme: ForgeDef['theme'] })[];
}

const ROOT = new URL('../../../../', import.meta.url).pathname;

export function loadWorld(path = `${ROOT}data/world/paris.json`): World {
  const file = JSON.parse(readFileSync(path, 'utf8')) as WorldFile;
  const forgesDef = JSON.parse(readFileSync(`${ROOT}data/paris/forges.json`, 'utf8')) as ForgeDef[];
  const themes = new Map(forgesDef.map((f) => [f.id, f.theme]));
  const byId = new Map<string, WorldNode>();
  const byCell = new Map<string, WorldNode[]>();
  for (const n of file.nodes) {
    byId.set(n.id, n);
    const list = byCell.get(n.h3) ?? [];
    list.push(n);
    byCell.set(n.h3, list);
  }
  const forges = file.nodes.filter((n) => n.kind === 'forge').map((n) => ({ ...n, theme: themes.get(n.id) ?? n.affinities }));
  return { nodes: file.nodes, byId, byCell, cells: file.cells, forges };
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
