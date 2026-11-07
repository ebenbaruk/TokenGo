// Maîtrise (Docs/13 §2) : XP par joueur et par famille, table `mastery`. Niveau et bonus : packages/shared (arena.ts).
import { ARENA, FAMILIES, MASTERY, masteryLevel, masteryProgress, type Family, type MasteryProgress } from '@tokengo/shared';
import type { Ctx } from './context.ts';

export function masteryXp(ctx: Ctx, userId: string): Record<Family, number> {
  const out = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Record<Family, number>;
  for (const r of ctx.db.prepare('SELECT family, xp FROM mastery WHERE user_id = ?').all(userId) as { family: Family; xp: number }[]) {
    if (r.family in out) out[r.family] = r.xp;
  }
  return out;
}

export function masteryView(ctx: Ctx, userId: string): Record<Family, MasteryProgress> {
  const xp = masteryXp(ctx, userId);
  return Object.fromEntries(FAMILIES.map((f) => [f, masteryProgress(xp[f])])) as Record<Family, MasteryProgress>;
}

/** Niveaux actuels (1–10) des familles demandées. */
export function masteryLevels(ctx: Ctx, userId: string, fams: readonly Family[]): Record<Family, number> {
  const xp = masteryXp(ctx, userId);
  return Object.fromEntries(fams.map((f) => [f, masteryLevel(xp[f])])) as Record<Family, number>;
}

/** Ajoute de l'XP de maîtrise ; renvoie les familles qui ont changé de niveau. */
export function addMastery(ctx: Ctx, userId: string, gains: Partial<Record<Family, number>>): { family: Family; level: number }[] {
  const before = masteryXp(ctx, userId);
  const up = ctx.db.prepare(`INSERT INTO mastery (user_id, family, xp) VALUES (?, ?, ?)
    ON CONFLICT(user_id, family) DO UPDATE SET xp = xp + excluded.xp`);
  const ups: { family: Family; level: number }[] = [];
  for (const [f, n] of Object.entries(gains) as [Family, number][]) {
    if (!(FAMILIES as readonly string[]).includes(f) || !(n > 0)) continue;
    up.run(userId, f, Math.round(n));
    const lvl = masteryLevel(before[f] + Math.round(n));
    if (lvl > masteryLevel(before[f])) ups.push({ family: f, level: lvl });
  }
  return ups;
}

/**
 * Crochet de capture (appelé UNE fois par capture réussie, dans la transaction de grantCatch) : +5 maîtrise de la famille,
 * et la capture compte comme activité d'un Champion (son arène ne repasse pas au Gardien tant qu'il joue).
 */
export function arenaOnCatch(ctx: Ctx, userId: string, family: Family): void {
  addMastery(ctx, userId, { [family]: MASTERY.xpCatch });
  touchChampion(ctx, userId);
}

/** Activité d'un Champion (combat, capture) : repousse l'échéance de 48 h — sauf arène déjà échue (le Gardien l'a reprise). */
export function touchChampion(ctx: Ctx, userId: string): void {
  const now = ctx.now();
  ctx.db.prepare('UPDATE arenas SET active_at = ? WHERE champion_user = ? AND active_at > ?').run(now, userId, now - ARENA.championExpiryMs);
}
