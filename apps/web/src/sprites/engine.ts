// Moteur de sprites pixel art : grilles texte (1 caractère = 1 pixel) → canvas / ImageData / data URL.
// Palette Sweetie 16 uniquement (+ blanc pur). Contour encre 1 px ajouté automatiquement autour de la silhouette.

export const SWEETIE = {
  ink: '#1a1c2c', plum: '#5d275d', berry: '#b13e53', orange: '#ef7d57', sun: '#ffcd75', lime: '#a7f070', green: '#38b764',
  teal: '#257179', navy: '#29366f', blue: '#3b5dc9', sky: '#41a6f6', cyan: '#73eff7', white: '#f4f4f4', mist: '#94b0c2',
  slate: '#566c86', night: '#333c57', pure: '#ffffff',
} as const;
export type SweetieName = keyof typeof SWEETIE;

/** Table de caractères par défaut, partagée par tous les sprites (surchageable par sprite). */
export const BASE_KEYS: Record<string, string> = {
  k: SWEETIE.ink, p: SWEETIE.plum, r: SWEETIE.berry, o: SWEETIE.orange, y: SWEETIE.sun, l: SWEETIE.lime, g: SWEETIE.green,
  t: SWEETIE.teal, n: SWEETIE.navy, b: SWEETIE.blue, s: SWEETIE.sky, c: SWEETIE.cyan, w: SWEETIE.white, m: SWEETIE.mist,
  a: SWEETIE.slate, N: SWEETIE.night, W: SWEETIE.pure,
  // étincelles « libres » : dessinées sans contour
  '*': SWEETIE.pure, '+': SWEETIE.sun, '~': SWEETIE.cyan,
};
const LOOSE = new Set(['*', '+', '~']);

export interface SpriteDef {
  /** frames : grilles texte de même taille ('.' ou ' ' = transparent) */
  frames: string[];
  keys?: Record<string, string>;
  /** ajoute un contour encre 1 px autour des pixels opaques (la grille doit laisser 1 px de marge) */
  outline?: boolean;
  /** ms par frame pour les animations */
  fps?: number;
}

export interface Grid { w: number; h: number; px: (string | null)[] }

const gridCache = new WeakMap<SpriteDef, Grid[]>();

export function parseGrid(src: string): string[] {
  const rows = src.split('\n').map((r) => r.replace(/\s+$/, '')).filter((r) => r.trim().length > 0);
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, '.'));
}

export function gridsOf(def: SpriteDef): Grid[] {
  const cached = gridCache.get(def);
  if (cached) return cached;
  const keys = { ...BASE_KEYS, ...def.keys };
  const grids = def.frames.map((f) => {
    const rows = parseGrid(f);
    const h = rows.length;
    const w = rows[0]!.length;
    const px: (string | null)[] = [];
    const solid: boolean[] = [];
    for (const row of rows) for (const ch of row) {
      const c = ch === '.' || ch === ' ' ? null : (keys[ch] ?? null);
      px.push(c);
      solid.push(c !== null && !LOOSE.has(ch));
    }
    if (def.outline) addOutline(px, solid, w, h);
    return { w, h, px };
  });
  gridCache.set(def, grids);
  return grids;
}

function addOutline(px: (string | null)[], solid: boolean[], w: number, h: number): void {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (solid[y * w + x] || px[y * w + x]) continue;
    const n = (dx: number, dy: number) => {
      const xx = x + dx; const yy = y + dy;
      return xx >= 0 && yy >= 0 && xx < w && yy < h && solid[yy * w + xx];
    };
    if (n(1, 0) || n(-1, 0) || n(0, 1) || n(0, -1)) px[y * w + x] = SWEETIE.ink;
  }
}

export function drawGrid(ctx: CanvasRenderingContext2D, g: Grid, scale: number, ox = 0, oy = 0): void {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const c = g.px[y * g.w + x];
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
  }
}

/** Rend une frame d'un sprite à l'échelle entière `scale`. */
export function renderSprite(def: SpriteDef, scale = 3, frame = 0): HTMLCanvasElement {
  const g = gridsOf(def)[frame % def.frames.length]!;
  const cv = document.createElement('canvas');
  cv.width = g.w * scale;
  cv.height = g.h * scale;
  drawGrid(cv.getContext('2d')!, g, scale);
  return cv;
}

/** Bande horizontale de toutes les frames (pour les animations CSS en steps()). */
const stripCache = new Map<string, string>();
export function spriteStripUrl(id: string, def: SpriteDef): { url: string; w: number; h: number; n: number } {
  const grids = gridsOf(def);
  const g0 = grids[0]!;
  const key = id;
  let url = stripCache.get(key);
  if (!url) {
    const cv = document.createElement('canvas');
    cv.width = g0.w * grids.length;
    cv.height = g0.h;
    const ctx = cv.getContext('2d')!;
    grids.forEach((g, i) => drawGrid(ctx, g, 1, i * g0.w, 0));
    url = cv.toDataURL();
    stripCache.set(key, url);
  }
  return { url, w: g0.w, h: g0.h, n: grids.length };
}

/** ImageData pour map.addImage (échelle entière, pixelRatio à passer à MapLibre). */
export function spriteImageData(def: SpriteDef, scale: number, frame = 0, pad = { top: 0, bottom: 0 }, shadow = false): ImageData {
  const g = gridsOf(def)[frame % def.frames.length]!;
  const cv = document.createElement('canvas');
  cv.width = g.w * scale;
  cv.height = (g.h + pad.top + pad.bottom) * scale;
  const ctx = cv.getContext('2d')!;
  if (shadow) {
    // ombre ovale encre 25 % sous le sprite (Docs/09 : éclats sur la carte)
    ctx.fillStyle = 'rgba(26,28,44,0.25)';
    const cy = cv.height - scale * 1.5;
    ctx.beginPath();
    ctx.ellipse(cv.width / 2, cy, g.w * scale * 0.32, scale * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  drawGrid(ctx, g, scale, 0, pad.top * scale);
  return ctx.getImageData(0, 0, cv.width, cv.height);
}

/** Recolore un sprite : remplace des couleurs par d'autres (accent des marchands, avatar personnalisé). */
export function recolor(def: SpriteDef, keys: Record<string, string>): SpriteDef {
  return { ...def, keys: { ...def.keys, ...keys } };
}

/** Superpose des grilles texte (calques) : les caractères non transparents du calque du dessus gagnent. */
export function layer(...grids: string[]): string {
  const parsed = grids.map(parseGrid);
  const h = Math.max(...parsed.map((p) => p.length));
  const w = Math.max(...parsed.map((p) => p[0]?.length ?? 0));
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      let ch = '.';
      for (const p of parsed) {
        const c = p[y]?.[x];
        if (c && c !== '.' && c !== ' ') ch = c === '_' ? '.' : c; // '_' = gomme
      }
      row += ch;
    }
    out.push(row);
  }
  return out.join('\n');
}

/** Décale une grille verticalement (rebond baked dans les frames). */
export function shiftY(src: string, dy: number): string {
  const rows = parseGrid(src);
  const w = rows[0]!.length;
  const blank = '.'.repeat(w);
  if (dy > 0) return [...Array(dy).fill(blank), ...rows.slice(0, rows.length - dy)].join('\n');
  return [...rows.slice(-dy), ...Array(-dy).fill(blank)].join('\n');
}

/** Miroir horizontal. */
export function flipX(src: string): string {
  return parseGrid(src).map((r) => [...r].reverse().join('')).join('\n');
}
