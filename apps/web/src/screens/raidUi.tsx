// Petits composants du Raid « Rogue Model » (Docs/13 §6) : barre de PV du boss (avec traînée jaune des dégâts récents),
// faiblesse / résistance, portrait glitché du boss, chiffres de dégâts qui volent.
import type { CSSProperties } from 'react';
import { CATEGORY_INFO, type Category } from '@tokengo/shared';
import { Sprite } from '../sprites/Sprite.tsx';
import { bossSprite } from '../sprites/raid.grids.ts';
import type { RaidHit } from '../lib/raid.ts';
import { CatIcon } from './arenaUi.tsx';
import s from './raidUi.module.css';

/** 3120 → « 3 120 » (espace fine insécable, comme sur la maquette). */
export const fmtHp = (n: number): string => Math.max(0, Math.round(n)).toLocaleString('en-US').replace(/,/g, ' ');

export function BossHpBar({ hp, max, size = 'm', testId }: { hp: number; max: number; size?: 's' | 'm' | 'l'; testId?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
  return (
    <span className={`${s.hp} ${s[`hp_${size}`]} ${pct <= 25 ? s.low : ''}`} data-testid={testId} data-hp={hp} data-max={max}
      role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={hp} aria-label={`${fmtHp(hp)} of ${fmtHp(max)} HP`}>
      <i className={s.lag} style={{ width: `${pct}%` }} />
      <i className={s.fill} style={{ width: `${pct}%` }} />
      <b className={`${s.hpText} num`}>{fmtHp(hp)} / {fmtHp(max)} HP</b>
    </span>
  );
}

export function WeakTag({ cat, kind, big }: { cat: Category; kind: 'weak' | 'resist'; big?: boolean }) {
  return (
    <span className={`${s.tag} ${kind === 'weak' ? s.weak : s.resist} ${big ? s.tagBig : ''}`} data-testid={`raid-${kind}`} data-category={cat}>
      <CatIcon cat={cat} size={big ? 18 : 13} />
      <span>{kind === 'weak' ? 'Weak to' : 'Resists'} <b>{CATEGORY_INFO[cat].name}</b></span>
      <small>{kind === 'weak' ? '×1.5' : '×0.6'}</small>
    </span>
  );
}

/** Portrait du boss : sprite qui grésille + aura rouge/cyan. */
export function BossArt({ bossId, scale = 4, className, style }: { bossId: string; scale?: number; className?: string; style?: CSSProperties }) {
  return (
    <span className={`${s.art} ${className ?? ''}`} style={style}>
      <span className={s.aura} />
      <Sprite def={bossSprite(bossId)} scale={scale} anim className={s.glitchy} />
    </span>
  );
}

/** Chiffres de dégâts qui s'envolent (les miens en gros, ceux de la ville plus petits avec le pseudo). */
export function FlyingHits({ hits }: { hits: RaidHit[] }) {
  return (
    <span className={s.flyLayer} aria-hidden>
      {hits.map((h, i) => (
        <span key={h.id} className={`${s.fly} ${h.mine ? s.flyMine : ''}`} style={{ '--x': `${((h.id * 37) % 70) - 35}px`, '--d': `${i * 40}ms` } as CSSProperties}>
          −{h.damage}{h.mine ? null : <small>{h.by}</small>}
        </span>
      ))}
    </span>
  );
}
