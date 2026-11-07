import type { DB } from '../db.ts';
import type { Config } from '../config.ts';
import type { World } from './world.ts';
import type { Bus } from './bus.ts';
import type { CreditsProvider } from './credits.ts';
import type { Settler } from '../chain/settler.ts';
import type { Regions } from './regions.ts';

/** Tout ce dont la logique de jeu a besoin. `now` est injectable pour les tests. */
export interface Ctx {
  db: DB;
  cfg: Config;
  world: World;
  bus: Bus;
  credits: CreditsProvider;
  now: () => number;
  /** Settler on-chain (absent quand la chaîne est désactivée : les ops restent `pending`). */
  chain?: Settler | undefined;
  /** Monde « partout » (régions générées hors de Paris). */
  regions?: Regions | undefined;
}

export class GameError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;
  constructor(code: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}
export const fail = (code: string, message: string, status = 400, extra: Record<string, unknown> = {}): never => {
  throw new GameError(code, message, status, extra);
};
