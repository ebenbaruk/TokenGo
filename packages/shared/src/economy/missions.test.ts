// Missions du jour (Docs/13 §7) : tirage (déterministe, 3 distinctes, ≥ 1 Arène/Décodage, éligibilité), progression, réclamation.
import { describe, expect, it } from 'vitest';
import { rngFrom } from '../rng.ts';
import { MISSION_CATALOG, MISSIONS, type MissionKind } from './rules.ts';
import { checkClaim, drawMissions, eligibleMissions, missionState, missionsDailyMax } from './missions.ts';

const ALL = { arenaUnlocked: true, raidActive: true };

describe('drawMissions', () => {
  it('is deterministic for a (day, player) seed', () => {
    const a = drawMissions(rngFrom('s', 'missions', 'u1', '2026-11-08'), ALL);
    const b = drawMissions(rngFrom('s', 'missions', 'u1', '2026-11-08'), ALL);
    expect(a).toEqual(b);
  });

  it('always gives 3 distinct missions with at least one Arena/Decode mission', () => {
    for (let i = 0; i < 500; i++) {
      for (const opts of [ALL, { arenaUnlocked: false, raidActive: false }, { arenaUnlocked: true, raidActive: false }]) {
        const m = drawMissions(rngFrom('s', 'm', i), opts);
        expect(m).toHaveLength(MISSIONS.perDay);
        expect(new Set(m).size).toBe(3);
        expect(m.some((k) => MISSION_CATALOG[k].group === 'arena')).toBe(true);
        for (const k of m) expect(eligibleMissions(opts)).toContain(k);
      }
    }
  });

  it('never offers arena battles below the Arena level, nor raid damage without a raid', () => {
    const seen = new Set<MissionKind>();
    for (let i = 0; i < 400; i++) for (const k of drawMissions(rngFrom('s', 'low', i), { arenaUnlocked: false, raidActive: false })) seen.add(k);
    expect(seen.has('arena_win')).toBe(false);
    expect(seen.has('arena_rounds')).toBe(false);
    expect(seen.has('raid_damage')).toBe(false);
    expect(seen.has('decode')).toBe(true); // seule mission « arena » possible : toujours là
  });

  it('varies over days and covers the whole catalogue', () => {
    const seen = new Set<MissionKind>();
    const days = new Set<string>();
    for (let d = 0; d < 300; d++) {
      const m = drawMissions(rngFrom('s', 'missions', 'u1', d), ALL);
      m.forEach((k) => seen.add(k));
      days.add(m.join(','));
    }
    expect(seen.size).toBe(Object.keys(MISSION_CATALOG).length);
    expect(days.size).toBeGreaterThan(20);
  });

  it('avoids two missions of the same group when it can', () => {
    for (let i = 0; i < 300; i++) {
      const groups = drawMissions(rngFrom('s', 'g', i), { arenaUnlocked: true, raidActive: false }).map((k) => MISSION_CATALOG[k].group);
      expect(new Set(groups).size).toBe(3); // arena + explore + trade
    }
  });
});

describe('progress & claim', () => {
  it('clamps progress to the goal', () => {
    expect(missionState('decode', 0, false)).toMatchObject({ progress: 0, goal: 3, done: false });
    expect(missionState('decode', 2, false)).toMatchObject({ progress: 2, done: false });
    expect(missionState('decode', 9, false)).toMatchObject({ progress: 3, done: true });
    expect(missionState('raid_damage', 250.7, false)).toMatchObject({ progress: 200, goal: 200, done: true });
    expect(missionState('combo3', -4, false).progress).toBe(0);
  });

  it('only claims finished, unclaimed missions of the day; the 3rd claim opens the chest', () => {
    const ms = [missionState('decode', 3, false), missionState('relay_sync', 4, true), missionState('shops', 1, false)];
    expect(checkClaim(ms, 'shops')).toEqual({ ok: false, error: 'NOT_DONE' });
    expect(checkClaim(ms, 'relay_sync')).toEqual({ ok: false, error: 'ALREADY_CLAIMED' });
    expect(checkClaim(ms, 'arena_win')).toEqual({ ok: false, error: 'NOT_TODAY' });
    expect(checkClaim(ms, 'decode')).toEqual({ ok: true, chest: false });
    const ms2 = [missionState('decode', 3, true), missionState('relay_sync', 4, true), missionState('shops', 2, false)];
    expect(checkClaim(ms2, 'shops')).toEqual({ ok: true, chest: true });
  });

  it('caps the daily payout: 3 × (40 XP + 15 ƒ) + chest 60 ƒ + 1 shard', () => {
    expect(missionsDailyMax()).toEqual({ xp: 120, flux: 105, shards: 1 });
  });
});
