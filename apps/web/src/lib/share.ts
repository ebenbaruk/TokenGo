// Cartes partageables (1200×675, format X) dessinées en canvas, style Pixel Pop : aplat + damier pixel, cadre encre à
// ombre dure, sprites en grilles, logo TokenGo. Partage via Web Share API (fichier), sinon téléchargement du PNG.
import { FAMILIES, VARIANTS, equivalences, type CodexView, type CompileResponse, type Family, type RouteCheckin } from '@tokengo/shared';
import { SWEETIE, gridsOf, drawGrid, type SpriteDef } from '../sprites/engine.ts';
import { FORGE, FAMILY_HEX, XP_STAR } from '../sprites/index.ts';
import { shardSilhouette, shardVariant } from '../sprites/variants.ts';
import { useGame, toast, type LastShare } from './store.ts';
import { fmtUsd, famName, fmtDist } from './format.ts';
import { play } from './sound.ts';

export const CARD_W = 1200;
export const CARD_H = 675;
const PIXEL = "'TG Pixel', 'Nunito', sans-serif";
const UI = "'Nunito', sans-serif";
const SITE = 'tokengo';

let logo: Promise<HTMLImageElement | null> | null = null;
function loadLogo(): Promise<HTMLImageElement | null> {
  logo ??= new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = '/art/logo.png';
  });
  return logo;
}

async function fontsReady(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`64px ${PIXEL}`, 'Aa'), document.fonts.load(`800 40px ${UI}`, '0$'), document.fonts.load(`64px ${PIXEL}`, '0')]);
  } catch { /* polices système */ }
}

function sprite(ctx: CanvasRenderingContext2D, def: SpriteDef, x: number, y: number, scale: number, frame = 0) {
  const g = gridsOf(def)[frame % def.frames.length]!;
  drawGrid(ctx, g, scale, Math.round(x), Math.round(y));
}

/** Fond commun : aplat, damier pixel, panneau crème à cadre encre et ombre dure, logo. */
async function frame(bg: string): Promise<{ cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  await fontsReady();
  const cv = document.createElement('canvas');
  cv.width = CARD_W;
  cv.height = CARD_H;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let y = 0; y < CARD_H; y += 30) for (let x = (y / 30) % 2 ? 30 : 0; x < CARD_W; x += 60) ctx.fillRect(x, y, 30, 30);
  // panneau
  const px = 40; const py = 40; const pw = CARD_W - 80; const ph = CARD_H - 80;
  ctx.fillStyle = SWEETIE.ink;
  ctx.fillRect(px + 12, py + 12, pw, ph);
  ctx.fillRect(px - 6, py - 6, pw + 12, ph + 12);
  ctx.fillStyle = '#FFFDF6';
  ctx.fillRect(px, py, pw, ph);
  const img = await loadLogo();
  if (img) {
    const w = 300;
    ctx.drawImage(img, CARD_W - px - w - 28, py + 26, w, (w * img.height) / img.width);
  }
  // pied de carte
  ctx.fillStyle = SWEETIE.ink;
  ctx.fillRect(px, py + ph - 58, pw, 58);
  ctx.fillStyle = SWEETIE.sun;
  ctx.font = `28px ${PIXEL}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('Walk the city. Catch AI. Spend it for real.', px + 28, py + ph - 29);
  ctx.fillStyle = SWEETIE.white;
  ctx.textAlign = 'right';
  ctx.font = `800 22px ${UI}`;
  ctx.fillText(`#${SITE} · NEAR AI Cloud`, px + pw - 28, py + ph - 29);
  ctx.textAlign = 'left';
  return { cv, ctx };
}

function badge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string, fg: string = SWEETIE.ink, size = 24) {
  ctx.font = `800 ${size}px ${UI}`;
  const w = ctx.measureText(text).width + 24;
  const h = size + 16;
  ctx.fillStyle = SWEETIE.ink;
  ctx.fillRect(x + 4, y + 4, w, h);
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 12, y + h / 2 + 1);
  return w;
}

/** Texte tronqué à une largeur max (ellipse). */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

const toBlob = (cv: HTMLCanvasElement): Promise<Blob> =>
  new Promise((ok, ko) => cv.toBlob((b) => (b ? ok(b) : ko(new Error('canvas.toBlob failed'))), 'image/png'));

// ───────── Cartes ─────────

/** Ticket de crédit après une compilation à la Forge. */
export async function creditCard(res: CompileResponse, forgeName: string, used: Family[]): Promise<Blob> {
  const { cv, ctx } = await frame(SWEETIE.plum);
  // forge + éclats fondus
  ctx.fillStyle = SWEETIE.sun;
  ctx.beginPath();
  ctx.arc(250, 300, 150, 0, Math.PI * 2);
  ctx.fill();
  sprite(ctx, FORGE, 250 - 16 * 9, 300 - 16 * 9 - 10, 9, 1);
  used.slice(0, 9).forEach((f, i) => {
    const a = (i / Math.min(9, used.length)) * Math.PI * 2 - Math.PI / 2;
    sprite(ctx, shardVariant(f, 'classic'), 250 + Math.cos(a) * 190 - 32, 300 + Math.sin(a) * 190 - 32, 4);
  });
  const x = 480;
  ctx.fillStyle = SWEETIE.plum;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `34px ${PIXEL}`;
  ctx.fillText(res.payoutNusd > 0 ? 'I compiled real AI compute' : 'Compiled at the Forge', x, 190);
  ctx.font = `800 130px ${UI}`;
  ctx.fillStyle = SWEETIE.ink;
  const amount = res.payoutNusd > 0 ? `+${fmtUsd(res.payoutNusd)}` : `+${res.xp} XP`;
  ctx.fillText(amount, x, 320);
  ctx.font = `800 30px ${UI}`;
  ctx.fillStyle = SWEETIE.slate;
  const eq = res.payoutNusd > 0 ? equivalences(res.payoutNusd) : null;
  ctx.fillText(fit(ctx, eq ? `≈ ${eq.chats} DeepSeek chats on NEAR AI Cloud` : 'XP only — the city reserve is resting', 640), x, 372);
  ctx.font = `32px ${PIXEL}`;
  ctx.fillStyle = SWEETIE.ink;
  ctx.fillText(fit(ctx, `@ ${forgeName}`, 640), x, 432);
  let bx = x;
  bx += badge(ctx, res.tier === 'first' ? 'First Compile' : `${res.tier[0]!.toUpperCase()}${res.tier.slice(1)} recipe`, bx, 470, SWEETIE.sun) + 18;
  bx += badge(ctx, `+${res.xp} XP`, bx, 470, SWEETIE.lime) + 18;
  if (res.simulated) badge(ctx, 'demo · simulated', bx, 470, SWEETIE.mist);
  return toBlob(cv);
}

/** Codex : grille 5×5 (familles × variantes, en-têtes de colonnes), %, titre, prochain titre. */
export async function codexCard(v: CodexView, handle: string): Promise<Blob> {
  const { cv, ctx } = await frame(SWEETIE.teal);
  const cell = 74;
  const gap = 8;
  const gx = 80; const gy = 122;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 15px ${UI}`;
  ctx.fillStyle = SWEETIE.slate;
  VARIANTS.forEach((variant, c) => ctx.fillText(VARIANT_SHORT[variant], gx + c * (cell + gap) + cell / 2, gy - 10));
  ctx.textAlign = 'left';
  FAMILIES.forEach((f, r) => {
    VARIANTS.forEach((variant, c) => {
      const e = v.entries.find((x) => x.family === f && x.variant === variant);
      const x = gx + c * (cell + gap); const y = gy + r * (cell + gap);
      ctx.fillStyle = e?.found ? FAMILY_HEX[f] : '#E7E1CC';
      ctx.fillRect(x, y, cell, cell);
      ctx.strokeStyle = SWEETIE.ink;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
      sprite(ctx, e?.found ? shardVariant(f, variant) : shardSilhouette(f), x + (cell - 64) / 2, y + (cell - 64) / 2, 4);
    });
  });
  const x = 540;
  ctx.fillStyle = SWEETIE.teal;
  ctx.font = `40px ${PIXEL}`;
  ctx.fillText('Shard Codex', x, 170);
  ctx.fillStyle = SWEETIE.slate;
  ctx.font = `800 26px ${UI}`;
  ctx.fillText(fit(ctx, `by ${handle}`, 300), x, 208);
  ctx.fillStyle = SWEETIE.ink;
  ctx.font = `800 120px ${UI}`;
  ctx.fillText(`${v.found}/${v.total}`, x, 320);
  // barre de progression
  ctx.fillStyle = SWEETIE.ink;
  ctx.fillRect(x - 4, 344, 568, 40);
  ctx.fillStyle = SWEETIE.white;
  ctx.fillRect(x, 348, 560, 32);
  ctx.fillStyle = SWEETIE.green;
  ctx.fillRect(x, 348, Math.round((560 * v.pct) / 100), 32);
  ctx.fillStyle = SWEETIE.ink;
  ctx.font = `800 24px ${UI}`;
  ctx.fillText(`${v.pct}% collected`, x + 12, 365);
  const next = v.titles.find((t) => !t.unlocked);
  let by = 420;
  if (v.title) { badge(ctx, `★ ${v.title}`, x, by, SWEETIE.sun, SWEETIE.ink, 28); by += 70; }
  ctx.font = `800 24px ${UI}`;
  ctx.fillStyle = SWEETIE.slate;
  ctx.textBaseline = 'alphabetic';
  if (next) ctx.fillText(`Next title: ${next.name} at ${next.need}`, x, by + 22);
  ctx.fillText(`best combo ×${v.records.bestCombo} · ${v.records.catches} catches · ${v.records.routesDone} routes`, x, by + 58);
  return toBlob(cv);
}

const VARIANT_SHORT = { classic: 'Classic', night: 'Night', landmark: 'Landmark', overclocked: 'Overclock', shiny: 'Shiny' } as const;

/** Daily Route terminée. */
export async function routeCard(c: RouteCheckin, stops: { name: string }[], lengthM: number): Promise<Blob> {
  const { cv, ctx } = await frame(SWEETIE.orange);
  // boucle pointillée stylisée
  const cx = 250; const cy = 300; const R = 150;
  ctx.strokeStyle = SWEETIE.ink;
  ctx.lineWidth = 8;
  ctx.setLineDash([4, 18]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  stops.forEach((_, i) => {
    const a = (i / stops.length) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * R; const y = cy + Math.sin(a) * R;
    ctx.fillStyle = SWEETIE.ink;
    ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SWEETIE.green;
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.fill();
  });
  sprite(ctx, XP_STAR, cx - 64, cy - 64, 8);
  const x = 480;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = SWEETIE.berry;
  ctx.font = `36px ${PIXEL}`;
  ctx.fillText('Daily Route complete!', x, 190);
  ctx.fillStyle = SWEETIE.ink;
  ctx.font = `800 110px ${UI}`;
  ctx.fillText(`${stops.length} stops`, x, 305);
  ctx.font = `800 30px ${UI}`;
  ctx.fillStyle = SWEETIE.slate;
  ctx.fillText(fit(ctx, `≈ ${fmtDist(lengthM)} · ${stops.map((s) => s.name).join(' → ')}`, 620), x, 358);
  let bx = x;
  if (c.reward) {
    bx += badge(ctx, `+${c.reward.xp} XP`, bx, 410, SWEETIE.lime) + 18;
    bx += badge(ctx, `+${c.reward.flux} ƒ`, bx, 410, SWEETIE.sun) + 18;
    bx += badge(ctx, `+1 ${famName(c.reward.shard)}`, bx, 410, SWEETIE.sky) + 18;
  }
  if (c.streak > 1) badge(ctx, `${c.streak}-day streak`, x, 480, SWEETIE.orange, SWEETIE.ink, 28);
  return toBlob(cv);
}

// ───────── Partage ─────────

/** Partage le PNG (Web Share API niveau 2) ou le télécharge. Enregistre le résultat pour les tests E2E. */
export async function shareImage(blob: Blob, filename: string, text: string, kind: LastShare['kind']): Promise<LastShare['via']> {
  const file = new File([blob], filename, { type: 'image/png' });
  let via: LastShare['via'] = 'download';
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
    try {
      await nav.share({ files: [file], text });
      via = 'share';
    } catch (e) {
      if ((e as Error).name === 'AbortError') via = 'share';
    }
  }
  if (via === 'download') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('Card saved — post it on X!', 'good');
  }
  play('share');
  useGame.setState({ lastShare: { kind, bytes: blob.size, type: blob.type, via } });
  return via;
}
