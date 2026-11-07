// HUD de la carte (Docs/09 §4 Carte) : haut = niveau/XP, Flux, crédits réels ; Réserve ; objectif épinglé ;
// bas = Bag · gros bouton contextuel · Quests ; barre de combo ; recentrage.
import { useEffect, useState } from 'react';
import { Backpack, ScrollText, LocateFixed, Target as TargetIcon, WifiOff, Zap, Volume2, VolumeX } from 'lucide-react';
import { CATCH } from '@tokengo/shared';
import { useGame, openOverlay, type Pos } from '../lib/store.ts';
import { contextual, type Target } from '../lib/nearby.ts';
import { fmtUsd } from '../lib/format.ts';
import { Counter, Pill, IconButton, Button } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { FLUX } from '../sprites/index.ts';
import { mapCtl } from '../map/ctl.ts';
import { EventBanner } from './EventBanner.tsx';
import { isMuted, setMuted } from '../lib/sound.ts';
import s from './Hud.module.css';

/** Position échantillonnée (pas de re-render à chaque frame de marche). */
export function useSampledPos(ms = 300): Pos | null {
  const [p, setP] = useState(useGame.getState().pos);
  useEffect(() => {
    const t = setInterval(() => setP(useGame.getState().pos), ms);
    return () => clearInterval(t);
  }, [ms]);
  return p;
}

function LevelRing({ level, into, need, onClick }: { level: number; into: number; need: number; onClick: () => void }) {
  const r = 22; const c = 2 * Math.PI * r;
  const k = need > 0 ? Math.min(1, into / need) : 1;
  return (
    <button type="button" className={s.level} onClick={onClick} aria-label={`Level ${level}, menu`} data-testid="level">
      <svg width={56} height={56} viewBox="0 0 56 56" aria-hidden>
        <circle cx={28} cy={28} r={r} fill="var(--panel)" stroke="var(--ink)" strokeWidth={9} />
        <circle cx={28} cy={28} r={r} fill="none" stroke="var(--white)" strokeWidth={5} />
        <circle cx={28} cy={28} r={r} fill="none" stroke="var(--lime)" strokeWidth={5} strokeDasharray={`${c * k} ${c}`}
          transform="rotate(-90 28 28)" style={{ transition: 'stroke-dasharray .5s var(--ease-out)' }} />
      </svg>
      <span className={s.levelNum}><small>Lv</small>{level}</span>
    </button>
  );
}

function ComboBar() {
  const me = useGame((st) => st.me);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  if (!me || me.combo < 2 || !me.comboExpiresAt || me.comboExpiresAt < now) return null;
  const left = (me.comboExpiresAt - now) / CATCH.comboWindowMs;
  return (
    <div className={s.combo} data-testid="combo">
      <span className="pixel">combo ×{me.combo}</span>
      <span className={s.comboTrack}>{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < Math.ceil(left * 5) ? s.on : ''} />)}</span>
    </div>
  );
}

export function Hud({ onAction }: { onAction: (t: Target) => void }) {
  const me = useGame((st) => st.me);
  const world = useGame((st) => st.world);
  const demo = useGame((st) => st.demo);
  const gps = useGame((st) => st.gps);
  const inTransit = useGame((st) => st.inTransit);
  const serverDown = useGame((st) => st.serverDown);
  const hidden = useGame((st) => st.hiddenSpawns);
  const pos = useSampledPos();
  const [following, setFollowing] = useState(true);
  const [muted, setMutedState] = useState(isMuted());
  useEffect(() => { mapCtl.onFollowChange = setFollowing; }, []);
  const ctx = contextual(world, pos, hidden, inTransit);
  const credits = me ? Math.max(0, me.credits.limitNusd - me.credits.usageNusd) : 0;
  const reserve = world?.reserve;
  const bagCount = me ? Object.values(me.shards).reduce((a, b) => a + b, 0) : 0;
  const variant = ctx.target?.kind === 'forge' ? 'gold' : ctx.target?.kind === 'market' ? 'gold' : 'primary';

  return (
    <div className={s.hud}>
      <div className={s.top} data-hud="top">
        <div className={s.row}>
          {me ? <LevelRing level={me.level} into={me.xpInto} need={me.xpNeed} onClick={() => openOverlay({ kind: 'menu' })} /> : null}
          <Pill className={s.fluxPill} testId="flux"><Sprite def={FLUX} scale={2} /><Counter value={me?.flux ?? 0} /></Pill>
          <Pill className={s.creditPill} onClick={() => openOverlay({ kind: 'credits' })} testId="credits-pill">
            <Zap size={16} strokeWidth={3} fill="var(--sun)" />
            <Counter value={credits} format={(n) => fmtUsd(n)} />
          </Pill>
        </div>
        <div className={s.row}>
          {reserve ? (
            <Pill className={s.reserve} testId="reserve">
              <span className={s.resLabel}>Reserve</span>
              <span className={s.resBar}>{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < Math.round(reserve.health * 5) ? s.on : ''} />)}</span>
              <span className="num">{fmtUsd(reserve.mainAvailNusd, 2)}</span>
              {reserve.simulated ? <span className={s.sim}>sim</span> : null}
            </Pill>
          ) : null}
          {demo ? <Pill className={s.demo} testId="demo-badge">🎯 Demo</Pill> : null}
          {gps === 'weak' ? <Pill className={s.warn}>Weak GPS</Pill> : null}
          <button type="button" className={s.mute} aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => { setMuted(!muted); setMutedState(!muted); }}>
            {muted ? <VolumeX size={18} strokeWidth={2.5} /> : <Volume2 size={18} strokeWidth={2.5} />}
          </button>
        </div>
        {serverDown ? <div className={s.banner}><WifiOff size={16} /> Offline — reconnecting…</div> : null}
        {inTransit ? <div className={s.banner}>In transit — catching paused</div> : null}
        <EventBanner />
        {world?.objective ? (
          <button type="button" className={s.objective} data-testid="objective" onClick={() => mapCtl.recenter()}>
            <TargetIcon size={18} strokeWidth={3} /> <span>{world.objective.text}</span>
          </button>
        ) : null}
      </div>

      <div className={s.bottom} data-hud="bottom">
        {!following ? (
          <button type="button" className={s.recenter} onClick={() => mapCtl.recenter()} aria-label="Recenter" data-testid="recenter">
            <LocateFixed strokeWidth={2.5} />
          </button>
        ) : null}
        <ComboBar />
        <div className={s.bar}>
          <div className={s.side}>
            <IconButton label="Bag" showLabel onClick={() => openOverlay({ kind: 'bag' })} testId="bag-btn"><Backpack strokeWidth={2.5} /></IconButton>
            {bagCount > 0 ? <span className={s.count}>{bagCount}</span> : null}
          </div>
          <div className={s.main}>
            <Button variant={variant} size="l" block testId="action-btn"
              reason={ctx.inRange ? null : ctx.reason}
              onClick={() => { if (ctx.target) onAction(ctx.target); }}>
              {ctx.label}
            </Button>
          </div>
          <div className={s.side}>
            <IconButton label="Quests" showLabel onClick={() => openOverlay({ kind: 'quests' })} testId="quests-btn"><ScrollText strokeWidth={2.5} /></IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}
