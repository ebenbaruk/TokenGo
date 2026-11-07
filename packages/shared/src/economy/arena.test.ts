// Arène & Maîtrise : déterminisme, bornes, rate limit, budget, politique adverse aveugle, récompenses, équilibrage.
import { describe, expect, it } from 'vitest';
import {
  ARENA, CATEGORIES, CHALLENGE_BANK, MASTERY, MODEL_STATS, TECHNIQUES, TECHNIQUE_RULES, WIN_LINES,
  arenaRng, battleRewards, championAccrual, checkArenaPick, drawChallenges, expectedPower, guardianMastery, guardianTeam,
  masteryGains, masteryLevel, masteryMult, masteryProgress, mulberry32, opponentPick, playArenaRound, rollPower,
  startArenaBattle, validArenaTeam,
  type ArenaBattleState, type ArenaPick, type Category, type Family, type Technique,
} from '../index.ts';

const T: Family[] = ['deepseek', 'qwen', 'gemini'];
const R: Family[] = ['claude', 'gpt', 'gemini'];
const lv = (team: Family[], m: number) => Object.fromEntries(team.map((f) => [f, m]));

/** Joue tout un combat avec une stratégie du joueur. */
function runBattle(seed: number, me: Family[], opp: Family[], strategy: (s: ArenaBattleState) => ArenaPick, mMe = 1, mOpp = 1, aff: Family[] = []) {
  let s = startArenaBattle(seed, { team: me, mastery: lv(me, mMe) }, { team: opp, mastery: lv(opp, mOpp) }, aff);
  while (s.status === 'open') {
    const r = playArenaRound(s, strategy(s));
    if ('error' in r) throw new Error(r.error);
    s = r.state;
  }
  return s;
}
/** Stratégie « bien jouée » : la politique du Gardien appliquée au joueur. */
const smart = (s: ArenaBattleState): ArenaPick =>
  opponentPick(s.me, s.challenges[s.rounds.length]!.category, ARENA.rounds - s.rounds.length, s.affinities);
/** Stratégie « mal jouée » : le pire modèle disponible, zero-shot. */
const dumb = (s: ArenaBattleState): ArenaPick => {
  const cat = s.challenges[s.rounds.length]!.category;
  const fam = s.me.team.filter((f) => f !== s.me.last).sort((a, b) => MODEL_STATS[a][cat] - MODEL_STATS[b][cat])[0]!;
  return { family: fam, technique: 'zero' };
};

describe('mastery', () => {
  it('levels follow the thresholds and cap at 10', () => {
    expect(masteryLevel(0)).toBe(1);
    expect(masteryLevel(29)).toBe(1);
    expect(masteryLevel(30)).toBe(2);
    expect(masteryLevel(149)).toBe(3);
    expect(masteryLevel(1500)).toBe(10);
    expect(masteryLevel(99_999)).toBe(10);
    expect(masteryProgress(100)).toEqual({ level: 3, xp: 100, into: 20, need: 70, next: 150 });
    expect(masteryProgress(2000).next).toBeNull();
  });
  it('multiplier is 1 at level 1 and +36 % at level 10, clamped', () => {
    expect(masteryMult(1)).toBe(1);
    expect(masteryMult(10)).toBeCloseTo(1.36);
    expect(masteryMult(42)).toBeCloseTo(1.36);
    expect(masteryMult(-3)).toBe(1);
  });
  it('battle mastery XP: +10 per round played, +10 more if won', () => {
    const s = runBattle(7, T, R, smart);
    const g = masteryGains(s.rounds);
    const total = Object.values(g).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBe(s.rounds.length * MASTERY.xpRound + s.rounds.filter((r) => r.winner === 'me').length * MASTERY.xpRoundWon);
    for (const f of Object.keys(g)) expect(T).toContain(f);
  });
});

describe('challenges & bank', () => {
  it('bank has ≥ 8 prompts and ≥ 4 win lines per category', () => {
    for (const c of CATEGORIES) {
      expect(CHALLENGE_BANK[c].length).toBeGreaterThanOrEqual(8);
      expect(new Set(CHALLENGE_BANK[c]).size).toBe(CHALLENGE_BANK[c].length);
      expect(WIN_LINES[c].length).toBeGreaterThanOrEqual(4);
    }
  });
  it('5 challenges, all different categories, deterministic by seed', () => {
    for (let seed = 1; seed < 200; seed++) {
      const a = drawChallenges(seed);
      expect(a).toHaveLength(ARENA.rounds);
      expect(new Set(a.map((c) => c.category)).size).toBe(ARENA.rounds);
      for (const c of a) expect(CHALLENGE_BANK[c.category]).toContain(c.prompt);
      expect(drawChallenges(seed)).toEqual(a);
    }
    expect(drawChallenges(1)).not.toEqual(drawChallenges(2));
  });
});

describe('power', () => {
  it('stays within the variance band, rounded to 0.1, and hallucination cuts to 30 %', () => {
    let hallucs = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const rng = mulberry32(i);
      const p = { family: 'claude' as Family, category: 'writing' as Category, technique: 'zero' as Technique, mastery: 1, affinities: [] };
      const r = rollPower(p, rng);
      expect(Math.round(r.power * 10) / 10).toBe(r.power);
      if (r.hallucinated) { hallucs++; expect(r.power).toBeLessThanOrEqual(10 * 1.12 * 0.3 + 0.05); }
      else { expect(r.power).toBeGreaterThanOrEqual(10 * 0.88 - 0.05); expect(r.power).toBeLessThanOrEqual(10 * 1.12 + 0.05); }
    }
    expect(hallucs / N).toBeGreaterThan(0.05);
    expect(hallucs / N).toBeLessThan(0.11);
  });
  it('techniques: CoT ×1.5 on math, tool +3 after multipliers, few-shot ×1.3 on lang, affinity +10 %', () => {
    const e = (family: Family, category: Category, technique: Technique, mastery = 1, affinities: Family[] = []) =>
      expectedPower({ family, category, technique, mastery, affinities });
    const h = (t: Technique) => 1 - ARENA.hallucBase * TECHNIQUE_RULES[t].halluc * (1 - ARENA.hallucPower);
    expect(e('deepseek', 'math', 'cot')).toBeCloseTo(9 * 1.5 * h('cot'));
    expect(e('deepseek', 'math', 'tool')).toBeCloseTo((9 + 3) * h('tool'));
    expect(e('qwen', 'lang', 'few')).toBeCloseTo(10 * 1.3 * h('few'));
    expect(e('gemini', 'vision', 'zero', 1, ['gemini'])).toBeCloseTo(10 * 1.1 * h('zero'));
    expect(e('gemini', 'vision', 'zero', 10)).toBeCloseTo(10 * 1.36 * h('zero'));
    expect(e('claude', 'speed', 'hot')).toBeCloseTo(5 * h('hot'));
  });
});

describe('battle rules', () => {
  it('is fully deterministic for a seed and a sequence of picks', () => {
    for (const seed of [1, 99, 123456]) expect(runBattle(seed, T, R, smart)).toEqual(runBattle(seed, T, R, smart));
  });
  it('rate limit: the model that just played cannot play the next round', () => {
    const s0 = startArenaBattle(5, { team: T, mastery: {} }, { team: R, mastery: {} }, []);
    const r1 = playArenaRound(s0, { family: 'deepseek', technique: 'zero' });
    if ('error' in r1) throw new Error(r1.error);
    expect(playArenaRound(r1.state, { family: 'deepseek', technique: 'zero' })).toEqual({ error: 'RATE_LIMITED' });
    expect('state' in playArenaRound(r1.state, { family: 'qwen', technique: 'zero' })).toBe(true);
    // l'adversaire respecte la même règle
    const s = runBattle(11, T, R, smart);
    for (let i = 1; i < s.rounds.length; i++) {
      expect(s.rounds[i]!.opp.family).not.toBe(s.rounds[i - 1]!.opp.family);
      expect(s.rounds[i]!.me.family).not.toBe(s.rounds[i - 1]!.me.family);
    }
  });
  it('token budget: never more than 10 tokens spent, NO_TOKENS refused', () => {
    let s = startArenaBattle(3, { team: T, mastery: {} }, { team: R, mastery: {} }, []);
    const seq: ArenaPick[] = [{ family: 'deepseek', technique: 'cot' }, { family: 'qwen', technique: 'cot' }, { family: 'deepseek', technique: 'cot' }];
    for (const p of seq) {
      const r = playArenaRound(s, p);
      if ('error' in r) throw new Error(r.error);
      s = r.state;
      if (s.status !== 'open') return; // combat fini avant la 4e manche : rien à vérifier de plus
    }
    expect(s.me.tokens).toBe(1);
    expect(playArenaRound(s, { family: 'gemini', technique: 'few' })).toEqual({ error: 'NO_TOKENS' });
    expect('state' in playArenaRound(s, { family: 'gemini', technique: 'hot' })).toBe(true);
  });
  it('rejects unknown families and techniques, and plays after the end', () => {
    const s0 = startArenaBattle(5, { team: T, mastery: {} }, { team: R, mastery: {} }, []);
    expect(playArenaRound(s0, { family: 'claude', technique: 'zero' })).toEqual({ error: 'NOT_IN_TEAM' });
    expect(playArenaRound(s0, { family: 'qwen', technique: 'magic' as Technique })).toEqual({ error: 'BAD_TECHNIQUE' });
    const done = runBattle(5, T, R, smart);
    expect(playArenaRound(done, { family: done.me.team.find((f) => f !== done.me.last)!, technique: 'zero' })).toEqual({ error: 'OVER' });
  });
  it('opponent never spends beyond its budget and never sees the player pick', () => {
    for (let seed = 1; seed < 300; seed++) {
      const s = runBattle(seed, T, R, smart, 1, 4);
      const spent = s.rounds.reduce((a, r) => a + TECHNIQUE_RULES[r.opp.technique].cost, 0);
      expect(spent).toBeLessThanOrEqual(ARENA.tokenBudget);
      expect(s.opp.tokens).toBe(ARENA.tokenBudget - spent);
      // même état, choix du joueur différents → l'adversaire joue exactement la même chose
      const s0 = startArenaBattle(seed, { team: T, mastery: {} }, { team: R, mastery: lv(R, 3) }, ['gemini']);
      const picks = T.flatMap((family) => TECHNIQUES.map((technique) => ({ family, technique })));
      const opps = picks.map((p) => playArenaRound(s0, p)).filter((r) => 'round' in r).map((r) => ('round' in r ? r.round.opp : null));
      expect(opps.length).toBeGreaterThan(5);
      for (const o of opps) expect(o).toEqual(opps[0]);
    }
  });
  it('ends at 3 wins or after 5 rounds; status matches the score', () => {
    for (let seed = 1; seed < 300; seed++) {
      const s = runBattle(seed, T, R, dumb, 1, 3);
      expect(s.rounds.length).toBeGreaterThanOrEqual(3);
      expect(s.rounds.length).toBeLessThanOrEqual(5);
      if (s.me.wins >= 3) expect(s.status).toBe('won');
      else if (s.opp.wins >= 3) expect(s.status).toBe('lost');
      else expect(s.rounds.length).toBe(5);
      for (const r of s.rounds) expect(r.line.length).toBeGreaterThan(5);
    }
  });
  it('a commons team played well beats a rares team played badly (most of the time)', () => {
    let wins = 0;
    const N = 300;
    for (let seed = 1; seed <= N; seed++) {
      // côté « joueur » : les raretés, mal jouées ; côté adversaire : les Communs avec la politique « bien jouée »
      let st = startArenaBattle(seed, { team: R, mastery: {} }, { team: T, mastery: {} }, []);
      while (st.status === 'open') { const r = playArenaRound(st, dumb(st)); if ('error' in r) throw new Error(r.error); st = r.state; }
      if (st.status === 'lost') wins++; // les Communs (adversaire, politique « smart ») ont gagné
    }
    expect(wins / N).toBeGreaterThan(0.75);
  });
  it('guardian mastery 1..2 cycles by day; guardian team is 3 distinct families', () => {
    const ms = new Set(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'].map(guardianMastery));
    expect([...ms].sort()).toEqual([1, 2]);
    for (let i = 0; i < 50; i++) expect(validArenaTeam(guardianTeam(mulberry32(i)))).toBe(true);
    expect(validArenaTeam(['gpt', 'gpt', 'qwen'])).toBe(false);
    expect(validArenaTeam(['gpt', 'qwen'])).toBe(false);
    expect(validArenaTeam(['gpt', 'qwen', 'llama'])).toBe(false);
  });
  it('checkArenaPick and arenaRng are pure', () => {
    const s0 = startArenaBattle(5, { team: T, mastery: {} }, { team: R, mastery: {} }, []);
    expect(checkArenaPick(s0.me, { family: 'qwen', technique: 'cot' })).toBeNull();
    expect(arenaRng(1, 2, 'me')()).toBe(arenaRng(1, 2, 'me')());
    expect(arenaRng(1, 2, 'me')()).not.toBe(arenaRng(1, 2, 'opp')());
  });
});

describe('rewards (bounded)', () => {
  it('guardian 60 XP / 20 ƒ, champion 100 / 30, loss 15 / 0', () => {
    expect(battleRewards('won', 'guardian')).toEqual({ xp: 60, flux: 20 });
    expect(battleRewards('won', 'champion')).toEqual({ xp: 100, flux: 30 });
    expect(battleRewards('lost', 'champion')).toEqual({ xp: 15, flux: 0 });
    // le gain net en Flux par jour reste borné : 12 combats × (30 − 10) + revenu de Champion 240
    expect(ARENA.battlesPerDay * (ARENA.rewards.champion.flux - ARENA.entryFee) + ARENA.championFluxMaxDay).toBeLessThanOrEqual(480);
  });
  it('champion income: 4 ƒ per full 10 min, capped per day, remainder kept', () => {
    const t0 = 1_000_000;
    expect(championAccrual(t0, t0 + 25 * 60_000, 0)).toEqual({ flux: 8, lastPaid: t0 + 20 * 60_000 });
    expect(championAccrual(t0, t0 + 9 * 60_000, 0)).toEqual({ flux: 0, lastPaid: t0 });
    expect(championAccrual(t0, t0 + 24 * 3600_000, 0).flux).toBe(240);
    expect(championAccrual(t0, t0 + 3600_000, 230).flux).toBe(10);
    expect(championAccrual(t0, t0 + 3600_000, 240).flux).toBe(0);
    expect(championAccrual(t0, t0 - 5, 0)).toEqual({ flux: 0, lastPaid: t0 });
  });
});
