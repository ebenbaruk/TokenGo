// Types partagés serveur / simulateur / UI. Montants de valeur = entiers (Flux, éclats, nano-USD).

export const FAMILIES = ['deepseek', 'qwen', 'gemini', 'gpt', 'claude'] as const;
export type Family = (typeof FAMILIES)[number];
export type ShardTokenId = `shard:${Family}`;
export type TokenId = ShardTokenId | 'flux';
export const shardToken = (f: Family): ShardTokenId => `shard:${f}`;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
export type NodeKind = 'relay' | 'market' | 'forge';

/** Un lieu réel du monde (sortie de build-world → data/world/paris.json). */
export interface WorldNode {
  id: string;            // 'osm:node/123' | 'osm:way/45' | 'forge:<slug>'
  kind: NodeKind;
  name: string;
  lat: number;
  lng: number;
  h3: string;            // cellule H3 résolution 9
  district: number;      // arrondissement 1..20 (0 si inconnu)
  category: string;      // ex. 'metro', 'museum', 'park', 'cafe', 'library', 'forge'
  affinities: Family[];  // familles favorisées par ce lieu (0..2)
}

export type Archetype =
  | 'gambler' | 'hoarder' | 'scholar' | 'hustler' | 'grandma' | 'purist' | 'trendchaser' | 'nightowl';
export const ARCHETYPES: readonly Archetype[] = [
  'gambler', 'hoarder', 'scholar', 'hustler', 'grandma', 'purist', 'trendchaser', 'nightowl',
];

export interface ForgeDef {
  id: string;            // 'forge:louvre'
  name: string;
  lat: number;
  lng: number;
  theme: Family[];       // familles favorisées dans ses recettes
}

export interface WorldFile {
  version: 1;
  city: 'paris';
  builtAt: string;
  nodes: WorldNode[];
  /** H3 r9 → richesse 0..6 et affinités de cellule (max 2 familles). */
  cells: Record<string, { richness: number; affinities: Family[] }>;
}
