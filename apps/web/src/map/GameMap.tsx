// Carte MapLibre (directe, sans react-map-gl). Éclats / nœuds / avatar = sources GeoJSON + couches symbol avec
// des sprites pixel art enregistrés via map.addImage. Aucune re-render React par frame : on s'abonne au store hors React.
import { useEffect, useRef } from 'react';
import { Map as MLMap, AttributionControl, setWorkerUrl, type GeoJSONSource, type MapMouseEvent, type PointLike, type MapGeoJSONFeature } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { FAMILIES, ACTION_RADIUS_M, type NodeView, type SpawnView, type LatLng } from '@tokengo/shared';
import { useGame } from '../lib/store.ts';
import { SHARDS, AVATAR, RUNNER, RELAY, RELAY_COOLDOWN, FORGE, BADGE, ACCENTS, hashStr, marketSprite, spriteImageData, gridsOf, type SpriteDef } from '../sprites/index.ts';
import { NODE_GRIDS } from '../sprites/nodes.grids.ts';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { mapCtl } from './ctl.ts';
import s from './GameMap.module.css';

setWorkerUrl(workerUrl);

export interface MapHandlers {
  onSpawn: (sp: SpawnView) => void;
  onNode: (n: NodeView) => void;
  onGround: (p: LatLng) => void;
}

const FOLLOW = { zoom: 17, pitch: 55 };
const FREE_MS = 8000;


type Anim = { name: string; frames: ImageData[] };

function registerImages(map: MLMap): Anim[] {
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  const anims: Anim[] = [];
  const add = (name: string, def: SpriteDef, scale: number, opts: { bounce?: boolean; shadow?: boolean } = {}) => {
    const n = gridsOf(def).length;
    const frames: ImageData[] = [];
    for (let i = 0; i < Math.max(n, opts.bounce ? 2 : 1); i++) {
      const pad = opts.bounce ? (i % 2 === 0 ? { top: 0, bottom: 3 } : { top: 2, bottom: 1 }) : { top: 0, bottom: opts.shadow ? 2 : 0 };
      frames.push(spriteImageData(def, scale * dpr, i % n, pad, opts.shadow));
    }
    map.addImage(name, frames[0]!, { pixelRatio: dpr });
    if (frames.length > 1) anims.push({ name, frames });
  };
  for (const f of FAMILIES) add(`shard-${f}`, SHARDS[f], 3, { bounce: true, shadow: true });
  add('relay', RELAY, 2);
  add('relay-cd', RELAY_COOLDOWN, 2);
  add('forge', FORGE, 2, { shadow: true });
  add('avatar', AVATAR, 2, { shadow: true });
  add('runner', RUNNER, 1);
  add('badge', BADGE, 2);
  ACCENTS.forEach((_, i) => add(`market-${i}`, { frames: NODE_GRIDS.market, keys: { A: ACCENTS[i]!.a, B: ACCENTS[i]!.b }, outline: true, fps: 1 }, 2));
  add('market-closed', marketSprite('x', true), 2);
  return anims;
}

const marketIcon = (n: NodeView) => {
  if (n.merchant?.status === 'closed') return 'market-closed';
  return `market-${hashStr(n.merchant?.id ?? n.id) % ACCENTS.length}`;
};

function circlePoly(c: LatLng, r: number): Feature {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push([c.lng + (r * Math.sin(a)) / (111_320 * Math.cos((c.lat * Math.PI) / 180)), c.lat + (r * Math.cos(a)) / 110_540]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}
const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
const pt = (p: LatLng, props: Record<string, unknown>): Feature => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });

export default function GameMap({ handlers }: { handlers: MapHandlers }) {
  const el = useRef<HTMLDivElement>(null);
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    const start = useGame.getState().pos ?? { lat: 48.8611, lng: 2.3358 };
    const map = new MLMap({
      container: el.current!,
      style: '/map/style.json',
      center: [start.lng, start.lat],
      zoom: FOLLOW.zoom,
      pitch: FOLLOW.pitch,
      maxPitch: 70,
      attributionControl: false,
      dragRotate: true,
      pitchWithRotate: false,
      fadeDuration: 0,
    });
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    map.touchZoomRotate.disableRotation();
    let following = true;
    let freeTimer = 0;
    let anims: Anim[] = [];
    let frame = 0;
    let animTimer = 0;
    let ready = false; // sources/couches ajoutées (isStyleLoaded() reste faux tant que les tuiles chargent)
    const setFollow = (f: boolean) => { following = f; mapCtl.onFollowChange(f); };
    mapCtl.isFollowing = () => following;
    mapCtl.recenter = () => {
      setFollow(true);
      const p = useGame.getState().pos;
      if (p) map.easeTo({ center: [p.lng, p.lat], zoom: FOLLOW.zoom, pitch: FOLLOW.pitch, duration: 600 });
    };
    const userMoved = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return;
      setFollow(false);
      clearTimeout(freeTimer);
      freeTimer = window.setTimeout(() => mapCtl.recenter(), FREE_MS);
    };
    map.on('dragstart', userMoved);
    map.on('zoomstart', userMoved);
    map.on('pitchstart', userMoved);

    const sync = () => {
      if (!ready) return;
      const st = useGame.getState();
      const now = Date.now();
      const hidden = new Set(st.hiddenSpawns);
      const nodes = st.world?.nodes ?? [];
      (map.getSource('nodes') as GeoJSONSource).setData(fc(nodes.map((n) => pt(n, {
        id: n.id, kind: n.kind, name: n.name,
        icon: n.kind === 'relay' ? ((n.cooldownUntil ?? 0) > now ? 'relay-cd' : 'relay') : n.kind === 'forge' ? 'forge' : marketIcon(n),
        badge: n.kind === 'market' && n.merchant?.hasContract && n.merchant.status !== 'closed' ? 1 : 0,
        sort: n.kind === 'forge' ? 3 : n.kind === 'market' ? 2 : 1,
      }))));
      (map.getSource('spawns') as GeoJSONSource).setData(fc((st.world?.spawns ?? []).filter((x) => !hidden.has(x.id) && x.expiresAt > now)
        .map((x) => pt(x, { id: x.id, family: x.family, icon: `shard-${x.family}` }))));
      (map.getSource('runners') as GeoJSONSource).setData(fc(st.showRunners ? (st.world?.runners ?? []).map((r) => pt(r, { handle: r.handle })) : []));
      const target = st.world?.objective?.target;
      (map.getSource('route') as GeoJSONSource).setData(fc(target && st.pos ? [{
        type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[st.pos.lng, st.pos.lat], [target.lng, target.lat]] },
      }] : []));
    };
    const syncMe = () => {
      if (!ready) return;
      const p = useGame.getState().pos;
      if (!p) return;
      (map.getSource('me') as GeoJSONSource).setData(fc([pt(p, {})]));
      (map.getSource('radius') as GeoJSONSource).setData(fc([circlePoly(p, ACTION_RADIUS_M.spawn + Math.min(p.acc, 20))]));
      if (following) map.easeTo({ center: [p.lng, p.lat], pitch: FOLLOW.pitch, zoom: FOLLOW.zoom, duration: 600 });
    };

    map.on('load', () => {
      anims = registerImages(map);
      const before = map.getLayer('place-quarter') ? 'place-quarter' : undefined;
      map.addSource('radius', { type: 'geojson', data: fc([]) });
      map.addSource('route', { type: 'geojson', data: fc([]) });
      map.addSource('nodes', { type: 'geojson', data: fc([]) });
      map.addSource('spawns', { type: 'geojson', data: fc([]) });
      map.addSource('me', { type: 'geojson', data: fc([]) });
      map.addSource('runners', { type: 'geojson', data: fc([]) });
      map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#41a6f6', 'fill-opacity': 0.12 } }, before);
      map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#3b5dc9', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.6 } }, before);
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#5d275d', 'line-width': 4, 'line-dasharray': [0.5, 2], 'line-opacity': 0.75 } });
      map.addLayer({ id: 'nodes', type: 'symbol', source: 'nodes', layout: {
        'icon-image': ['get', 'icon'], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'sort'], 'icon-pitch-alignment': 'viewport',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 13, ['match', ['get', 'kind'], 'forge', 0.7, 0.35], 16, ['match', ['get', 'kind'], 'forge', 1, 0.8], 18, 1],
      } });
      map.addLayer({ id: 'node-badges', type: 'symbol', source: 'nodes', filter: ['==', ['get', 'badge'], 1], minzoom: 15, layout: {
        'icon-image': 'badge', 'icon-anchor': 'bottom', 'icon-offset': [16, -40], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      } });
      map.addLayer({ id: 'node-labels', type: 'symbol', source: 'nodes', filter: ['==', ['get', 'kind'], 'forge'], layout: {
        'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-anchor': 'top', 'text-offset': [0, 0.3],
        'text-max-width': 10, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#5d275d', 'text-halo-color': '#ffcd75', 'text-halo-width': 2 } });
      map.addLayer({ id: 'runners', type: 'symbol', source: 'runners', minzoom: 14, layout: {
        'icon-image': 'runner', 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-pitch-alignment': 'viewport',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 17, 1],
        'text-field': ['step', ['zoom'], '', 16.5, ['get', 'handle']], 'text-font': ['Noto Sans Bold'], 'text-size': 10,
        'text-anchor': 'top', 'text-offset': [0, 0.2], 'text-optional': true,
      }, paint: { 'text-color': '#5d275d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
      map.addLayer({ id: 'me', type: 'symbol', source: 'me', layout: {
        'icon-image': 'avatar', 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      } });
      map.addLayer({ id: 'spawns', type: 'symbol', source: 'spawns', layout: {
        'icon-image': ['get', 'icon'], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.4, 17, 0.8, 18, 1],
      } });
      ready = true;
      sync();
      syncMe();
      // frames d'animation (rebond des éclats, étincelles de la forge, lumière des relais)
      animTimer = window.setInterval(() => {
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        frame++;
        const moving = Boolean(useGame.getState().walkTarget);
        for (const a of anims) {
          if (a.name === 'avatar' && !moving) { map.updateImage(a.name, a.frames[0]!); continue; }
          map.updateImage(a.name, a.frames[frame % a.frames.length]!);
        }
      }, 380);
    });

    const clickable = ['spawns', 'nodes', 'node-badges'];
    map.on('click', (e: MapMouseEvent) => {
      const box: [PointLike, PointLike] = [[e.point.x - 18, e.point.y - 22], [e.point.x + 18, e.point.y + 14]];
      const feats = map.queryRenderedFeatures(box, { layers: clickable.filter((l) => map.getLayer(l)) });
      const st = useGame.getState();
      const sp = feats.find((f: MapGeoJSONFeature) => f.layer.id === 'spawns');
      if (sp) {
        const spawn = st.world?.spawns.find((x) => x.id === sp.properties.id);
        if (spawn) return h.current.onSpawn(spawn);
      }
      const nf = feats.find((f: MapGeoJSONFeature) => f.layer.id === 'nodes' || f.layer.id === 'node-badges');
      if (nf) {
        const node = st.world?.nodes.find((x) => x.id === nf.properties.id);
        if (node) return h.current.onNode(node);
      }
      h.current.onGround({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    for (const l of clickable) {
      map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
    }

    let lastPos = useGame.getState().pos;
    let lastWorld = useGame.getState().world;
    let lastHidden = useGame.getState().hiddenSpawns;
    let lastRunners = useGame.getState().showRunners;
    let lastSyncMe = 0;
    const unsub = useGame.subscribe((st) => {
      if (st.world !== lastWorld || st.hiddenSpawns !== lastHidden || st.showRunners !== lastRunners) { lastWorld = st.world; lastHidden = st.hiddenSpawns; lastRunners = st.showRunners; sync(); }
      if (st.pos !== lastPos) {
        lastPos = st.pos;
        const now = performance.now();
        // marche démo : on lisse la caméra (≈ 8 maj/s suffisent, l'easeTo interpole)
        if (now - lastSyncMe > 120) { lastSyncMe = now; syncMe(); }
      }
    });
    const tick = window.setInterval(sync, 5000); // recharges des relais, expirations
    (window as unknown as { __tgMap?: MLMap }).__tgMap = map;
    return () => { unsub(); clearInterval(tick); clearInterval(animTimer); clearTimeout(freeTimer); map.remove(); };
  }, []);

  return <div ref={el} className={s.map} data-testid="map" />;
}
