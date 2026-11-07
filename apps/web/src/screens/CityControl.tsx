// « Who holds the city » (Docs/13 §8) : Forges-Arènes tenues par un Champion (couronne à la couleur de son district,
// depuis combien de temps), celles gardées par une Sentinelle (tuiles compactes), + Top Champions (temps de détention
// cumulé sur 7 jours). Utilisé par la feuille Quests et /pulse.
import { useEffect, useState } from 'react';
import type { CityArenaView, CityControlResponse } from '@tokengo/shared';
import { api } from '../lib/api.ts';
import { arrLabel, crownDef, districtColor, inkOn } from '../lib/districts.ts';
import { fmtSpan } from '../lib/format.ts';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHIELD } from '../sprites/arena.grids.ts';
import s from './CityControl.module.css';

const MEDAL = ['🥇', '🥈', '🥉', '4', '5'];

export function DistrictChip({ d }: { d: number | null }) {
  const c = districtColor(d);
  if (!c || !d) return null;
  return <span className={s.chip} style={{ background: c, color: inkOn(c) }}>{arrLabel(d)}</span>;
}

export function CityControl({ onOpen }: { onOpen?: (forgeId: string) => void }) {
  const [v, setV] = useState<CityControlResponse | null>(null);
  useEffect(() => {
    const load = () => api.cityControl().then(setV).catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  if (!v) return <div className={s.skeleton} aria-busy />;
  const champs = v.arenas.filter((a) => a.holder === 'champion');
  const guarded = v.arenas.filter((a) => a.holder === 'guardian');
  const tap = (a: CityArenaView) => (onOpen ? { onClick: () => onOpen(a.forgeId), role: 'button', tabIndex: 0 } : {});
  return (
    <section className={s.wrap} data-testid="city-control">
      <div className={s.head}>
        <h3 className={s.h3}>Who holds the city</h3>
        <span className={s.score}><b className="num">{champs.length}</b>/{v.arenas.length} arenas held by runners</span>
      </div>
      {champs.length ? (
        <ul className={s.list}>
          {champs.map((a) => (
            <li key={a.forgeId} data-testid={`city-${a.forgeId}`} data-holder="champion" title={`${a.name} holds ${a.forgeName}`}
              className={`${s.row} ${a.mine ? s.mine : ''} ${onOpen ? s.tap : ''}`} {...tap(a)}>
              <span className={s.badge}><Sprite def={crownDef(a.district)} scale={2} anim /></span>
              <span className={s.forge}>{a.forgeName}</span>
              <span className={s.holder}><span className={s.name}>{a.mine ? 'You!' : a.name}</span><DistrictChip d={a.district} /></span>
              <span className={s.since}><small>held</small>{fmtSpan(v.now - (a.since ?? v.now))}</span>
            </li>
          ))}
        </ul>
      ) : <p className={s.empty}>Every arena is guarded by its Sentinel — beat one to put your district on the map.</p>}
      {guarded.length ? <>
        <div className={s.sub}>Guarded by Sentinels</div>
        <ul className={s.tiles}>
          {guarded.map((a) => (
            <li key={a.forgeId} data-testid={`city-${a.forgeId}`} data-holder="guardian" title={a.name}
              className={`${s.tile} ${onOpen ? s.tap : ''}`} {...tap(a)}>
              <Sprite def={SHIELD} scale={1} />
              <span className={s.tileName}>{a.forgeName}</span>
            </li>
          ))}
        </ul>
      </> : null}
      <h4 className={s.h4}>Top Champions · {v.windowDays} days</h4>
      {v.top.length === 0 ? (
        <p className={s.empty}>No Champion yet this week — the first crown is up for grabs.</p>
      ) : (
        <ol className={s.top} data-testid="top-champions">
          {v.top.map((t, i) => (
            <li key={t.handle} className={t.mine ? s.mine : ''}>
              <span className={s.rank}>{MEDAL[i]}</span>
              <span className={s.name}>{t.handle}</span>
              <DistrictChip d={t.district} />
              {t.arenas > 0 ? <span className={s.crowns}><Sprite def={crownDef(t.district)} scale={1} />×{t.arenas}</span> : null}
              <b className={`${s.held} num`}>{fmtSpan(t.heldMs)}</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
