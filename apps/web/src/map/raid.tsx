// Raid « Rogue Model » (Docs/13 §6) sur la carte : marqueur DOM animé (boss qui grésille, barre de PV en direct, chiffres de
// dégâts de la ville) au-dessus de la Forge attaquée. Un seul marqueur, monté avec React (re-render seulement quand les PV bougent).
import { Marker, type Map as MLMap } from 'maplibre-gl';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeView } from '@tokengo/shared';
import { useGame } from '../lib/store.ts';
import { raidOf, useLiveRaid, useRaid } from '../lib/raid.ts';
import { BossArt, BossHpBar, FlyingHits } from '../screens/raidUi.tsx';
import s from './raid.module.css';

function RaidMarker({ onTap }: { onTap: () => void }) {
  const r = useLiveRaid();
  const hits = useRaid((st) => st.hits);
  if (!r || r.status !== 'active') return null;
  return (
    <button type="button" className={s.marker} data-testid="raid-marker" data-hp={r.hp} onClick={(e) => { e.stopPropagation(); onTap(); }}
      aria-label={`${r.boss}: ${r.hp} HP left. Open the raid`}>
      <span className={s.name}>{r.boss}</span>
      <BossArt bossId={r.bossId} scale={2} />
      <span className={s.bar}><BossHpBar hp={r.hp} max={r.maxHp} size="s" /></span>
      <FlyingHits hits={hits} />
    </button>
  );
}

/** Attache le marqueur ; il suit l'événement de ville courant (apparaît / disparaît tout seul). */
export function attachRaidMarker(map: MLMap, onNode: (n: NodeView) => void): () => void {
  let marker: Marker | null = null;
  let root: Root | null = null;
  let at = '';
  const sync = () => {
    const st = useGame.getState();
    const r = raidOf(st.world?.event);
    const live = r && r.status === 'active' && (st.world?.event?.endsAt ?? 0) > Date.now() + st.skewMs ? r : null;
    const key = live ? `${live.eventId}:${live.forgeId}` : '';
    if (key === at) return;
    at = key;
    marker?.remove(); marker = null;
    root?.unmount(); root = null;
    if (!live) return;
    const e = st.world!.event!;
    const el = document.createElement('div');
    el.className = s.host ?? '';
    root = createRoot(el);
    root.render(<RaidMarker onTap={() => {
      const node = useGame.getState().world?.nodes.find((n) => n.id === live.forgeId);
      if (node) onNode(node);
    }} />);
    // à droite de la Forge : ni sur son icône, ni caché sous le HUD
    marker = new Marker({ element: el, anchor: 'left', offset: [30, 6] }).setLngLat([e.lng, e.lat]).addTo(map);
  };
  const unsub = useGame.subscribe((st, prev) => { if (st.world?.event !== prev.world?.event) sync(); });
  const t = window.setInterval(sync, 2000); // fin par expiration
  sync();
  return () => { unsub(); clearInterval(t); marker?.remove(); const r = root; root = null; if (r) setTimeout(() => r.unmount(), 0); };
}
