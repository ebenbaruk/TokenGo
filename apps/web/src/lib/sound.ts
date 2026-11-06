// Sons courts synthétisés en WebAudio (aucun asset). Coupables (préférence locale).
type SoundName = 'tap' | 'catch' | 'perfect' | 'miss' | 'fled' | 'sync' | 'trade' | 'forge' | 'error' | 'level';

let ctx: AudioContext | null = null;
const KEY = 'tg.muted';
export function isMuted(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setMuted(m: boolean): void {
  try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* stockage indisponible */ }
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(a: AudioContext, freq: number, at: number, dur: number, type: OscillatorType = 'square', vol = 0.08, slideTo?: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + at);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + at + dur);
  g.gain.setValueAtTime(0.0001, a.currentTime + at);
  g.gain.exponentialRampToValueAtTime(vol, a.currentTime + at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + at);
  o.stop(a.currentTime + at + dur + 0.02);
}

function noise(a: AudioContext, at: number, dur: number, vol = 0.05, from = 800, to = 3000) {
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(from, a.currentTime + at);
  f.frequency.exponentialRampToValueAtTime(to, a.currentTime + at + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, a.currentTime + at);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(a.currentTime + at);
}

export function play(name: SoundName): void {
  if (isMuted()) return;
  const a = ac();
  if (!a) return;
  switch (name) {
    case 'tap': tone(a, 660, 0, 0.05, 'square', 0.04); break;
    case 'catch': tone(a, 1320, 0, 0.08, 'triangle', 0.1); tone(a, 1760, 0.07, 0.14, 'triangle', 0.09); break;
    case 'perfect': [523, 659, 784, 1046].forEach((f, i) => tone(a, f, i * 0.06, 0.22, 'triangle', 0.08)); break;
    case 'miss': tone(a, 300, 0, 0.1, 'square', 0.05, 200); break;
    case 'fled': tone(a, 600, 0, 0.35, 'triangle', 0.06, 120); break;
    case 'sync': noise(a, 0, 0.35, 0.08, 400, 4000); tone(a, 880, 0.25, 0.15, 'triangle', 0.06); break;
    case 'trade': tone(a, 1046, 0, 0.06, 'square', 0.05); tone(a, 1568, 0.06, 0.18, 'triangle', 0.07); break;
    case 'forge': noise(a, 0, 0.9, 0.12, 80, 300); tone(a, 70, 0, 0.9, 'sawtooth', 0.05, 50);
      [784, 1046, 1318, 1568].forEach((f, i) => tone(a, f, 1.0 + i * 0.07, 0.4, 'triangle', 0.07)); break;
    case 'error': tone(a, 220, 0, 0.12, 'square', 0.05); tone(a, 180, 0.1, 0.15, 'square', 0.05); break;
    case 'level': [392, 523, 659, 784, 1046].forEach((f, i) => tone(a, f, i * 0.08, 0.25, 'square', 0.05)); break;
  }
}

export function buzz(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* iOS : ignoré */ }
}
