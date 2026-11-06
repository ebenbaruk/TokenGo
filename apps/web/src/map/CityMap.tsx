// Carte de Paris « vue d'ensemble » (Lab, Pulse) : même style cartoon, points colorés via une source GeoJSON.
// Les mises à jour passent par setData (pas de re-render React de la carte).
import { useEffect, useRef } from 'react';
import { Map as MLMap, AttributionControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import s from './CityMap.module.css';

setWorkerUrl(workerUrl);

export interface CityPoint { lng: number; lat: number; color: string; r?: number; stroke?: string; label?: string; kind?: 'bot' | 'merchant' }

const fc = (pts: CityPoint[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: pts.map((p) => ({ type: 'Feature', properties: { color: p.color, r: p.r ?? 5, stroke: p.stroke ?? '#1a1c2c', label: p.label ?? '', kind: p.kind ?? 'merchant' }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
});

export default function CityMap({ points, height = 360, testId }: { points: CityPoint[]; height?: number | string; testId?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const latest = useRef(points);
  latest.current = points;

  useEffect(() => {
    const m = new MLMap({
      container: el.current!, style: '/map/style.json', center: [2.3442, 48.8590], zoom: 11.4, minZoom: 10, maxZoom: 16,
      attributionControl: false, pitchWithRotate: false, dragRotate: false, fadeDuration: 0,
    });
    m.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    m.touchZoomRotate.disableRotation();
    m.on('load', () => {
      m.addSource('pts', { type: 'geojson', data: fc(latest.current) });
      m.addLayer({ id: 'bots', type: 'circle', source: 'pts', filter: ['==', ['get', 'kind'], 'bot'], paint: {
        'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-opacity': 0.75,
      } });
      m.addLayer({ id: 'pts', type: 'circle', source: 'pts', filter: ['==', ['get', 'kind'], 'merchant'], paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['*', ['get', 'r'], 0.7], 14, ['*', ['get', 'r'], 1.6]],
        'circle-color': ['get', 'color'], 'circle-stroke-color': ['get', 'stroke'], 'circle-stroke-width': 1.5,
      } });
      ready.current = true;
    });
    map.current = m;
    return () => { ready.current = false; m.remove(); };
  }, []);

  useEffect(() => {
    if (!ready.current || !map.current) return;
    (map.current.getSource('pts') as GeoJSONSource | undefined)?.setData(fc(points));
  }, [points]);

  return <div ref={el} className={s.map} style={{ height }} data-testid={testId} />;
}
