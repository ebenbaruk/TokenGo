import { describe, expect, it } from 'vitest';
import { cellToLatLng, cellToParent, latLngToCell } from 'h3-js';
import { WORLD_GEN } from '@tokengo/shared';
import { generateRegion, haversineM, overpassQuery, proceduralRegion, regionOf, regionsAround, selectRegion } from './worldgen.ts';
import { fakeOverpass, LISBON } from './worldgen.fixture.ts';

const REGION = regionOf(LISBON.lat, LISBON.lng);

const minDist = (nodes: { lat: number; lng: number }[]) => {
  let m = Infinity;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) m = Math.min(m, haversineM(nodes[i]!.lat, nodes[i]!.lng, nodes[j]!.lat, nodes[j]!.lng));
  return m;
};

describe('régions « partout »', () => {
  it('regionsAround : la région du joueur en premier, régions voisines dans 600 m', () => {
    const ids = regionsAround(LISBON.lat, LISBON.lng);
    expect(ids[0]).toBe(REGION);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(ids.length).toBeLessThanOrEqual(4);
    expect(overpassQuery(REGION)).toMatch(/^\[out:json\]\[timeout:\d+\];\(nwr\[/);
  });

  it('OSM : sélection déterministe, plafonnée, dans la région, espacée', () => {
    const els = fakeOverpass();
    const a = selectRegion(REGION, els)!;
    const b = selectRegion(REGION, [...els].reverse())!;
    expect(a).not.toBeNull();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a)); // indépendant de l'ordre de la réponse
    const by = (k: string) => a.nodes.filter((n) => n.kind === k);
    expect(a.source).toBe('osm');
    expect(by('forge').length).toBeGreaterThanOrEqual(1);
    expect(by('forge').length).toBeLessThanOrEqual(WORLD_GEN.maxForges);
    expect(by('market').length).toBeGreaterThanOrEqual(WORLD_GEN.minOsmMarkets);
    expect(by('market').length).toBeLessThanOrEqual(WORLD_GEN.maxMarkets);
    expect(by('relay').length).toBeGreaterThanOrEqual(WORLD_GEN.minOsmRelays);
    expect(by('relay').length).toBeLessThanOrEqual(WORLD_GEN.maxRelays);
    for (const n of a.nodes) {
      expect(cellToParent(latLngToCell(n.lat, n.lng, 9), WORLD_GEN.regionRes)).toBe(REGION);
      expect(n.region).toBe(REGION);
      expect(n.h3).toBe(latLngToCell(n.lat, n.lng, 9));
    }
    for (const f of by('forge')) expect(f.theme).toHaveLength(2);
    expect(by('forge')[0]!.name).toMatch(/Place/); // un vrai repère (musée/culte), pas un nom généré
    expect(minDist(by('market'))).toBeGreaterThanOrEqual(600);
    expect(minDist(by('relay'))).toBeGreaterThanOrEqual(170);
    expect(new Set(a.nodes.map((n) => n.id)).size).toBe(a.nodes.length);
  });

  it('trop peu de POI → null ; generateRegion bascule alors en procédural', () => {
    const few = fakeOverpass().slice(0, 5);
    expect(selectRegion(REGION, few)).toBeNull();
    expect(generateRegion(REGION, few).source).toBe('procedural');
    expect(generateRegion(REGION, null).source).toBe('procedural'); // Overpass injoignable
    expect(generateRegion(REGION, fakeOverpass()).source).toBe('osm');
  });

  it('procédural : déterministe à partir de l’id, comptes fixes, nommé, dans la région', () => {
    const a = proceduralRegion(REGION);
    expect(JSON.stringify(proceduralRegion(REGION))).toBe(JSON.stringify(a));
    const P = WORLD_GEN.procedural;
    expect(a.nodes.filter((n) => n.kind === 'forge')).toHaveLength(P.forges);
    expect(a.nodes.filter((n) => n.kind === 'market')).toHaveLength(P.markets);
    expect(a.nodes.filter((n) => n.kind === 'relay')).toHaveLength(P.relays);
    expect(minDist(a.nodes)).toBeGreaterThanOrEqual(150);
    expect(new Set(a.nodes.map((n) => n.name)).size).toBe(a.nodes.length);
    for (const n of a.nodes) expect(haversineM(n.lat, n.lng, ...cellToLatLng(REGION))).toBeLessThan(2000);
    // une autre région donne un autre quartier
    const other = proceduralRegion(regionOf(52.52, 13.405));
    expect(other.nodes.map((n) => n.name)).not.toEqual(a.nodes.map((n) => n.name));
    // les marchands auront des affinités (spécialités) et les forges un thème de 2 familles
    expect(a.nodes.filter((n) => n.kind === 'market').every((n) => n.affinities.length >= 1)).toBe(true);
  });
});
