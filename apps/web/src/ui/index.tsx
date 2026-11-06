// Design system « chunky » (Docs/09 §2 et §5).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as RPointerEvent } from 'react';
import clsx from 'clsx';
import { Minus, Plus, X, ChevronsRight } from 'lucide-react';
import type { Family } from '@tokengo/shared';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS } from '../sprites/index.ts';
import { play, buzz } from '../lib/sound.ts';
import s from './ui.module.css';

export { s as uiStyles };

// ───────── Button ─────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger' | 'dark';
interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: 's' | 'm' | 'l';
  disabled?: boolean;
  /** raison affichée sous le bouton quand il est désactivé (règle « toujours dire pourquoi ») */
  reason?: string | null;
  loading?: boolean;
  block?: boolean;
  className?: string;
  style?: CSSProperties;
  testId?: string;
  ariaLabel?: string;
}
export function Button({ children, onClick, variant = 'secondary', size = 'm', disabled, reason, loading, block, className, style, testId, ariaLabel }: ButtonProps) {
  const isDisabled = disabled || loading || Boolean(reason);
  return (
    <span className={clsx(s.btnWrap, block && s.block)}>
      <button type="button" data-testid={testId} aria-label={ariaLabel}
        className={clsx(s.btn, s[variant], size === 's' && s.sizeS, size === 'l' && s.sizeL, className)} style={style}
        disabled={isDisabled}
        onPointerDown={() => { if (!isDisabled) play('tap'); }}
        onClick={() => { if (!isDisabled) onClick?.(); }}>
        {loading ? <span className={s.spinner} aria-hidden /> : null}
        {children}
      </button>
      {reason ? <span className={s.reason} data-testid={testId ? `${testId}-reason` : undefined}>{reason}</span> : null}
    </span>
  );
}

export function IconButton({ children, label, onClick, testId, showLabel = false }: { children: ReactNode; label: string; onClick?: () => void; testId?: string; showLabel?: boolean }) {
  return (
    <button type="button" className={s.iconBtn} aria-label={label} data-testid={testId} onClick={() => { play('tap'); onClick?.(); }}
      style={showLabel ? { flexDirection: 'column', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 58, width: 60 } : undefined}>
      {children}
      {showLabel ? <span className={s.iconLabel}>{label}</span> : null}
    </button>
  );
}

// ───────── Pill ─────────
export function Pill({ children, onClick, style, className, testId }: { children: ReactNode; onClick?: () => void; style?: CSSProperties; className?: string; testId?: string }) {
  if (onClick) return <button type="button" className={clsx(s.pill, className)} style={style} onClick={onClick} data-testid={testId}>{children}</button>;
  return <span className={clsx(s.pill, className)} style={style} data-testid={testId}>{children}</span>;
}

// ───────── Counter (nombre qui roule + delta flottant) ─────────
export function Counter({ value, format = (n) => n.toLocaleString('en-US'), duration = 450, showDelta = true, deltaFormat, testId, className }: {
  value: number; format?: (n: number) => string; duration?: number; showDelta?: boolean; deltaFormat?: (d: number) => string; testId?: string; className?: string;
}) {
  const [shown, setShown] = useState(value);
  const [deltas, setDeltas] = useState<{ id: number; d: number }[]>([]);
  const [bump, setBump] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (showDelta) {
      const id = Date.now() + Math.random();
      setDeltas((ds) => [...ds.slice(-1), { id, d: value - from }]);
      setTimeout(() => setDeltas((ds) => ds.filter((x) => x.id !== id)), 1150);
    }
    setBump((b) => b + 1);
    if (reduce) { setShown(value); return; }
    const t0 = performance.now();
    let raf = 0;
    const steps = 8; // défilement saccadé façon pixel (--step)
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const q = Math.ceil(k * steps) / steps;
      setShown(from + (value - from) * q);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, showDelta]);
  const df = deltaFormat ?? ((d: number) => `${d > 0 ? '+' : ''}${format(d)}`);
  return (
    <span className={clsx(s.counter, className)} data-testid={testId} data-value={value}>
      <span key={bump} className={bump ? s.bump : undefined} style={{ display: 'inline-block' }}>{format(Math.round(shown * 1e6) / 1e6)}</span>
      {deltas.map((x) => <span key={x.id} className={clsx(s.delta, x.d < 0 && s.neg)}>{df(x.d)}</span>)}
    </span>
  );
}

// ───────── Sheet (feuille basse) ─────────
export function Sheet({ open, onClose, title, subtitle, icon, children, full, tabs, testId }: {
  open: boolean; onClose: () => void; title?: ReactNode; subtitle?: ReactNode; icon?: ReactNode; children: ReactNode; full?: boolean; tabs?: ReactNode; testId?: string;
}) {
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  if (!open) return null;
  const down = (e: RPointerEvent) => { start.current = e.clientY; (e.target as Element).setPointerCapture(e.pointerId); };
  const move = (e: RPointerEvent) => { if (start.current !== null) setDy(Math.max(0, e.clientY - start.current)); };
  const up = () => { if (dy > 110) onClose(); start.current = null; setDy(0); };
  return (
    <>
      <div className={s.backdrop} onClick={onClose} />
      <section className={clsx(s.sheet, full && s.full)} role="dialog" aria-modal="true" data-testid={testId}
        style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}>
        <div className={s.handleRow} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}><div className={s.handle} /></div>
        {title !== undefined ? (
          <header className={s.sheetHead}>
            {icon}
            <div className={s.sheetTitle}>
              <h2>{title}</h2>
              {subtitle ? <div className="dim" style={{ fontSize: 14, fontWeight: 700 }}>{subtitle}</div> : null}
            </div>
            <button type="button" className={s.closeBtn} aria-label="Close" onClick={onClose} data-testid="sheet-close"><X size={22} strokeWidth={3} /></button>
          </header>
        ) : null}
        {tabs}
        <div className={s.sheetBody}>{children}</div>
      </section>
    </>
  );
}

// ───────── Tabs ─────────
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; dot?: boolean; hidden?: boolean }[] }) {
  return (
    <div className={s.tabs} role="tablist">
      {items.filter((i) => !i.hidden).map((i) => (
        <button key={i.id} type="button" role="tab" aria-selected={value === i.id} className={s.tab} data-testid={`tab-${i.id}`}
          onClick={() => { play('tap'); onChange(i.id); }}>
          {i.label}{i.dot ? <span className={s.tabDot} /> : null}
        </button>
      ))}
    </div>
  );
}

// ───────── Stepper ─────────
export function Stepper({ value, min = 1, max, onChange }: { value: number; min?: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className={s.stepper} data-testid="stepper">
      <button type="button" className={s.stepBtn} aria-label="Less" disabled={value <= min} onClick={() => { play('tap'); onChange(Math.max(min, value - 1)); }}><Minus strokeWidth={3} /></button>
      <span className={clsx(s.stepVal, 'num')} data-testid="stepper-value">{value}</span>
      <button type="button" className={s.stepBtn} aria-label="More" disabled={value >= max} onClick={() => { play('tap'); onChange(Math.min(max, value + 1)); }}><Plus strokeWidth={3} /></button>
    </div>
  );
}

// ───────── SlideToConfirm ─────────
export function SlideToConfirm({ label, onConfirm, disabled, testId }: { label: string; onConfirm: () => void; disabled?: boolean; testId?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [done, setDone] = useState(false);
  const drag = useRef<{ x0: number } | null>(null);
  const maxX = () => (track.current ? track.current.clientWidth - 60 : 200);
  useEffect(() => { if (!disabled) { setDone(false); setX(0); } }, [disabled, label]);
  const down = (e: RPointerEvent) => {
    if (disabled || done) return;
    drag.current = { x0: e.clientX - x };
    (e.target as Element).setPointerCapture(e.pointerId);
    play('tap');
  };
  const move = (e: RPointerEvent) => { if (drag.current) setX(Math.max(0, Math.min(maxX(), e.clientX - drag.current.x0))); };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    if (x >= maxX() * 0.88) { setX(maxX()); setDone(true); buzz(20); onConfirm(); }
    else setX(0);
  };
  return (
    <div ref={track} className={clsx(s.slide, disabled && s.disabled, done && s.done)} data-testid={testId}
      role="button" aria-label={label} tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if (!disabled && !done && (e.key === 'Enter' || e.key === ' ')) { setDone(true); onConfirm(); } }}>
      <div className={s.slideFill} style={{ width: x + 56 }} />
      <div className={s.slideLabel}>{label}</div>
      <div className={s.slideKnob} style={{ transform: `translateX(${x}px)`, transition: drag.current ? 'none' : 'transform .2s var(--ease-pop)' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid={testId ? `${testId}-knob` : undefined}>
        <ChevronsRight strokeWidth={3} />
      </div>
    </div>
  );
}

// ───────── HoldButton (maintenir pour confirmer) ─────────
export function HoldButton({ children, onConfirm, ms = 1000, disabled, reason, variant = 'gold', testId }: {
  children: ReactNode; onConfirm: () => void; ms?: number; disabled?: boolean; reason?: string | null; variant?: Variant; testId?: string;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const isDisabled = disabled || Boolean(reason);
  const start = () => {
    if (isDisabled) return;
    play('tap');
    setHolding(true);
    timer.current = window.setTimeout(() => { setHolding(false); buzz([20, 40, 20]); onConfirm(); }, ms);
  };
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setHolding(false); };
  return (
    <span className={clsx(s.btnWrap, s.block)}>
      <button type="button" data-testid={testId} disabled={isDisabled}
        className={clsx(s.btn, s[variant], s.sizeL, s.hold, holding && s.holding, holding && s.pressed)}
        style={{ '--hold-ms': `${ms}ms` } as CSSProperties}
        onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
        onKeyDown={(e) => { if (!isDisabled && (e.key === 'Enter' || e.key === ' ')) onConfirm(); }}
        onContextMenu={(e) => e.preventDefault()}>
        <span className={s.holdFill} />
        <span className={s.holdLabel}>{children}</span>
      </button>
      {reason ? <span className={s.reason}>{reason}</span> : null}
    </span>
  );
}

// ───────── ShardIcon ─────────
export function ShardIcon({ family, scale = 2, anim = false, glow = false }: { family: Family; scale?: number; anim?: boolean; glow?: boolean }) {
  return <Sprite def={SHARDS[family]} scale={scale} anim={anim} title={`${family} shard`}
    style={glow ? { filter: 'drop-shadow(0 0 6px rgba(255,255,255,.9))' } : undefined} />;
}

// ───────── Gauge, Sparkline ─────────
export function Gauge({ value, max, mark, color = 'var(--sky)', height = 10 }: { value: number; max: number; mark?: number; color?: string; height?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <div className={s.gauge} style={{ height }}>
      <div className={s.gaugeFill} style={{ width: `${pct}%`, background: color }} />
      {mark !== undefined && max > 0 ? <div className={s.gaugeMark} style={{ left: `${Math.min(100, (mark / max) * 100)}%` }} /> : null}
    </div>
  );
}

export function Sparkline({ points, w = 64, h = 22, color = 'var(--ink)' }: { points: number[]; w?: number; h?: number; color?: string }) {
  if (points.length < 2) return <svg width={w} height={h} aria-hidden><line x1={0} x2={w} y1={h / 2} y2={h / 2} stroke="var(--mist)" strokeWidth={2} strokeDasharray="3 3" /></svg>;
  const lo = Math.min(...points); const hi = Math.max(...points);
  const span = hi - lo || 1;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((p - lo) / span) * (h - 6)).toFixed(1)}`).join(' ');
  const up = points[points.length - 1]! >= points[0]!;
  return (
    <svg width={w} height={h} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w - 2} cy={h - 3 - ((points[points.length - 1]! - lo) / span) * (h - 6)} r={3} fill={up ? 'var(--green)' : 'var(--berry)'} stroke="var(--ink)" strokeWidth={1.5} />
    </svg>
  );
}

export function Card({ children, style, className, testId }: { children: ReactNode; style?: CSSProperties; className?: string; testId?: string }) {
  return <div className={clsx(s.card, className)} style={style} data-testid={testId}>{children}</div>;
}
