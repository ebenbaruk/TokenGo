// Récit d'un scénario de l'Economy Lab : compare le run du scénario au run baseline (même graine, mêmes bots)
// pour isoler son effet. Tous les chiffres viennent des deux SimResult — rien n'est écrit en dur.
import { FAMILY_INFO, NUSD_PER_USD, type Family } from '@tokengo/shared';
import type { SimResult, SeriesPoint } from '@tokengo/shared/economy/sim.ts';
import type { Band, Marker, Series } from '../ui/LineChart.tsx';

export interface Story {
  headline: string;
  title: string;
  series: Series[];
  gap: [number, number];
  marker?: Marker;
  format: (n: number) => string;
  bands: Band[];
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}\u00a0%`;
const usd = (n: number) => `$${(n / NUSD_PER_USD).toFixed(2)}`;
const SOLID = '#b13e53';
const DASH = '#566c86';

/** Bandes verticales des périodes de flood (index = heure de série). */
export function floodBands(res: SimResult): Band[] {
  const start = res.events.find((e) => e.kind === 'flood-start');
  if (!start) return [];
  const end = res.events.find((e) => e.kind === 'flood-end');
  const idx = (h: number) => Math.max(0, res.series.findIndex((p) => p.hour >= h));
  const last = res.series.length - 1;
  return [{ from: idx(start.hour), to: end ? idx(end.hour) || last : last, label: 'flood' }];
}

/** Marchands distincts passés en « closing » au moins une fois. */
const struggling = (r: SimResult) => new Set(r.events.filter((e) => e.kind === 'closing' && e.merchantId).map((e) => e.merchantId)).size;

function priceStory(res: SimResult, base: SimResult, f: Family, from: number, to: number, mode: 'min' | 'max') {
  const s = res.series; const b = base.series;
  const n = Math.min(s.length, b.length);
  let best = { i: from, r: 1 };
  for (let i = from; i <= Math.min(to, n - 1); i++) {
    const r = s[i]!.avgMid[f] / (b[i]!.avgMid[f] || 1);
    if (mode === 'min' ? r < best.r : r > best.r) best = { i, r };
  }
  return best;
}

export function makeStory(res: SimResult, base: SimResult): Story | null {
  const n = Math.min(res.series.length, base.series.length);
  const S = res.series.slice(0, n); const B = base.series.slice(0, n);
  const prices = (pts: SeriesPoint[], f: Family) => pts.map((p) => p.avgMid[f]);

  if (res.scenario === 'flood-deepseek') {
    const f: Family = 'deepseek';
    const bands = floodBands(res);
    const w = bands[0] ?? { from: 0, to: n - 1 };
    const peak = priceStory(res, base, f, w.from, w.to, 'min');
    const drop = 1 - peak.r;
    const extra = struggling(res) - struggling(base);
    const name = FAMILY_INFO[f].name;
    return {
      title: `${name} price: with flood vs. without`,
      headline: drop > 0.01
        ? `The flood cut ${name} prices by ${pct(drop)}${extra > 0 ? ` and pushed ${extra} more merchant${extra > 1 ? 's' : ''} into trouble.` : ', yet merchants held up.'}`
        : `The flood barely moved ${name} prices — merchants absorbed it.`,
      series: [
        { label: 'with flood', color: SOLID, values: prices(S, f) },
        { label: 'without (baseline)', color: DASH, values: prices(B, f), dashed: true },
      ],
      gap: [0, 1],
      marker: drop > 0.01 ? { i: peak.i, value: S[peak.i]!.avgMid[f], label: `−${pct(drop)} at peak` } : undefined,
      format: (v) => `${v.toFixed(1)} ƒ`,
      bands,
    };
  }

  if (res.scenario === 'reserve-refill') {
    const last = n - 1;
    const more = S[last]!.payoutsCum - B[last]!.payoutsCum;
    const rel = B[last]!.payoutsCum > 0 ? more / B[last]!.payoutsCum : 0;
    const refill = res.events.find((e) => e.kind === 'reserve-refill');
    const at = refill ? Math.max(0, S.findIndex((p) => p.hour >= refill.hour)) : 0;
    return {
      title: 'Real credits paid: with refill vs. without',
      headline: `The refill let the city pay ${usd(Math.max(0, more))} more in real credits${rel > 0 ? ` (+${pct(rel)})` : ''} and kept the reserve at ${pct(S[last]!.reserveHealth)} health instead of ${pct(B[last]!.reserveHealth)}.`,
      series: [
        { label: 'with refill', color: SOLID, values: S.map((p) => p.payoutsCum / NUSD_PER_USD) },
        { label: 'without (baseline)', color: DASH, values: B.map((p) => p.payoutsCum / NUSD_PER_USD), dashed: true },
      ],
      gap: [0, 1],
      marker: more > 0 ? { i: last, value: S[last]!.payoutsCum / NUSD_PER_USD, label: `+${usd(more)}` } : undefined,
      format: (v) => `$${v.toFixed(2)}`,
      bands: refill ? [{ from: at, to: Math.min(last, at + 2), label: 'refill', color: 'var(--lime)' }] : [],
    };
  }

  if (res.scenario === 'everyone-aura') {
    const c = priceStory(res, base, 'claude', 0, n - 1, 'max');
    const g = priceStory(res, base, 'gpt', 0, n - 1, 'max');
    const last = n - 1;
    return {
      title: 'Claude price: everyone forging vs. a normal week',
      headline: `With everyone forging, Claude rose ${pct(c.r - 1)} and GPT ${pct(g.r - 1)} above a normal week; real payouts reached ${usd(S[last]!.payoutsCum)} vs ${usd(B[last]!.payoutsCum)}.`,
      series: [
        { label: 'Claude · everyone forges', color: SOLID, values: prices(S, 'claude') },
        { label: 'Claude · baseline', color: DASH, values: prices(B, 'claude'), dashed: true },
        { label: 'GPT · everyone forges', color: '#38b764', values: prices(S, 'gpt') },
        { label: 'GPT · baseline', color: '#94b0c2', values: prices(B, 'gpt'), dashed: true },
      ],
      gap: [0, 1],
      marker: c.r > 1.01 ? { i: c.i, value: S[c.i]!.avgMid.claude, label: `+${pct(c.r - 1)} at peak` } : undefined,
      format: (v) => `${v.toFixed(0)} ƒ`,
      bands: [],
    };
  }
  return null;
}
