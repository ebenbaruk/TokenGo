// Boucles de fond : tick horaire des marchands + dérive de P0, réflexions toutes les 3 h (étalées).
import { MERCHANT } from '@tokengo/shared';
import { kvGet, kvSet } from './db.ts';
import type { Ctx } from './game/context.ts';
import { HOUR, allMerchants, reflect, runHourly, type Brain } from './game/merchants.ts';
import { parisDay } from './game/reserve.ts';

/** Rattrape les heures manquées (max 6) puis planifie. Renvoie une fonction d'arrêt. */
export function startJobs(ctx: Ctx, brain?: Brain): () => void {
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
  timers.push(setInterval(hourly, 60_000));
  timers.push(setInterval(() => void reflections(), 10 * 60_000));
  return () => timers.forEach(clearInterval);
}
