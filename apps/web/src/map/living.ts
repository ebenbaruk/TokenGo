// Carte vivante (Docs/09 § Carte vivante) : marcheurs animés (couche symbol, ≤ 12, 5 maj/s), étiquette au tap,
// bulles des marchands (≤ 3 marqueurs DOM, sans chevauchement), zone de l'événement de ville.
import { Marker, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { haversineM, legPosition, pickBubbles, type BubbleCandidate, type CityEventView, type LatLng, type NodeView, type WalkerView } from '@tokengo/shared';
import { useGame } from '../lib/store.ts';
import { play } from '../lib/sound.ts';
import { WALKER_VARIANTS, spriteImageData, walkerSprite } from '../sprites/index.ts';
import s from './living.module.css';

const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
const pt = (p: LatLng, props: Record<string, unknown>): Feature => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });

export const EVENT_COLORS: Record<CityEventView['kind'], { fill: string; line: string; text: string }> = {
  flash_crash: { fill: '#b13e53', line: '#b13e53', text: '#b13e53' },
  hype: { fill: '#38b764', line: '#257179', text: '#257179' },
  gold_rush: { fill: '#ffcd75', line: '#ef7d57', text: '#b13e53' },
  strike: { fill: '#566c86', line: '#333c57', text: '#333c57' },
  rogue: { fill: '#b13e53', line: '#5d275d', text: '#b13e53' }, // Raid (Docs/13 §6)
};
const EVENT_ICON: Record<CityEventView['kind'], string> = { flash_crash: '▼', hype: '▲', gold_rush: '★', strike: '✋', rogue: '⚠' };

function circle(c: LatLng, r: number): Feature {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push([c.lng + (r * Math.sin(a)) / (111_320 * Math.cos((c.lat * Math.PI) / 180)), c.lat + (r * Math.cos(a)) / 110_540]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}

/** Sprites des marcheurs : variante × sens × frame. */
export function registerWalkerImages(map: MLMap): void {
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  WALKER_VARIANTS.forEach((_, v) => {
    for (const dir of ['r', 'l'] as const) {
      const def = walkerSprite(v, dir);
      for (const f of [0, 1]) map.addImage(`walker-${v}-${dir}-${f}`, spriteImageData(def, 2 * dpr, f, { top: 0, bottom: 2 }, true), { pixelRatio: dpr });
    }
  });
}

/** Couches (à appeler une fois au `load`, avant les nœuds pour que les marcheurs passent dessous). */
export function addLivingLayers(map: MLMap, before?: string): void {
  map.addSource('event-zone', { type: 'geojson', data: fc([]) });
  map.addSource('event-label', { type: 'geojson', data: fc([]) });
  map.addSource('walkers', { type: 'geojson', data: fc([]) });
  map.addLayer({ id: 'event-fill', type: 'fill', source: 'event-zone', paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.16 } }, before);
  map.addLayer({ id: 'event-line', type: 'line', source: 'event-zone',
    paint: { 'line-color': ['get', 'line'], 'line-width': 3, 'line-dasharray': [3, 2], 'line-opacity': 0.85 } }, before);
  map.addLayer({ id: 'walkers', type: 'symbol', source: 'walkers', minzoom: 13.5, layout: {
    'icon-image': ['get', 'icon'], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport',
    'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 16, 1, 18, 1.15],
    'icon-offset': ['case', ['==', ['get', 'idle'], 1], ['literal', [24, 2]], ['literal', [0, 0]]],
  } });
  map.addLayer({ id: 'event-label', type: 'symbol', source: 'event-label', minzoom: 12, layout: {
    'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-allow-overlap': false, 'text-max-width': 12,
  }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#fffdf6', 'text-halo-width': 2.5 } });
}

export interface Living {
  /** tap sur un marcheur : étiquette 4 s */
  showTag: (walkerId: string) => void;
  syncEvent: () => void;
  stop: () => void;
}

const TAG_MS = 4500;

export function attachLiving(map: MLMap, onNode: (n: NodeView) => void): Living {
  let frame = 0;
  let tag: { id: string; marker: Marker; until: number } | null = null;
  const bubbles = new Map<string, { marker: Marker; text: string }>();

  const walkerPos = (w: WalkerView, now: number) => legPosition(w, now);

  // ── marcheurs ──
  const tickWalkers = () => {
    const st = useGame.getState();
    const src = map.getSource('walkers') as GeoJSONSource | undefined;
    if (!src) return;
    frame++;
    const now = Date.now() + st.skewMs;
    const list = st.showRunners ? st.walkers : [];
    src.setData(fc(list.map((w) => {
      const p = walkerPos(w, now);
      const dir = p.heading > 0 && p.heading < 180 ? 'r' : 'l';
      // en marche : les jambes alternent ; à l'arrêt : debout (frame 1)
      // à l'arrêt (devant une échoppe, un relais) : un pas de côté pour ne pas disparaître derrière le sprite du lieu
      return pt(p, { id: w.id, idle: p.moving ? 0 : 1, icon: `walker-${w.variant % WALKER_VARIANTS.length}-${dir}-${p.moving ? frame % 2 : 1}` });
    })));
    if (tag) {
      const w = list.find((x) => x.id === tag!.id);
      if (!w || Date.now() > tag.until) hideTag();
      else { const p = walkerPos(w, now); tag.marker.setLngLat([p.lng, p.lat]); }
    }
  };

  const hideTag = () => {
    if (!tag) return;
    const el = tag.marker.getElement().firstElementChild as HTMLElement | null;
    const m = tag.marker;
    tag = null;
    el?.classList.add(s.out!);
    window.setTimeout(() => m.remove(), 220);
  };

  const showTag = (id: string) => {
    const st = useGame.getState();
    const w = st.walkers.find((x) => x.id === id);
    if (!w) return;
    hideTag();
    const el = document.createElement('div');
    const inner = document.createElement('div');
    inner.className = s.tag!;
    inner.dataset.testid = 'walker-tag';
    const name = document.createElement('b');
    name.textContent = w.name ?? 'Another player';
    const note = document.createElement('span');
    note.textContent = w.kind === 'player' ? 'real player · rough area only' : (w.note ?? 'out for a walk');
    inner.append(name, note);
    el.appendChild(inner);
    const p = walkerPos(w, Date.now() + st.skewMs);
    tag = { id, marker: new Marker({ element: el, anchor: 'bottom', offset: [0, -34] }).setLngLat([p.lng, p.lat]).addTo(map), until: Date.now() + TAG_MS };
    play('pop');
  };

  // ── bulles des marchands ──
  const BW = 168; // largeur max d'une bulle (px), pour éviter les chevauchements
  const BH = 46;
  const tickBubbles = () => {
    const st = useGame.getState();
    const pos = st.pos;
    const nodes = st.world?.nodes ?? [];
    let picked: BubbleCandidate[] = [];
    if (pos && !st.overlay) {
      const cands: BubbleCandidate[] = nodes.filter((n) => n.merchant?.bubble).map((n) => ({ id: n.id, lat: n.lat, lng: n.lng, bubble: n.merchant!.bubble! }));
      picked = pickBubbles(cands, pos, Date.now());
    }
    // en écran : pas de chevauchement, pas hors champ, pas sous le HUD, pas sur l'avatar
    const rect = map.getContainer().getBoundingClientRect();
    const w = rect.width;
    const topHud = document.querySelector('[data-hud="top"]')?.getBoundingClientRect();
    const bottomHud = document.querySelector('[data-hud="bottom"]')?.getBoundingClientRect();
    const minY = (topHud ? topHud.bottom - rect.top : 150) + 6;
    const maxY = (bottomHud ? bottomHud.top - rect.top : rect.height - 150) - 6;
    const me = pos ? map.project([pos.lng, pos.lat]) : null;
    const kept: { x: number; y: number }[] = [];
    const show = picked.filter((c) => {
      const p = map.project([c.lng, c.lat]);
      const box = { x: p.x, y: p.y - 40 - BH / 2 };
      if (box.x < BW / 2 - 20 || box.x > w - BW / 2 + 20 || box.y - BH / 2 < minY || p.y > maxY) return false;
      if (me && Math.abs(me.x - box.x) < BW * 0.45 && Math.abs(me.y - 30 - box.y) < BH) return false;
      if (kept.some((k) => Math.abs(k.x - box.x) < BW && Math.abs(k.y - box.y) < BH + 6)) return false;
      kept.push(box);
      return true;
    });
    const ids = new Set(show.map((c) => c.id));
    for (const [id, b] of bubbles) {
      if (ids.has(id)) continue;
      bubbles.delete(id);
      (b.marker.getElement().firstElementChild as HTMLElement | null)?.classList.add(s.out!);
      window.setTimeout(() => b.marker.remove(), 220);
    }
    for (const c of show) {
      const cur = bubbles.get(c.id);
      if (cur && cur.text === c.bubble.text) continue;
      cur?.marker.remove();
      const el = document.createElement('div');
      const inner = document.createElement('button');
      inner.type = 'button';
      inner.className = `${s.bubble} ${s[c.bubble.tone] ?? ''}`;
      inner.dataset.testid = 'merchant-bubble';
      inner.dataset.tone = c.bubble.tone;
      inner.textContent = c.bubble.text;
      inner.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const n = useGame.getState().world?.nodes.find((x) => x.id === c.id);
        if (n) onNode(n);
      });
      el.appendChild(inner);
      // décalage d'apparition : les bulles ne poppent pas toutes en même temps
      inner.style.animationDelay = `${bubbles.size * 120}ms`;
      bubbles.set(c.id, { marker: new Marker({ element: el, anchor: 'bottom', offset: [0, -40] }).setLngLat([c.lng, c.lat]).addTo(map), text: c.bubble.text });
    }
  };

  // ── événement de ville ──
  let lastEvent = '';
  const syncEvent = () => {
    const e = useGame.getState().world?.event ?? null;
    const live = e && e.endsAt > Date.now() + useGame.getState().skewMs ? e : null;
    // dans la zone, la bannière suffit : l'étiquette ne sert qu'à repérer la zone de loin
    const pos = useGame.getState().pos;
    const inside = !!(live && pos && haversineM(pos, live) <= live.radiusM);
    const key = live ? `${live.id}:${live.endsAt}:${inside}` : '';
    if (key === lastEvent) return;
    lastEvent = key;
    const zone = map.getSource('event-zone') as GeoJSONSource | undefined;
    const label = map.getSource('event-label') as GeoJSONSource | undefined;
    if (!zone || !label) return;
    if (!live) { zone.setData(fc([])); label.setData(fc([])); return; }
    const c = EVENT_COLORS[live.kind];
    const z = circle(live, live.radiusM);
    z.properties = { fill: c.fill, line: c.line };
    zone.setData(fc([z]));
    // étiquette au bord nord de la zone : lisible quand on regarde la zone de loin, jamais sur l'avatar
    label.setData(inside || live.kind === 'rogue' ? fc([]) : fc([pt({ lat: live.lat + (live.radiusM * 0.92) / 110_540, lng: live.lng }, { label: `${EVENT_ICON[live.kind]} ${live.title.split(' at ')[0]!.split(' near ')[0]!.toUpperCase()}\n${live.effect}`, color: c.text })]));
  };

  let pulse = 0;
  const pulseZone = () => {
    if (!lastEvent || !map.getLayer('event-fill')) return;
    pulse++;
    map.setPaintProperty('event-fill', 'fill-opacity', 0.12 + 0.07 * Math.abs(Math.sin(pulse / 3)));
  };

  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const t1 = window.setInterval(tickWalkers, 220);
  const t2 = window.setInterval(tickBubbles, 1000);
  const t3 = window.setInterval(() => { syncEvent(); if (!reduced()) pulseZone(); }, 500);
  map.on('moveend', tickBubbles);
  tickWalkers();
  syncEvent();
  window.setTimeout(tickBubbles, 600);
  return {
    showTag, syncEvent,
    stop: () => {
      clearInterval(t1); clearInterval(t2); clearInterval(t3);
      map.off('moveend', tickBubbles);
      for (const b of bubbles.values()) b.marker.remove();
      tag?.marker.remove();
    },
  };
}

