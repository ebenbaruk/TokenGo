// Fausse réponse Overpass pour les tests (aucun réseau).
import { cellToChildren, cellToLatLng } from 'h3-js';
import { regionOf, type OsmElement } from './worldgen.ts';

export const LISBON = { lat: 38.7107, lng: -9.1365 };

/** Fausse réponse Overpass : des POI variés sur les cellules r9 de la région (+ quelques-uns hors région). */
export function fakeOverpass(region = regionOf(LISBON.lat, LISBON.lng)): OsmElement[] {
  const kinds: Record<string, string>[] = [
    { amenity: 'cafe' }, { leisure: 'park' }, { tourism: 'artwork' }, { amenity: 'fountain' }, { shop: 'books' },
    { historic: 'monument' }, { amenity: 'library' }, { tourism: 'museum', wikidata: 'Q1' }, { amenity: 'place_of_worship' }, { railway: 'station' },
  ];
  const out: OsmElement[] = [];
  let id = 1000;
  cellToChildren(region, 9).sort().forEach((c, i) => {
    const [lat, lng] = cellToLatLng(c);
    const tags = { ...kinds[i % kinds.length]!, name: `Place ${i}` };
    out.push({ type: i % 3 ? 'node' : 'way', id: id++, ...(i % 3 ? { lat, lon: lng } : { center: { lat, lon: lng } }), tags });
  });
  out.push({ type: 'node', id: 1, lat: 38.80, lon: -9.30, tags: { amenity: 'cafe', name: 'Elsewhere' } }); // hors région
  out.push({ type: 'node', id: 2, lat: LISBON.lat, lon: LISBON.lng, tags: { amenity: 'drinking_water' } });
  return out;
}
