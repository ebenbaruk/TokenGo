// Raid « Rogue Model » (Docs/13 §6) : PV bornés, faiblesse déterministe par tranche, formule de dégâts, assaut de 3 manches
// (budget 6, rate limit), récompenses bornées, limite d'assauts.
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES, RAID, RAID_BOSSES, drawRaidChallenges, playRaidRound, raidAffinity, raidAssaultsLeft, raidBossOf, raidBossTeam,
  raidCatMult, raidFamiliesUsed, raidMaxHp, raidRanking, raidReward, raidRoundDamage, startRaidAssault, validRaidTeam,
  type RaidAssaultState,
} from '../index.ts';

const T0 = Date.parse('2026-11-08T14:03:00Z');

describe('raid HP', () => {
  it('800 + 120 per active player, bounded 800–6000', () => {
    expect(raidMaxHp(0)).toBe(800);
    expect(raidMaxHp(1)).toBe(920);
    expect(raidMaxHp(10)).toBe(2000);
    expect(raidMaxHp(43)).toBe(5960);
    expect(raidMaxHp(44)).toBe(6000);
    expect(raidMaxHp(10_000)).toBe(6000);
    expect(raidMaxHp(-5)).toBe(800);
    expect(raidMaxHp(Number.NaN)).toBe(800);
  });
});

describe('boss', () => {
  it('boss and team are deterministic from the seed; team = 3 different families', () => {
    for (let s = 1; s < 200; s++) {
      expect(raidBossOf(s)).toEqual(raidBossOf(s));
      const t = raidBossTeam(s);
      expect(t).toEqual(raidBossTeam(s));
      expect(validRaidTeam(t)).toBe(true);
    }
    const names = new Set(Array.from({ length: 300 }, (_, s) => raidBossOf(s).name));
    expect(names.size).toBe(RAID_BOSSES.length);
  });
});

describe('weakness / resistance', () => {
  it('same seed + same 10-min slice → same pair; weakness ≠ resistance; rotates across slices', () => {
    const a = raidAffinity(42, T0);
    // tout instant de la même tranche donne le même résultat
    const start = a.slice * RAID.sliceMs;
    expect(raidAffinity(42, start)).toEqual(a);
    expect(raidAffinity(42, start + RAID.sliceMs - 1)).toEqual(a);
    expect(a.sliceEndsAt).toBe(start + RAID.sliceMs);
    const seen = new Set<string>();
    for (let k = 0; k < 60; k++) {
      const x = raidAffinity(42, start + k * RAID.sliceMs);
      expect(x.weakness).not.toBe(x.resist);
      expect(CATEGORIES).toContain(x.weakness);
      seen.add(x.weakness);
    }
    expect(seen.size).toBeGreaterThanOrEqual(4); // elle change vraiment
    // la graine compte : deux raids n'ont pas la même suite de faiblesses
    const differs = Array.from({ length: 30 }, (_, k) => start + k * RAID.sliceMs).some((t) => raidAffinity(42, t).weakness !== raidAffinity(43, t).weakness);
    expect(differs).toBe(true);
  });
});

describe('damage formula', () => {
  it('power × 5, ×1.5 weakness, ×0.6 resistance, ×1.5 for a won round, rounded', () => {
    expect(raidCatMult('math', 'math', 'code')).toBe(1.5);
    expect(raidCatMult('code', 'math', 'code')).toBe(0.6);
    expect(raidCatMult('lang', 'math', 'code')).toBe(1);
    expect(raidRoundDamage(10, 'lang', 'math', 'code', false)).toBe(50);
    expect(raidRoundDamage(10, 'lang', 'math', 'code', true)).toBe(75);
    expect(raidRoundDamage(10, 'math', 'math', 'code', true)).toBe(113); // 10 × 5 × 1.5 × 1.5 = 112.5
    expect(raidRoundDamage(10, 'code', 'math', 'code', false)).toBe(30);
    expect(raidRoundDamage(0, 'math', 'math', 'code', true)).toBe(0);
    expect(raidRoundDamage(-3, 'math', 'math', 'code', true)).toBe(0);
  });
});

const ME = { team: ['deepseek', 'qwen', 'gemini'] as const, mastery: { deepseek: 1, qwen: 1, gemini: 1 } };
const newAssault = (seed: number): RaidAssaultState =>
  startRaidAssault(seed, { team: [...ME.team], mastery: ME.mastery }, raidBossTeam(seed), ['gemini', 'claude'], { weakness: 'writing', resist: 'math' });

describe('assault (arena engine, 3 rounds, 6 tokens)', () => {
  it('3 different categories, always including the current weakness', () => {
    for (let s = 1; s < 100; s++) {
      const ch = drawRaidChallenges(s, 'vision');
      expect(ch).toHaveLength(RAID.rounds);
      expect(new Set(ch.map((c) => c.category)).size).toBe(RAID.rounds);
      expect(ch.map((c) => c.category)).toContain('vision');
    }
  });

  it('plays exactly 3 rounds; damage = sum of round damages; rate limit and budget enforced; boss at mastery 3', () => {
    let s = newAssault(7);
    expect(s.me.tokens).toBe(RAID.tokenBudget);
    expect(Object.values(s.boss.mastery).every((m) => m === RAID.bossMastery)).toBe(true);
    const r1 = playRaidRound(s, { family: 'deepseek', technique: 'cot' });
    if ('error' in r1) throw new Error(r1.error);
    s = r1.state;
    expect(s.me.tokens).toBe(3);
    expect(playRaidRound(s, { family: 'deepseek', technique: 'zero' })).toEqual({ error: 'RATE_LIMITED' });
    expect(playRaidRound(s, { family: 'qwen', technique: 'cot' })).not.toHaveProperty('error'); // 3 tokens : ok
    const r2 = playRaidRound(s, { family: 'qwen', technique: 'cot' });
    if ('error' in r2) throw new Error(r2.error);
    s = r2.state;
    expect(s.me.tokens).toBe(0);
    expect(playRaidRound(s, { family: 'gemini', technique: 'few' })).toEqual({ error: 'NO_TOKENS' });
    expect(playRaidRound(s, { family: 'claude', technique: 'zero' })).toEqual({ error: 'NOT_IN_TEAM' });
    const r3 = playRaidRound(s, { family: 'gemini', technique: 'zero' });
    if ('error' in r3) throw new Error(r3.error);
    s = r3.state;
    expect(s.status).toBe('done');
    expect(s.rounds).toHaveLength(3);
    expect(playRaidRound(s, { family: 'deepseek', technique: 'zero' })).toEqual({ error: 'OVER' });
    expect(s.damage).toBe(s.rounds.reduce((a, r) => a + r.damage, 0));
    for (const r of s.rounds) {
      expect(r.damage).toBe(raidRoundDamage(r.me.power, r.category, 'writing', 'math', r.winner === 'me'));
    }
    expect(raidFamiliesUsed(s.rounds)).toEqual(['deepseek', 'qwen', 'gemini']);
  });

  it('is deterministic (same seed, same picks → same rounds) and does not mutate the input state', () => {
    const a = newAssault(99);
    const copy = JSON.stringify(a);
    const x = playRaidRound(a, { family: 'gemini', technique: 'tool' });
    const y = playRaidRound(newAssault(99), { family: 'gemini', technique: 'tool' });
    expect(x).toEqual(y);
    expect(JSON.stringify(a)).toBe(copy);
  });

  it('a typical assault deals a sensible chunk of a fresh boss (≈ 5–40 % of 800 HP)', () => {
    let total = 0;
    const N = 300;
    for (let seed = 1; seed <= N; seed++) {
      let s = newAssault(seed);
      for (const f of ['deepseek', 'qwen', 'gemini'] as const) {
        const r = playRaidRound(s, { family: f, technique: 'zero' });
        if ('error' in r) throw new Error(r.error);
        s = r.state;
      }
      total += s.damage;
    }
    const avg = total / N;
    expect(avg).toBeGreaterThan(0.05 * 800);
    expect(avg).toBeLessThan(0.4 * 800);
  });
});

describe('limits and rewards', () => {
  it('3 assaults per player per raid', () => {
    expect(raidAssaultsLeft(0)).toBe(3);
    expect(raidAssaultsLeft(2)).toBe(1);
    expect(raidAssaultsLeft(3)).toBe(0);
    expect(raidAssaultsLeft(9)).toBe(0);
  });

  it('win: 80 XP + 30 ƒ (+40 ƒ top 3) + 20 mastery; fail: 20 XP only', () => {
    expect(raidReward('won', 1)).toEqual({ xp: 80, flux: 70, mastery: 20, top3: true });
    expect(raidReward('won', 3)).toEqual({ xp: 80, flux: 70, mastery: 20, top3: true });
    expect(raidReward('won', 4)).toEqual({ xp: 80, flux: 30, mastery: 20, top3: false });
    expect(raidReward('won', null)).toEqual({ xp: 80, flux: 30, mastery: 20, top3: false });
    expect(raidReward('failed', 1)).toEqual({ xp: 20, flux: 0, mastery: 0, top3: false });
    // borne dure : jamais plus que 80 XP / 70 ƒ par raid et par joueur
    for (const r of [1, 2, 3, 4, 50, null]) {
      const w = raidReward('won', r);
      expect(w.xp).toBeLessThanOrEqual(80);
      expect(w.flux).toBeLessThanOrEqual(70);
    }
  });

  it('ranking: more damage first, ties broken by who hit first', () => {
    const r = raidRanking([{ id: 'a', damage: 50, firstAt: 3 }, { id: 'b', damage: 90, firstAt: 5 }, { id: 'c', damage: 50, firstAt: 1 }]);
    expect(r.map((x) => [x.id, x.rank])).toEqual([['b', 1], ['c', 2], ['a', 3]]);
  });
});
