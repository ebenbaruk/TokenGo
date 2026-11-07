// Bande-son de la vidéo, synthétisée ici (aucune musique tierce) : chiptune 4 voix (2 carrés, triangle, bruit)
// en do majeur à 132 BPM + effets sonores calqués sur ceux du jeu (apps/web/src/lib/sound.ts) aux instants du montage.
// Usage : node scripts/video/music.ts <sortie.wav> <durée s> [sfx.json]   (sfx.json : [{ "t": 3.2, "name": "perfect" }])
import { readFileSync, writeFileSync } from 'node:fs';

const [, , out = 'music.wav', durArg = '100', sfxPath] = process.argv;
const SR = 44_100;
const DUR = Number(durArg);
const N = Math.ceil(SR * DUR);
const L = new Float32Array(N);
const R = new Float32Array(N);

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);
type Wave = 'square' | 'pulse' | 'triangle' | 'saw' | 'noise';
let seed = 1;
const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
function osc(w: Wave, ph: number): number {
  const p = ph - Math.floor(ph);
  switch (w) {
    case 'square': return p < 0.5 ? 1 : -1;
    case 'pulse': return p < 0.25 ? 1 : -1;
    case 'triangle': return 4 * Math.abs(p - 0.5) - 1;
    case 'saw': return 2 * p - 1;
    case 'noise': return rnd();
  }
}
/** Une note : enveloppe attaque/décroissance, glissando optionnel, panoramique. */
function note(t: number, dur: number, f: number, w: Wave, vol: number, o: { slideTo?: number; pan?: number; decay?: number; vib?: number } = {}) {
  const i0 = Math.floor(t * SR);
  const n = Math.floor(dur * SR);
  const pan = o.pan ?? 0;
  const gl = Math.min(1, 1 - pan) * vol;
  const gr = Math.min(1, 1 + pan) * vol;
  let ph = 0;
  for (let k = 0; k < n && i0 + k < N; k++) {
    if (i0 + k < 0) continue;
    const x = k / n;
    const fr = o.slideTo ? f * (o.slideTo / f) ** x : f;
    ph += (fr * (1 + (o.vib ?? 0) * Math.sin((k / SR) * 2 * Math.PI * 5.5))) / SR;
    const att = Math.min(1, k / (0.004 * SR));
    const env = att * (o.decay ? Math.exp(-x * o.decay) : 1 - x * 0.35) * Math.min(1, (n - k) / (0.01 * SR));
    const s = osc(w, w === 'noise' ? 0 : ph) * env;
    L[i0 + k]! += s * gl;
    R[i0 + k]! += s * gr;
  }
}

// ───────── Musique ─────────
const BPM = 132;
const B = 60 / BPM; // une noire
const S = B / 4;    // double croche
// progression I–vi–IV–V (do, la m, fa, sol), 1 mesure chacune
const CHORDS = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
const BASS = [36, 33, 29, 31];
// mélodie (en doubles croches, -1 = silence), 2 phrases de 4 mesures
const MEL_A = [
  72, -1, 76, -1, 79, -1, 76, 79, 84, -1, 83, -1, 79, -1, 76, -1,
  76, -1, 72, -1, 69, -1, 72, 76, 81, -1, 79, -1, 76, -1, 72, -1,
  77, -1, 81, -1, 84, -1, 81, 77, 72, -1, 74, -1, 77, -1, 81, -1,
  79, -1, 83, -1, 86, -1, 83, 79, 74, -1, 79, -1, 83, 84, 86, -1,
];
const MEL_B = [
  84, 84, -1, 79, -1, 76, -1, 79, 84, -1, 86, -1, 88, -1, -1, -1,
  81, 81, -1, 76, -1, 72, -1, 76, 81, -1, 79, -1, 76, -1, -1, -1,
  77, 77, -1, 81, -1, 84, -1, 81, 77, -1, 76, -1, 74, -1, 72, -1,
  74, -1, 79, -1, 83, -1, 86, -1, 84, -1, -1, -1, 79, 81, 83, -1,
];
const BAR = 4 * B;
const bars = Math.ceil(DUR / BAR);
for (let bar = 0; bar < bars; bar++) {
  const t0 = bar * BAR;
  const c = bar % 4;
  const section = Math.floor(bar / 4) % 4; // A, A, B, A (intro sans mélodie : 2 mesures)
  const intro = bar < 2;
  const outro = t0 > DUR - BAR * 2;
  // basse triangle : octaves en croches
  for (let k = 0; k < 8; k++) note(t0 + k * 2 * S, 2 * S * 0.9, midi(BASS[c]! + (k % 2 ? 12 : 0)), 'triangle', 0.22);
  // accords arpégés (pulse, discrets)
  for (let k = 0; k < 16; k++) note(t0 + k * S, S * 0.85, midi(CHORDS[c]![k % 3]! + 12), 'pulse', 0.035, { pan: -0.35, decay: 3 });
  // batterie : grosse caisse (triangle qui plonge), caisse claire (bruit), charleston
  for (let k = 0; k < 4; k++) {
    note(t0 + k * B, 0.12, 150, 'triangle', 0.5, { slideTo: 40, decay: 4 });
    if (k % 2 === 1 && !intro) note(t0 + k * B, 0.12, 1, 'noise', 0.16, { decay: 6 });
  }
  for (let k = 0; k < 8; k++) note(t0 + k * 2 * S + S, 0.03, 1, 'noise', 0.05, { decay: 8, pan: 0.3 });
  if (intro) continue;
  const mel = section === 2 ? MEL_B : MEL_A;
  const quiet = outro ? 0.6 : 1;
  for (let k = 0; k < 16; k++) {
    const m = mel[(c * 16 + k) % mel.length]!;
    if (m < 0) continue;
    let len = 1;
    while (k + len < 16 && mel[(c * 16 + k + len) % mel.length] === -1 && len < 3) len++;
    note(t0 + k * S, len * S * 0.92, midi(m), 'square', 0.075 * quiet, { pan: 0.15, vib: 0.004 });
    note(t0 + k * S + S * 0.75, len * S * 0.8, midi(m), 'square', 0.025 * quiet, { pan: -0.5 }); // écho
  }
}
// fondu final
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const g = Math.min(1, t / 0.4, (DUR - t) / 2.2);
  L[i]! *= Math.max(0, g) * 0.8;
  R[i]! *= Math.max(0, g) * 0.8;
}

// ───────── Effets (recettes du jeu) ─────────
const arp = (t: number, fs: number[], step: number, dur: number, w: Wave, vol: number) => fs.forEach((f, i) => note(t + i * step, dur, f, w, vol, { decay: 3 }));
const SFX: Record<string, (t: number) => void> = {
  tap: (t) => note(t, 0.05, 660, 'square', 0.08, { decay: 4 }),
  perfect: (t) => { arp(t, [523, 659, 784, 1046].map((f) => f * 1.12), 0.055, 0.2, 'triangle', 0.3); note(t + 0.24, 0.25, 2093, 'square', 0.09, { decay: 3 }); note(t, 0.12, 1, 'noise', 0.15, { decay: 5 }); },
  discover: (t) => { arp(t, [659, 784, 988, 1319], 0.07, 0.18, 'square', 0.12); note(t + 0.3, 0.5, 2637, 'triangle', 0.15, { decay: 3 }); },
  coin: (t) => { note(t, 0.06, 988, 'square', 0.12); note(t + 0.06, 0.22, 1319, 'square', 0.12, { decay: 3 }); },
  trade: (t) => { note(t, 0.06, 1046, 'square', 0.12); note(t + 0.06, 0.18, 1568, 'triangle', 0.18, { decay: 3 }); },
  stamp: (t) => { note(t, 0.18, 120, 'triangle', 0.6, { slideTo: 45, decay: 4 }); note(t, 0.1, 1, 'noise', 0.25, { decay: 6 }); arp(t + 0.12, [784, 988, 1175, 1568], 0.06, 0.18, 'square', 0.1); },
  forge: (t) => { note(t, 0.9, 1, 'noise', 0.16, { decay: 2 }); note(t, 0.9, 70, 'saw', 0.15, { slideTo: 50 }); arp(t + 1.0, [784, 1046, 1318, 1568], 0.07, 0.4, 'triangle', 0.22); },
  whoosh: (t) => note(t, 0.3, 1, 'noise', 0.12, { decay: 3 }),
  event: (t) => arp(t, [659, 880, 659, 988], 0.09, 0.12, 'square', 0.13),
  route: (t) => { arp(t, [523, 523, 523, 659], 0.11, 0.12, 'square', 0.12); arp(t + 0.5, [784, 1046], 0.16, 0.45, 'square', 0.12); },
  pop: (t) => note(t, 0.05, 1200, 'triangle', 0.1, { slideTo: 1600 }),
};
if (sfxPath) {
  for (const e of JSON.parse(readFileSync(sfxPath, 'utf8')) as { t: number; name: string }[]) SFX[e.name]?.(e.t);
}

// ───────── WAV 16 bits stéréo (limiteur doux) ─────────
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.tanh(L[i]! * 1.1) * 30_000), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.tanh(R[i]! * 1.1) * 30_000), 46 + i * 4);
}
writeFileSync(out, buf);
console.log(`[music] ${out}: ${DUR.toFixed(1)} s`);
