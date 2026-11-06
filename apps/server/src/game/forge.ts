// Forge : recettes du jour, estimation du rendement, compilation (burn → octroi réel ou simulé).
import {
  FIRST_COMPILE, FORGE, RESERVE, TIERS, UNLOCKS, XP, equivalences, forgePayout, missingFor, recipesFor, shardToken,
  type CompileResponse, type Family, type ForgeView, type Pool, type RecipeView, type Tier,
} from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { GameError, fail } from './context.ts';
import { assertQuota } from './quotas.ts';
import { randomId } from './crypto.ts';
import { addXp, debit, getUser, inventory, levelOf, markTutorial, meView, tutorialOf, type UserRow } from './players.ts';
import { assertCanAct } from './actions.ts';
import { forgePaused, getPools, grantCredits, grantedSince, parisDay, reserveView, yieldInput } from './reserve.ts';
import { poolAvail } from '@tokengo/shared';

const LABEL: Record<Tier | 'first', string> = { first: 'First Compile', spark: 'Spark', prism: 'Prism', aura: 'Aura' };
const HOUR = 3600_000;
/** Attente max de la preuve de burn on-chain avant l'octroi (au-delà : on octroie quand même, le settler complète burn_tx). */
export const BURN_PROOF = { timeoutMs: 6_000 };

function forgeOf(ctx: Ctx, forgeId: string) {
  const f = ctx.world.forges.find((x) => x.id === forgeId);
  if (!f) fail('NOT_FOUND', 'Unknown forge.', 404);
  return f!;
}

export const judgeOpen = (ctx: Ctx) => {
  const now = ctx.now();
  return now >= Date.parse(ctx.cfg.JUDGE_POOL_FROM) && now < Date.parse(ctx.cfg.JUDGE_POOL_TO);
};

/** Quelle poche paie ce joueur pour cette recette ? null = XP seulement (avec la raison). */
function poolFor(ctx: Ctx, u: UserRow, tier: Tier | 'first'): { pool: Pool | null; note: string | null } {
  // runners-agents : jamais d'octroi (burn + XP seulement), quelle que soit la recette
  if (u.is_agent) return { pool: null, note: 'Runner-agents compile for XP only.' };
  if (tier === 'first') {
    if (grantedSince(ctx, ctx.now() - HOUR, { pool: 'welcome' }) >= RESERVE.welcomeGrantsPerHour * FIRST_COMPILE.payout) {
      return { pool: null, note: 'Welcome credits are busy this hour — XP only, try again later.' };
    }
    return { pool: 'welcome', note: null };
  }
  const flags = JSON.parse(u.flags) as Record<string, unknown>;
  if (flags.flagged) return { pool: null, note: 'Account under review — XP only.' };
  if (u.kind === 'google' && u.walked_m >= 1500) return { pool: 'main', note: null };
  if (u.demo_token || judgeOpen(ctx)) {
    if (grantedSince(ctx, 0, { userId: u.id, pool: 'judge' }) >= RESERVE.judgeCapPerAccount) return { pool: null, note: 'Demo credit cap reached — XP only.' };
    return { pool: 'judge', note: null };
  }
  if (u.kind === 'google') return { pool: null, note: `Walk ${((1500 - u.walked_m) / 1000).toFixed(1)} km more to earn real credits.` };
  return { pool: null, note: 'Sign in with Google and walk 1.5 km to earn real credits.' };
}

function estimate(ctx: Ctx, u: UserRow, tier: Tier | 'first'): { payout: number; pool: Pool | null; note: string | null } {
  const { pool, note } = poolFor(ctx, u, tier);
  if (!pool) return { payout: 0, pool: null, note };
  if (tier === 'first') return { payout: Math.min(FIRST_COMPILE.payout, poolAvail(getPools(ctx).welcome)), pool, note: null };
  const p = forgePayout({ ...yieldInput(ctx, u.id, pool), weight: TIERS[tier].weight });
  if (pool === 'judge') p.amount = Math.min(p.amount, RESERVE.judgeCapPerAccount - grantedSince(ctx, 0, { userId: u.id, pool: 'judge' }));
  const why = { ok: null, 'player-cap': 'Daily cap reached — XP only until tomorrow.', 'global-cap': 'The city hit its daily forge cap — XP only.', 'below-min': 'Reserve too low for real credits — XP only.' }[p.reason];
  return { payout: Math.max(0, p.amount), pool: p.amount > 0 ? pool : null, note: p.amount > 0 ? null : why };
}

export function viewForge(ctx: Ctx, userId: string, forgeId: string): ForgeView {
  const f = forgeOf(ctx, forgeId);
  const u = getUser(ctx, userId)!;
  const inv = inventory(ctx, userId);
  const t = tutorialOf(u);
  const level = levelOf(u);
  const day = parisDay(ctx.now());
  const recipes: RecipeView[] = [];
  if (!t.firstCompile) {
    const e = estimate(ctx, u, 'first');
    recipes.push({
      tier: 'first', label: LABEL.first, needs: FIRST_COMPILE.needs, missing: missingFor(FIRST_COMPILE.needs, inv.shards), fee: 0, level: 1,
      locked: t.caught && t.synced && t.traded ? null : 'Catch a shard, sync a relay and trade once first.',
      payoutNusd: e.payout, payoutNote: e.note,
    });
  }
  for (const r of recipesFor(ctx.cfg.SPAWN_SECRET, f.id, f.theme, day)) {
    const e = estimate(ctx, u, r.tier);
    recipes.push({
      tier: r.tier, label: LABEL[r.tier], needs: r.needs, missing: missingFor(r.needs, inv.shards), fee: r.fee, level: r.level,
      locked: level < r.level ? `Unlocks at level ${r.level}` : null, payoutNusd: e.payout, payoutNote: e.note,
    });
  }
  return { id: f.id, name: f.name, lat: f.lat, lng: f.lng, theme: f.theme, day, recipes, reserve: reserveView(ctx) };
}

export async function compile(ctx: Ctx, userId: string, forgeId: string, tier: Tier | 'first'): Promise<CompileResponse> {
  const f = forgeOf(ctx, forgeId);
  const u = getUser(ctx, userId)!;
  if (forgePaused(ctx)) fail('FORGE_PAUSED', 'The Forges are paused for maintenance.');
  assertCanAct(ctx, u, 'forge', f);
  assertQuota(ctx, userId, 'compile');
  const t = tutorialOf(u);
  let needs: Partial<Record<Family, number>>;
  let fee = 0;
  if (tier === 'first') {
    if (t.firstCompile) fail('BAD_REQUEST', 'First Compile already done.');
    if (!(t.caught && t.synced && t.traded)) fail('TUTORIAL_INCOMPLETE', 'Catch a shard, sync a relay and trade once first.');
    needs = FIRST_COMPILE.needs;
  } else {
    if (!(tier in TIERS)) fail('BAD_REQUEST', 'Unknown recipe.');
    const lvl = TIERS[tier].level;
    if (levelOf(u) < lvl) fail('LEVEL_LOCKED', `Unlocks at level ${lvl}.`);
    const r = recipesFor(ctx.cfg.SPAWN_SECRET, f.id, f.theme, parisDay(ctx.now())).find((x) => x.tier === tier)!;
    needs = r.needs;
    fee = r.fee;
  }
  const est = estimate(ctx, u, tier);
  const compileId = randomId(10);
  const now = ctx.now();
  // 1. burn des éclats + frais (atomique) ; le settler on-chain le prouve avant l'octroi quand la chaîne est active
  ctx.db.transaction(() => {
    const lack = missingFor(needs, inventory(ctx, userId).shards);
    if (Object.keys(lack).length) fail('INSUFFICIENT', 'Missing shards for this recipe.', 400, { missing: lack });
    for (const [fam, n] of Object.entries(needs) as [Family, number][]) debit(ctx, userId, shardToken(fam), n, `forge:${compileId}`);
    if (fee) debit(ctx, userId, 'flux', fee, `forge:${compileId}`);
    ctx.db.prepare('INSERT INTO compiles (id, at, user_id, forge_id, tier, inputs, fee, pool, payout_nusd, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(compileId, now, userId, f.id, tier, JSON.stringify(needs), fee, est.pool, est.payout, 'burning');
  })();
  // 1b. chaîne active : preuve synchrone — règle toutes les ops en attente jusqu'au burn inclus, attend la finalité (borné)
  let burnTx: string | null = null;
  if (ctx.chain) {
    const last = (ctx.db.prepare('SELECT MAX(id) id FROM chain_ops WHERE memo = ?').get(`forge:${compileId}`) as { id: number | null }).id;
    if (last !== null) burnTx = await ctx.chain.flush(last, BURN_PROOF.timeoutMs);
  }
  // 2. octroi réel (ou simulé) ; si la Réserve refuse, la compilation paie en XP
  let payout = 0;
  let note = est.note;
  let pending = false;
  if (est.pool && est.payout > 0) {
    try {
      await grantCredits(ctx, userId, est.pool, est.payout, compileId);
      payout = est.payout;
    } catch (e) {
      note = (e as Error).message;
      pending = e instanceof GameError && e.code === 'GRANT_PENDING';
    }
  }
  const xp = tier === 'first' ? XP.compile.first : XP.compile[tier];
  const levelUp = ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE compiles SET status = ?, payout_nusd = ? WHERE id = ?')
      .run(payout > 0 ? 'granted' : pending ? 'pending' : 'xp-only', pending ? est.payout : payout, compileId);
    if (tier === 'first') markTutorial(ctx, userId, 'firstCompile');
    return addXp(ctx, userId, xp);
  })();
  if (payout > 0) {
    ctx.bus.publish('compile', `${u.handle} compiled ${LABEL[tier]} at ${f.name} · +$${(payout / 1e9).toFixed(3)}`, { forgeId: f.id, payout, tier });
  }
  return {
    compileId, tier, payoutNusd: payout, simulated: ctx.credits.simulated, pool: payout > 0 ? est.pool : null, xp, note: payout > 0 ? null : note,
    equiv: equivalences(payout), burnTx, levelUp, me: meView(ctx, userId),
    ...(pending ? { pending: true, pendingNusd: est.payout } : {}),
  };
}

export { FORGE, UNLOCKS };
