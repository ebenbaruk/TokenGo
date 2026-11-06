// Joueurs : création, inventaire (miroir de jeu + outbox on-chain), XP, vue « Me ».
import {
  FAMILIES, levelForXp, newMoveState, shardToken, type Family, type Inventory, type Me, type MoveState, type TokenId,
  type TutorialState,
} from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { fail } from './context.ts';
import { randomId } from './crypto.ts';

export interface UserRow {
  id: string; kind: 'guest' | 'google'; handle: string; mode: 'gps' | 'demo'; demo_token: number; xp: number; combo: number;
  last_catch_at: number | null; district: number | null; tutorial: string; tut_lat: number | null; tut_lng: number | null;
  move_state: string | null; walked_m: number; in_transit: number; flags: string; near_account: string | null; created_at: number;
}

const ADJ = ['Neon', 'Pixel', 'Turbo', 'Velvet', 'Cosmic', 'Lucky', 'Rapid', 'Sunny', 'Mellow', 'Brave', 'Fuzzy', 'Jolly'];
const NOUN = ['Pigeon', 'Croissant', 'Gargoyle', 'Baguette', 'Moped', 'Macaron', 'Lantern', 'Bridge', 'Metro', 'Beret', 'Fox', 'Owl'];

export function createUser(ctx: Ctx, opts: { kind: 'guest'; demo: boolean; demoToken?: boolean; ipHash?: string }): UserRow {
  const id = randomId(12);
  let handle = '';
  for (let i = 0; i < 20; i++) {
    const n = Math.floor(Math.random() * 900 + 100);
    handle = `${ADJ[Math.floor(Math.random() * ADJ.length)]}${NOUN[Math.floor(Math.random() * NOUN.length)]}${n}`;
    if (!ctx.db.prepare('SELECT 1 FROM users WHERE handle = ?').get(handle)) break;
  }
  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db.prepare(`INSERT INTO users (id, kind, handle, mode, demo_token, xp, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, opts.kind, handle, opts.demo ? 'demo' : 'gps', opts.demoToken ? 1 : 0, 0, now, opts.ipHash ?? null);
    // kit de départ : en démo, de quoi atteindre vite la First Compile (Docs/02 §7)
    if (opts.demoToken) {
      ctx.db.prepare('UPDATE users SET xp = ? WHERE id = ?').run(4291, id); // niveau 7
      credit(ctx, id, 'flux', 600, 'starter-kit');
      for (const [f, n] of [['deepseek', 6], ['qwen', 4], ['gemini', 5], ['gpt', 3], ['claude', 2]] as const) credit(ctx, id, shardToken(f), n, 'starter-kit');
    } else if (opts.demo) {
      ctx.db.prepare('UPDATE users SET xp = ? WHERE id = ?').run(383, id); // niveau 3
      credit(ctx, id, 'flux', 60, 'starter-kit');
      credit(ctx, id, 'shard:deepseek', 1, 'starter-kit');
      credit(ctx, id, 'shard:qwen', 1, 'starter-kit');
      credit(ctx, id, 'shard:gemini', 2, 'starter-kit');
    } else {
      credit(ctx, id, 'flux', 30, 'starter-kit');
    }
  })();
  return getUser(ctx, id)!;
}

export const getUser = (ctx: Ctx, id: string): UserRow | undefined =>
  ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

export const playerAccount = (userId: string) => `user:${userId}`;
export const merchantAccount = (merchantId: string) => `merchant:${merchantId}`;

export function balance(ctx: Ctx, userId: string, token: TokenId): number {
  const r = ctx.db.prepare('SELECT amount FROM inventory WHERE user_id = ? AND token_id = ?').get(userId, token) as { amount: number } | undefined;
  return r?.amount ?? 0;
}

export function inventory(ctx: Ctx, userId: string): { flux: number; shards: Inventory } {
  const rows = ctx.db.prepare('SELECT token_id, amount FROM inventory WHERE user_id = ?').all(userId) as { token_id: string; amount: number }[];
  const shards = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Inventory;
  let flux = 0;
  for (const r of rows) {
    if (r.token_id === 'flux') flux = r.amount;
    else shards[r.token_id.slice(6) as Family] = r.amount;
  }
  return { flux, shards };
}

const outbox = (ctx: Ctx, kind: 'mint' | 'burn' | 'transfer', from: string | null, to: string | null, token: TokenId, amount: number, memo: string) =>
  ctx.db.prepare('INSERT INTO chain_ops (kind, from_acc, to_acc, token_id, amount, memo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(kind, from, to, token, amount, memo, ctx.now());

/** Crédite le joueur. `fromMerchant` → transfert on-chain depuis le marchand, sinon mint. */
export function credit(ctx: Ctx, userId: string, token: TokenId, amount: number, memo: string, fromMerchant?: string) {
  if (amount <= 0) return;
  ctx.db.prepare(`INSERT INTO inventory (user_id, token_id, amount) VALUES (?, ?, ?)
    ON CONFLICT(user_id, token_id) DO UPDATE SET amount = amount + excluded.amount`).run(userId, token, amount);
  if (fromMerchant) outbox(ctx, 'transfer', merchantAccount(fromMerchant), playerAccount(userId), token, amount, memo);
  else outbox(ctx, 'mint', null, playerAccount(userId), token, amount, memo);
}

/** Débite le joueur (INSUFFICIENT sinon). `toMerchant` → transfert, sinon burn. */
export function debit(ctx: Ctx, userId: string, token: TokenId, amount: number, memo: string, toMerchant?: string) {
  if (amount <= 0) return;
  const r = ctx.db.prepare('UPDATE inventory SET amount = amount - ? WHERE user_id = ? AND token_id = ? AND amount >= ?').run(amount, userId, token, amount);
  if (r.changes !== 1) fail('INSUFFICIENT', token === 'flux' ? 'Not enough Flux.' : 'Not enough shards.');
  if (toMerchant) outbox(ctx, 'transfer', playerAccount(userId), merchantAccount(toMerchant), token, amount, memo);
  else outbox(ctx, 'burn', playerAccount(userId), null, token, amount, memo);
}

/** Mouvements de valeur internes aux marchands (imports, exports) : mint/burn sur le compte du marchand. */
export function merchantLedger(ctx: Ctx, merchantId: string, kind: 'mint' | 'burn', token: TokenId, amount: number, memo: string) {
  if (amount > 0) outbox(ctx, kind, kind === 'burn' ? merchantAccount(merchantId) : null, kind === 'mint' ? merchantAccount(merchantId) : null, token, amount, memo);
}

/** Ajoute de l'XP ; renvoie le nouveau niveau s'il y a eu passage de niveau. */
export function addXp(ctx: Ctx, userId: string, xp: number): number | null {
  const u = getUser(ctx, userId)!;
  const before = levelForXp(u.xp).level;
  ctx.db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(xp, userId);
  const after = levelForXp(u.xp + xp).level;
  return after > before ? after : null;
}

export const levelOf = (u: UserRow) => levelForXp(u.xp).level;

export function tutorialOf(u: UserRow): TutorialState {
  return { caught: false, synced: false, traded: false, firstCompile: false, playground: false, ...(JSON.parse(u.tutorial) as Partial<TutorialState>) };
}
export function markTutorial(ctx: Ctx, userId: string, step: keyof TutorialState) {
  const u = getUser(ctx, userId)!;
  const t = tutorialOf(u);
  if (t[step]) return;
  t[step] = true;
  ctx.db.prepare('UPDATE users SET tutorial = ? WHERE id = ?').run(JSON.stringify(t), userId);
}

export const moveStateOf = (u: UserRow): MoveState => (u.move_state ? (JSON.parse(u.move_state) as MoveState) : newMoveState());

export function meView(ctx: Ctx, userId: string): Me {
  const u = getUser(ctx, userId);
  if (!u) return fail('UNAUTHENTICATED', 'Session expired.', 401);
  const lv = levelForXp(u.xp);
  const inv = inventory(ctx, userId);
  const key = ctx.db.prepare('SELECT limit_nusd, usage_nusd, simulated FROM api_keys WHERE user_id = ?').get(userId) as
    { limit_nusd: number; usage_nusd: number; simulated: number } | undefined;
  const comboAlive = u.last_catch_at !== null && ctx.now() - u.last_catch_at <= 90_000;
  return {
    id: u.id, handle: u.handle, kind: u.kind, mode: u.mode,
    level: lv.level, xp: u.xp, xpInto: lv.into, xpNeed: lv.need,
    flux: inv.flux, shards: inv.shards,
    combo: comboAlive ? u.combo : 0,
    comboExpiresAt: comboAlive ? u.last_catch_at! + 90_000 : null,
    credits: { limitNusd: key?.limit_nusd ?? 0, usageNusd: key?.usage_nusd ?? 0, simulated: key ? key.simulated === 1 : !ctx.cfg.realCredits, hasKey: !!key },
    walkedM: u.walked_m,
    district: u.district,
    tutorial: tutorialOf(u),
  };
}
