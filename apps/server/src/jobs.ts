// Boucles de fond : tick horaire des marchands + dérive de P0, réflexions toutes les 3 h (étalées).
import { MERCHANT } from '@tokengo/shared';
import { kvGet, kvSet } from './db.ts';
import type { Ctx } from './game/context.ts';
import { HOUR, allMerchants, reflect, runHourly, type Brain } from './game/merchants.ts';
import { parisDay } from './game/reserve.ts';
import { eventTick } from './game/events.ts';

export interface PeriodicJob { name: string; everyMs: number; run: () => Promise<void> }

/** Rattrape les heures manquées (max 6) puis planifie. `periodic` : tâches en plus (ex. usage NEAR AI, mode réel). Renvoie une fonction d'arrêt. */
export function startJobs(ctx: Ctx, brain?: Brain, periodic: PeriodicJob[] = []): () => void {
  const timers: NodeJS.Timeout[] = [];
  const hourly = () => {
    const now = ctx.now();
    const cur = Math.floor(now / HOUR) * HOUR;
    let last = kvGet<number>(ctx.db, 'last-hourly') ?? cur - HOUR;
    last = Math.max(last, cur - 6 * HOUR);
    while (last < cur) {
      last += HOUR;
      runHourly(ctx, last);
      kvSet(ctx.db, 'last-hourly', last);
    }
  };
  const reflections = async () => {
    const now = ctx.now();
    const day = parisDay(now);
    const lastAll = kvGet<Record<string, number>>(ctx.db, 'last-reflect') ?? {};
    // étalement : ~1/18 des marchands toutes les 10 min → chacun toutes les 3 h
    const due = allMerchants(ctx).filter((m) => m.status !== 'closed' && now - (lastAll[m.id] ?? 0) >= MERCHANT.reflectEveryMs);
    for (const m of due.slice(0, Math.ceil(due.length / 18) + (Object.keys(lastAll).length ? 0 : due.length))) {
      await reflect(ctx, m.id, day, brain);
      lastAll[m.id] = now;
    }
    kvSet(ctx.db, 'last-reflect', lastAll);
  };
  hourly();
  void reflections();
  const events = () => { try { eventTick(ctx); } catch (e) { console.error('[events]', (e as Error).message); } };
  events();
  timers.push(setInterval(hourly, 60_000));
  timers.push(setInterval(events, 60_000));
  timers.push(setInterval(() => void reflections(), 10 * 60_000));
  for (const job of periodic) {
    let busy = false;
    const tick = async () => {
      if (busy) return; // pas de chevauchement si un appel réseau traîne
      busy = true;
      try { await job.run(); } catch (e) { console.error(`[job ${job.name}]`, (e as Error).message); } finally { busy = false; }
    };
    void tick();
    timers.push(setInterval(() => void tick(), job.everyMs));
  }
  return () => timers.forEach(clearInterval);
}
