// Bus d'événements en mémoire : alimente la table events (Pulse) et les flux SSE.
import type { DB } from '../db.ts';
import type { PulseEvent } from '@tokengo/shared';

type Listener = (e: PulseEvent) => void;
export interface Bus {
  publish: (kind: string, text: string, data?: Record<string, unknown>, userId?: string) => PulseEvent;
  subscribe: (fn: Listener) => () => void;
  subscribeUser: (userId: string, fn: Listener) => () => void;
  /** Diffusion éphémère à tous (id 0, NON stockée dans le Pulse) : PV du raid en direct, trop fréquents pour le ticker. */
  broadcast: (kind: string, text: string, data?: Record<string, unknown>) => void;
}

export function createBus(db: DB, now: () => number): Bus {
  const pub = new Set<Listener>();
  const users = new Map<string, Set<Listener>>();
  const insert = db.prepare('INSERT INTO events (at, kind, text, data) VALUES (?, ?, ?, ?)');
  return {
    publish(kind, text, data, userId) {
      const at = now();
      let e: PulseEvent;
      if (userId) {
        e = { id: 0, at, kind, text, ...(data ? { data } : {}) };
        for (const fn of users.get(userId) ?? []) fn(e);
        return e;
      }
      const id = Number(insert.run(at, kind, text, data ? JSON.stringify(data) : null).lastInsertRowid);
      e = { id, at, kind, text, ...(data ? { data } : {}) };
      for (const fn of pub) fn(e);
      return e;
    },
    subscribe(fn) { pub.add(fn); return () => pub.delete(fn); },
    broadcast(kind, text, data) {
      const e: PulseEvent = { id: 0, at: now(), kind, text, ...(data ? { data } : {}) };
      for (const fn of pub) fn(e);
    },
    subscribeUser(userId, fn) {
      const set = users.get(userId) ?? new Set();
      set.add(fn);
      users.set(userId, set);
      return () => set.delete(fn);
    },
  };
}
