// Web Worker de l'Economy Lab : exécute le vrai simulateur partagé (packages/shared/src/economy/sim.ts)
// et renvoie des frames compactes (toutes les 2 h simulées) pour la lecture animée.
import { createSim, STEPS_PER_HOUR, type Sim, type Scenario, type SimResult, type WorldLike } from '@tokengo/shared/economy/sim.ts';
import type { Family, MerchantState, Pools } from '@tokengo/shared';
import world from '../../../../data/world/paris.json';

export interface LabRunRequest { type: 'run'; days: number; players: number; seed: number; scenario: Scenario; initialMerchants?: MerchantState[]; initialP0?: Record<Family, number>; initialPools?: Pools }
export interface LabMerchantInfo { id: string; name: string; lat: number; lng: number }
export interface LabFrame {
  hour: number;
  /** 0 open · 1 closing · 2 closed, même ordre que `merchants` */
  status: number[];
  flux: number[];
  bots: [number, number][];
}
export type LabMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; result: SimResult; merchants: LabMerchantInfo[]; frames: LabFrame[]; ms: number; fromLive: boolean }
  | { type: 'error'; message: string };

const FRAME_HOURS = 2;
const MAX_BOTS_DRAWN = 160;
const ST = { open: 0, closing: 1, closed: 2 } as const;

self.onmessage = (ev: MessageEvent<LabRunRequest>) => {
  const req = ev.data;
  if (req.type !== 'run') return;
  const t0 = performance.now();
  const post = (m: LabMessage) => (self as unknown as Worker).postMessage(m);
  const base = { world: world as unknown as WorldLike, days: req.days, players: req.players, seed: req.seed, scenario: req.scenario };
  let sim: Sim | undefined;
  let fromLive = false;
  try {
    if (req.initialMerchants?.length) {
      sim = createSim({ ...base, initialMerchants: req.initialMerchants, initialP0: req.initialP0, initialPools: req.initialPools });
      fromLive = true;
    }
  } catch { sim = undefined; }
  try {
    sim ??= createSim(base);
    const frames: LabFrame[] = [];
    let merchants: LabMerchantInfo[] = [];
    const capture = () => {
      const snap = sim!.snapshot();
      if (!merchants.length) merchants = snap.merchants.map((m) => ({ id: m.id, name: m.name, lat: m.lat, lng: m.lng }));
      frames.push({
        hour: snap.hour,
        status: snap.merchants.map((m) => ST[m.status]),
        flux: snap.merchants.map((m) => Math.round(m.flux)),
        bots: snap.bots.slice(0, MAX_BOTS_DRAWN).map((b) => [Math.round(b.lng * 1e5) / 1e5, Math.round(b.lat * 1e5) / 1e5]),
      });
    };
    capture();
    const s = sim;
    const chunk = STEPS_PER_HOUR * FRAME_HOURS;
    let lastPost = 0;
    while (!s.done) {
      s.run(chunk);
      capture();
      const now = performance.now();
      if (now - lastPost > 60) { lastPost = now; post({ type: 'progress', fraction: s.stepIndex / s.totalSteps }); }
    }
    post({ type: 'done', result: s.result(), merchants, frames, ms: Math.round(performance.now() - t0), fromLive });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
