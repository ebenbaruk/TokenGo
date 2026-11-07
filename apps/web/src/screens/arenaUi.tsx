// Petits composants partagés de l'Arène (Docs/13) : icônes de catégorie, barres de stats, barre de maîtrise.
import type { CSSProperties } from 'react';
import { Calculator, Code, Eye, Languages, PenLine, Zap, type LucideIcon } from 'lucide-react';
import { CATEGORIES, CATEGORY_INFO, MODEL_STATS, type Category, type Family, type MasteryProgress } from '@tokengo/shared';
import s from './arenaUi.module.css';

export const CAT_ICON: Record<Category, LucideIcon> = { math: Calculator, code: Code, writing: PenLine, vision: Eye, speed: Zap, lang: Languages };
/** Couleur d'aplat par catégorie (Sweetie 16). */
export const CAT_COLOR: Record<Category, string> = {
  math: 'var(--sky)', code: 'var(--lime)', writing: 'var(--sun)', vision: 'var(--cyan)', speed: 'var(--orange)', lang: '#ffc6d9',
};

export function CatIcon({ cat, size = 16 }: { cat: Category; size?: number }) {
  const I = CAT_ICON[cat];
  return <I size={size} strokeWidth={2.8} aria-label={CATEGORY_INFO[cat].name} />;
}

/** 6 mini-barres verticales (stat 1–10), la catégorie `hot` mise en avant. */
export function StatBars({ family, hot }: { family: Family; hot?: Category | null }) {
  return (
    <div className={s.stats} aria-label="Game stats">
      {CATEGORIES.map((c) => {
        const v = MODEL_STATS[family][c];
        return (
          <span key={c} className={`${s.stat} ${hot === c ? s.hot : ''}`} title={`${CATEGORY_INFO[c].name} ${v}`}>
            <span className={s.col}><i style={{ height: `${v * 10}%`, background: CAT_COLOR[c] } as CSSProperties} /></span>
            <CatIcon cat={c} size={11} />
            <b className="num">{v}</b>
          </span>
        );
      })}
    </div>
  );
}

export function MasteryBar({ m, testId, dark }: { m: MasteryProgress; testId?: string; dark?: boolean }) {
  const pct = m.need > 0 ? Math.min(100, (m.into / m.need) * 100) : 100;
  return (
    <span className={`${s.mastery} ${dark ? s.dark : ''}`} data-testid={testId} data-level={m.level} data-xp={m.xp}>
      <b>M{m.level}</b>
      <span className={s.mBar}><i style={{ width: `${pct}%` }} /></span>
      <small className="num">{m.next === null ? 'max' : `${m.into}/${m.need}`}</small>
    </span>
  );
}
