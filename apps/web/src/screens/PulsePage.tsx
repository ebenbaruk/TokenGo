// City Pulse (/pulse, public, mode spectateur des juges) : ticker live (SSE), Paris Shard Index, Réserve,
// santé des marchands, statut on-chain, carte des marchands colorée par prix d'une famille.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Radio } from 'lucide-react';
import { FAMILIES, FAMILY_INFO, midAt, type Family, type MerchantState, type PulseEvent, type PulseResponse } from '@tokengo/shared';
import { api } from '../lib/api.ts';
import { fmtClock, fmtCountdown, fmtUsd } from '../lib/format.ts';
import { PageShell } from './PageShell.tsx';
import { CityControl } from './CityControl.tsx'; // Contrôle de la ville (Docs/13 §8)
import { Card, Gauge, Sparkline } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, FAMILY_DARK } from '../sprites/index.ts';
import type { CityPoint } from '../map/CityMap.tsx';
import world from '../../../../data/world/paris.json';
import { CATEGORY_INFO } from '@tokengo/shared';
import { BossHpBar } from './raidUi.tsx'; // Raid (Docs/13 §6)
import s from './PulsePage.module.css';

const CityMap = lazy(() => import('../map/CityMap.tsx'));

export interface ChainStatus {
  enabled: boolean; contract: string | null; pending: number; inFlight: number; rejected: number; lagMs: number;
  lastSettlement: { id: string; txHash: string | null; url: string | null; ops: number; at: number; gasTgas: number | null; ms: number | null } | null;
  settled: { batches: number; ops: number };
}

const markets = (world as { nodes: { id: string; kind: string; name: string; lat: number; lng: number }[] }).nodes.filter((n) => n.kind === 'market');
/** 'osm:node/123' → 'm-node-123' (ids des marchands côté serveur) */
const merchantIdOf = (nodeId: string) => `m-${nodeId.replace(/^osm:/, '').replace('/', '-')}`;

const isAgent = (e: PulseEvent) => Boolean(e.data && (e.data.agent === true || e.data.isAgent === true || e.data.runner === 'agent'));
const ICON: Record<string, string> = { trade: '⇄', compile: '⚒', catch: '◆', sync: '◎', rescue: '♥', closing: '⚠', closed: '✖', reopened: '★', contract: '✉', settle: '⛓', 'city.event': '⚡', 'city.event.end': '◌',
  'city.raid.end': '☠', 'raid.half': '⚠' }; // Raid (Docs/13 §6)

/** Couleur d'un prix relatif (mid / médiane de la ville) : vert = pas cher, jaune = normal, rouge = cher. */
function priceColor(r: number): string {
  if (r < 0.88) return '#38b764';
  if (r < 0.97) return '#a7f070';
  if (r < 1.04) return '#ffcd75';
  if (r < 1.15) return '#ef7d57';
  return '#b13e53';
}

export default function PulsePage() {
  const [pulse, setPulse] = useState<PulseResponse | null>(null);
  const [events, setEvents] = useState<PulseEvent[]>([]);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const [live, setLive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fam, setFam] = useState<Family>('gemini');
  const [states, setStates] = useState<Map<string, MerchantState> | null>(null);
  const [snapP0, setSnapP0] = useState<Record<Family, number> | null>(null);

  useEffect(() => {
    const load = () => api.pulse().then((p) => { setPulse(p); setErr(null); setEvents((cur) => mergeEvents(cur, p.events)); }).catch(() => setErr('Can’t reach the city right now — retrying.'));
    const loadChain = () => fetch('/api/chain/status').then((r) => (r.ok ? r.json() : null)).then((c: ChainStatus | null) => setChain(c)).catch(() => {});
    void load(); void loadChain();
    const loadSnap = () => api.labSnapshot().then((j) => {
      if (j.initialMerchants?.length) { setStates(new Map(j.initialMerchants.map((m) => [m.id, m]))); setSnapP0(j.initialP0); }
    }).catch(() => {});
    void loadSnap();
    const t3 = setInterval(loadSnap, 60_000);
    const t1 = setInterval(load, 30_000);
    const t2 = setInterval(loadChain, 15_000);
    const es = new EventSource('/api/pulse/stream');
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data as string) as PulseEvent;
        // Raid (Docs/13 §6) : PV en direct (éphémère, hors ticker)
        if (e.kind === 'raid.hp' && e.data) { const d = e.data as { eventId: number; hp: number }; setPulse((p) => (p?.cityEvent?.raid && p.cityEvent.id === d.eventId ? { ...p, cityEvent: { ...p.cityEvent, raid: { ...p.cityEvent.raid, hp: Math.min(p.cityEvent.raid.hp, d.hp) } } } : p)); return; }
        setEvents((cur) => mergeEvents(cur, [e]));
        if (e.kind.startsWith('city.')) void load(); // carte « Now in Paris » à jour tout de suite
      } catch { /* ping */ }
    };
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); es.close(); };
  }, []);

  const p0 = snapP0 ?? (pulse ? Object.fromEntries(FAMILIES.map((f) => [f, pulse.index[f]?.at(-1) ?? FAMILY_INFO[f].p0])) as Record<Family, number> : null);
  const points = useMemo<CityPoint[]>(() => {
    // prix « milieu » de chaque marchand pour la famille choisie, comparé à la médiane de la ville
    const mids = new Map<string, number>();
    if (states && p0) for (const [id, m] of states) if (m.status !== 'closed') mids.set(id, midAt(p0[fam], m, fam, m.stock[fam]));
    const sorted = [...mids.values()].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 1;
    return markets.map((n) => {
      const id = merchantIdOf(n.id);
      const m = states?.get(id);
      if (!m) return { lng: n.lng, lat: n.lat, color: '#f4f4f4', r: 4, label: n.name };
      if (m.status === 'closed') return { lng: n.lng, lat: n.lat, color: '#94b0c2', stroke: '#b13e53', r: 4, label: n.name };
      return { lng: n.lng, lat: n.lat, color: priceColor((mids.get(id) ?? median) / median), r: 5, label: n.name };
    });
  }, [states, fam, p0?.[fam]]);

  const total = pulse ? pulse.merchants.open + pulse.merchants.closing + pulse.merchants.closed : 0;
  return (
    <PageShell title="City Pulse" testId="pulse-page"
      subtitle={<>Paris, live. Every catch, trade and compile as it happens — <span className={live ? s.liveOn : s.liveOff}><Radio size={14} /> {live ? 'live' : 'connecting…'}</span></>}>
      {err ? <p className={s.err}>{err}</p> : null}
      <div className={s.grid}>
        <div className={s.col}>
          <LivingCard pulse={pulse} />
          <div className={s.kpis}>
            <Card testId="pulse-reserve">
              <div className={s.kTitle}>City Reserve {pulse?.reserve.simulated ? <span className={s.sim}>demo</span> : null}</div>
              <div className={s.big}>{pulse ? fmtUsd(pulse.reserve.mainAvailNusd, 2) : '—'}</div>
              <Gauge value={pulse?.reserve.mainAvailNusd ?? 0} max={pulse?.reserve.mainInitialNusd ?? 1} color="var(--teal)" height={14} />
              <div className={s.kSub}>{pulse ? `${Math.round(pulse.reserve.health * 100)} % health${pulse.reserve.forgePaused ? ' · forges paused' : ''}` : 'loading…'}</div>
            </Card>
            <Card testId="pulse-merchants">
              <div className={s.kTitle}>Merchants</div>
              <div className={s.big}>{pulse ? pulse.merchants.open : '—'}<small> open</small></div>
              <div className={s.stack}>
                {pulse ? (['open', 'closing', 'closed'] as const).map((k) => (
                  <i key={k} className={s[k]} style={{ width: `${(pulse.merchants[k] / Math.max(1, total)) * 100}%` }} />
                )) : null}
              </div>
              <div className={s.kSub}>{pulse ? `${pulse.merchants.closing} closing · ${pulse.merchants.closed} closed` : 'loading…'}</div>
            </Card>
          </div>

          <Card testId="pulse-index">
            <h2 className={s.h2}>Paris Shard Index</h2>
            <div className={s.index}>
              {FAMILIES.map((f) => {
                const pts = pulse?.index[f] ?? [];
                const last = pts.at(-1) ?? FAMILY_INFO[f].p0;
                const first = pts[0] ?? last;
                const ch = first ? (last / first - 1) * 100 : 0;
                return (
                  <div key={f} className={s.idxRow}>
                    <Sprite def={SHARDS[f]} scale={2} />
                    <span className={s.idxName}>{FAMILY_INFO[f].name}</span>
                    <Sparkline points={pts} w={90} h={26} color={FAMILY_DARK[f]} />
                    <span className={`${s.idxVal} num`}>{last.toFixed(1)} ƒ</span>
                    <span className={`${s.idxCh} num ${ch >= 0 ? s.up : s.down}`}>{ch >= 0 ? '+' : ''}{ch.toFixed(1)} %</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className={s.mapHead}>
              <h2 className={s.h2} style={{ margin: 0 }}>Who sells {FAMILY_INFO[fam].name} cheap?</h2>
              <div className={s.famPick}>
                {FAMILIES.map((f) => (
                  <button key={f} type="button" aria-pressed={fam === f} aria-label={FAMILY_INFO[f].name} className={fam === f ? s.famOn : ''} onClick={() => setFam(f)}>
                    <Sprite def={SHARDS[f]} scale={2} />
                  </button>
                ))}
              </div>
            </div>
            <Suspense fallback={<div style={{ height: 380 }} />}><CityMap points={points} height={380} testId="pulse-map" /></Suspense>
            <div className={s.legend}>
              {states ? <>
                <span><i style={{ background: '#38b764' }} /> cheap</span><span><i style={{ background: '#ffcd75' }} /> normal</span>
                <span><i style={{ background: '#b13e53' }} /> pricey</span><span><i style={{ background: '#94b0c2', borderColor: '#b13e53' }} /> closed</span>
              </> : <span className="dim">{markets.length} merchants · live prices appear when the city snapshot is available</span>}
            </div>
          </Card>
        </div>

        <div className={s.col}>
          <Card testId="pulse-chain">
            <h2 className={s.h2}>On-chain</h2>
            {!chain ? <p className="dim" style={{ margin: 0 }}>Checking the ledger…</p> : !chain.enabled ? (
              <p className="dim" style={{ margin: 0 }}>Settlement is off on this server — the game runs on its own ledger.</p>
            ) : (
              <div className={s.chain}>
                <div><b className="num">{chain.settled.ops.toLocaleString('en-US')}</b><span>ops settled in {chain.settled.batches} batches</span></div>
                <div><b className="num">{chain.pending + chain.inFlight}</b><span>pending{chain.lagMs > 0 ? ` · ${Math.round(chain.lagMs / 1000)} s behind` : ''}</span></div>
                {chain.lastSettlement ? (
                  <a className={s.tx} href={chain.lastSettlement.url ?? '#'} target="_blank" rel="noreferrer" data-testid="pulse-last-tx">
                    Last settlement · {chain.lastSettlement.ops} ops · {fmtClock(chain.lastSettlement.at)} <ExternalLink size={12} />
                  </a>
                ) : <span className="dim">No settlement yet.</span>}
                {chain.contract ? <span className={s.contract}>Contract <span className="mono">{chain.contract}</span> (NEAR testnet)</span> : null}
              </div>
            )}
          </Card>

          <Card testId="pulse-city"><CityControl /></Card>

          <Card testId="pulse-ticker">
            <h2 className={s.h2}>Live ticker</h2>
            <ol className={s.ticker}>
              {events.length === 0 ? <li className="dim">{pulse ? 'Quiet streets… the next catch will show up here.' : 'Loading…'}</li> : events.slice(0, 40).map((e) => (
                <li key={e.id} className={s.ev}>
                  <span className={s.evIcon} aria-hidden>{ICON[e.kind] ?? '•'}</span>
                  <span className={s.evText}>{e.text}{isAgent(e) ? <span className={s.agent}>agent</span> : null}</span>
                  <time className={s.evTime}>{fmtClock(e.at)}</time>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

/** Événement de ville en cours + marcheurs sur la carte. */
function LivingCard({ pulse }: { pulse: PulseResponse | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const e = pulse?.cityEvent && pulse.cityEvent.endsAt > now ? pulse.cityEvent : null;
  const w = pulse?.walkers;
  return (
    <Card testId="pulse-living">
      <div className={s.living}>
        <div className={s.livingEvent} data-testid="pulse-city-event" data-kind={e?.kind ?? 'none'}>
          <div className={s.kTitle}>Now in Paris</div>
          {e ? <>
            <div className={s.evTitle}><span className={s.evBadge} data-kind={e.kind}>⚡</span>{e.title}</div>
            <div className={s.kSub}>{e.effect} · <span className="num">{fmtCountdown(e.endsAt - now)}</span> left</div>
            {e.raid ? <div className={s.raidHp} data-testid="pulse-raid"><BossHpBar hp={e.raid.hp} max={e.raid.maxHp} size="s" testId="pulse-raid-hp" /><small>{e.raid.boss} · weak to {CATEGORY_INFO[e.raid.weakness].name} · {e.raid.participants} fighting</small></div> : null}
          </> : <div className={s.kSub}>{pulse ? 'No city event right now — flash crashes, gold rushes and strikes pop up a few times a day.' : 'loading…'}</div>}
        </div>
        <div className={s.livingWalkers} data-testid="pulse-walkers">
          <div className={s.kTitle}>On the map</div>
          <div className={s.big}>{w ? w.runners + w.players : '—'}<small> walkers</small></div>
          <div className={s.kSub}>{w ? `${w.runners} runner-agents · ${w.players} player${w.players === 1 ? '' : 's'}` : ''}</div>
        </div>
      </div>
    </Card>
  );
}

function mergeEvents(cur: PulseEvent[], add: PulseEvent[]): PulseEvent[] {
  const byId = new Map(cur.map((e) => [e.id, e]));
  for (const e of add) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, 80);
}
