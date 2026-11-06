import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAMILIES, type WorldFile } from '@tokengo/shared/types.ts';
import { affinitiesOfTags, nodeCategory } from '@tokengo/shared/economy/affinity.ts';
import { haversineM } from './build-world.ts';

const ROOT = join(import.meta.dirname, '../../..');
const world = JSON.parse(readFileSync(join(ROOT, 'data/world/paris.json'), 'utf8')) as WorldFile;
const LOUVRE_START = { lat: 48.8611, lng: 2.3358 }; // Cour Napoléon, départ de la démo

const ofKind = (k: string) => world.nodes.filter((n) => n.kind === k);

describe('data/world/paris.json', () => {
  it('a des comptes dans les fourchettes', () => {
    expect(ofKind('relay').length).toBeGreaterThanOrEqual(800);
    expect(ofKind('relay').length).toBeLessThanOrEqual(1100);
    expect(ofKind('market').length).toBeGreaterThanOrEqual(110);
    expect(ofKind('market').length).toBeLessThanOrEqual(170);
    expect(ofKind('forge').length).toBe(10);
  });

  it('a des ids uniques et un ordre stable', () => {
    const ids = world.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it("n'a pas deux nodes à moins de 50 m, ni de relay/market à moins de 80 m d'une forge", () => {
    const n = world.nodes;
    for (let i = 0; i < n.length; i++)
      for (let j = i + 1; j < n.length; j++) {
        const a = n[i]!, b = n[j]!;
        if (Math.abs(a.lat - b.lat) > 0.002) continue;
        const d = haversineM(a.lat, a.lng, b.lat, b.lng);
        expect(d, `${a.id} ↔ ${b.id}`).toBeGreaterThanOrEqual(50);
        if (a.kind === 'forge' || b.kind === 'forge') expect(d, `${a.id} ↔ ${b.id}`).toBeGreaterThanOrEqual(80);
      }
  });

  it('place tout dans Paris (bbox + arrondissement connu)', () => {
    for (const n of world.nodes) {
      expect(n.lat).toBeGreaterThan(48.815);
      expect(n.lat).toBeLessThan(48.903);
      expect(n.lng).toBeGreaterThan(2.224);
      expect(n.lng).toBeLessThan(2.47);
      expect(n.district, n.id).toBeGreaterThanOrEqual(1);
      expect(n.district, n.id).toBeLessThanOrEqual(20);
      expect(n.h3, n.id).toMatch(/^89[0-9a-f]{13}$/);
      expect(world.cells[n.h3], n.id).toBeDefined();
    }
  });

  it("n'utilise que des familles valides (max 2) ; chaque market a une affinité ou une catégorie", () => {
    for (const n of world.nodes) {
      expect(n.affinities.length).toBeLessThanOrEqual(2);
      for (const f of n.affinities) expect(FAMILIES).toContain(f);
    }
    for (const m of ofKind('market')) expect(m.affinities.length > 0 || m.category.length > 0, m.id).toBe(true);
    for (const c of Object.values(world.cells)) {
      expect(c.richness).toBeGreaterThanOrEqual(0);
      expect(c.richness).toBeLessThanOrEqual(6);
      expect(c.affinities.length).toBeLessThanOrEqual(2);
      for (const f of c.affinities) expect(FAMILIES).toContain(f);
    }
    // toutes les familles existent quelque part, sinon des recettes seraient infaisables
    for (const f of FAMILIES) expect(world.nodes.some((n) => n.affinities.includes(f)), f).toBe(true);
  });

  it('garantit le départ de la démo au Louvre : une Forge < 250 m et ≥ 2 marchands < 600 m', () => {
    const d = (n: { lat: number; lng: number }) => haversineM(LOUVRE_START.lat, LOUVRE_START.lng, n.lat, n.lng);
    expect(ofKind('forge').some((f) => d(f) < 250)).toBe(true);
    expect(ofKind('market').filter((m) => d(m) < 600).length).toBeGreaterThanOrEqual(2);
  });
});

describe('affinitiesOfTags / nodeCategory', () => {
  it('applique la table Docs/04 §4', () => {
    expect(affinitiesOfTags({ amenity: 'library' })).toEqual(['claude']);
    expect(affinitiesOfTags({ railway: 'station', public_transport: 'station' })).toEqual(['gpt']);
    expect(affinitiesOfTags({ leisure: 'park' })).toEqual(['gemini']);
    expect(affinitiesOfTags({ office: 'coworking', name: 'Station F' })).toEqual(['qwen']);
    expect(affinitiesOfTags({ amenity: 'cafe' })).toEqual(['deepseek']);
    expect(affinitiesOfTags({ shop: 'books' })).toEqual(['claude', 'deepseek']);
    expect(affinitiesOfTags({ tourism: 'museum', museum: 'science' })).toEqual(['gemini']);
    expect(affinitiesOfTags({ tourism: 'artwork' })).toEqual([]);
  });
  it('catégorise', () => {
    expect(nodeCategory({ railway: 'station', station: 'subway' })).toBe('metro');
    expect(nodeCategory({ shop: 'books' })).toBe('bookshop');
    expect(nodeCategory({ historic: 'castle' })).toBe('monument');
  });
});
