// Codex : tirage des variantes cosmétiques d'une capture et résumé de collection (fonctions pures).
import { FAMILIES, type Family } from '../types.ts';
import type { Rng } from '../rng.ts';
import { CODEX, CODEX_TITLES, FAMILY_INFO, VARIANTS, type Variant } from './rules.ts';

/** Heure solaire locale (0..24) à une longitude : ne dépend d'aucun fuseau, marche dans toutes les villes. */
export const solarHour = (now: number, lng: number): number => (((now / 3_600_000 + lng / 15) % 24) + 24) % 24;
export const isNight = (hour: number): boolean => hour >= CODEX.nightFromHour || hour < CODEX.nightToHour;

export interface VariantInput {
  rng: Rng;
  perfect: boolean;
  combo: number;          // combo APRÈS cette capture
  solarHour: number;
  nearLandmark: boolean;  // une Forge à ≤ CODEX.landmarkRadiusM
}

/** Tire la variante d'une capture réussie. Consomme toujours exactement un tirage (déterminisme). */
export function rollVariant(i: VariantInput): Variant {
  if (i.rng() < CODEX.shinyChance) return 'shiny';
  if (i.perfect && i.combo >= CODEX.overclockCombo) return 'overclocked';
  if (i.nearLandmark) return 'landmark';
  if (isNight(i.solarHour)) return 'night';
  return 'classic';
}

/** Nom affiché : « Louvre Claude », « Night DeepSeek », « Shiny GPT »… */
export function variantName(f: Family, v: Variant, place?: string | null): string {
  const fam = FAMILY_INFO[f].name;
  switch (v) {
    case 'classic': return fam;
    case 'night': return `Night ${fam}`;
    case 'landmark': return `${place ?? 'Landmark'} ${fam}`;
    case 'overclocked': return `Overclocked ${fam}`;
    case 'shiny': return `Shiny ${fam}`;
  }
}

/** Nom court d'un lieu pour une variante : « Louvre — Pyramide » → « Louvre ». */
export const placeShort = (name: string): string => name.split(/ [—–-] /)[0]!.trim().slice(0, 24);

/** Indice pour trouver une case inconnue (silhouette du Codex). */
export const VARIANT_HINT: Record<Variant, string> = {
  classic: 'Catch one anywhere.',
  night: 'Out after 9 pm…',
  landmark: 'Near a Forge monument.',
  overclocked: 'PERFECT at combo ×3+.',
  shiny: '1 in 40. Pure luck.',
};

export const CODEX_SIZE = FAMILIES.length * VARIANTS.length;

export interface CodexSummary {
  found: number;
  total: number;
  pct: number;                                        // 0..100 entier
  byFamily: Record<Family, number>;                   // cases trouvées par famille (sur VARIANTS.length)
  titles: { id: string; name: string; need: number; unlocked: boolean }[];
  title: string | null;                               // meilleur titre débloqué
}

export function codexSummary(entries: { family: Family; variant: Variant }[]): CodexSummary {
  const seen = new Set(entries
    .filter((e) => (VARIANTS as readonly string[]).includes(e.variant) && (FAMILIES as readonly string[]).includes(e.family))
    .map((e) => `${e.family}:${e.variant}`));
  const byFamily = Object.fromEntries(FAMILIES.map((f) => [f, VARIANTS.filter((v) => seen.has(`${f}:${v}`)).length])) as Record<Family, number>;
  const found = seen.size;
  const titles = CODEX_TITLES.map((t) => ({ id: t.id, name: t.name, need: t.need, unlocked: found >= t.need }));
  const best = [...titles].reverse().find((t) => t.unlocked);
  return { found, total: CODEX_SIZE, pct: Math.floor((found / CODEX_SIZE) * 100), byFamily, titles, title: best?.name ?? null };
}

/** Titre débloqué en passant de `before` à `after` cases, sinon null. */
export function newTitle(before: number, after: number): string | null {
  return CODEX_TITLES.find((x) => before < x.need && after >= x.need)?.name ?? null;
}
