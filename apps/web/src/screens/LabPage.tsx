// Economy Lab (/lab, public) : le vrai simulateur dans un Web Worker, lecture animée sur la carte de Paris,
// graphiques, journal d'événements, contrôles de santé, et les règles expliquées. Docs/09 §4 + Docs/03 §10.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Dices, RotateCcw, Check, X as XIcon } from 'lucide-react';
import {
  FAMILIES, FAMILY_INFO, CATCH, RELAY, PRICING, MERCHANT, TIERS, FORGE, RESERVE_PARTITION, MOVE, NUSD_PER_USD, xpToNext,
} from '@tokengo/shared';
import type { Scenario, SimResult, SimEvent } from '@tokengo/shared/economy/sim.ts';
import type { LabFrame, LabMerchantInfo, LabMessage, LabRunRequest } from '../lab/sim.worker.ts';
import SimWorker from '../lab/sim.worker.ts?worker';
import { PageShell } from './PageShell.tsx';
import { api } from '../lib/api.ts';
import { Button, Card, Gauge } from '../ui/index.tsx';
import { LineChart } from '../ui/LineChart.tsx';
import { makeStory, floodBands } from '../lab/story.ts';
import { FAMILY_DARK } from '../sprites/index.ts';
import { fmtInt, fmtUsd } from '../lib/format.ts';
import type { CityPoint } from '../map/CityMap.tsx';
import s from './LabPage.module.css';

const CityMap = lazy(() => import('../map/CityMap.tsx'));

const SCEN: { id: Scenario; label: string; hint: string }[] = [
  { id: 'baseline', label: 'Baseline', hint: 'A normal week in Paris.' },
  { id: 'flood-deepseek', label: 'DeepSeek flood', hint: 'Bots dump common shards on merchants.' },
  { id: 'reserve-refill', label: 'Reserve refill', hint: 'The city reserve gets topped up mid-week.' },
  { id: 'everyone-aura', label: 'Everyone forges', hint: '60 % of players grind the big recipes.' },
];
const STATUS_COLOR = ['#38b764', '#ef7d57', '#94b0c2'];

interface Run { result: SimResult; baseline: SimResult | null; merchants: LabMerchantInfo[]; frames: LabFrame[]; ms: number; fromLive: boolean }

function eventText(e: SimEvent): string {
  const who = e.merchantName ?? 'A merchant';
  switch (e.kind) {
    case 'closing': return `${who} is struggling — closing-down sale`;
    case 'closed': return `${who} went bankrupt`;
    case 'reopened': return `${who} reopened`;
    case 'rescued': return `${who} got rescued by patrons${e.detail ? ` (${e.detail})` : ''}`;
    case 'reserve-refill': return `The city reserve was refilled${e.detail ? ` · ${e.detail}` : ''}`;
    case 'flood-start': return 'A DeepSeek flood begins';
    case 'flood-end': return 'The DeepSeek flood ends';
    default: return e.detail ?? e.kind;
  }
}
const hh = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:00`;

/** Paris en direct (marchands, prix de référence, poches de la Réserve) ; sinon Paris « neuf ». */
async function liveStart(): Promise<Pick<LabRunRequest, 'initialMerchants' | 'initialP0' | 'initialPools'>> {
  try {
    const snap = await api.labSnapshot();
    if (snap.initialMerchants?.length) return { initialMerchants: snap.initialMerchants, initialP0: snap.initialP0, initialPools: snap.initialPools };
  } catch { /* pas de serveur */ }
  return {};
}

export default function LabPage() {
  const [players, setPlayers] = useState(200);
  const [days, setDays] = useState(7);
  const [scenario, setScenario] = useState<Scenario>('baseline');
  const [seed, setSeed] = useState(42);
  const [progress, setProgress] = useState<number | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const worker = useRef<Worker | null>(null);

  const start = async () => {
    worker.current?.terminate();
    setErr(null);
    setProgress(0);
    setPlaying(false);
    const live = await liveStart();
    const w = new SimWorker();
    worker.current = w;
    w.onmessage = (ev: MessageEvent<LabMessage>) => {
      const m = ev.data;
      if (m.type === 'progress') setProgress(m.fraction);
      else if (m.type === 'error') { setErr(m.message); setProgress(null); }
      else {
        setRun({ result: m.result, baseline: m.baseline, merchants: m.merchants, frames: m.frames, ms: m.ms, fromLive: m.fromLive });
        setProgress(null);
        setFrame(0);
        setPlaying(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setFrame(m.frames.length - 1);
        w.terminate();
      }
    };
    w.postMessage({ type: 'run', days, players, seed, scenario, ...live } satisfies LabRunRequest);
  };
  useEffect(() => { void start(); return () => worker.current?.terminate(); }, []); // premier run auto

  // lecture animée (≈ 6 s pour une semaine)
  useEffect(() => {
    if (!playing || !run) return;
    const t = setInterval(() => setFrame((f) => {
      if (f >= run.frames.length - 1) { setPlaying(false); return f; }
      return f + 1;
    }), Math.max(30, 6000 / run.frames.length));
    return () => clearInterval(t);
  }, [playing, run]);

  const fr = run?.frames[Math.min(frame, (run?.frames.length ?? 1) - 1)];
  const hour = fr?.hour ?? 0;
  const points = useMemo<CityPoint[]>(() => {
    if (!run || !fr) return [];
    const bots: CityPoint[] = fr.bots.map(([lng, lat]) => ({ lng, lat, color: '#3b5dc9', r: 2.2, kind: 'bot' }));
    const ms: CityPoint[] = run.merchants.map((m, i) => ({
      lng: m.lng, lat: m.lat, color: STATUS_COLOR[fr.status[i] ?? 0]!, r: 3 + Math.min(4, (fr.flux[i] ?? 0) / 700),
      stroke: fr.status[i] === 2 ? '#b13e53' : '#1a1c2c', label: m.name,
    }));
    return [...bots, ...ms];
  }, [run, fr]);

  const res = run?.result;
  const series = res?.series ?? [];
  const cursor = Math.min(hour, Math.max(0, series.length - 1));
  const counts = fr ? [0, 1, 2].map((k) => fr.status.filter((x) => x === k).length) : [0, 0, 0];
  const dayLabel = (i: number) => (i === 0 ? 'start' : `D${Math.ceil(i / 24)}`);
  const endH = (res?.days ?? days) * 24;
  const clockDay = hour >= endH ? res?.days ?? days : Math.floor(hour / 24) + 1;
  const clockH = hour >= endH ? '24:00' : hh(hour % 24);
  const story = useMemo(() => (res && run?.baseline ? makeStory(res, run.baseline) : null), [res, run?.baseline]);
  const priceBands = useMemo(() => (res ? floodBands(res) : []), [res]);
  const visibleEvents = (res?.events ?? []).filter((e) => e.hour <= hour).slice(-60).reverse();

  return (
    <PageShell title="Economy Lab" testId="lab-page"
      subtitle="Run a whole week of Paris in seconds — same rules as the live game, same code, 200 bots doing what players do.">
      <div className={s.grid}>
        <div className={s.colLeft}>
          <Card>
            <div className={s.controls}>
              <label className={s.field}>
                <span>Bots <b className="num">{players}</b></span>
                <input type="range" min={50} max={500} step={10} value={players} onChange={(e) => setPlayers(Number(e.target.value))} data-testid="lab-bots" />
              </label>
              <label className={s.field}>
                <span>Days <b className="num">{days}</b></span>
                <input type="range" min={1} max={14} step={1} value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="lab-days" />
              </label>
              <div className={s.field}>
                <span>Scenario</span>
                <div className={s.scen}>
                  {SCEN.map((sc) => (
                    <button key={sc.id} type="button" className={scenario === sc.id ? s.scenOn : ''} onClick={() => setScenario(sc.id)} data-testid={`scen-${sc.id}`}>
                      {sc.label}
                    </button>
                  ))}
                </div>
                <small className="dim">{SCEN.find((x) => x.id === scenario)!.hint}</small>
              </div>
              <div className={s.seedRow}>
                <label className={s.field} style={{ flex: 1 }}>
                  <span>Seed</span>
                  <input className={s.seed} type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
                </label>
                <Button size="s" ariaLabel="Random seed" onClick={() => setSeed(Math.floor(Math.random() * 99999))}><Dices size={18} /></Button>
              </div>
              <Button variant="gold" size="l" block onClick={() => void start()} loading={progress !== null} testId="lab-run">
                {progress !== null ? `Simulating… ${Math.round(progress * 100)} %` : `Simulate ${days === 7 ? '1 week' : `${days} day${days > 1 ? 's' : ''}`}`}
              </Button>
              {progress !== null ? <Gauge value={progress} max={1} color="var(--sun)" height={12} /> : null}
              {err ? <p className={s.err}>{err}</p> : null}
              {run ? <small className="dim" data-testid="lab-meta">{run.result.players} bots · {run.result.merchants} merchants · {run.result.days} days simulated in {(run.ms / 1000).toFixed(1)} s{run.fromLive ? ' · started from live Paris' : ''}</small> : null}
            </div>
          </Card>

          <Card className={s.mapCard}>
            <div className={s.mapHead}>
              <Button size="s" ariaLabel={playing ? 'Pause' : 'Play'} onClick={() => {
                if (!run) return;
                if (frame >= run.frames.length - 1) setFrame(0);
                setPlaying(!playing);
              }} testId="lab-play">{playing ? <Pause size={18} /> : <Play size={18} />}</Button>
              <div className={s.clock}>
                <span className="pixel">Day {clockDay}</span> <span className="num">{clockH}</span>
              </div>
              <input type="range" className={s.scrub} min={0} max={Math.max(0, (run?.frames.length ?? 1) - 1)} value={frame}
                onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} aria-label="Timeline" />
              <Button size="s" variant="ghost" ariaLabel="Restart" onClick={() => { setFrame(0); setPlaying(true); }}><RotateCcw size={18} /></Button>
            </div>
            <Suspense fallback={<div style={{ height: 340 }} />}><CityMap points={points} height={340} testId="lab-map" /></Suspense>
            <div className={s.legend}>
              <span><i style={{ background: STATUS_COLOR[0] }} /> open {counts[0]}</span>
              <span><i style={{ background: STATUS_COLOR[1] }} /> closing {counts[1]}</span>
              <span><i style={{ background: STATUS_COLOR[2], borderColor: 'var(--berry)' }} /> closed {counts[2]}</span>
              <span><i style={{ background: '#3b5dc9', borderRadius: '50%' }} /> bots</span>
              <span className="dim">dot size = merchant till</span>
            </div>
          </Card>

          <Card>
            <h2 className={s.h2}>Event log</h2>
            <ol className={s.log} data-testid="lab-log">
              {visibleEvents.length === 0 ? <li className="dim">{run ? 'Quiet so far…' : 'Run a simulation to see what happens.'}</li> : visibleEvents.map((e, i) => (
                <li key={`${e.hour}-${i}`}><b>Day {Math.min(e.day, res?.days ?? e.day)} {e.day > (res?.days ?? 99) ? '24:00' : hh(e.hourOfDay)}</b> — {eventText(e)}</li>
              ))}
            </ol>
          </Card>
        </div>

        <div className={s.colRight}>
          {res ? (
            <>
              {story ? (
                <Card testId="lab-story" className={s.story}>
                  <p className={s.headline} data-testid="lab-headline">{story.headline}</p>
                  <h2 className={s.h2}>{story.title}</h2>
                  <LineChart testId="chart-compare" series={story.series} gap={story.gap} marker={story.marker} bands={story.bands}
                    cursor={cursor} xMax={series.length} xLabel={dayLabel} format={story.format} height={170} />
                  <small className="dim">Same seed, same {res.players} bots — the only difference is the scenario.</small>
                </Card>
              ) : null}
              <div className={s.kpis}>
                <div><b className="num">{fmtUsd(series[cursor]?.payoutsCum ?? 0)}</b><span>real credits paid</span></div>
                <div><b className="num">{fmtUsd(series[cursor]?.mainPoolAvail ?? 0, 2)}</b><span>main pool left</span></div>
                <div><b className="num">{fmtInt(res.totals.compiles)}</b><span>compiles ({fmtInt(res.totals.compilesPaid)} paid)</span></div>
                <div><b className="num">{fmtInt(res.totals.catches)}</b><span>shards caught</span></div>
              </div>
              <Card>
                <h2 className={s.h2}>Prices vs. start</h2>
                <LineChart testId="chart-prices" bands={priceBands} cursor={cursor} xMax={series.length} xLabel={dayLabel} format={(n) => `×${n.toFixed(2)}`}
                  series={FAMILIES.map((f) => {
                    const v0 = series[0]?.avgMid[f] || 1;
                    return { label: FAMILY_INFO[f].name, color: FAMILY_DARK[f], values: series.map((p) => p.avgMid[f] / v0) };
                  })} />
              </Card>
              <Card>
                <h2 className={s.h2}>Flux in circulation</h2>
                <LineChart cursor={cursor} xMax={series.length} xLabel={dayLabel} format={(n) => `${Math.round(n / 1000)}k`}
                  series={[
                    { label: 'Players', color: '#3b5dc9', values: series.map((p) => p.fluxPlayers), area: true },
                    { label: 'Merchants', color: '#ef7d57', values: series.map((p) => p.fluxMerchants) },
                  ]} />
              </Card>
              <Card>
                <h2 className={s.h2}>Reserve & real payouts</h2>
                <LineChart cursor={cursor} xMax={series.length} xLabel={dayLabel} format={(n) => `$${n.toFixed(2)}`}
                  series={[
                    { label: 'Main pool ($)', color: '#257179', values: series.map((p) => p.mainPoolAvail / NUSD_PER_USD), area: true },
                    { label: 'Paid out ($)', color: '#b13e53', values: series.map((p) => p.payoutsCum / NUSD_PER_USD) },
                  ]} />
              </Card>
              <Card>
                <h2 className={s.h2}>Merchants</h2>
                <LineChart cursor={cursor} xMax={series.length} xLabel={dayLabel}
                  series={[
                    { label: 'Open', color: '#38b764', values: series.map((p) => p.open) },
                    { label: 'Closing', color: '#ef7d57', values: series.map((p) => p.closing) },
                    { label: 'Closed', color: '#566c86', values: series.map((p) => p.closed), dashed: true },
                  ]} />
              </Card>
              <Card testId="lab-health">
                <h2 className={s.h2}>Health checks <small className="dim">{res.health.filter((h) => h.pass).length}/{res.health.length} pass</small></h2>
                <table className={s.health}>
                  <tbody>
                    {res.health.map((h) => (
                      <tr key={h.name}>
                        <td className={h.pass ? s.pass : s.fail}>{h.pass ? <Check size={18} strokeWidth={3} /> : <XIcon size={18} strokeWidth={3} />}</td>
                        <td>{h.name}</td>
                        <td className="num">{h.display}</td>
                        <td className="dim">{h.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          ) : (
            <Card><p className="dim" style={{ margin: 0 }}>{progress !== null ? 'Paris is waking up…' : 'No run yet.'}</p></Card>
          )}
          <RulesPanel />
        </div>
      </div>
    </PageShell>
  );
}

function RulesPanel() {
  const usdOf = (n: number) => `$${(n / NUSD_PER_USD).toFixed(2)}`;
  const rows: [string, string][] = [
    ['Shards', FAMILIES.map((f) => `${FAMILY_INFO[f].name} ${FAMILY_INFO[f].p0} ƒ (${FAMILY_INFO[f].rarity})`).join(' · ')],
    ['Catching', `Lock-on ring: perfect ±${CATCH.perfectWindow.common * 100}–${CATCH.perfectWindow.epic * 100} %, good ±${CATCH.goodWindow.common * 100} %. Perfect = ${CATCH.perfectBonusChance * 100} % bonus shard. Rare shards may flee after a miss.`],
    ['Relays', `Sync every ${RELAY.cooldownMs / 60000} min → ${RELAY.fluxMin}–${RELAY.fluxMax} ƒ and a ${RELAY.shardChance * 100} % chance of a shard.`],
    ['Merchant prices', `price = base × (target ÷ stock)^${PRICING.alpha}, clamped ${PRICING.scarcityMin}–${PRICING.scarcityMax}×, ± a ${PRICING.spreadMin * 100}–${PRICING.spreadMax * 100} % margin. Every unit is priced at the stock after the trade, so buy-then-sell always loses.`],
    ['Merchant life', `Rent ${MERCHANT.rentPerHour} ƒ/h when active. Till < ${MERCHANT.closingBelow} ƒ → closing sale; after ${MERCHANT.closingGraceMs / 3600000} h → closed. Players reopen it with ${MERCHANT.reopenAt} ƒ; contributors get half spread for 7 days.`],
    ['Forge recipes', (Object.entries(TIERS)).map(([t, r]) => `${t}: Lv ${r.level}, ${Object.entries(r.byRarity).map(([k, q]) => `${q} ${k}`).join(' + ')}, fee ${r.fee} ƒ`).join(' · ')],
    ['Real payouts', `Each compile pays ${(FORGE.yieldPerWeight * 100).toFixed(1)} % of the main pool per recipe weight, capped at ${usdOf(FORGE.capPlayerDay)} per player per day and ${FORGE.capGlobalDayRatio * 100} % of the pool per day.`],
    ['Reserve', `Total ${usdOf(Object.values(RESERVE_PARTITION).reduce((a, b) => a + b, 0))}: ${Object.entries(RESERVE_PARTITION).map(([k, v]) => `${k} ${usdOf(v)}`).join(' · ')}. It never promises more than it holds.`],
    ['Anti-cheat', `Over ${MOVE.transitKmh} km/h = in transit (no catching). Real credits need ${MOVE.proofOfWalkM / 1000} km of plausible walking.`],
    ['Levels', `XP to next level = 100 × L^1.5 (L2 ${xpToNext(1)}, L5 ${xpToNext(5)}).`],
  ];
  return (
    <Card testId="lab-rules">
      <details className={s.rules}>
        <summary><h2 className={s.h2} style={{ display: 'inline' }}>Explain the rules</h2></summary>
        <p className="dim" style={{ fontSize: 13 }}>Straight from <code>packages/shared/src/economy/rules.ts</code> — the server, this simulator and the UI all import the same file.</p>
        <dl>
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </details>
    </Card>
  );
}
