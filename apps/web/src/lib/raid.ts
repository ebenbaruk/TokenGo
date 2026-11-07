// Raid « Rogue Model » (Docs/13 §6) côté client : PV en direct (SSE `raid.hp`), derniers coups de la ville (chiffres qui
// volent sur la carte et dans l'onglet Raid), annonce de fin collective (`city.raid.end`). Le serveur reste autoritaire :
// ces valeurs ne servent qu'à l'affichage et sont recalées à chaque réponse de l'API.
import { create } from 'zustand';
import type { CityEventView, RaidHpEvent, RaidLive } from '@tokengo/shared';
import { useGame } from './store.ts';

export interface RaidHit { id: number; damage: number; by: string; mine: boolean }
export interface RaidEndNotice { eventId: number; outcome: 'won' | 'failed'; boss: string; text: string }

interface RaidState {
  /** derniers coups reçus (≤ 6), effacés après 1,8 s */
  hits: RaidHit[];
  /** fin du raid annoncée par le serveur (écran collectif) */
  end: RaidEndNotice | null;
  /** un écran d'assaut est ouvert (il montre lui-même la fin s'il porte le dernier coup) */
  assaultOpen: boolean;
}
export const useRaid = create<RaidState>(() => ({ hits: [], end: null, assaultOpen: false }));

/** Raid de l'événement de ville en cours (s'il y en a un et qu'il est encore actif). */
export function raidOf(e: CityEventView | null | undefined): RaidLive | null {
  return e?.kind === 'rogue' && e.raid ? e.raid : null;
}
export const useLiveRaid = (): RaidLive | null => useGame((st) => raidOf(st.world?.event));

/** Applique un état de raid frais (réponse d'API) à l'événement du monde courant. */
export function patchRaid(r: Partial<RaidLive> & { eventId: number }): void {
  const w = useGame.getState().world;
  const e = w?.event;
  if (!w || !e || e.kind !== 'rogue' || e.id !== r.eventId || !e.raid) return;
  // les PV ne remontent jamais côté client (deux réponses croisées) : on garde le plus bas
  const hp = r.hp === undefined ? e.raid.hp : Math.min(e.raid.hp, r.hp);
  useGame.setState({ world: { ...w, event: { ...e, raid: { ...e.raid, ...r, hp } } } });
}

let hitSeq = 1;
export function pushHit(damage: number, by: string, mine: boolean): void {
  const id = hitSeq++;
  useRaid.setState((s) => ({ hits: [...s.hits.slice(-5), { id, damage, by, mine }] }));
  setTimeout(() => useRaid.setState((s) => ({ hits: s.hits.filter((h) => h.id !== id) })), 1800);
}

/** SSE `raid.hp` : PV à jour + chiffre qui vole (les coups du joueur lui-même sont déjà montrés par l'écran d'assaut). */
export function onRaidHp(e: RaidHpEvent): void {
  patchRaid({ eventId: e.eventId, hp: e.hp, maxHp: e.maxHp });
  const me = useGame.getState().me?.handle;
  if (e.by !== me) pushHit(e.damage, e.by, false);
}

/** Raids dont l'écran de fin a déjà été montré (ex. par l'écran d'assaut du joueur qui a porté le dernier coup). */
const endShown = new Set<number>();
export const markEndShown = (eventId: number) => { endShown.add(eventId); };
export const isEndShown = (eventId: number) => endShown.has(eventId);

export function onRaidEnd(d: { eventId: number; outcome: 'won' | 'failed'; boss: string }, text: string): void {
  if (endShown.has(d.eventId)) return;
  useRaid.setState({ end: { eventId: d.eventId, outcome: d.outcome, boss: d.boss, text } });
}
export const clearRaidEnd = () => useRaid.setState({ end: null });
