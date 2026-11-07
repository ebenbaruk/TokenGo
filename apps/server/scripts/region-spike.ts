// Vérifie le chemin réel du monde « partout » : requête Overpass (miroirs publics) pour la région d'un point, puis sélection.
// Usage : node apps/server/scripts/region-spike.ts [lat] [lng]      (défaut : Lisbonne, Baixa)
// Aucun écrit en base : affiche les comptes, quelques nœuds, et le repli procédural pour comparaison.
import { WORLD_GEN } from '@tokengo/shared';
import { overpassFetcher, parseOverpassUrls } from '../src/game/regions.ts';
import { overpassQuery, proceduralRegion, regionOf, selectRegion } from '../src/game/worldgen.ts';

const lat = Number(process.argv[2] ?? 38.7107), lng = Number(process.argv[3] ?? -9.1365);
const region = regionOf(lat, lng);
const urls = parseOverpassUrls(process.env.OVERPASS_URLS ?? 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter');
console.log(`region ${region} (r${WORLD_GEN.regionRes}) around ${lat}, ${lng} — mirrors: ${urls.join(' | ')}`);
const t0 = Date.now();
const elements = await overpassFetcher(urls, 120_000)!(overpassQuery(region));
console.log(`overpass: ${elements.length} elements in ${Date.now() - t0} ms`);
const g = selectRegion(region, elements);
const summary = (nodes: { kind: string }[]) => ['forge', 'market', 'relay'].map((k) => `${k}:${nodes.filter((n) => n.kind === k).length}`).join(' ');
if (!g) console.log('too few POIs → procedural fallback would be used');
else {
  console.log(`osm selection: ${summary(g.nodes)}`);
  for (const n of g.nodes.filter((x) => x.kind !== 'relay')) console.log(`  ${n.kind.padEnd(6)} ${n.name} [${n.category}] ${n.affinities.join(',')}`);
  console.log(`  relays e.g.: ${g.nodes.filter((x) => x.kind === 'relay').slice(0, 8).map((x) => x.name).join(' · ')}`);
}
console.log(`procedural (for comparison): ${summary(proceduralRegion(region).nodes)}`);
