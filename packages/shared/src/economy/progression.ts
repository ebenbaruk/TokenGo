// Niveaux & XP.
import { MAX_LEVEL, xpToNext, CATCH, XP } from './rules.ts';

/** Niveau atteint pour un total d'XP, + progression dans le niveau courant. */
export function levelForXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = xp;
  while (level < MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: level >= MAX_LEVEL ? 0 : xpToNext(level) };
}

export const xpForLevel = (level: number): number => {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
};

/** Combo : une capture dans les 90 s après la précédente fait monter le combo (max 5). */
export function nextCombo(prevCombo: number, lastCatchAt: number | null, now: number): number {
  if (lastCatchAt === null || now - lastCatchAt > CATCH.comboWindowMs) return 1;
  return Math.min(CATCH.comboMax, prevCombo + 1);
}

export const catchXp = (perfect: boolean, combo: number): number =>
  XP.catch + (perfect ? XP.perfectBonus : 0) + XP.perComboLevel * Math.max(0, combo - 1);
