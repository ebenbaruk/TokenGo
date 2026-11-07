// Montage de la vidéo de démo à partir des clips de record.ts (var/video/raw/*.mp4 + marks.json).
// 1) Les habillages (fond pixel art, cadre du téléphone, légendes, cartes titre/fin) sont dessinés en HTML et
//    capturés en PNG par Chromium (polices du jeu : Pixelify Sans + Nunito, depuis @fontsource).
// 2) ffmpeg assemble chaque plan (fond + clip + cadre + légende animée) puis les concatène, en 1920×1080 et 1080×1350.
// 3) Bande-son synthétisée (music.ts) avec effets calés sur les repères des clips.
// Usage : node scripts/video/compose.ts            → docs-assets/video/tokengo-demo.mp4 (+ -portrait, boucle, vignette)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';

const ROOT = new URL('../../', import.meta.url).pathname;
const RAW = `${ROOT}var/video/raw`;
const WORK = `${ROOT}var/video/work`;
const OUT = `${ROOT}docs-assets/video`;
const FPS = 30;
/** Le Lock-on de l'accroche est filmé au ralenti ×4 (record.ts, HOOK_SLOW) et réaccéléré ici. */
const SLOW = 4;

const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const marks = (clip: string) => JSON.parse(readFileSync(`${RAW}/${clip}/marks.json`, 'utf8')) as { duration: number; slow?: number; marks: { name: string; t: number }[] };
/** Ralenti de tournage d'un clip (record.ts : SLOW_ALL) : les décalages et vitesses ci-dessous sont en temps « page ». */
const k = (clip: string) => marks(clip).slow ?? 1;
/** Temps d'un repère dans un clip (n-ième occurrence). */
const M = (clip: string, name: string, nth = 0) => {
  const m = marks(clip).marks.filter((x) => x.name === name)[nth];
  if (!m) throw new Error(`mark ${clip}:${name}#${nth} missing`);
  return m.t;
};

// ───────── Découpage ─────────
interface Caption { title: string; sub?: string; accent?: string }
type Shot =
  | { kind: 'phone'; clip: string; from: number; to: number; speed?: number; cap: Caption; fadeCap?: boolean; sfx?: { at: number; name: string }[] }
  | { kind: 'laptop'; clip: string; from: number; to: number; cap: Caption; fadeCap?: boolean }
  | { kind: 'card'; card: 'title' | 'end'; dur: number };

function shotList(): Shot[] {
  return [
    // 0 — accroche : l'anneau se resserre, PERFECT, confettis, combo ×2
    { kind: 'phone', clip: 'hook', from: M('hook', 'lockon') - 0.1 * k('hook'), to: M('hook', 'continue'), speed: SLOW, cap: { title: 'Catch AI.', sub: 'Real AI compute, hiding on real streets.' }, fadeCap: true,
      sfx: [{ at: M('hook', 'result') - 0.2 * k('hook'), name: 'perfect' }, { at: M('hook', 'result') + 0.65 * SLOW, name: 'discover' }] },
    { kind: 'card', card: 'title', dur: 2.6 },
    // Daily Route
    { kind: 'phone', clip: 'route', from: M('route', 'sheet') + 0.1 * k('route'), to: M('route', 'sheet') + 2.9 * k('route'), cap: { title: 'Walk your city.', sub: 'A new loop of real places every day.' }, fadeCap: true },
    { kind: 'phone', clip: 'route', from: M('route', 'walk') - 0.2 * k('route'), to: M('route', 'complete'), speed: 2, cap: { title: 'Walk your city.', sub: 'A new loop of real places every day.' },
      sfx: [0, 1, 2].map((i) => ({ at: M('route', 'stop', i), name: 'coin' })) },
    { kind: 'phone', clip: 'route', from: M('route', 'complete'), to: M('route', 'complete') + 2.6 * k('route'), cap: { title: 'Walk your city.', sub: 'A new loop of real places every day.' },
      sfx: [{ at: M('route', 'complete') + 0.05 * k('route'), name: 'route' }] },
    // Marchands
    { kind: 'phone', clip: 'market', from: M('market', 'fly') + 0.6 * k('market'), to: M('market', 'why'), speed: 1.2, cap: { title: 'Meet the AI shopkeepers.', sub: 'Each one has a mood, a stock and a story.' }, fadeCap: true,
      sfx: [{ at: M('market', 'open') + 0.15 * k('market'), name: 'pop' }] },
    { kind: 'phone', clip: 'market', from: M('market', 'why') + 0.1 * k('market'), to: M('market', 'buy') - 0.2 * k('market'), cap: { title: 'Prices move with real supply & demand.', sub: '“Why this price?” — every shop shows its math.' }, fadeCap: true,
      sfx: [{ at: M('market', 'why') + 0.15 * k('market'), name: 'tap' }] },
    { kind: 'phone', clip: 'market', from: M('market', 'buy'), to: M('market', 'haggle') + 0.2 * k('market'), speed: 2.5, cap: { title: 'Haggle with AI shopkeepers.', sub: 'Bring proof: your rival sells it cheaper.' }, fadeCap: true },
    { kind: 'phone', clip: 'market', from: M('market', 'haggle') + 0.2 * k('market'), to: M('market', 'end'), cap: { title: 'Haggle with AI shopkeepers.', sub: 'Bring proof: your rival sells it cheaper.' },
      sfx: [{ at: M('market', 'rival') + 0.15 * k('market'), name: 'whoosh' }, { at: M('market', 'stamp'), name: 'stamp' }] },
    // Ville vivante
    { kind: 'phone', clip: 'event', from: M('event', 'crash') - 1.2 * k('event'), to: M('event', 'banner') + 4.6 * k('event'), cap: { title: 'The city is alive.', sub: 'Flash crash at the Louvre: DeepSeek −40%.' }, fadeCap: true,
      sfx: [{ at: M('event', 'banner') + 0.05 * k('event'), name: 'event' }] },
    { kind: 'phone', clip: 'event', from: M('event', 'sheet') + 1.0 * k('event'), to: M('event', 'end'), cap: { title: 'The city is alive.', sub: 'Flash crash at the Louvre: DeepSeek −40%.' } },
    // Economy Lab
    { kind: 'phone', clip: 'lab', from: M('lab', 'scenario') - 0.2 * k('lab'), to: M('lab', 'run') + 0.2 * k('lab'), speed: 2.5, cap: { title: 'A real economy, stress-tested.', sub: 'Simulate a week of Paris in one second.' }, fadeCap: true,
      sfx: [{ at: M('lab', 'run') + 0.15 * k('lab'), name: 'tap' }] },
    { kind: 'phone', clip: 'lab', from: M('lab', 'run') + 0.2 * k('lab'), to: M('lab', 'end'), speed: 1.5, cap: { title: 'A real economy, stress-tested.', sub: 'Simulate a week of Paris in one second.' } },
    // Forge
    { kind: 'phone', clip: 'forge', from: M('forge', 'fly') + 0.3 * k('forge'), to: M('forge', 'hold'), speed: 1.3, cap: { title: 'Forge your shards…', sub: 'at real monuments.' }, fadeCap: true },
    { kind: 'phone', clip: 'forge', from: M('forge', 'hold'), to: M('forge', 'ticket'), speed: 1.6, cap: { title: 'Forge your shards…', sub: 'at real monuments.' },
      sfx: [{ at: M('forge', 'hold') + 0.3 * k('forge'), name: 'forge' }] },
    { kind: 'phone', clip: 'forge', from: M('forge', 'ticket'), to: M('forge', 'try') + 0.1 * k('forge'), cap: { title: '…into a REAL AI API key.', sub: 'With real NEAR AI Cloud credits on it.', accent: 'REAL' }, fadeCap: true,
      sfx: [{ at: M('forge', 'ticket') + 0.05 * k('forge'), name: 'coin' }] },
    { kind: 'phone', clip: 'forge', from: M('forge', 'try') + 0.1 * k('forge'), to: M('forge', 'answer') + 1.6 * k('forge'), speed: 1.6, cap: { title: '…into a REAL AI API key.', sub: 'Use it in the playground, or in your own code.', accent: 'REAL' } },
    // Partout / canapé
    { kind: 'phone', clip: 'hook', from: M('hook', 'fly') - 0.4 * k('hook'), to: M('hook', 'tap-catch') + 0.2 * k('hook'), cap: { title: 'Play anywhere — or from your couch.', sub: 'Remote Scout: a pigeon-drone with a battery.' }, fadeCap: true },
    { kind: 'laptop', clip: 'desktop', from: 0.2, to: 3.9, cap: { title: 'Play anywhere — or from your couch.', sub: 'Any browser. No app, no wallet, no sign-up.' } },
    { kind: 'card', card: 'end', dur: 5.5 },
  ];
}
const speedOf = (s: Exclude<Shot, { kind: 'card' }>) => (s.kind === 'phone' ? s.speed ?? 1 : 1) * k(s.clip);
const dur = (s: Shot) => (s.kind === 'card' ? s.dur : (s.to - s.from) / speedOf(s));

// ───────── Habillages (HTML → PNG) ─────────
const font = (p: string) => `data:font/woff2;base64,${readFileSync(`${ROOT}node_modules/@fontsource/${p}`).toString('base64')}`;
const img = (p: string, mime: string) => `data:${mime};base64,${readFileSync(`${ROOT}${p}`).toString('base64')}`;
const CSS = `
@font-face { font-family: Pixel; src: url(${font('pixelify-sans/files/pixelify-sans-latin-700-normal.woff2')}); font-weight: 700; }
@font-face { font-family: Nunito; src: url(${font('nunito/files/nunito-latin-800-normal.woff2')}); font-weight: 800; }
@font-face { font-family: Nunito; src: url(${font('nunito/files/nunito-latin-900-normal.woff2')}); font-weight: 900; }
* { margin: 0; box-sizing: border-box; }
html, body { background: transparent; }
:root { --ink: #1a1c2c; --gold: #ffcd75; --orange: #ef7d57; --cream: #f4f4f4; --blue: #41a6f6; --purple: #5d275d; }
.bg { position: absolute; inset: 0; background: url(${img('apps/web/public/art/cover.webp', 'image/webp')}) center / cover; image-rendering: pixelated; filter: saturate(1.05) blur(2.5px); transform: scale(1.03); }
.shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(26,28,44,.82) 0%, rgba(26,28,44,.62) 45%, rgba(26,28,44,.25) 72%, rgba(26,28,44,.35) 100%); }
.cap { position: absolute; color: #fff; }
.cap h1 { font: 700 var(--t) / 1.04 Pixel, monospace; letter-spacing: .01em; -webkit-text-stroke: calc(var(--t) * .045) var(--ink); paint-order: stroke fill;
  text-shadow: 0 calc(var(--t) * .07) 0 var(--ink), 0 calc(var(--t) * .12) 24px rgba(0,0,0,.35); }
.cap h1 em { font-style: normal; color: var(--gold); }
.cap p { display: inline-block; margin-top: calc(var(--t) * .38); font: 800 var(--s) / 1.25 Nunito, sans-serif; color: var(--ink); background: var(--cream);
  padding: .35em .75em; border-radius: .6em; border: 4px solid var(--ink); box-shadow: 0 6px 0 var(--ink); }
.tag { position: absolute; font: 900 26px Nunito, sans-serif; color: var(--ink); background: var(--gold); border: 4px solid var(--ink); border-radius: 14px; padding: 6px 16px; box-shadow: 0 5px 0 var(--ink); }
`;

async function png(page: Page, w: number, h: number, body: string, file: string) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body style="width:${w}px;height:${h}px;position:relative;overflow:hidden">${body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(50);
  await page.screenshot({ path: file, omitBackground: true });
}

interface Layout {
  name: string; W: number; H: number;
  phone: { x: number; y: number; w: number; h: number }; // écran (trou dans le cadre)
  laptop: { x: number; y: number; w: number; h: number };
  capBox: (c: Caption) => string;
  shade: string;
}
const BEZEL = 20;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const titleHtml = (c: Caption) => (c.accent ? esc(c.title).replace(c.accent, `<em>${c.accent}</em>`) : esc(c.title));

const LAND: Layout = {
  name: 'land', W: 1920, H: 1080,
  phone: { x: 1170, y: 60, w: 444, h: 960 },
  laptop: { x: 300, y: 250, w: 1320, h: 825 },
  shade: '',
  capBox: (c) => `<div class="cap" style="left:130px;top:0;bottom:0;width:930px;display:flex;flex-direction:column;justify-content:center;--t:${c.title.length > 26 ? 92 : 112}px;--s:36px">
    <h1>${titleHtml(c)}</h1>${c.sub ? `<div><p>${esc(c.sub)}</p></div>` : ''}</div>`,
};
const PORT: Layout = {
  name: 'portrait', W: 1080, H: 1350,
  phone: { x: 314, y: 300, w: 452, h: 978 },
  laptop: { x: 40, y: 420, w: 1000, h: 625 },
  shade: 'background: linear-gradient(180deg, rgba(26,28,44,.78) 0%, rgba(26,28,44,.5) 22%, rgba(26,28,44,.2) 45%, rgba(26,28,44,.3) 100%)',
  capBox: (c) => `<div class="cap" style="left:50px;right:50px;top:34px;text-align:center;--t:${c.title.length > 26 ? 60 : 76}px;--s:28px">
    <h1>${titleHtml(c)}</h1>${c.sub ? `<div><p style="margin-top:14px">${esc(c.sub)}</p></div>` : ''}</div>`,
};

async function drawLayout(page: Page, L: Layout, shots: Shot[]) {
  const dir = `${WORK}/${L.name}`;
  mkdirSync(dir, { recursive: true });
  // fond
  await png(page, L.W, L.H, `<div class="bg"></div><div class="shade" style="${L.shade}"></div>`, `${dir}/bg.png`);
  // cadre du téléphone : contour encre + coque, écran transparent aux coins arrondis
  const p = L.phone;
  const R = 54;
  await png(page, L.W, L.H, `
    <svg width="${L.W}" height="${L.H}" style="position:absolute;inset:0">
      <defs><mask id="m"><rect width="100%" height="100%" fill="white"/><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${R - BEZEL + 6}" fill="black"/></mask></defs>
      <rect x="${p.x - BEZEL - 6}" y="${p.y - BEZEL - 6 + 14}" width="${p.w + 2 * BEZEL + 12}" height="${p.h + 2 * BEZEL + 12}" rx="${R + 6}" fill="rgba(0,0,0,.35)" mask="url(#m)"/>
      <rect x="${p.x - BEZEL - 6}" y="${p.y - BEZEL - 6}" width="${p.w + 2 * BEZEL + 12}" height="${p.h + 2 * BEZEL + 12}" rx="${R + 6}" fill="#1a1c2c" mask="url(#m)"/>
      <rect x="${p.x - BEZEL}" y="${p.y - BEZEL}" width="${p.w + 2 * BEZEL}" height="${p.h + 2 * BEZEL}" rx="${R}" fill="#333c57" mask="url(#m)"/>
      <rect x="${p.x - BEZEL + 5}" y="${p.y - BEZEL + 5}" width="${p.w + 2 * BEZEL - 10}" height="${p.h + 2 * BEZEL - 10}" rx="${R - 5}" fill="#1a1c2c" mask="url(#m)"/>
      <rect x="${p.x + p.w / 2 - 40}" y="${p.y - 14}" width="80" height="8" rx="4" fill="#333c57"/>
      <rect x="${p.x + p.w + BEZEL - 1}" y="${p.y + 170}" width="8" height="90" rx="3" fill="#333c57"/>
      <rect x="${p.x - BEZEL - 7}" y="${p.y + 140}" width="8" height="60" rx="3" fill="#333c57"/>
    </svg>`, `${dir}/frame.png`);
  // cadre d'ordinateur portable
  const l = L.laptop;
  await png(page, L.W, L.H, `
    <svg width="${L.W}" height="${L.H}" style="position:absolute;inset:0">
      <defs><mask id="m"><rect width="100%" height="100%" fill="white"/><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="6" fill="black"/></mask></defs>
      <rect x="${l.x - 22}" y="${l.y - 22}" width="${l.w + 44}" height="${l.h + 56}" rx="26" fill="#1a1c2c" mask="url(#m)"/>
      <circle cx="${l.x + l.w / 2}" cy="${l.y - 11}" r="4" fill="#566c86"/>
      <path d="M ${l.x - 120} ${l.y + l.h + 34} h ${l.w + 240} l -40 40 h ${-(l.w + 160)} z" fill="#94b0c2" stroke="#1a1c2c" stroke-width="6"/>
      <rect x="${l.x + l.w / 2 - 90}" y="${l.y + l.h + 34}" width="180" height="12" rx="6" fill="#566c86"/>
    </svg>`, `${dir}/laptop.png`);
  // légendes (une par plan)
  for (const [i, s] of shots.entries()) {
    if (s.kind === 'card') continue;
    const cap = s.kind === 'laptop' && L.name === 'land'
      ? `<div class="cap" style="left:0;right:0;top:40px;text-align:center;--t:84px;--s:32px"><h1>${titleHtml(s.cap)}</h1>${s.cap.sub ? `<div><p style="margin-top:12px">${esc(s.cap.sub)}</p></div>` : ''}</div>`
      : s.kind === 'laptop'
        ? `<div class="cap" style="left:40px;right:40px;top:60px;text-align:center;--t:76px;--s:30px"><h1>${titleHtml(s.cap)}</h1>${s.cap.sub ? `<div><p style="margin-top:16px">${esc(s.cap.sub)}</p></div>` : ''}</div>`
        : L.capBox(s.cap);
    await png(page, L.W, L.H, cap, `${dir}/cap${i}.png`);
  }
  // cartes titre et fin
  const logo = img('apps/web/public/art/logo.png', 'image/png');
  const big = L.name === 'land';
  await png(page, L.W, L.H, `<div class="bg"></div><div class="shade" style="background:rgba(26,28,44,.55)"></div>
    <div class="cap" style="inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;--t:${big ? 70 : 54}px;--s:${big ? 34 : 28}px">
      <img src="${logo}" style="width:${big ? 980 : 860}px;image-rendering:pixelated;filter:drop-shadow(0 12px 0 #1a1c2c)">
      <h1 style="margin-top:46px">Walk your city. Catch AI.<br><em>Spend it for real.</em></h1>
    </div>`, `${dir}/title.png`);
  await png(page, L.W, L.H, `<div class="bg"></div><div class="shade" style="background:rgba(26,28,44,.62)"></div>
    <div class="cap" style="inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:${big ? 34 : 30}px;--t:${big ? 62 : 50}px;--s:${big ? 34 : 28}px;padding:0 50px">
      <img src="${logo}" style="width:${big ? 860 : 820}px;image-rendering:pixelated;filter:drop-shadow(0 12px 0 #1a1c2c)">
      <h1>Walk your city. Catch AI.<br><em>Spend it for real.</em></h1>
      <div><p style="margin:0">Play in your browser — tokengo demo link in post</p></div>
      <div style="font:900 ${big ? 30 : 26}px Nunito;color:#fff;text-shadow:0 3px 0 #1a1c2c;opacity:.95">Built at NEAR HACKATHON · #NEARHackathon @NEARProtocol</div>
    </div>`, `${dir}/end.png`);
}

// ───────── Plans → segments vidéo ─────────
function renderShot(L: Layout, s: Shot, i: number): string {
  const dir = `${WORK}/${L.name}`;
  const out = `${dir}/seg${String(i).padStart(2, '0')}.mp4`;
  const d = dur(s).toFixed(3);
  const enc = ['-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-t', d, out];
  if (s.kind === 'card') {
    const f = s.card === 'end' ? 'fade=in:st=0:d=0.5' : 'fade=in:st=0:d=0.15:color=white,fade=out:st=' + (s.dur - 0.25).toFixed(2) + ':d=0.25:color=white';
    // léger zoom avant (Ken Burns) sur la carte
    ff(['-loop', '1', '-framerate', String(FPS), '-t', d, '-i', `${dir}/${s.card}.png`, '-filter_complex',
      `[0]scale=${L.W * 2}:${L.H * 2},zoompan=z='1+0.03*on/${Math.round(s.dur * FPS)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${L.W}x${L.H}:fps=${FPS},${f}[v]`,
      '-map', '[v]', ...enc]);
    return out;
  }
  const speed = speedOf(s);
  const box = s.kind === 'phone' ? L.phone : L.laptop;
  const frame = s.kind === 'phone' ? 'frame.png' : 'laptop.png';
  const capFade = s.fadeCap
    ? `fade=in:st=0:d=0.3:alpha=1[c];[b][c]overlay=x='if(lt(t,0.3),-50*(1-t/0.3),0)':y=0`
    : `null[c];[b][c]overlay=0:0`;
  ff(['-loop', '1', '-framerate', String(FPS), '-i', `${dir}/bg.png`,
    '-ss', s.from.toFixed(3), '-t', ((s.to - s.from) + 0.2).toFixed(3), '-i', `${RAW}/${s.clip}.mp4`,
    '-loop', '1', '-framerate', String(FPS), '-i', `${dir}/${frame}`,
    '-loop', '1', '-framerate', String(FPS), '-i', `${dir}/cap${i}.png`,
    '-filter_complex',
    `[1]setpts=(PTS-STARTPTS)/${speed},fps=${FPS},tpad=stop_mode=clone:stop_duration=3,scale=${box.w}:${box.h}:flags=lanczos[v];` +
    `[0][v]overlay=${box.x}:${box.y}[a];[a][2]overlay=0:0[b];[3]format=rgba,${capFade}[o]`,
    '-map', '[o]', ...enc]);
  return out;
}

function compose(L: Layout, shots: Shot[], tag: string) {
  const segs = shots.map((s, i) => renderShot(L, s, i));
  const list = `${WORK}/${L.name}/concat.txt`;
  writeFileSync(list, segs.map((f) => `file '${f}'`).join('\n') + '\n');
  const total = shots.reduce((a, s) => a + dur(s), 0);
  // effets sonores sur la ligne de temps finale
  const sfx: { t: number; name: string }[] = [];
  let t = 0;
  for (const s of shots) {
    if (s.kind === 'phone') for (const e of s.sfx ?? []) {
      const at = t + (e.at - s.from) / speedOf(s);
      if (at >= t - 0.05 && at <= t + dur(s)) sfx.push({ t: Math.max(0, at), name: e.name });
    }
    if (s.kind === 'card') sfx.push({ t: t + 0.02, name: s.card === 'title' ? 'perfect' : 'route' });
    t += dur(s);
  }
  writeFileSync(`${WORK}/sfx.json`, JSON.stringify(sfx, null, 1));
  execFileSync('node', [`${ROOT}scripts/video/music.ts`, `${WORK}/music.wav`, total.toFixed(3), `${WORK}/sfx.json`], { stdio: 'inherit' });
  const out = `${OUT}/tokengo-demo${tag}.mp4`;
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-i', `${WORK}/music.wav`, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', L.name === 'land' ? '26' : '26', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', out]);
  console.log(`[compose] ${out} — ${total.toFixed(1)} s`);
  return total;
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const shots = shotList();
  const only = process.argv[2]; // 'land' | 'portrait' (défaut : les deux)
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const L of [LAND, PORT]) if (!only || only === L.name) await drawLayout(page, L, shots);

  // vignette : la capture PERFECT dans le téléphone + titre
  const hookResult = M('hook', 'result') + 2.6 * SLOW;
  ff(['-ss', hookResult.toFixed(2), '-i', `${RAW}/hook.mp4`, '-frames:v', '1', `${WORK}/thumb-phone.png`]);
  await png(page, 1280, 720, `<div class="bg"></div><div class="shade"></div>
    <img src="${img('var/video/work/thumb-phone.png', 'image/png')}" style="position:absolute;left:820px;top:40px;height:640px;border-radius:34px;border:14px solid #1a1c2c;box-shadow:0 12px 0 rgba(0,0,0,.35)">
    <div class="cap" style="left:70px;top:0;bottom:0;width:720px;display:flex;flex-direction:column;justify-content:center;--t:84px;--s:28px">
      <img src="${img('apps/web/public/art/logo.png', 'image/png')}" style="width:520px;image-rendering:pixelated;margin-bottom:26px;filter:drop-shadow(0 8px 0 #1a1c2c)">
      <h1>Catch AI.<br>Forge a <em>REAL</em><br>AI API key.</h1>
      <div><p>A walking game for your phone</p></div>
    </div>`, `${OUT}/thumbnail.png`);
  await browser.close();

  for (const L of [LAND, PORT]) if (!only || only === L.name) compose(L, shots, L.name === 'land' ? '' : '-portrait');

  // boucle de 5 s de la capture (README) : MP4 muet + GIF
  const t0 = M('hook', 'lockon') - 0.1 * k('hook');
  ff(['-ss', t0.toFixed(2), '-t', String(5 * SLOW), '-i', `${RAW}/hook.mp4`, '-vf', `setpts=PTS/${SLOW},fps=30,scale=390:-2:flags=lanczos`, '-an', '-t', '5', '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/catch-loop.mp4`]);
  ff(['-ss', t0.toFixed(2), '-t', String(5 * SLOW), '-i', `${RAW}/hook.mp4`, '-filter_complex',
    `setpts=PTS/${SLOW},fps=15,scale=300:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-t', '5', `${OUT}/catch-loop.gif`]);
}

await main();
