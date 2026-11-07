// Bannière de l'événement de ville en cours (partagé par tous) : titre, effet, compte à rebours, distance. Tap = voir la zone.
import { useEffect, useState } from 'react';
import { LIVING, haversineM } from '@tokengo/shared';
import { useGame } from '../lib/store.ts';
import { fmtCountdown } from '../lib/format.ts';
import { mapCtl } from '../map/ctl.ts';
import { EVENT_COLORS } from '../map/living.ts';
import { RaidBanner } from './RaidBanner.tsx';
import s from './EventBanner.module.css';

const ICON = { flash_crash: '▼', hype: '▲', gold_rush: '★', strike: '✋', rogue: '⚠' } as const;

export function EventBanner() {
  const e = useGame((st) => st.world?.event ?? null);
  const skew = useGame((st) => st.skewMs);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const pos = useGame.getState().pos;
  if (!e) return null;
  const left = e.endsAt - (now + skew);
  if (left <= 0) return null;
  const d = pos ? haversineM(pos, e) : null;
  if (d !== null && d > LIVING.eventFarM) return null; // joueur dans une autre ville (monde « partout ») : l'événement reste dans le Pulse
  const where = d === null ? '' : d <= e.radiusM ? 'you’re in the zone!' : d < 1000 ? `${Math.round(d / 10) * 10} m away` : `${(d / 1000).toFixed(1)} km away`;
  if (e.kind === 'rogue') return <RaidBanner e={e} left={left} where={where} />; // Raid (Docs/13 §6)
  const c = EVENT_COLORS[e.kind];
  return (
    <button type="button" className={s.banner} data-testid="event-banner" data-kind={e.kind} onClick={() => mapCtl.lookAt(e)}
      aria-label={`${e.title}: ${e.effect}. ${fmtCountdown(left)} left. Show on map`}>
      <span className={s.icon} style={{ background: c.line }} aria-hidden>{ICON[e.kind]}</span>
      <span className={s.body}>
        <span className={s.title}>{e.title}</span>
        <span className={s.effect}>{e.effect}{where ? <> · <em>{where}</em></> : null}</span>
      </span>
      <span className={`${s.time} num`}>{fmtCountdown(left)}</span>
    </button>
  );
}
