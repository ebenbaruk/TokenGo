// Daily Route : checklist des arrêts du jour (feuille) + fête plein écran quand la route est bouclée.
import { useState, type CSSProperties } from 'react';
import { haversineM, type DailyRouteView } from '@tokengo/shared';
import { Check, Footprints, Share2 } from 'lucide-react';
import { useGame, celebrate, toast, openOverlay, type Celebration } from '../lib/store.ts';
import { famName, fmtDist } from '../lib/format.ts';
import { walkTo } from '../geo/engine.ts';
import { routeCard, shareImage } from '../lib/share.ts';
import { Sheet, Button, Counter } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { FORGE, RELAY, FLUX, XP_STAR, SHARDS, marketSprite } from '../sprites/index.ts';
import s from './RouteSheet.module.css';

const KIND_LABEL = { relay: 'Relay', market: 'Merchant', forge: 'Forge' } as const;

function StopIcon({ st }: { st: DailyRouteView['stops'][number] }) {
  if (st.kind === 'forge') return <Sprite def={FORGE} scale={1} />;
  if (st.kind === 'market') return <Sprite def={marketSprite(st.id)} scale={1} />;
  return <Sprite def={RELAY} scale={1} />;
}

export function RouteSheet({ onClose }: { onClose: () => void }) {
  const route = useGame((st) => st.world?.route);
  const pos = useGame((st) => st.pos);
  const demo = useGame((st) => st.demo);
  if (!route) {
    return (
      <Sheet open onClose={onClose} title="Daily Route" testId="route-sheet">
        <p className="dim">No route around here today — walk towards relays and merchants.</p>
      </Sheet>
    );
  }
  const next = route.stops.find((x) => !x.done);
  const complete = route.completedAt !== null;
  return (
    <Sheet open onClose={onClose} title="Daily Route" subtitle={`${route.total} real places · ≈ ${fmtDist(route.lengthM)} loop · new one tomorrow`} testId="route-sheet">
      <div className={s.stack}>
        <div className={`${s.reward} ${complete ? s.rewardDone : ''}`}>
          <span className={s.rLabel}>{complete ? 'Collected today' : 'Reward'}</span>
          <span className={s.rItem}><Sprite def={XP_STAR} scale={2} /> <b className="num">+{route.reward.xp}</b> XP</span>
          <span className={s.rItem}><Sprite def={FLUX} scale={2} /> <b className="num">+{route.reward.flux}</b> ƒ</span>
          <span className={s.rItem}><Sprite def={SHARDS[route.reward.shard]} scale={2} /> <b className="num">+1</b> {famName(route.reward.shard)}</span>
          {route.streak > 0 ? <span className={s.streak}>🔥 {route.streak}-day streak</span> : <span className={s.streakHint}>Finish daily to build a streak (+10 ƒ per day, max +30)</span>}
        </div>
        <ol className={s.list} data-testid="route-stops">
          {route.stops.map((st, i) => {
            const d = pos ? haversineM(pos, st) : null;
            return (
              <li key={st.id} className={`${s.stop} ${st.done ? s.done : ''} ${st === next ? s.next : ''}`} data-done={st.done ? '1' : '0'}>
                <span className={s.num}>{st.done ? <Check size={16} strokeWidth={4} /> : i + 1}</span>
                <span className={s.icon}><StopIcon st={st} /></span>
                <span className={s.main}>
                  <b>{st.name}</b>
                  <small>{KIND_LABEL[st.kind]}{d !== null && !st.done ? ` · ${fmtDist(d)}` : st.done ? ' · checked in' : ''}</small>
                </span>
                {!st.done && demo ? <Button size="s" onClick={() => { onClose(); walkTo(st); }}><Footprints size={14} /> Go</Button> : null}
              </li>
            );
          })}
        </ol>
        <p className="dim" style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>Just walk within reach of each stop — it checks in by itself.</p>
      </div>
    </Sheet>
  );
}

/** Fête plein écran (confettis pixel, récompenses qui roulent, carte partageable). */
export function RouteCelebration({ c }: { c: Extract<Celebration, { kind: 'route' }> }) {
  const route = useGame((st) => st.world?.route);
  const [busy, setBusy] = useState(false);
  const r = c.checkin;
  const close = () => celebrate(null);
  const share = async () => {
    setBusy(true);
    try {
      const blob = await routeCard(r, route?.stops ?? [], route?.lengthM ?? 0);
      await shareImage(blob, 'tokengo-daily-route.png', `Daily Route done on TokenGo — ${r.total} stops${r.streak > 1 ? `, ${r.streak}-day streak` : ''}!`, 'route');
    } catch { toast('Could not make the card — try again.', 'bad'); } finally { setBusy(false); }
  };
  return (
    <div className={`${s.party} pixel-pattern`} data-testid="route-complete" onClick={close}>
      <div className={s.confetti} aria-hidden>
        {Array.from({ length: 36 }, (_, i) => (
          <i key={i} style={{ '--x': `${(i * 37) % 100}%`, '--d': `${(i % 9) * 0.12}s`, '--c': ['#ffcd75', '#38b764', '#41a6f6', '#b13e53', '#f4f4f4', '#ef7d57'][i % 6], '--r': `${(i % 5) * 40 - 80}deg` } as CSSProperties} />
        ))}
      </div>
      <div className={s.partyCard} onClick={(e) => e.stopPropagation()}>
        <div className={s.partyKicker}>Daily Route</div>
        <h2 className={s.partyTitle}>Loop complete!</h2>
        <div className={s.partyStops}>{Array.from({ length: r.total }, (_, i) => <i key={i} style={{ animationDelay: `${0.15 + i * 0.12}s` }}><Check size={14} strokeWidth={4} /></i>)}</div>
        {r.reward ? (
          <div className={s.partyRewards}>
            <span><Sprite def={XP_STAR} scale={3} /><Counter value={r.reward.xp} format={(n) => `+${Math.round(n)}`} showDelta={false} /> XP</span>
            <span><Sprite def={FLUX} scale={3} /><Counter value={r.reward.flux} format={(n) => `+${Math.round(n)}`} showDelta={false} /> ƒ</span>
            <span><Sprite def={SHARDS[r.reward.shard]} scale={3} anim />+1 {famName(r.reward.shard)}</span>
          </div>
        ) : null}
        {r.streak > 0 ? <div className={s.partyStreak}>🔥 {r.streak}-day streak{r.streak > 1 ? ' — keep it going!' : ' — come back tomorrow!'}</div> : null}
        <div className={s.partyActions}>
          <Button variant="gold" block onClick={() => void share()} loading={busy} testId="route-share"><Share2 size={18} /> Share card</Button>
          <Button block onClick={() => { close(); openOverlay({ kind: 'codex' }); }}>Codex</Button>
          <Button block variant="ghost" onClick={close} testId="route-close">Nice!</Button>
        </div>
      </div>
    </div>
  );
}
