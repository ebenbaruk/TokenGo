// Événements de ville côté serveur : persistance, planification automatique (jobs), déclenchement admin, effets.
// Les effets eux-mêmes sont des fonctions pures bornées (packages/shared/src/economy/events.ts).
import {
  CITY_EVENT, drawCityEvent, eventEffectText, eventGapMs, eventPriceEffect, eventStrikes, eventTitle, isEventActive, makeCityEvent, parisHour,
  type CityEvent, type CityEventSpec, type CityEventView, type Family, type LatLng, type PriceOpts,
} from '@tokengo/shared';
import { kvGet, kvSet } from '../db.ts';
import type { Ctx } from './context.ts';
import { parisDayStart } from './reserve.ts';

const parse = (r: { data: string } | undefined): CityEvent | null => (r ? (JSON.parse(r.data) as CityEvent) : null);

/** L'événement en cours (au plus un), ou null. */
export function activeEvent(ctx: Ctx): CityEvent | null {
  const now = ctx.now();
  return parse(ctx.db.prepare('SELECT data FROM city_events WHERE starts_at <= ? AND ends_at > ? ORDER BY id DESC LIMIT 1').get(now, now) as { data: string } | undefined);
}

export const eventById = (ctx: Ctx, id: number): CityEvent | null =>
  parse(ctx.db.prepare('SELECT data FROM city_events WHERE id = ?').get(id) as { data: string } | undefined);

export const eventView = (e: CityEvent | null): CityEventView | null => (e ? { ...e, title: eventTitle(e), effect: eventEffectText(e) } : null);

/** Options de prix (multiplicateur de l'événement, grève) pour une famille chez un marchand situé en `pos`. */
export function eventPriceOpts(e: CityEvent | null, family: Family, pos: LatLng, now: number): PriceOpts {
  const event = eventPriceEffect(e, family, pos, now);
  return { ...(event ? { event } : {}), ...(eventStrikes(e, pos, now) ? { strike: true } : {}) };
}

/** Termine l'événement en cours maintenant (admin) ; renvoie celui qui a été arrêté. */
export function endEvent(ctx: Ctx): CityEvent | null {
  const e = activeEvent(ctx);
  if (!e) return null;
  const now = ctx.now();
  ctx.db.prepare('UPDATE city_events SET ends_at = ?, data = ? WHERE id = ?').run(now, JSON.stringify({ ...e, endsAt: now }), e.id);
  kvSet(ctx.db, 'city-event-ended', e.id);
  ctx.bus.publish('city.event.end', `${eventTitle(e)} is over`, { eventId: e.id });
  return e;
}

/** Démarre un événement maintenant (termine l'éventuel événement en cours : un seul à la fois) et l'annonce dans le Pulse. */
export function startEvent(ctx: Ctx, spec: Omit<CityEventSpec, 'startsAt'>, source: 'auto' | 'admin'): CityEvent {
  const now = ctx.now();
  const e = ctx.db.transaction(() => {
    for (const cur of ctx.db.prepare('SELECT id, data FROM city_events WHERE ends_at > ?').all(now) as { id: number; data: string }[]) {
      const old = JSON.parse(cur.data) as CityEvent;
      ctx.db.prepare('UPDATE city_events SET ends_at = ?, data = ? WHERE id = ?').run(now, JSON.stringify({ ...old, endsAt: now }), cur.id);
    }
    const id = Number(ctx.db.prepare("INSERT INTO city_events (kind, family, zone, starts_at, ends_at, source, data) VALUES (?, ?, ?, ?, ?, ?, '{}')")
      .run(spec.kind, spec.family ?? null, spec.zone, now, now, source).lastInsertRowid);
    const ev = makeCityEvent(id, { ...spec, startsAt: now });
    ctx.db.prepare('UPDATE city_events SET family = ?, ends_at = ?, data = ? WHERE id = ?').run(ev.family, ev.endsAt, JSON.stringify(ev), id);
    return ev;
  })();
  const mins = Math.round((e.endsAt - e.startsAt) / 60_000);
  ctx.bus.publish('city.event', `${eventTitle(e)} — ${mins} min: ${eventEffectText(e)}`, { eventId: e.id, kind: e.kind, family: e.family, zone: e.zone, endsAt: e.endsAt });
  return e;
}

/**
 * Tick (toutes les minutes, jobs) : annonce la fin de l'événement terminé, puis en lance un automatiquement si
 * la pause est écoulée, dans le créneau 8 h–23 h de Paris, et sous le plafond quotidien.
 */
export function eventTick(ctx: Ctx): CityEvent | null {
  const now = ctx.now();
  const last = parse(ctx.db.prepare('SELECT data FROM city_events WHERE starts_at <= ? ORDER BY id DESC LIMIT 1').get(now) as { data: string } | undefined);
  if (last && last.endsAt <= now && (kvGet<number>(ctx.db, 'city-event-ended') ?? 0) < last.id) {
    kvSet(ctx.db, 'city-event-ended', last.id);
    ctx.bus.publish('city.event.end', `${eventTitle(last)} is over`, { eventId: last.id });
  }
  if (isEventActive(last, now)) return null;
  const seq = (ctx.db.prepare('SELECT COUNT(*) n FROM city_events').get() as { n: number }).n + 1;
  let next = kvGet<number>(ctx.db, 'city-event-next');
  if (next === null) { next = now + 20 * 60_000; kvSet(ctx.db, 'city-event-next', next); }
  if (now < next) return null;
  const h = parisHour(now);
  if (h < CITY_EVENT.firstHour || h >= CITY_EVENT.lastHour) return null;
  const today = (ctx.db.prepare('SELECT COUNT(*) n FROM city_events WHERE starts_at >= ?').get(parisDayStart(now)) as { n: number }).n;
  if (today >= CITY_EVENT.maxPerDay) return null;
  const e = startEvent(ctx, drawCityEvent(ctx.cfg.SPAWN_SECRET, seq, now), 'auto');
  kvSet(ctx.db, 'city-event-next', e.endsAt + eventGapMs(ctx.cfg.SPAWN_SECRET, seq));
  return e;
}
