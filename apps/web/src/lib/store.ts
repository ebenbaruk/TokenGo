// État global (Zustand). Exposé en lecture sur window.__tg pour les tests E2E (la carte WebGL n'est pas lisible).
import { create } from 'zustand';
import type { Me, NodeView, SpawnView, WorldResponse, Family, ScoutView } from '@tokengo/shared';

export interface Pos { lat: number; lng: number; acc: number; heading?: number; t: number }

export type Overlay =
  | { kind: 'catch'; spawn: SpawnView }
  | { kind: 'relay'; node: NodeView }
  | { kind: 'merchant'; node: NodeView }
  | { kind: 'forge'; node: NodeView }
  | { kind: 'jump'; node: NodeView }
  | { kind: 'credits' }
  | { kind: 'bag' }
  | { kind: 'quests' }
  | { kind: 'menu' }
  | { kind: 'profile' }
  | { kind: 'proofs' }
  | { kind: 'district' };

export interface Toast { id: number; text: string; tone: 'good' | 'bad' | 'info'; icon?: Family | 'flux' | 'xp' | 'level' }

export type GpsStatus = 'pending' | 'ok' | 'weak' | 'denied' | 'demo';

interface State {
  phase: 'splash' | 'play';
  me: Me | null;
  world: WorldResponse | null;
  pos: Pos | null;
  demo: boolean;
  gps: GpsStatus;
  inTransit: boolean;
  overlay: Overlay | null;
  toasts: Toast[];
  lastResult: unknown;
  /** éclats capturés localement (masqués en attendant le prochain /world) */
  hiddenSpawns: string[];
  /** destination en Demo Walk */
  walkTarget: { lat: number; lng: number } | null;
  serverDown: boolean;
  showRunners: boolean;
  /** Remote Scout : batterie (dernier état serveur ; l'UI la fait progresser avec scoutCharge) */
  scout: ScoutView | null;
}

export const useGame = create<State>(() => ({
  phase: 'splash',
  me: null,
  world: null,
  pos: null,
  demo: false,
  gps: 'pending',
  inTransit: false,
  overlay: null,
  toasts: [],
  lastResult: null,
  hiddenSpawns: [],
  walkTarget: null,
  serverDown: false,
  scout: null,
  showRunners: (() => { try { return localStorage.getItem('tg.runners') !== '0'; } catch { return true; } })(),
}));

const set = useGame.setState;
const get = useGame.getState;

let toastSeq = 1;
export function toast(text: string, tone: Toast['tone'] = 'info', icon?: Toast['icon'], ms = 2600): void {
  const id = toastSeq++;
  set({ toasts: [...get().toasts.slice(-1), { id, text, tone, icon }] }); // max 2
  setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), ms);
}

/** L'heure du serveur et celle du téléphone diffèrent : on recale la batterie du Scout sur l'horloge locale à la réception. */
export function rebaseScout(v: ScoutView): ScoutView {
  const now = Date.now();
  return { ...v, at: now, resumeAt: v.resumeAt === null ? null : now + Math.max(0, v.resumeAt - v.at) };
}

export function setMe(me: Me, levelUp?: number | null): void {
  set(me.scout ? { me, scout: rebaseScout(me.scout) } : { me });
  if (levelUp) toast(`Level ${levelUp}! New things unlocked.`, 'good', 'level', 3500);
}

export function setShowRunners(v: boolean): void {
  set({ showRunners: v });
  try { localStorage.setItem('tg.runners', v ? '1' : '0'); } catch { /* */ }
}

export const openOverlay = (o: Overlay | null) => set({ overlay: o });
export const closeOverlay = () => set({ overlay: null });
export const hideSpawn = (id: string) => set({ hiddenSpawns: [...get().hiddenSpawns, id].slice(-50) });

declare global {
  interface Window { __tg?: () => Record<string, unknown> }
}
if (typeof window !== 'undefined') {
  window.__tg = () => {
    const s = get();
    return { phase: s.phase, position: s.pos, me: s.me, world: s.world, lastResult: s.lastResult, overlay: s.overlay?.kind ?? null, demo: s.demo, gps: s.gps, scout: s.scout, toasts: s.toasts.map((t) => t.text) };
  };
}
