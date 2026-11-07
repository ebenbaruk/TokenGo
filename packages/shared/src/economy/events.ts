// Événements de ville (Docs/03 §9) : définition bornée, tirage déterministe, effets sur les prix et les spawns. Fonctions pures.
import { cellToLatLng } from 'h3-js';
import type { Family } from '../types.ts';
import { haversineM, offsetM, type LatLng } from '../geo.ts';
import { pick, rngFrom, weightedPick } from '../rng.ts';
import { CITY_EVENT, CITY_EVENTS, EVENT_ZONES, FAMILY_INFO, SPAWN_WINDOW_MS, type CityEventKind, type EventZoneId } from './rules.ts';
import type { Spawn } from './spawns.ts';

export interface CityEvent {
  id: number;
  kind: CityEventKind;
  family: Family | null;
  zone: EventZoneId;
  zoneName: string;
  lat: number;
  lng: number;
  radiusM: number;
  startsAt: number;
  endsAt: number;
  /** effets (déjà bornés par makeCityEvent) */
  priceMult: number | null;
  extraSpawnChance: number | null;
  strike: boolean;
}

export interface CityEventSpec { kind: CityEventKind; family?: Family | null; zone: EventZoneId; startsAt: number; durationMs?: number }

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Construit un événement à partir d'une demande (tirage auto ou admin) en appliquant les bornes de rules.ts. */
export function makeCityEvent(id: number, spec: CityEventSpec): CityEvent {
  const rule = CITY_EVENTS[spec.kind];
  if (!rule) throw new Error(`unknown city event ${spec.kind}`);
  const zone = EVENT_ZONES.find((z) => z.id === spec.zone);
  if (!zone) throw new Error(`unknown zone ${spec.zone}`);
  const family = rule.families.length ? (spec.family && rule.families.includes(spec.family) ? spec.family : rule.families[0]!) : null;
  const duration = clamp(spec.durationMs ?? rule.durationMs, 60_000, CITY_EVENT.durationMaxMs);
  return {
    id, kind: spec.kind, family, zone: zone.id, zoneName: zone.name, lat: zone.lat, lng: zone.lng, radiusM: CITY_EVENT.radiusM,
    startsAt: spec.startsAt, endsAt: spec.startsAt + duration,
    priceMult: rule.priceMult !== undefined ? clamp(rule.priceMult, CITY_EVENT.priceMultMin, CITY_EVENT.priceMultMax) : null,
    extraSpawnChance: rule.extraSpawnChance !== undefined ? clamp(rule.extraSpawnChance, 0, CITY_EVENT.extraSpawnMax) : null,
    strike: !!rule.strike,
  };
}

export const isEventActive = (e: CityEvent | null | undefined, now: number): e is CityEvent => !!e && e.startsAt <= now && now < e.endsAt;
export const inEventZone = (e: CityEvent, p: LatLng): boolean => haversineM(e, p) <= e.radiusM;

/** Tirage automatique n° seq (déterministe) : genre pondéré, famille et zone au hasard. */
export function drawCityEvent(secret: string, seq: number, startsAt: number): CityEventSpec {
  const rng = rngFrom(secret, 'city-event', seq);
  const kind = weightedPick(rng, Object.fromEntries(Object.entries(CITY_EVENTS).map(([k, r]) => [k, r.weight])) as Record<CityEventKind, number>);
  const rule = CITY_EVENTS[kind];
  return { kind, family: rule.families.length ? pick(rng, rule.families) : null, zone: pick(rng, EVENT_ZONES).id, startsAt };
}

/** Pause avant l'événement suivant (déterministe). */
export const eventGapMs = (secret: string, seq: number): number =>
  Math.round(CITY_EVENT.gapMinMs + rngFrom(secret, 'city-event-gap', seq)() * (CITY_EVENT.gapMaxMs - CITY_EVENT.gapMinMs));

/** Effet prix pour une famille chez un marchand situé en `pos` (null : aucun). */
export function eventPriceEffect(e: CityEvent | null | undefined, family: Family, pos: LatLng, now: number): { label: string; mult: number } | null {
  if (!isEventActive(e, now) || e.priceMult === null || e.family !== family || !inEventZone(e, pos)) return null;
  return { label: eventTitle(e), mult: e.priceMult };
}

/** Grève : le marchand en `pos` ne vend plus. */
export const eventStrikes = (e: CityEvent | null | undefined, pos: LatLng, now: number): boolean =>
  isEventActive(e, now) && e.strike && inEventZone(e, pos);

/**
 * Vague bonus d'une ruée : au plus 1 éclat de la famille par cellule (centre dans la zone) et par fenêtre.
 * Ids distincts des spawns normaux (`cell:window:e<id>`) : rien ne change pour les éclats déjà affichés.
 */
export function eventSpawnsForCell(secret: string, e: CityEvent | null | undefined, cell: string, window: number): Spawn[] {
  if (!e || e.extraSpawnChance === null || !e.family) return [];
  const t = window * SPAWN_WINDOW_MS;
  // la fenêtre doit chevaucher l'événement
  if (t >= e.endsAt || t + SPAWN_WINDOW_MS <= e.startsAt) return [];
  const [lat, lng] = cellToLatLng(cell);
  if (!inEventZone(e, { lat, lng })) return [];
  const rng = rngFrom(secret, 'event-spawn', e.id, cell, window);
  if (rng() >= e.extraSpawnChance) return [];
  const r = 60 * Math.sqrt(rng());
  const a = rng() * 2 * Math.PI;
  const p = offsetM({ lat, lng }, r * Math.cos(a), r * Math.sin(a));
  return [{ id: `${cell}:${window}:e${e.id}`, family: e.family, lat: p.lat, lng: p.lng, expiresAt: Math.min((window + 1) * SPAWN_WINDOW_MS, e.endsAt) }];
}

const pct = (m: number) => `${m < 1 ? '−' : '+'}${Math.round(Math.abs(m - 1) * 100)}%`;

export function eventTitle(e: Pick<CityEvent, 'kind' | 'zoneName'>): string {
  const at = { flash_crash: 'Flash crash at', hype: 'Forge hype at', gold_rush: 'Gold rush near', strike: 'Merchant strike at' }[e.kind];
  return `${at} ${e.zoneName}`;
}

/** Effet en une ligne courte (bannière, Pulse). */
export function eventEffectText(e: Pick<CityEvent, 'kind' | 'family' | 'priceMult'>): string {
  const fam = e.family ? FAMILY_INFO[e.family].name : '';
  if (e.kind === 'gold_rush') return `extra ${fam} shards`;
  if (e.kind === 'strike') return 'shops buy but won’t sell';
  return `${fam} prices ${pct(e.priceMult ?? 1)}`;
}

/** Heure de Paris (0–23). */
export function parisHour(t: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)));
}
