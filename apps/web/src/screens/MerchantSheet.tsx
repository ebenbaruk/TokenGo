// Marchand (Docs/09 §4) : onglets Trade / Contract / Rescue, « Why this price? », devis exact, slide to confirm.
import { useCallback, useEffect, useRef, useState } from 'react';
import { FAMILIES, MERCHANT, UNLOCKS, haversineM, type Family, type MerchantView, type NodeView, type PriceExplanation, type QuoteResponse, type Side } from '@tokengo/shared';
import { Info, ChevronDown, ExternalLink } from 'lucide-react';
import { api, ApiFail, humanError } from '../lib/api.ts';
import { useGame, setMe, toast } from '../lib/store.ts';
import { radiusFor } from '../lib/nearby.ts';
import { famName, fmtClock, fmtCountdown, fmtDist, fmtInt } from '../lib/format.ts';
import { play } from '../lib/sound.ts';
import { Sheet, Tabs, Stepper, SlideToConfirm, Button, Gauge, Sparkline, Card } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, FLUX, merchantSprite, accentOf } from '../sprites/index.ts';
import s from './MerchantSheet.module.css';

type Tab = 'trade' | 'contract' | 'rescue';
const r2 = (n: number) => (Math.round(n * 100) / 100).toString();

/** « Why this price? » rendu comme une phrase chiffrée. */
export function explainSentence(e: PriceExplanation): string {
  const mid = Math.round(e.p0 * e.scarcity);
  const base = `Base ${r2(e.p0)} ƒ × scarcity ${e.scarcity.toFixed(2)} (I hold ${e.stock}, I want ${Math.round(e.target)}) ≈ ${mid} ƒ, ± my margin ${Math.round(e.spread * 100)} % — and each unit moves my stock`;
  const tail = [
    e.sell !== null ? `I sell at ${e.sell} ƒ` : null,
    e.buy !== null ? `I buy at ${e.buy} ƒ` : null,
  ].filter(Boolean).join(', ');
  const notes = [
    e.specialty ? 'It’s my specialty, so a slimmer margin.' : null,
    e.closing ? 'Closing-down sale: −10 %.' : null,
    e.sellBlocked === 'contract' ? 'Not selling these: I need them for my contract.' : null,
    e.sellBlocked === 'empty' ? 'I’m out of these.' : null,
    e.buyBlocked === 'no-flux' ? 'My till is too empty to buy.' : null,
    e.buyBlocked === 'closing' ? 'Not buying while I’m closing.' : null,
  ].filter(Boolean).join(' ');
  return `${base}${tail ? ` → ${tail}.` : '.'}${notes ? ` ${notes}` : ''}`;
}

const STATUS = { open: 'Open', closing: 'Closing', closed: 'Closed' } as const;

export function MerchantSheet({ node, onClose }: { node: NodeView; onClose: () => void }) {
  const mId = node.merchant?.id ?? node.id;
  const me = useGame((st) => st.me);
  const pos = useGame((st) => st.pos);
  const [m, setM] = useState<MerchantView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('trade');
  const [pick, setPick] = useState<{ family: Family; side: Side } | null>(null);
  const [why, setWhy] = useState<Family | null>(null);
  const [face, setFace] = useState(1);
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [greet, setGreet] = useState<string | null>(null);
  useEffect(() => { api.greet(mId).then((g) => setGreet(g.greeting)).catch(() => {}); }, [mId]);

  const load = useCallback(() => api.merchant(mId).then((v) => { setM(v); setErr(null); }).catch((e) => setErr(humanError(e))), [mId]);
  useEffect(() => { void load(); const t = setTimeout(() => setFace(0), 1600); return () => clearTimeout(t); }, [load]);
  const cheer = () => { setFace(2); setTimeout(() => setFace(0), 1500); };

  const dist = pos ? haversineM(pos, node) : Infinity;
  const inRange = pos ? dist <= radiusFor('market', pos) : false;
  const farReason = inRange ? null : `${Math.round(dist)} m away — get a bit closer`;
  const archetype = m?.archetype ?? node.merchant?.archetype ?? 'grandma';
  const accent = accentOf(mId);

  return (
    <Sheet open onClose={onClose} full title={m?.name ?? node.merchant?.name ?? node.name}
      subtitle={<>{m?.place ?? node.name} · {Number.isFinite(dist) ? fmtDist(dist) : ''}</>}
      icon={<span className={s.portrait} style={{ background: accent.a }}><Sprite def={merchantSprite(archetype, mId)} scale={2} frame={face} /></span>}
      testId="merchant-sheet"
      tabs={<Tabs value={tab} onChange={setTab} items={[
        { id: 'trade', label: 'Trade' },
        { id: 'contract', label: 'Contract', dot: Boolean(m?.contract) },
        { id: 'rescue', label: 'Rescue', dot: m?.status !== undefined && m.status !== 'open' },
      ]} />}>
      {err ? <p className={s.err}>{err}</p> : null}
      {!m ? <p className="dim">Opening the shop…</p> : (
        <>
          <div className={s.moodRow}>
            <span className={`${s.status} ${s[m.status]}`}>{STATUS[m.status]}</span>
            <span className={s.archetype}>{archetype}</span>
            <span className={s.till}><Sprite def={FLUX} scale={1} /> till {fmtInt(m.flux)} ƒ</span>
          </div>
          <div className={s.bubble} data-testid="merchant-mood">{greet ?? m.greeting}{m.mood && m.mood !== (greet ?? m.greeting) ? <small className={s.mood}>mood · {m.mood}</small> : null}</div>

          {tab === 'trade' && (
            <div className={s.list}>
              <div className={s.headRow}><span>Shard</span><span>Sell to me</span><span>Buy</span></div>
              {FAMILIES.map((f) => {
                const e = m.prices.find((p) => p.family === f);
                if (!e) return null;
                const best = m.bestKnown[f];
                return (
                  <div key={f} className={s.fam} data-testid={`row-${f}`}>
                    <div className={s.famMain}>
                      <Sprite def={SHARDS[f]} scale={2} />
                      <div className={s.famInfo}>
                        <div className={s.famName}>{famName(f)}{e.specialty ? <span className={s.spec}>★</span> : null}
                          <button type="button" className={`${s.why} ${me && !me.tutorial.traded ? s.whyHint : ''}`} aria-label={`Why this price for ${famName(f)}?`} data-testid={`why-${f}`}
                            onClick={() => setWhy(why === f ? null : f)}><Info size={16} strokeWidth={3} /></button>
                        </div>
                        <div className={s.stockLine}>
                          <Gauge value={e.stock} max={Math.max(e.target * 1.5, e.stock, 1)} mark={e.target} height={8} color="var(--teal)" />
                          <span className="num">{e.stock}/{Math.round(e.target)}</span>
                          <Sparkline points={m.trend24h[f] ?? []} w={36} h={16} />
                        </div>
                      </div>
                    </div>
                    <div className={s.prices}>
                      <button type="button" className={`${s.priceBtn} ${s.sell}`} data-testid={`sell-${f}`}
                        disabled={e.buy === null || (me?.shards[f] ?? 0) === 0}
                        onClick={() => { play('tap'); setPick({ family: f, side: 'sell' }); }}>
                        {e.buy !== null ? <span><b className="num">{e.buy}</b> ƒ</span> : <small>{e.buyBlocked === 'no-flux' ? 'till empty' : 'not buying'}</small>}
                        <small>{e.buy !== null ? `you have ${me?.shards[f] ?? 0}` : ''}</small>
                      </button>
                      <button type="button" className={`${s.priceBtn} ${s.buy}`} data-testid={`buy-${f}`}
                        disabled={e.sell === null}
                        onClick={() => { play('tap'); setPick({ family: f, side: 'buy' }); }}>
                        {e.sell !== null ? <span><b className="num">{e.sell}</b> ƒ</span> : <small>{e.sellBlocked === 'contract' ? 'contract' : e.sellBlocked === 'empty' ? 'sold out' : 'closed'}</small>}
                      </button>
                    </div>
                    {why === f ? <div className={s.whyPop} data-testid="why-popover">{explainSentence(e)}</div> : null}
                    {best?.buy || best?.sell ? (
                      <div className={s.best}>Best known: {best.buy ? `pays ${best.buy.price} ƒ at ${best.buy.merchant} · ${fmtDist(best.buy.distanceM)}` : ''}
                        {best.buy && best.sell ? ' · ' : ''}{best.sell ? `sells ${best.sell.price} ƒ at ${best.sell.merchant} · ${fmtDist(best.sell.distanceM)}` : ''}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'contract' && <ContractTab m={m} farReason={farReason} onDone={(v) => { setM(v); cheer(); }} />}
          {tab === 'rescue' && <RescueTab m={m} farReason={farReason} onDone={(v) => { setM(v); cheer(); }} />}

          {m.lastThought ? (
            <button type="button" className={s.thought} onClick={() => setThoughtOpen(!thoughtOpen)}>
              <span>Last thought ({fmtClock(m.lastThought.at)}) <ChevronDown size={14} style={{ transform: thoughtOpen ? 'rotate(180deg)' : undefined }} /></span>
              {thoughtOpen ? <em>{m.lastThought.text}</em> : null}
            </button>
          ) : null}
          {m.walletUrl ? <a className={s.wallet} href={m.walletUrl} target="_blank" rel="noreferrer">Merchant wallet <ExternalLink size={11} /></a> : null}
        </>
      )}
      {pick && m ? <TradePanel m={m} pick={pick} farReason={farReason} onClose={() => setPick(null)}
        onTraded={(v) => { setM(v); setPick(null); cheer(); }} onStale={() => void load()} /> : null}
    </Sheet>
  );
}

function TradePanel({ m, pick, farReason, onClose, onTraded, onStale }: {
  m: MerchantView; pick: { family: Family; side: Side }; farReason: string | null; onClose: () => void; onTraded: (m: MerchantView) => void; onStale: () => void;
}) {
  const me = useGame((st) => st.me);
  const e = m.prices.find((p) => p.family === pick.family)!;
  const unit = pick.side === 'sell' ? e.buy ?? 0 : e.sell ?? 0;
  const maxQty = Math.max(1, Math.min(pick.side === 'sell' ? me?.shards[pick.family] ?? 0 : e.stock, 10));
  const [qty, setQty] = useState(1);
  const [q, setQ] = useState<QuoteResponse | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const requote = useCallback(async () => {
    const id = ++seq.current;
    setQ(null);
    setQErr(null);
    try {
      const r = await api.quote(m.id, { side: pick.side, family: pick.family, qty });
      if (id === seq.current) setQ(r);
    } catch (err) {
      if (id === seq.current) setQErr(humanError(err));
    }
  }, [m.id, pick.side, pick.family, qty]);
  useEffect(() => { const t = setTimeout(() => void requote(), 150); return () => clearTimeout(t); }, [requote]);

  const confirm = async () => {
    if (!q) return;
    if (q.expiresAt < Date.now()) { toast('Quote expired — refreshed.', 'info'); void requote(); return; }
    setBusy(true);
    try {
      const r = await api.trade(m.id, q.quoteId);
      useGame.setState({ lastResult: r });
      setMe(r.me, r.levelUp);
      play('trade');
      toast(r.side === 'sell' ? `Sold ${r.qty} ${famName(r.family)} · +${r.total} ƒ` : `Bought ${r.qty} ${famName(r.family)} · −${r.total} ƒ`, 'good', r.family);
      onTraded(r.merchant);
    } catch (err) {
      if (err instanceof ApiFail && err.code === 'PRICE_MOVED') { toast(humanError(err), 'info'); onStale(); void requote(); }
      else { toast(humanError(err), 'bad'); play('error'); }
    } finally {
      setBusy(false);
    }
  };

  const afford = pick.side === 'buy' && q && me ? me.flux >= q.total : true;
  const reason = farReason ?? (qErr ? qErr : !afford ? `You have ${fmtInt(me?.flux ?? 0)} ƒ — not enough` : null);
  const verb = pick.side === 'sell' ? 'sell' : 'buy';
  return (
    <div className={s.panel} data-testid="trade-panel">
      <div className={s.panelHead}>
        <Sprite def={SHARDS[pick.family]} scale={3} anim />
        <div style={{ flex: 1 }}>
          <div className="pixel" style={{ fontSize: 22 }}>{pick.side === 'sell' ? 'Sell' : 'Buy'} {famName(pick.family)}</div>
          <div className="dim" style={{ fontSize: 13 }}>{pick.side === 'sell' ? `${m.name.split(' ')[0]} pays ${unit} ƒ for the first one` : `${unit} ƒ for the first one`}</div>
        </div>
        <Button size="s" variant="ghost" onClick={onClose}>✕</Button>
      </div>
      <div className={s.panelRow}>
        <Stepper value={qty} max={maxQty} onChange={setQty} />
        <div className={s.total} data-testid="quote-total">
          {q ? <><span><b className="num">{q.total}</b> ƒ</span><small>{q.unitPrices.length > 1 ? q.unitPrices.join(' + ') : 'exact total'}</small></> : <small>{qErr ?? 'quoting…'}</small>}
        </div>
      </div>
      {q && q.unitPrices.length > 1 && q.unitPrices[0] !== q.unitPrices[q.unitPrices.length - 1] ? (
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>The price slides with each unit: my stock changes as we trade.</div>
      ) : null}
      {reason ? <div className={s.reason}>{reason}</div> : null}
      <SlideToConfirm key={`${q?.quoteId}`} testId="slide-confirm" disabled={!q || busy || Boolean(reason)}
        label={q ? `Slide to ${verb} · ${q.total} ƒ` : 'Getting a quote…'} onConfirm={() => void confirm()} />
    </div>
  );
}

function ContractTab({ m, farReason, onDone }: { m: MerchantView; farReason: string | null; onDone: (m: MerchantView) => void }) {
  const me = useGame((st) => st.me);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const c = m.contract;
  if (!c) return <Card><p style={{ margin: 0 }}>No contract right now. Come back later — I post new ones every few hours.</p></Card>;
  const have = me?.shards[c.family] ?? 0;
  const reason = farReason ?? (have < c.qty ? `You have ${have}/${c.qty} ${famName(c.family)}` : null);
  return (
    <Card testId="contract-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Sprite def={SHARDS[c.family]} scale={4} anim />
        <div style={{ flex: 1 }}>
          <div className="pixel" style={{ fontSize: 22 }}>Bring me {c.qty} {famName(c.family)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}><Sprite def={FLUX} scale={2} /> {c.reward} ƒ reward</div>
          <div className="dim" style={{ fontSize: 13 }}>Ends in {fmtCountdown(c.expiresAt - now)}</div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Button variant="gold" block reason={reason} loading={busy} testId="deliver-btn" onClick={async () => {
          setBusy(true);
          try {
            const r = await api.deliver(m.id);
            setMe(r.me, r.levelUp);
            play('trade');
            toast(`Contract done! +${r.total} ƒ · +${r.xp} XP`, 'good', 'flux');
            onDone(r.merchant);
          } catch (e) { toast(humanError(e), 'bad'); } finally { setBusy(false); }
        }}>Deliver</Button>
      </div>
    </Card>
  );
}

function RescueTab({ m, farReason, onDone }: { m: MerchantView; farReason: string | null; onDone: (m: MerchantView) => void }) {
  const me = useGame((st) => st.me);
  const r = m.rescue;
  const needed = r ? Math.max(0, r.needed - r.raised) : 0;
  const max = Math.max(MERCHANT.rescueMin, Math.min(me?.flux ?? 0, needed || MERCHANT.rescueMin));
  const [amount, setAmount] = useState(Math.min(max, 100));
  const [busy, setBusy] = useState(false);
  if (!r) {
    return (
      <Card>
        <p style={{ margin: 0 }}>{m.status === 'open' ? 'Business is fine, thanks to Runners like you.' : 'Rescue opens soon.'}</p>
        {m.isPatron ? <p style={{ margin: '8px 0 0', fontWeight: 800 }}>★ You’re a patron here — half spread for 7 days.</p> : null}
      </Card>
    );
  }
  const lowFlux = (me?.flux ?? 0) < MERCHANT.rescueMin;
  const reason = farReason ?? ((me?.level ?? 0) < UNLOCKS.rescue ? `Investing unlocks at level ${UNLOCKS.rescue}` : lowFlux ? `Needs at least ${MERCHANT.rescueMin} ƒ` : null);
  return (
    <Card testId="rescue-card">
      <div className="pixel" style={{ fontSize: 22 }}>Needs {r.needed} ƒ to reopen</div>
      <div style={{ margin: '10px 0' }}><Gauge value={r.raised} max={r.needed} color="var(--green)" height={16} /></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 14 }}>
        <span>{r.raised} / {r.needed} ƒ</span><span>{r.contributors} contributor{r.contributors === 1 ? '' : 's'}</span>
      </div>
      {r.patron ? <div style={{ marginTop: 6, fontSize: 14 }}>Top patron: <b>{r.patron}</b></div> : null}
      <p className="dim" style={{ fontSize: 13 }}>Perks: biggest contributor becomes Patron · all contributors get half spread here for 7 days.</p>
      <input type="range" className={s.slider} min={MERCHANT.rescueMin} max={max} step={10} value={Math.min(amount, max)}
        onChange={(e) => setAmount(Number(e.target.value))} disabled={lowFlux} aria-label="Contribution" />
      <div style={{ marginTop: 10 }}>
        <Button variant="primary" block reason={reason} loading={busy} testId="rescue-btn" onClick={async () => {
          setBusy(true);
          try {
            const res = await api.rescue(m.id, Math.min(amount, max));
            setMe(res.me, res.levelUp);
            play('trade');
            toast(`Thanks! −${Math.min(amount, max)} ƒ invested`, 'good', 'flux');
            onDone(res.merchant);
          } catch (e) { toast(humanError(e), 'bad'); } finally { setBusy(false); }
        }}>Invest {Math.min(amount, max)} ƒ</Button>
      </div>
    </Card>
  );
}
