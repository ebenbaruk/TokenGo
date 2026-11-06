// Génère apps/web/public/map/style.json : style « cartoon plat de jour » (Docs/09 §1 Carte)
// sur les tuiles vectorielles OpenFreeMap (schéma OpenMapTiles). Écrit à la main plutôt que patcher `liberty` :
// moins de couches, toutes maîtrisées. Usage : node apps/web/scripts/build-map-style.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const C = {
  ground: '#F6EFD9', groundAlt: '#F0E6CB', water: '#41a6f6', waterEdge: '#3b5dc9', park: '#a7f070', parkEdge: '#38b764',
  wood: '#38b764', building: '#EAD9C6', buildingEdge: '#D2BBA3', road: '#ffffff', casing: '#94b0c2', rail: '#94b0c2',
  night: '#333c57', slate: '#566c86', navy: '#29366f', sand: '#ffe2a8',
};
const line = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const poly = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const cls = (...c: string[]) => ['match', ['get', 'class'], c, true, false];
const zw = (stops: [number, number][]) => ['interpolate', ['exponential', 1.4], ['zoom'], ...stops.flat()];
const name = ['coalesce', ['get', 'name:latin'], ['get', 'name']];

type Layer = Record<string, unknown>;
const layers: Layer[] = [
  { id: 'background', type: 'background', paint: { 'background-color': C.ground } },
  { id: 'landuse-res', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('residential', 'suburb', 'neighbourhood'),
    paint: { 'fill-color': C.groundAlt, 'fill-opacity': 0.6 } },
  { id: 'landuse-sand', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('sand'), paint: { 'fill-color': C.sand } },
  { id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('grass'),
    paint: { 'fill-color': C.park, 'fill-opacity': 0.85 } },
  { id: 'landuse-cemetery', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('cemetery'),
    paint: { 'fill-color': '#cfe8a8' } },
  { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', filter: poly, paint: { 'fill-color': C.park } },
  { id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('wood', 'forest'),
    paint: { 'fill-color': C.wood, 'fill-opacity': 0.55 } },
  { id: 'park-edge', type: 'line', source: 'omt', 'source-layer': 'park', filter: poly, minzoom: 13,
    paint: { 'line-color': C.parkEdge, 'line-width': zw([[13, 0.5], [18, 2]]) } },
  { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', filter: ['all', line, ['!=', ['get', 'brunnel'], 'tunnel']],
    paint: { 'line-color': C.water, 'line-width': zw([[10, 1], [18, 6]]) } },
  { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', filter: ['all', poly, ['!=', ['get', 'brunnel'], 'tunnel']],
    paint: { 'fill-color': C.water } },
  { id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water', filter: ['all', poly, ['!=', ['get', 'brunnel'], 'tunnel']],
    minzoom: 11, paint: { 'line-color': C.waterEdge, 'line-width': zw([[11, 0.5], [16, 2], [19, 3]]) } },
];

// Routes : contour mist puis aplat blanc. Ordre : petites dessous, grandes dessus.
const roads: { id: string; classes: string[]; min: number; w: [number, number][] }[] = [
  { id: 'path', classes: ['path', 'pedestrian', 'track'], min: 15, w: [[15, 1], [19, 4]] },
  { id: 'service', classes: ['service'], min: 15, w: [[15, 1], [19, 6]] },
  { id: 'minor', classes: ['minor'], min: 13, w: [[13, 0.6], [16, 4], [19, 12]] },
  { id: 'secondary', classes: ['secondary', 'tertiary'], min: 10, w: [[10, 0.6], [16, 7], [19, 18]] },
  { id: 'primary', classes: ['primary', 'trunk', 'motorway'], min: 8, w: [[8, 0.8], [16, 9], [19, 22]] },
];
for (const r of roads) {
  const filter = ['all', line, cls(...r.classes), ['!=', ['get', 'brunnel'], 'tunnel']];
  const casing = r.id === 'primary' || r.id === 'secondary' ? 2 : 1;
  if (r.id !== 'path') {
    layers.push({ id: `road-${r.id}-casing`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: r.min, filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.casing, 'line-width': zw(r.w.map(([z, w]) => [z, w + casing * 2] as [number, number])) } });
  }
  layers.push({ id: `road-${r.id}`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: r.min, filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: r.id === 'path'
      ? { 'line-color': '#ffffff', 'line-width': zw(r.w), 'line-dasharray': [2, 1] }
      : { 'line-color': C.road, 'line-width': zw(r.w) } });
}
layers.push(
  { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12,
    filter: ['all', line, cls('rail', 'transit'), ['!=', ['get', 'brunnel'], 'tunnel']],
    paint: { 'line-color': C.rail, 'line-width': zw([[12, 0.5], [18, 2]]), 'line-dasharray': [3, 2] } },
  { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13,
    paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingEdge } },
  { id: 'building-edge', type: 'line', source: 'omt', 'source-layer': 'building', minzoom: 16,
    paint: { 'line-color': C.buildingEdge, 'line-width': 1 } },
  // Labels : eau, grands axes (zoom fort), quartiers. Pas de POI, pas de numéros, pas de petites rues.
  { id: 'water-label', type: 'symbol', source: 'omt', 'source-layer': 'water_name', filter: line,
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': name, 'text-font': ['Noto Sans Bold'],
      'text-size': 14, 'text-letter-spacing': 0.25 },
    paint: { 'text-color': '#ffffff', 'text-halo-color': C.waterEdge, 'text-halo-width': 1.5 } },
  { id: 'road-label-major', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 15,
    filter: cls('primary', 'trunk', 'secondary'),
    layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': 11,
      'symbol-spacing': 500 },
    paint: { 'text-color': C.slate, 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
  { id: 'place-quarter', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 12,
    filter: cls('suburb', 'quarter', 'neighbourhood'),
    layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.15,
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13], 'text-max-width': 8 },
    paint: { 'text-color': C.night, 'text-halo-color': C.ground, 'text-halo-width': 2, 'text-opacity': 0.75 } },
  { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 12, filter: cls('city', 'town'),
    layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': 16 },
    paint: { 'text-color': C.navy, 'text-halo-color': C.ground, 'text-halo-width': 2 } },
);

const style = {
  version: 8,
  name: 'TokenGo Pixel Pop Paris (day)',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    omt: {
      type: 'vector', url: 'https://tiles.openfreemap.org/planet',
      attribution: '© <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
    },
  },
  layers,
};
const out = fileURLToPath(new URL('../public/map/style.json', import.meta.url));
writeFileSync(out, JSON.stringify(style, null, 1));
console.log(`style.json: ${layers.length} layers → ${out}`);
