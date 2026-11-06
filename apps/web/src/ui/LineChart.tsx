// Graphique en lignes SVG fait main (léger, aux couleurs de la DA) : séries, axe Y min/max, axe X en jours, curseur.
import { useEffect, useId, useRef, useState } from 'react';

export interface Series { label: string; color: string; values: number[]; dashed?: boolean; area?: boolean }

export function LineChart({ series, height = 150, xLabel, format = (n) => n.toFixed(0), cursor, xMax, testId }: {
  series: Series[]; height?: number; xLabel?: (i: number, n: number) => string; format?: (n: number) => string;
  /** index courant (lecture animée) */ cursor?: number; xMax?: number; testId?: string;
}) {
  const id = useId();
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(320);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { if (e) setW(Math.max(200, Math.round(e.contentRect.width))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); const H = height; const L = 44; const R = 8; const T = 8; const B = 20;
  const n = Math.max(2, xMax ?? Math.max(...series.map((s) => s.values.length)));
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  let lo = all.length ? Math.min(...all) : 0;
  let hi = all.length ? Math.max(...all) : 1;
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; hi += pad; lo = Math.max(lo - pad, Math.min(0, lo));
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <figure ref={box} style={{ margin: 0 }} data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-labelledby={id} style={{ display: 'block', overflow: 'visible' }}>
        <title id={id}>{series.map((s) => s.label).join(', ')}</title>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#d9cfb4" strokeWidth={1} strokeDasharray={i === 0 ? undefined : '3 3'} />
            <text x={L - 4} y={y(t) + 4} textAnchor="end" fontSize={10} fontWeight={800} fill="var(--slate)">{format(t)}</text>
          </g>
        ))}
        {xLabel ? [0, Math.floor((n - 1) / 2), n - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={10} fontWeight={800} fill="var(--slate)">{xLabel(i, n)}</text>
        )) : null}
        {series.map((s) => {
          const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
          if (pts.length < 2) return null;
          return (
            <g key={s.label}>
              {s.area ? <path d={`M${x(0)},${y(lo)} L${pts.join(' L')} L${x(s.values.length - 1)},${y(lo)} Z`} fill={s.color} opacity={0.18} /> : null}
              <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
            </g>
          );
        })}
        {cursor !== undefined ? <line x1={x(cursor)} x2={x(cursor)} y1={T} y2={H - B} stroke="var(--ink)" strokeWidth={1.5} /> : null}
      </svg>
      <figcaption style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, fontWeight: 800, marginTop: 4 }}>
        {series.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <i style={{ width: 12, height: 4, background: s.color, display: 'inline-block', border: '1px solid var(--ink)' }} />{s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
