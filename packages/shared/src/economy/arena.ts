// Arène des modèles + Maîtrise (Docs/13 §2 et §4) : fonctions pures, partagées serveur / tests / UI.
//
// Un combat : 3 familles par camp, 5 épreuves (catégories toutes différentes) tirées de la graine, premier à 3 manches.
// À chaque manche, chaque camp choisit un modèle (pas celui de la manche précédente : « rate limit ») et une technique
// de prompt (payée sur un budget de 10 tokens). Puissance = stat × maîtrise × technique × affinité × (1 ± variance),
// + bonus fixe des outils, × 0,3 en cas d'hallucination. L'adversaire (Gardien ou fantôme du Champion) décide avec une
// politique fixe qui ne voit JAMAIS le choix du joueur de la manche en cours (opponentPick ne le reçoit pas).
import { FAMILIES, type Family } from '../types.ts';
import { mulberry32, type Rng } from '../rng.ts';
import { CHALLENGE_BANK, FINAL_LINES, HALLUC_LINES, TIE_LINES, WIN_LINES } from '../arena-bank.ts';
import {
  ARENA, CATEGORIES, FAMILY_INFO, MASTERY, MODEL_STATS, TECHNIQUES, TECHNIQUE_RULES, type Category, type Technique,
} from './rules.ts';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

// ───────────── Maîtrise ─────────────

/** Niveau de maîtrise (1–10) pour une XP de famille. */
export function masteryLevel(xp: number): number {
  let lvl = 1;
  for (let i = 1; i < MASTERY.thresholds.length; i++) if (xp >= MASTERY.thresholds[i]!) lvl = i + 1;
  return Math.min(MASTERY.maxLevel, lvl);
}

export interface MasteryProgress {
  level: number;
  xp: number;
  /** XP dans le niveau courant */
  into: number;
  /** XP du niveau courant au suivant (0 au niveau max) */
  need: number;
  /** seuil d'XP du prochain niveau (null au niveau max) */
  next: number | null;
}
export function masteryProgress(xp: number): MasteryProgress {
  const level = masteryLevel(xp);
  const from = MASTERY.thresholds[level - 1]!;
  const next = level >= MASTERY.maxLevel ? null : MASTERY.thresholds[level]!;
  return { level, xp, into: xp - from, need: next === null ? 0 : next - from, next };
}

/** Multiplicateur de puissance en arène : × (1 + 0.04 × (m − 1)). */
export const masteryMult = (level: number): number => 1 + MASTERY.powerPerLevel * (clamp(Math.round(level), 1, MASTERY.maxLevel) - 1);

// ───────────── Épreuves ─────────────

export interface ArenaChallenge { category: Category; prompt: string }

/** Flux aléatoire indépendant pour (graine, manche, canal) — le choix d'un camp ne décale jamais les tirages de l'autre. */
export function arenaRng(seed: number, round: number, channel: 'me' | 'opp' | 'line' | 'draw'): Rng {
  const salt = { me: 0x85ebca6b, opp: 0xc2b2ae35, line: 0x27d4eb2f, draw: 0x165667b1 }[channel];
  return mulberry32((seed ^ Math.imul(round + 1, 0x9e3779b1) ^ salt) >>> 0);
}

/** 5 épreuves de catégories toutes différentes (une des 6 manque), énoncés tirés dans la banque. */
export function drawChallenges(seed: number): ArenaChallenge[] {
  const rng = arenaRng(seed, 0, 'draw');
  const cats = [...CATEGORIES];
  for (let i = cats.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cats[i], cats[j]] = [cats[j]!, cats[i]!];
  }
  return cats.slice(0, ARENA.rounds).map((category) => {
    const bank = CHALLENGE_BANK[category];
    return { category, prompt: bank[Math.floor(rng() * bank.length)]! };
  });
}

// ───────────── Puissance ─────────────

/** Multiplicateur d'une technique dans une catégorie. */
export function techniqueMult(t: Technique, cat: Category): number {
  const r = TECHNIQUE_RULES[t];
  return r.mult[cat] ?? r.multElse;
}

export interface PowerInput {
  family: Family;
  category: Category;
  technique: Technique;
  mastery: number;          // niveau 1–10
  affinities: readonly Family[];
}

/** Puissance avant variance et hallucination (sans bonus fixe). */
function basePower(p: PowerInput): number {
  const aff = p.affinities.includes(p.family) ? 1 + ARENA.affinityBonus : 1;
  return MODEL_STATS[p.family][p.category] * masteryMult(p.mastery) * techniqueMult(p.technique, p.category) * aff;
}

export const hallucChance = (t: Technique): number => ARENA.hallucBase * TECHNIQUE_RULES[t].halluc;

/** Espérance de puissance (variance centrée, hallucination comptée en moyenne) — sert à la politique et à l'UI. */
export function expectedPower(p: PowerInput): number {
  const raw = basePower(p) + (TECHNIQUE_RULES[p.technique].add[p.category] ?? 0);
  const h = hallucChance(p.technique);
  return raw * (1 - h + h * ARENA.hallucPower);
}

/**
 * Puissance réelle d'un coup : u1 → variance ±12 % (× facteur de la technique), u2 → hallucination.
 * Les deux tirages sont toujours consommés (même ordre quel que soit le choix) : déterministe et sans biais.
 */
export function rollPower(p: PowerInput, rng: Rng): { power: number; hallucinated: boolean } {
  const u1 = rng();
  const u2 = rng();
  const r = TECHNIQUE_RULES[p.technique];
  const v = (2 * u1 - 1) * ARENA.variance * r.variance;
  let power = basePower(p) * (1 + v) + (r.add[p.category] ?? 0);
  const hallucinated = u2 < hallucChance(p.technique);
  if (hallucinated) power *= ARENA.hallucPower;
  return { power: round1(Math.max(0, power)), hallucinated };
}

// ───────────── Combat ─────────────

export interface ArenaCombatant {
  team: Family[];
  mastery: Partial<Record<Family, number>>; // niveaux figés au début du combat
  tokens: number;
  last: Family | null;                      // modèle « rate-limited » à la prochaine manche
  wins: number;
  total: number;                            // somme des puissances (départage)
}
export interface ArenaPick { family: Family; technique: Technique }
export interface ArenaRoundPlay extends ArenaPick { power: number; hallucinated: boolean }
export type ArenaRoundWinner = 'me' | 'opp' | 'tie';
export interface ArenaRound {
  index: number;
  category: Category;
  prompt: string;
  me: ArenaRoundPlay;
  opp: ArenaRoundPlay;
  winner: ArenaRoundWinner;
  line: string;
}
export type ArenaBattleStatus = 'open' | 'won' | 'lost';
export interface ArenaBattleState {
  seed: number;
  affinities: Family[];
  challenges: ArenaChallenge[];
  me: ArenaCombatant;
  opp: ArenaCombatant;
  rounds: ArenaRound[];
  status: ArenaBattleStatus;
}
export type ArenaPlayError = 'OVER' | 'NOT_IN_TEAM' | 'RATE_LIMITED' | 'NO_TOKENS' | 'BAD_TECHNIQUE';

/** Une équipe valide : exactement 3 familles connues, toutes différentes. */
export function validArenaTeam(team: readonly string[]): team is Family[] {
  return team.length === ARENA.teamSize && new Set(team).size === team.length && team.every((f) => (FAMILIES as readonly string[]).includes(f));
}

const newArenaCombatant = (c: { team: Family[]; mastery: Partial<Record<Family, number>> }): ArenaCombatant => ({
  team: [...c.team], mastery: Object.fromEntries(c.team.map((f) => [f, clamp(Math.round(c.mastery[f] ?? 1), 1, MASTERY.maxLevel)])),
  tokens: ARENA.tokenBudget, last: null, wins: 0, total: 0,
});

export function startArenaBattle(
  seed: number, me: { team: Family[]; mastery: Partial<Record<Family, number>> }, opp: { team: Family[]; mastery: Partial<Record<Family, number>> },
  affinities: readonly Family[],
): ArenaBattleState {
  return { seed, affinities: [...affinities], challenges: drawChallenges(seed), me: newArenaCombatant(me), opp: newArenaCombatant(opp), rounds: [], status: 'open' };
}

/** Vérifie un choix (équipe, rate limit, budget). */
export function checkArenaPick(c: ArenaCombatant, pick: ArenaPick): ArenaPlayError | null {
  if (!(TECHNIQUES as readonly string[]).includes(pick.technique)) return 'BAD_TECHNIQUE';
  if (!c.team.includes(pick.family)) return 'NOT_IN_TEAM';
  if (c.last === pick.family) return 'RATE_LIMITED';
  if (TECHNIQUE_RULES[pick.technique].cost > c.tokens) return 'NO_TOKENS';
  return null;
}

/**
 * Politique du Gardien et des fantômes de Champions : meilleur modèle disponible pour l'épreuve, technique la plus rentable
 * dans un budget lissé (≤ tokens restants / manches restantes, arrondi au-dessus, + 1). Ne reçoit PAS le choix du joueur.
 */
export function opponentPick(c: ArenaCombatant, category: Category, roundsLeft: number, affinities: readonly Family[]): ArenaPick {
  const allowed = Math.min(c.tokens, Math.ceil(c.tokens / Math.max(1, roundsLeft)) + 1);
  let best: (ArenaPick & { ev: number; cost: number }) | null = null;
  for (const family of c.team) {
    if (family === c.last) continue;
    for (const technique of TECHNIQUES) {
      const cost = TECHNIQUE_RULES[technique].cost;
      if (cost > allowed) continue;
      const ev = expectedPower({ family, category, technique, mastery: c.mastery[family] ?? 1, affinities });
      if (!best || ev > best.ev + 1e-9 || (Math.abs(ev - best.ev) <= 1e-9 && cost < best.cost)) best = { family, technique, ev, cost };
    }
  }
  return { family: best!.family, technique: best!.technique };
}

const label = (f: Family, side: 'me' | 'opp', clash: boolean) => (clash ? `${side === 'me' ? 'Your' : 'Their'} ${FAMILY_INFO[f].name}` : FAMILY_INFO[f].name);

/** Ligne de commentaire d'une manche (gabarits, déterministe). */
export function arenaCommentary(rng: Rng, category: Category, me: ArenaRoundPlay, opp: ArenaRoundPlay, winner: ArenaRoundWinner): string {
  const clash = me.family === opp.family;
  const n = { me: label(me.family, 'me', clash), opp: label(opp.family, 'opp', clash) };
  const pick = (arr: readonly string[]) => arr[Math.floor(rng() * arr.length)]!;
  if (winner === 'tie') return pick(TIE_LINES).replace('{w}', n.me).replace('{l}', n.opp);
  const loser = winner === 'me' ? 'opp' : 'me';
  const lp = loser === 'me' ? me : opp;
  if (lp.hallucinated) return pick(HALLUC_LINES).replace('{h}', n[loser]);
  return pick(WIN_LINES[category]).replace('{w}', n[winner]).replace('{l}', n[loser]);
}

/** Ligne finale du combat (gabarits ; le cerveau LLM peut la remplacer plus tard, même interface). */
export const arenaFinalLine = (seed: number, status: 'won' | 'lost'): string => {
  const arr = FINAL_LINES[status];
  return arr[Math.floor(arenaRng(seed, 99, 'line')() * arr.length)]!;
};

/**
 * Joue une manche. L'adversaire choisit d'abord (sur son seul état), puis le choix du joueur est validé ;
 * les deux puissances sont tirées sur des flux indépendants. Renvoie le nouvel état (l'ancien n'est pas modifié).
 */
export function playArenaRound(state: ArenaBattleState, pick: ArenaPick): { state: ArenaBattleState; round: ArenaRound } | { error: ArenaPlayError } {
  if (state.status !== 'open') return { error: 'OVER' };
  const index = state.rounds.length;
  const ch = state.challenges[index];
  if (!ch) return { error: 'OVER' };
  const err = checkArenaPick(state.me, pick);
  if (err) return { error: err };
  const oppPick = opponentPick(state.opp, ch.category, ARENA.rounds - index, state.affinities);
  const play = (c: ArenaCombatant, p: ArenaPick, side: 'me' | 'opp'): ArenaRoundPlay => ({
    ...p, ...rollPower({ family: p.family, category: ch.category, technique: p.technique, mastery: c.mastery[p.family] ?? 1, affinities: state.affinities }, arenaRng(state.seed, index, side)),
  });
  const me = play(state.me, pick, 'me');
  const opp = play(state.opp, oppPick, 'opp');
  const winner: ArenaRoundWinner = me.power > opp.power ? 'me' : opp.power > me.power ? 'opp' : 'tie';
  const round: ArenaRound = { index, category: ch.category, prompt: ch.prompt, me, opp, winner, line: arenaCommentary(arenaRng(state.seed, index, 'line'), ch.category, me, opp, winner) };
  const next = (c: ArenaCombatant, p: ArenaRoundPlay, won: boolean): ArenaCombatant => ({
    ...c, tokens: c.tokens - TECHNIQUE_RULES[p.technique].cost, last: p.family, wins: c.wins + (won ? 1 : 0), total: round1(c.total + p.power),
  });
  const s: ArenaBattleState = {
    ...state, me: next(state.me, me, winner === 'me'), opp: next(state.opp, opp, winner === 'opp'), rounds: [...state.rounds, round],
  };
  s.status = arenaBattleStatus(s);
  return { state: s, round };
}

/** Fin du combat : premier à 3 ; après 5 manches, plus de manches gagnées puis total des puissances ; égalité parfaite → le défenseur garde. */
export function arenaBattleStatus(s: ArenaBattleState): ArenaBattleStatus {
  if (s.me.wins >= ARENA.winsNeeded) return 'won';
  if (s.opp.wins >= ARENA.winsNeeded) return 'lost';
  if (s.rounds.length < ARENA.rounds) return 'open';
  if (s.me.wins !== s.opp.wins) return s.me.wins > s.opp.wins ? 'won' : 'lost';
  return s.me.total > s.opp.total ? 'won' : 'lost';
}

// ───────────── Récompenses (bornées) ─────────────

export type ArenaOpponentKind = 'guardian' | 'champion';
export function battleRewards(status: 'won' | 'lost', vs: ArenaOpponentKind): { xp: number; flux: number } {
  const r = status === 'lost' ? ARENA.rewards.loss : ARENA.rewards[vs];
  return { xp: r.xp, flux: r.flux };
}

/** XP de maîtrise gagnée par le joueur : +10 par manche jouée avec la famille, +10 si gagnée. */
export function masteryGains(rounds: readonly ArenaRound[]): Partial<Record<Family, number>> {
  const out: Partial<Record<Family, number>> = {};
  for (const r of rounds) out[r.me.family] = (out[r.me.family] ?? 0) + MASTERY.xpRound + (r.winner === 'me' ? MASTERY.xpRoundWon : 0);
  return out;
}

// ───────────── Gardien & Champion ─────────────

/** Numéro de jour (jours depuis l'epoch) d'un jour de Paris « YYYY-MM-DD ». */
export const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
export const guardianMastery = (day: string): number => ARENA.guardianMasteryBase + (dayNumber(day) % ARENA.guardianMasteryMod);

/** Équipe du Gardien : 3 familles différentes tirées par la graine (jour + forge). */
export function guardianTeam(rng: Rng): Family[] {
  const fams = [...FAMILIES];
  for (let i = fams.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [fams[i], fams[j]] = [fams[j]!, fams[i]!];
  }
  return fams.slice(0, ARENA.teamSize);
}

/**
 * Revenu du Champion : +4 ƒ par tranche complète de 10 min entre lastPaid et until, plafonné par ce qui reste du
 * plafond du jour. Le reste (< 10 min) est conservé ; ce qui dépasse le plafond est perdu (newLastPaid avance quand même).
 */
export function championAccrual(lastPaid: number, until: number, paidToday: number): { flux: number; lastPaid: number } {
  const slot = 10 * 60_000;
  const periods = Math.max(0, Math.floor((until - lastPaid) / slot));
  const flux = Math.min(periods * ARENA.championFluxPer10Min, Math.max(0, ARENA.championFluxMaxDay - paidToday));
  return { flux, lastPaid: lastPaid + periods * slot };
}
