// Affinités de lieu : tags OSM → familles d'éclats favorisées (Docs/04 §4, Docs/02 §3).
// Fonctions pures, partagées par build-world (précalcul Paris) et un futur OsmWorld.

import type { Family } from '../types.ts';

export type OsmTags = Readonly<Record<string, string>>;

/** Condition sur un tag : liste de valeurs acceptées, '*' (tag présent), ou RegExp sur la valeur. */
type TagCond = readonly string[] | '*' | RegExp;

export interface AffinityRule {
  family: Family;
  /** Tous les tags listés doivent correspondre (ET). Pour un OU, écrire plusieurs règles. */
  when: Readonly<Record<string, TagCond>>;
  why: string;
}

/**
 * L'ordre compte : les familles sont retenues dans l'ordre des règles, max 2 par lieu.
 * Règles les plus spécifiques d'abord (Station F, musées de sciences) pour qu'elles passent devant les génériques.
 */
export const AFFINITY_RULES: readonly AffinityRule[] = [
  // — Qwen : tech, coworkings, Station F
  { family: 'qwen', when: { name: /^station f$/i }, why: 'Station F, campus de startups' },
  { family: 'qwen', when: { office: ['coworking'] }, why: 'coworking' },
  { family: 'qwen', when: { amenity: ['coworking_space'] }, why: 'coworking' },
  { family: 'qwen', when: { shop: ['computer', 'electronics'] }, why: 'boutique informatique / électronique' },

  // — Gemini : musées de sciences (avant les règles génériques), nature et eau
  { family: 'gemini', when: { tourism: ['museum'], museum: ['science', 'technology', 'natural_history', 'nature'] }, why: 'musée de sciences' },
  { family: 'gemini', when: { tourism: ['museum'], name: /scien|découverte|muséum|histoire naturelle|arts et métiers|cité des sciences/i }, why: 'musée de sciences (nom)' },
  { family: 'gemini', when: { leisure: ['park', 'garden'] }, why: 'parc / jardin' },
  { family: 'gemini', when: { natural: ['water'] }, why: 'plan d\'eau' },
  { family: 'gemini', when: { waterway: '*' }, why: 'cours d\'eau / canal' },
  { family: 'gemini', when: { amenity: ['fountain'] }, why: 'fontaine' },

  // — Claude : savoir et scène
  { family: 'claude', when: { amenity: ['library', 'university', 'college'] }, why: 'bibliothèque / université' },
  { family: 'claude', when: { shop: ['books'] }, why: 'librairie' },
  { family: 'claude', when: { amenity: ['theatre'] }, why: 'théâtre' },

  // — GPT : gares et grands nœuds de transport
  { family: 'gpt', when: { railway: ['station'] }, why: 'gare / station' },
  { family: 'gpt', when: { public_transport: ['station'] }, why: 'gare / station' },

  // — DeepSeek : commerce de rue (tout shop=* restant)
  { family: 'deepseek', when: { amenity: ['cafe', 'bar', 'restaurant', 'marketplace'] }, why: 'café / bar / restaurant / marché' },
  { family: 'deepseek', when: { shop: '*' }, why: 'commerce' },
];

function condMatches(cond: TagCond, value: string | undefined): boolean {
  if (value === undefined) return false;
  if (cond === '*') return true;
  if (cond instanceof RegExp) return cond.test(value);
  return cond.includes(value);
}

/** Familles favorisées par un lieu (0..2, sans doublon, dans l'ordre des règles). */
export function affinitiesOfTags(tags: OsmTags, max = 2): Family[] {
  const out: Family[] = [];
  for (const rule of AFFINITY_RULES) {
    if (out.length >= max) break;
    if (out.includes(rule.family)) continue;
    const ok = Object.entries(rule.when).every(([k, cond]) => condMatches(cond, tags[k]));
    if (ok) out.push(rule.family);
  }
  return out;
}

/** Catégorie lisible d'un lieu (pour l'UI, les sprites et les statistiques). Première correspondance gagne. */
export function nodeCategory(tags: OsmTags): string {
  const { railway, station, network = '', tourism, amenity, shop, leisure, historic, office } = tags;
  if (railway === 'station') {
    if (station === 'subway' || network.includes('Métro')) return 'metro';
    if (station === 'train' || station === 'light_rail' || /RER|Transilien/.test(network)) return 'train';
    return 'station';
  }
  if (amenity === 'marketplace') return 'marketplace';
  if (amenity === 'cafe' || amenity === 'bar' || amenity === 'restaurant' || amenity === 'theatre') return amenity;
  if (amenity === 'library') return 'library';
  if (amenity === 'university' || amenity === 'college') return 'university';
  if (amenity === 'coworking_space' || office === 'coworking') return 'coworking';
  if (amenity === 'fountain') return 'fountain';
  if (shop === 'books') return 'bookshop';
  if (shop === 'bakery') return 'bakery';
  if (shop === 'computer' || shop === 'electronics') return 'tech_shop';
  if (shop) return 'shop';
  if (tourism === 'museum' || tourism === 'gallery' || tourism === 'attraction' || tourism === 'viewpoint' || tourism === 'artwork') return tourism;
  if (leisure === 'park' || leisure === 'garden') return leisure;
  if (historic === 'memorial' || historic === 'tomb') return 'memorial';
  if (historic) return 'monument';
  return 'place';
}
