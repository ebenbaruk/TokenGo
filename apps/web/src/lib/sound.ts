// Sons courts synthétisés en WebAudio (aucun asset), façon chiptune, + vibrations (Vibration API).
// Deux préférences locales indépendantes : son coupé (tg.muted) et vibrations coupées (tg.haptics = '0').
export type SoundName =
  | 'tap' | 'catch' | 'perfect' | 'miss' | 'fled' | 'sync' | 'trade' | 'forge' | 'error' | 'level'
  | 'discover' | 'shiny' | 'stop' | 'route' | 'reveal' | 'coin' | 'whoosh' | 'share' | 'event' | 'pop'
  | 'clash' | 'crown'
  | 'decodeIn' | 'decoded' | 'glitch' | 'tick';

let ctx: AudioContext | null = null;
const KEY = 'tg.muted';
const HKEY = 'tg.haptics';
const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

export const isMuted = (): boolean => read(KEY) === '1';
export const setMuted = (m: boolean): void => write(KEY, m ? '1' : '0');
export const hapticsOn = (): boolean => read(HKEY) !== '0';
export const setHaptics = (on: boolean): void => write(HKEY, on ? '1' : '0');
export const canVibrate = (): boolean => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

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

/** Arpège (fréquences, pas en s). */
const arp = (a: AudioContext, freqs: number[], step: number, dur: number, type: OscillatorType, vol: number, at = 0) =>
  freqs.forEach((f, i) => tone(a, f, at + i * step, dur, type, vol));

/**
 * Joue un son. `pitch` : nombre de demi-tons de transposition (le combo monte d'un ton par niveau).
 */
export function play(name: SoundName, pitch = 0): void {
  if (isMuted()) return;
  const a = ac();
  if (!a) return;
  const k = 2 ** (pitch / 12);
  switch (name) {
    case 'tap': tone(a, 660, 0, 0.05, 'square', 0.04); break;
    case 'catch': tone(a, 1320 * k, 0, 0.08, 'triangle', 0.1); tone(a, 1760 * k, 0.07, 0.14, 'triangle', 0.09); break;
    case 'perfect':
      arp(a, [523, 659, 784, 1046].map((f) => f * k), 0.055, 0.2, 'triangle', 0.08);
      tone(a, 2093 * k, 0.24, 0.25, 'square', 0.035);
      noise(a, 0, 0.12, 0.05, 2000, 6000);
      break;
    case 'miss': tone(a, 300, 0, 0.1, 'square', 0.05, 200); break;
    case 'fled': tone(a, 600, 0, 0.35, 'triangle', 0.06, 120); break;
    case 'sync': noise(a, 0, 0.35, 0.08, 400, 4000); tone(a, 880, 0.25, 0.15, 'triangle', 0.06); break;
    case 'trade': tone(a, 1046, 0, 0.06, 'square', 0.05); tone(a, 1568, 0.06, 0.18, 'triangle', 0.07); break;
    case 'coin': tone(a, 988, 0, 0.06, 'square', 0.05); tone(a, 1319, 0.06, 0.22, 'square', 0.05); break;
    case 'forge': noise(a, 0, 0.9, 0.12, 80, 300); tone(a, 70, 0, 0.9, 'sawtooth', 0.05, 50);
      arp(a, [784, 1046, 1318, 1568], 0.07, 0.4, 'triangle', 0.07, 1.0); break;
    case 'error': tone(a, 220, 0, 0.12, 'square', 0.05); tone(a, 180, 0.1, 0.15, 'square', 0.05); break;
    case 'level': arp(a, [392, 523, 659, 784, 1046], 0.08, 0.25, 'square', 0.05); break;
    // nouvelle case du Codex : « ta-da » montant + cloche
    case 'discover': arp(a, [659, 784, 988, 1319], 0.07, 0.18, 'square', 0.045); tone(a, 2637, 0.3, 0.5, 'triangle', 0.05); break;
    // shiny : cascade scintillante
    case 'shiny': arp(a, [1568, 2093, 1760, 2349, 1976, 2637], 0.045, 0.16, 'triangle', 0.05); noise(a, 0, 0.5, 0.03, 4000, 9000); break;
    // arrêt de la Daily Route : deux notes rondes
    case 'stop': tone(a, 784, 0, 0.09, 'triangle', 0.08); tone(a, 1175, 0.08, 0.2, 'triangle', 0.08); break;
    // fin de route : fanfare
    case 'route':
      arp(a, [523, 523, 523, 659], 0.11, 0.12, 'square', 0.05);
      arp(a, [784, 1046], 0.16, 0.45, 'square', 0.05, 0.5);
      arp(a, [262, 330, 392], 0.11, 0.3, 'triangle', 0.06);
      break;
    case 'reveal': noise(a, 0, 0.25, 0.04, 600, 5000); tone(a, 1760, 0.15, 0.25, 'triangle', 0.06); break;
    case 'whoosh': noise(a, 0, 0.28, 0.06, 300, 3000); break;
    case 'share': tone(a, 880, 0, 0.07, 'triangle', 0.06); tone(a, 1320, 0.07, 0.07, 'triangle', 0.06); tone(a, 1760, 0.14, 0.14, 'triangle', 0.06); break;
    // événement de ville : jingle ; bulle de marchand : petit « pop »
    case 'event': arp(a, [659, 880, 659, 988], 0.09, 0.12, 'square', 0.045); break;
    case 'pop': tone(a, 1200, 0, 0.04, 'triangle', 0.025, 1600); break;
    // Arène : choc des deux réponses, hallucination (glitch), couronne du Champion (fanfare royale)
    case 'clash': noise(a, 0, 0.18, 0.09, 300, 2500); tone(a, 196, 0, 0.18, 'square', 0.05, 98); tone(a, 1568, 0.05, 0.12, 'triangle', 0.05); break;
    case 'crown':
      arp(a, [392, 523, 659, 784], 0.1, 0.18, 'square', 0.05);
      arp(a, [1046, 1318, 1568, 2093], 0.09, 0.35, 'triangle', 0.06, 0.45);
      noise(a, 0.45, 0.6, 0.03, 3000, 9000);
      break;
    // Décodage (Docs/13 §3) : la carte s'ouvre (modem bref), bon jeton (frappe + accord), hallucination (bruit + chute)
    case 'decodeIn': arp(a, [880, 1320, 990, 1480], 0.035, 0.05, 'square', 0.035); break;
    case 'decoded':
      arp(a, [1046, 1046, 1046], 0.04, 0.03, 'square', 0.035);
      arp(a, [659, 988, 1319, 1976], 0.06, 0.22, 'triangle', 0.07, 0.12);
      break;
    case 'glitch':
      noise(a, 0, 0.18, 0.09, 200, 8000); noise(a, 0.2, 0.12, 0.07, 6000, 300);
      tone(a, 420, 0.02, 0.45, 'sawtooth', 0.045, 70); tone(a, 433, 0.02, 0.45, 'square', 0.03, 75);
      break;
    case 'tick': tone(a, 1760, 0, 0.025, 'square', 0.025); break;
  }
}

/** Motifs de vibration par événement (ms : vibre, pause, vibre…). */
export const HAPTIC = {
  tap: 8,
  good: 35,
  perfect: [25, 30, 25, 30, 70],
  miss: [15, 40, 15],
  shiny: [20, 25, 20, 25, 20, 25, 120],
  stop: [30, 50, 30],
  route: [60, 60, 60, 60, 200],
  trade: 20,
  forge: [40, 80, 40, 80, 160],
  reveal: 25,
  clash: [30, 20, 60],
  crown: [50, 50, 50, 50, 50, 50, 250],
  decoded: [20, 30, 50],
  glitch: [60, 30, 20, 30, 90],
} as const satisfies Record<string, number | readonly number[]>;

export function buzz(pattern: number | readonly number[]): void {
  if (!hapticsOn() || !canVibrate()) return;
  try { navigator.vibrate(pattern as number | number[]); } catch { /* iOS : ignoré */ }
}

/** Son + vibration d'un coup. */
export function feedback(name: SoundName, haptic?: keyof typeof HAPTIC, pitch = 0): void {
  play(name, pitch);
  if (haptic) buzz(HAPTIC[haptic]);
}
