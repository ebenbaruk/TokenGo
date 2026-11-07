// Marchandage (Docs/03 §5 bis, Docs/09) : mini-jeu de cartes. Le serveur décide de tout ; ici on ne fait que montrer
// le portrait qui réagit, la patience, le prix qui défile et le tampon « DEAL! ».
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarCheck, DoorOpen, Handshake, Package, Sparkles, Store, TrendingDown, VenetianMask, X } from 'lucide-react';
import type { Family, HaggleCard, HaggleDealResponse, HaggleView, MerchantView, Side } from '@tokengo/shared';
import { api, ApiFail, humanError } from '../lib/api.ts';
import { setMe, toast, useGame } from '../lib/store.ts';
import { famName } from '../lib/format.ts';
import { buzz, play } from '../lib/sound.ts';
import { Button, Counter } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, accentOf, merchantSprite } from '../sprites/index.ts';
import s from './HaggleGame.module.css';

const CARD: Record<HaggleCard, { title: string; hint: string; icon: ReactNode; tone: string }> = {
  bulk: { title: 'Bulk deal', hint: 'Big orders talk', icon: <Package size={22} strokeWidth={2.6} />, tone: 'sky' },
  regular: { title: 'I’ll come back daily', hint: 'Loyalty pays — if it’s true', icon: <CalendarCheck size={22} strokeWidth={2.6} />, tone: 'lime' },
  rival: { title: 'Your rival', hint: '', icon: <Store size={22} strokeWidth={2.6} />, tone: 'sun' },
  bluff: { title: 'Cheaper down the street', hint: 'Pure bluff', icon: <VenetianMask size={22} strokeWidth={2.6} />, tone: 'plum' },
  compliment: { title: 'Compliment the shop', hint: 'Some love flattery', icon: <Sparkles size={22} strokeWidth={2.6} />, tone: 'pink' },
  lowball: { title: 'Lowball', hint: 'Risky. Very.', icon: <TrendingDown size={22} strokeWidth={2.6} />, tone: 'orange' },
  walk: { title: 'Walk away', hint: 'Will they call you back?', icon: <DoorOpen size={22} strokeWidth={2.6} />, tone: 'mist' },
};
const TRAIT = { greedy: 'Greedy', friendly: 'Friendly', proud: 'Proud' } as const;
const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 1 : 0)} %`;

export function HaggleGame({ m, pick, onClose, onDeal }: {
  m: MerchantView; pick: { family: Family; side: Side; qty: number }; onClose: () => void; onDeal: (r: HaggleDealResponse) => void;
}) {
  const [h, setH] = useState<HaggleView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState<'deal' | 'nodeal' | null>(null);
  const [react, setReact] = useState(0); // relance l'animation du portrait à chaque réplique
  const me = useGame((st) => st.me);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // une seule séance par ouverture (StrictMode rejoue les effets en dev)
    started.current = true;
    api.haggleStart(m.id, pick).then((v) => { setH(v); play('tap'); }).catch((e) => setErr(humanError(e)));
  }, [m.id, pick]);

  const playCard = async (card: HaggleCard) => {
    if (!h || busy) return;
    setBusy(true);
    try {
      const v = await api.hagglePlay(m.id, h.haggleId, card);
      setH(v);
      setReact((n) => n + 1);
      if (v.phase === 'sour' || v.phase === 'walked') { setStamp('nodeal'); play('error'); buzz([40, 40, 40]); }
      else if (v.face === 'annoyed') { play('miss'); buzz(60); }
      else if ((v.last?.gainedBp ?? 0) > 0) play('catch');
      else play('tap');
    } catch (e) {
      toast(humanError(e), 'bad');
      if (e instanceof ApiFail && e.code === 'EXPIRED') onClose();
    } finally { setBusy(false); }
  };

  const deal = async () => {
    if (!h || busy) return;
    setBusy(true);
    try {
      const r = await api.haggleDeal(m.id, h.haggleId);
      setH(r.haggle);
      setReact((n) => n + 1);
      setStamp('deal');
      play('perfect');
      buzz([30, 30, 80]);
      setMe(r.me, r.levelUp);
      useGame.setState({ lastResult: r });
      setTimeout(() => onDeal(r), 1500);
    } catch (e) {
      if (e instanceof ApiFail && e.code === 'PRICE_MOVED') {
        toast(humanError(e), 'info');
        if (typeof e.extra.total === 'number') setH({ ...h, total: e.extra.total }); // l'offre tient, sur le nouveau prix
      }
      else { toast(humanError(e), 'bad'); play('error'); }
      setBusy(false);
    }
  };

  const archetype = m.archetype;
  const accent = accentOf(m.id);
  const done = h?.phase === 'done';
  const over = h ? h.phase === 'sour' || h.phase === 'walked' : false;
  const saved = h ? Math.abs(h.baseTotal - h.total) : 0;
  const room = h ? Math.abs(h.baseTotal - h.bestTotal) : 0;
  const afford = !h || h.side === 'sell' || (me?.flux ?? 0) >= h.total;
  const verb = pick.side === 'buy' ? 'Buy' : 'Sell';

  return (
    <div className={s.screen} data-testid="haggle-game" role="dialog" aria-label={`Haggle with ${m.name}`}>
      <div className={s.top}>
        <div className={s.title}><Handshake size={22} strokeWidth={2.8} /> <span className="pixel">Haggle</span></div>
        {h ? <div className={s.rounds} aria-label={`Round ${h.round} of ${h.rounds}`}>
          {Array.from({ length: h.rounds }, (_, i) => <i key={i} className={i < (h.phase === 'open' ? h.round - 1 : h.rounds) ? s.roundDone : i === h.round - 1 && h.phase === 'open' ? s.roundNow : ''} />)}
        </div> : null}
        <button type="button" className={s.close} aria-label="Leave" data-testid="haggle-close" onClick={onClose}><X size={20} strokeWidth={3} /></button>
      </div>

      {err ? (
        <div className={s.errBox}><p>{err}</p><Button variant="primary" onClick={onClose}>Back to the shop</Button></div>
      ) : !h ? <p className={s.loading}>{m.name.split(' ')[0]} crosses their arms…</p> : (
        <>
          <div className={s.stage}>
            <div className={`${s.portrait} ${s[`face_${h.face}`]}`} key={react} style={{ background: accent.a }} data-testid="haggle-face" data-face={h.face}>
              <Sprite def={merchantSprite(archetype, m.id)} scale={4} frame={h.face === 'happy' ? 2 : h.face === 'annoyed' ? 0 : 1} />
              {h.face === 'annoyed' ? <span className={s.anger} aria-hidden /> : null}
              {h.face === 'happy' ? <span className={s.hearts} aria-hidden><i /><i /><i /></span> : null}
            </div>
            <div className={s.side}>
              <div className={s.name}>{m.name}</div>
              <div className={s.chips}>
                <span className={`${s.chip} ${s[`trait_${h.trait}`]}`}>{TRAIT[h.trait]}</span>
                {h.rep !== 0 ? <span className={s.chip}>{h.rep > 0 ? `★ ${h.rep}` : `☹ ${h.rep}`}</span> : null}
                {h.hints.map((x) => <span key={x} className={`${s.chip} ${s.hint}`}>{x}</span>)}
              </div>
              <div className={s.patience} data-testid="haggle-patience" data-value={h.patience} aria-label={`Patience ${h.patience} of ${h.patienceMax}`}>
                <small>Patience</small>
                <span>{Array.from({ length: h.patienceMax }, (_, i) => <i key={i} className={i < h.patience ? s.full : ''} />)}</span>
              </div>
            </div>
          </div>

          <div className={s.bubble} key={`b${react}`} data-testid="haggle-line">
            {h.line}
            {h.last && h.last.gainedBp > 0 && !done ? <b className={s.gain}>+{pct(h.last.gainedBp)}</b> : null}
          </div>

          <div className={s.board}>
            <div className={s.item}>
              <Sprite def={SHARDS[pick.family]} scale={2} anim />
              <span><b>{h.qty}×</b> {famName(pick.family)}<small>{verb === 'Buy' ? 'you buy' : 'you sell'}</small></span>
            </div>
            <div className={s.price}>
              {saved > 0 ? <del className={s.list} data-testid="haggle-base">{h.baseTotal} ƒ</del> : <span className={s.listPlain} data-testid="haggle-base">list price</span>}
              <span className={s.now} data-testid="haggle-total" data-value={h.total}><Counter value={h.total} showDelta={false} /> ƒ</span>
              {saved > 0 ? <span className={s.saved} data-testid="haggle-saved">{h.side === 'buy' ? '−' : '+'}{saved} ƒ</span> : null}
            </div>
            <div className={s.roomBar} aria-hidden>
              <i style={{ width: `${room ? Math.min(100, (saved / room) * 100) : 0}%` }} />
            </div>
            <small className={s.roomLabel}>{h.total === h.bestTotal && saved > 0 ? 'Rock bottom — they won’t go further' : `Best ${h.side === 'buy' ? 'possible' : 'they’d pay'}: ${h.bestTotal} ƒ`} · offer {pct(h.offerBp)} / max {pct(h.maxBp)}</small>
          </div>

          {h.phase === 'open' ? (
            <div className={s.cards} data-testid="haggle-cards">
              {h.hand.map(({ card, rival }) => {
                const c = CARD[card];
                const title = card === 'rival' && rival
                  ? <>{rival.merchant} {h.side === 'buy' ? 'sells' : 'pays'} <span className={s.nowrap}>{rival.price} ƒ</span></> : c.title;
                const hint = card === 'rival' && rival ? `I saw it at ${rival.place}` : c.hint;
                return (
                  <button key={card} type="button" className={`${s.card} ${s[`tone_${c.tone}`]}`} data-testid={`haggle-card-${card}`} disabled={busy}
                    onClick={() => void playCard(card)}>
                    <span className={s.cardIcon}>{c.icon}</span>
                    <span className={s.cardTitle}>{title}</span>
                    <span className={s.cardHint}>{hint}</span>
                  </button>
                );
              })}
            </div>
          ) : h.phase === 'final' ? <div className={s.final}>Final offer — take it or leave it.</div> : null}

          <div className={s.foot}>
            {done ? <div className={s.sealed}>Handshake! {saved > 0 ? `You ${h.side === 'buy' ? 'saved' : 'earned'} ${saved} ƒ.` : ''}</div> : over ? (
              <Button variant="dark" block testId="haggle-leave" onClick={onClose}>{h.phase === 'sour' ? 'Leave (they’re sulking)' : 'Leave'}</Button>
            ) : (
              <Button variant="gold" size="l" block testId="haggle-deal" loading={busy && !done} disabled={done}
                reason={afford ? null : `You have ${me?.flux ?? 0} ƒ`} onClick={() => void deal()}>
                <Handshake size={22} strokeWidth={2.8} /> Deal · {h.total} ƒ
              </Button>
            )}
          </div>
        </>
      )}
      {stamp ? <div className={`${s.stamp} ${stamp === 'deal' ? s.stampDeal : s.stampNo}`} data-testid="haggle-stamp">{stamp === 'deal' ? 'DEAL!' : 'NO DEAL'}</div> : null}
    </div>
  );
}
