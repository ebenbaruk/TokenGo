import type { DB } from '../db.ts';
import type { Config } from '../config.ts';
import type { World } from './world.ts';
import type { Bus } from './bus.ts';
import type { CreditsProvider } from './credits.ts';

/** Tout ce dont la logique de jeu a besoin. `now` est injectable pour les tests. */
export interface Ctx {
  db: DB;
  cfg: Config;
  world: World;
  bus: Bus;
  credits: CreditsProvider;
  now: () => number;
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
