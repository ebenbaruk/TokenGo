// Raid « Rogue Model » (Docs/13 §6) : fonctions pures, partagées serveur / tests / UI.
//
// Un assaut = 3 manches jouées avec le moteur de l'Arène (mêmes techniques, rate limit, variance, hallucination) contre
// l'équipe du boss (maîtrise 3), budget 6 tokens. Chaque manche fait des dégâts au boss :
//   dégâts = puissance × RAID.damageScale × (×1,5 faiblesse | ×0,6 résistance) × (×1,5 si la manche est gagnée), arrondi.
// La faiblesse et la résistance changent toutes les 10 min (graine du raid) ; elles sont figées au début d'un assaut.
import { FAMILIES, type Family } from '../types.ts';
import { mulberry32 } from '../rng.ts';
import { CHALLENGE_BANK } from '../arena-bank.ts';
import {
  arenaCommentary, arenaRng, checkArenaPick, guardianTeam, opponentPick, rollPower,
  type ArenaChallenge, type ArenaCombatant, type ArenaPick, type ArenaPlayError, type ArenaRound, type ArenaRoundPlay,
} from './arena.ts';
import { CATEGORIES, MASTERY, RAID, RAID_BOSSES, TECHNIQUE_RULES, type Category, type RaidBossId } from './rules.ts';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

// ───────────── Boss ─────────────

/** PV du boss : 800 + 120 × joueurs actifs dans la dernière heure, borné 800–6 000. */
export const raidMaxHp = (activePlayers: number): number =>
  Math.round(clamp(RAID.hpBase + RAID.hpPerPlayer * Math.max(0, Math.floor(activePlayers || 0)), RAID.hpMin, RAID.hpMax));

/** Boss tiré de la graine du raid. */
export const raidBossOf = (seed: number): { id: RaidBossId; name: string } =>
  RAID_BOSSES[Math.floor(mulberry32((seed ^ 0x2545f491) >>> 0)() * RAID_BOSSES.length)]!;
export const raidBossName = (id: string): string => RAID_BOSSES.find((b) => b.id === id)?.name ?? 'Rogue model';

/** Équipe du boss : 3 familles différentes tirées de la graine (même tirage que le Gardien). */
export const raidBossTeam = (seed: number): Family[] => guardianTeam(mulberry32((seed ^ 0x6a09e667) >>> 0));

/** Tranche de 10 min (absolue) contenant l'instant t. */
export const raidSlice = (t: number): number => Math.floor(t / RAID.sliceMs);

export interface RaidAffinity { weakness: Category; resist: Category; slice: number; sliceEndsAt: number }

/** Faiblesse (×1,5) et résistance (×0,6) du boss à l'instant t : deux catégories différentes, déterministes (graine, tranche). */
export function raidAffinity(seed: number, t: number): RaidAffinity {
  const slice = raidSlice(t);
  const rng = mulberry32((seed ^ Math.imul(slice + 1, 0x9e3779b1) ^ 0x51ed270b) >>> 0);
  const weakness = CATEGORIES[Math.floor(rng() * CATEGORIES.length)]!;
  const others = CATEGORIES.filter((c) => c !== weakness);
  const resist = others[Math.floor(rng() * others.length)]!;
  return { weakness, resist, slice, sliceEndsAt: (slice + 1) * RAID.sliceMs };
}

/** Multiplicateur de catégorie (faiblesse / résistance / neutre). */
export const raidCatMult = (cat: Category, weakness: Category, resist: Category): number =>
  cat === weakness ? RAID.weakMult : cat === resist ? RAID.resistMult : 1;

/** Dégâts d'une manche (entier ≥ 0). */
export function raidRoundDamage(power: number, cat: Category, weakness: Category, resist: Category, won: boolean): number {
  const mult = raidCatMult(cat, weakness, resist) * (won ? RAID.wonRoundMult : 1);
  return Math.max(0, Math.round(Math.max(0, power) * RAID.damageScale * mult));
}

// ───────────── Assaut ─────────────

export interface RaidRound extends ArenaRound {
  /** dégâts infligés au boss par cette manche */
  damage: number;
  /** multiplicateur total appliqué (catégorie × manche gagnée) */
  mult: number;
}
export interface RaidAssaultState {
  seed: number;
  affinities: Family[];
  weakness: Category;
  resist: Category;
  challenges: ArenaChallenge[];
  me: ArenaCombatant;
  boss: ArenaCombatant;
  rounds: RaidRound[];
  status: 'open' | 'done';
  damage: number;
}

/** 3 épreuves de catégories différentes, dont TOUJOURS la faiblesse du moment (sinon elle ne servirait qu'une fois sur deux). */
export function drawRaidChallenges(seed: number, weakness: Category): ArenaChallenge[] {
  const rng = arenaRng(seed, 0, 'draw');
  const others = CATEGORIES.filter((c) => c !== weakness);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j]!, others[i]!];
  }
  const cats = [weakness, ...others.slice(0, RAID.rounds - 1)];
  for (let i = cats.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cats[i], cats[j]] = [cats[j]!, cats[i]!];
  }
  return cats.map((category) => {
    const bank = CHALLENGE_BANK[category];
    return { category, prompt: bank[Math.floor(rng() * bank.length)]! };
  });
}

const combatant = (team: Family[], mastery: Partial<Record<Family, number>>): ArenaCombatant => ({
  team: [...team], mastery: Object.fromEntries(team.map((f) => [f, clamp(Math.round(mastery[f] ?? 1), 1, MASTERY.maxLevel)])),
  tokens: RAID.tokenBudget, last: null, wins: 0, total: 0,
});

/** Une équipe d'assaut valide : 3 familles connues, toutes différentes. */
export function validRaidTeam(team: readonly string[]): team is Family[] {
  return team.length === RAID.teamSize && new Set(team).size === team.length && team.every((f) => (FAMILIES as readonly string[]).includes(f));
}

export function startRaidAssault(
  seed: number, me: { team: Family[]; mastery: Partial<Record<Family, number>> }, bossTeam: Family[],
  affinities: readonly Family[], aff: { weakness: Category; resist: Category },
): RaidAssaultState {
  const bossMastery = Object.fromEntries(bossTeam.map((f) => [f, RAID.bossMastery])) as Partial<Record<Family, number>>;
  return {
    seed, affinities: [...affinities], weakness: aff.weakness, resist: aff.resist, challenges: drawRaidChallenges(seed, aff.weakness),
    me: combatant(me.team, me.mastery), boss: combatant(bossTeam, bossMastery), rounds: [], status: 'open', damage: 0,
  };
}

/**
 * Joue une manche d'assaut (même déroulé que playArenaRound : le boss choisit d'abord sur son seul état, flux de tirage
 * indépendants). Les 3 manches sont toujours jouées. Renvoie le nouvel état (l'ancien n'est pas modifié).
 */
export function playRaidRound(state: RaidAssaultState, pick: ArenaPick): { state: RaidAssaultState; round: RaidRound } | { error: ArenaPlayError } {
  if (state.status !== 'open') return { error: 'OVER' };
  const index = state.rounds.length;
  const ch = state.challenges[index];
  if (!ch) return { error: 'OVER' };
  const err = checkArenaPick(state.me, pick);
  if (err) return { error: err };
  const bossPick = opponentPick(state.boss, ch.category, RAID.rounds - index, state.affinities);
  const play = (c: ArenaCombatant, p: ArenaPick, side: 'me' | 'opp'): ArenaRoundPlay => ({
    ...p, ...rollPower({ family: p.family, category: ch.category, technique: p.technique, mastery: c.mastery[p.family] ?? 1, affinities: state.affinities }, arenaRng(state.seed, index, side)),
  });
  const me = play(state.me, pick, 'me');
  const opp = play(state.boss, bossPick, 'opp');
  const winner = me.power > opp.power ? 'me' : opp.power > me.power ? 'opp' : 'tie';
  const won = winner === 'me';
  const mult = Math.round(raidCatMult(ch.category, state.weakness, state.resist) * (won ? RAID.wonRoundMult : 1) * 100) / 100;
  const damage = raidRoundDamage(me.power, ch.category, state.weakness, state.resist, won);
  const round: RaidRound = {
    index, category: ch.category, prompt: ch.prompt, me, opp, winner,
    line: arenaCommentary(arenaRng(state.seed, index, 'line'), ch.category, me, opp, winner), damage, mult,
  };
  const next = (c: ArenaCombatant, p: ArenaRoundPlay, w: boolean): ArenaCombatant => ({
    ...c, tokens: c.tokens - TECHNIQUE_RULES[p.technique].cost, last: p.family, wins: c.wins + (w ? 1 : 0), total: round1(c.total + p.power),
  });
  const rounds = [...state.rounds, round];
  return {
    round,
    state: {
      ...state, me: next(state.me, me, won), boss: next(state.boss, opp, winner === 'opp'), rounds,
      status: rounds.length >= RAID.rounds ? 'done' : 'open', damage: state.damage + damage,
    },
  };
}

/** Assauts restants pour un joueur (3 par raid). */
export const raidAssaultsLeft = (used: number): number => Math.max(0, RAID.assaultsPerRaid - Math.max(0, used));

/** Familles utilisées sur l'ensemble des manches (pour la maîtrise de victoire). */
export const raidFamiliesUsed = (rounds: readonly { me: { family: Family } }[]): Family[] =>
  FAMILIES.filter((f) => rounds.some((r) => r.me.family === f));

// ───────────── Récompenses (bornées) ─────────────

export interface RaidReward { xp: number; flux: number; mastery: number; top3: boolean }

/**
 * Récompense d'un participant. Victoire : 80 XP + 30 ƒ (+40 ƒ pour le top 3 des dégâts) et +20 maîtrise par famille
 * utilisée. Échec : 20 XP de consolation. `rank` : rang (1 = plus de dégâts) parmi les joueurs réels, null si inconnu.
 */
export function raidReward(outcome: 'won' | 'failed', rank: number | null): RaidReward {
  if (outcome === 'failed') return { xp: RAID.rewards.fail.xp, flux: 0, mastery: 0, top3: false };
  const top3 = rank !== null && rank >= 1 && rank <= 3;
  return { xp: RAID.rewards.win.xp, flux: RAID.rewards.win.flux + (top3 ? RAID.rewards.top3Flux : 0), mastery: RAID.rewards.win.mastery, top3 };
}

/** Classement par dégâts (décroissant ; à égalité, le premier arrivé). Renvoie les rangs 1-based. */
export function raidRanking<T extends { damage: number; firstAt: number }>(rows: readonly T[]): (T & { rank: number })[] {
  return [...rows].sort((a, b) => b.damage - a.damage || a.firstAt - b.firstAt).map((r, i) => ({ ...r, rank: i + 1 }));
}
