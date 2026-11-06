// Registre des sprites : nom → SpriteDef. Tout est dessiné en grilles texte (aucun asset externe).
import type { Family } from '@tokengo/shared';
import { SWEETIE, recolor, type SpriteDef } from './engine.ts';
import { SHARDS } from './shards.ts';
import { AVATAR_GRIDS } from './avatar.grids.ts';
import { MERCHANT_GRIDS } from './merchants.grids.ts';
import { NODE_GRIDS } from './nodes.grids.ts';

export * from './engine.ts';
export { SHARDS };

/** Couleurs d'accent (paires base/ombre de Sweetie 16) tirées de l'id d'un marchand. */
export const ACCENTS: { a: string; b: string }[] = [
  { a: SWEETIE.sky, b: SWEETIE.blue }, { a: SWEETIE.berry, b: SWEETIE.plum }, { a: SWEETIE.green, b: SWEETIE.teal },
  { a: SWEETIE.orange, b: SWEETIE.berry }, { a: SWEETIE.blue, b: SWEETIE.navy }, { a: SWEETIE.teal, b: SWEETIE.navy },
  { a: SWEETIE.plum, b: SWEETIE.night }, { a: SWEETIE.lime, b: SWEETIE.green }, { a: SWEETIE.sun, b: SWEETIE.orange },
];

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function accentOf(id: string): { a: string; b: string; c: string; d: string } {
  const h = hashStr(id);
  const p = ACCENTS[h % ACCENTS.length]!;
  let q = ACCENTS[(h >>> 8) % ACCENTS.length]!;
  if (q === p) q = ACCENTS[(ACCENTS.indexOf(p) + 3) % ACCENTS.length]!;
  return { a: p.a, b: p.b, c: q.a, d: q.b };
}

const ARCHETYPE_KEYS = ['gambler', 'hoarder', 'scholar', 'hustler', 'grandma', 'purist', 'trendchaser', 'nightowl'] as const;
export const normArchetype = (a: string): (typeof ARCHETYPE_KEYS)[number] => {
  const k = a.toLowerCase().replace(/[^a-z]/g, '');
  return (ARCHETYPE_KEYS as readonly string[]).includes(k) ? (k as (typeof ARCHETYPE_KEYS)[number]) : 'grandma';
};

const merchantCache = new Map<string, SpriteDef>();
/** Portrait 32×32 d'un marchand : archétype + accent dérivé de l'id. Frames : 0 idle, 1 parle, 2 joie. */
export function merchantSprite(archetype: string, id: string): SpriteDef {
  const key = `${normArchetype(archetype)}|${id}`;
  let def = merchantCache.get(key);
  if (!def) {
    const ac = accentOf(id);
    def = { frames: MERCHANT_GRIDS[normArchetype(archetype)]!, keys: { A: ac.a, B: ac.b, C: ac.c, D: ac.d }, outline: true, fps: 3 };
    merchantCache.set(key, def);
  }
  return def;
}

export const AVATAR: SpriteDef = { frames: AVATAR_GRIDS, outline: true, fps: 5 };
/** Runner-agent : même gabarit que l'avatar, casquette plum et veste verte (on les distingue du joueur). */
export const RUNNER: SpriteDef = recolor(AVATAR, { r: SWEETIE.plum, o: SWEETIE.berry, p: SWEETIE.night, b: SWEETIE.green, s: SWEETIE.lime, n: SWEETIE.teal, c: SWEETIE.sun, t: SWEETIE.orange });
export const RELAY: SpriteDef = { frames: NODE_GRIDS.relay, outline: true, fps: 2 };
export const RELAY_COOLDOWN: SpriteDef = recolor(RELAY, { c: SWEETIE.mist, t: SWEETIE.slate, W: SWEETIE.white, '~': 'transparent' });
export const FORGE: SpriteDef = { frames: NODE_GRIDS.forge, outline: true, fps: 4 };
export const FLUX: SpriteDef = { frames: NODE_GRIDS.flux, outline: true, fps: 1 };
export const XP_STAR: SpriteDef = { frames: NODE_GRIDS.xp, outline: true, fps: 1 };
export const LOCK: SpriteDef = { frames: NODE_GRIDS.lock, outline: true };
export const BADGE: SpriteDef = { frames: NODE_GRIDS.badge, outline: true };
export function marketSprite(id: string, closed = false): SpriteDef {
  const ac = accentOf(id);
  return { frames: closed ? NODE_GRIDS.marketClosed : NODE_GRIDS.market, keys: { A: ac.a, B: ac.b }, outline: true, fps: 1.5 };
}

export const shardSprite = (f: Family): SpriteDef => SHARDS[f];
export const FAMILY_HEX: Record<Family, string> = {
  deepseek: SWEETIE.cyan, qwen: SWEETIE.plum, gemini: SWEETIE.sky, gpt: SWEETIE.lime, claude: SWEETIE.orange,
};
/** Couleur foncée lisible sur fond clair (texte, bordures) par famille. */
export const FAMILY_DARK: Record<Family, string> = {
  deepseek: SWEETIE.teal, qwen: SWEETIE.plum, gemini: SWEETIE.blue, gpt: SWEETIE.green, claude: SWEETIE.berry,
};
