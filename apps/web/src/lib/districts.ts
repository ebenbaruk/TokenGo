// Couleurs des 20 arrondissements (Docs/13 §8) : couronnes de la carte, « Who holds the city ». 15 tons Sweetie 16
// (sans l'encre, réservée aux contours) + 5 teintes claires de la même palette ; voisins ≠ couleurs proches.
import { SWEETIE, type SpriteDef } from '../sprites/engine.ts';
import { CROWN } from '../sprites/arena.grids.ts';

export const DISTRICT_COLORS: readonly string[] = [
  SWEETIE.berry, SWEETIE.sky, SWEETIE.green, SWEETIE.orange, SWEETIE.plum,      // 1–5
  SWEETIE.cyan, SWEETIE.sun, SWEETIE.blue, SWEETIE.lime, SWEETIE.teal,          // 6–10
  SWEETIE.navy, SWEETIE.mist, SWEETIE.slate, SWEETIE.white, SWEETIE.night,      // 11–15
  '#e07a8f', '#9d5d9d', '#7fd29a', '#f7a98d', '#8fa3e6',                        // 16–20 : teintes claires (berry, plum, green, orange, blue)
];

/** Couleur d'un district 1–20 ; null → pas de district choisi (or neutre / Gardien). */
export const districtColor = (d: number | null | undefined): string | null =>
  d && d >= 1 && d <= 20 ? DISTRICT_COLORS[d - 1]! : null;

/** Texte lisible sur cette couleur (encre ou blanc). */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.55 ? SWEETIE.ink : SWEETIE.white;
}

/** « 7th » (libellé court d'un arrondissement). */
export const arrLabel = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

// Couronne teintée : corps à la couleur du district, bandeau nuit, pierres blanches (or seul sans district). Défs en cache.
const crowns = new Map<number, SpriteDef>();
export function crownDef(d: number | null | undefined): SpriteDef {
  const c = districtColor(d);
  if (!c) return CROWN;
  let def = crowns.get(d!);
  if (!def) { def = { ...CROWN, keys: { y: c, o: SWEETIE.night, r: SWEETIE.pure, s: SWEETIE.pure } }; crowns.set(d!, def); }
  return def;
}
