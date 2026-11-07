// HUD de la carte (Docs/09 §4 Carte) : haut = niveau/XP, Flux, crédits réels ; Réserve ; objectif épinglé ;
// bas = Bag · gros bouton contextuel · Quests ; barre de combo ; recentrage.
import { useEffect, useState } from 'react';
import { Backpack, ScrollText, LocateFixed, Target as TargetIcon, WifiOff, Zap, Volume2, VolumeX, Footprints, BatteryCharging } from 'lucide-react';
import { CATCH, SCOUT, scoutCharge, scoutResumeAt, type RegionStatus } from '@tokengo/shared';
import { useGame, openOverlay, type Pos } from '../lib/store.ts';
import { contextual, type Target } from '../lib/nearby.ts';
import { fmtUsd } from '../lib/format.ts';
import { Counter, Pill, IconButton, Button } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { FLUX, SCOUT as SCOUT_SPRITE } from '../sprites/index.ts';
import { mapCtl } from '../map/ctl.ts';
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

/** Badge de mode : Remote Scout (pigeon-drone) ou marche réelle (GPS). */
function ModeBadge({ demo }: { demo: boolean }) {
  return demo
    ? <Pill className={s.scoutBadge} testId="mode-badge"><Sprite def={SCOUT_SPRITE} scale={1} anim /> Scout</Pill>
    : <Pill className={s.walkBadge} testId="mode-badge"><Footprints size={15} strokeWidth={2.8} /> Walking</Pill>;
}

/** Batterie du Scout (prédiction locale à 1 Hz ; le serveur reste autoritaire) + bandeau « au sol ». */
function useScoutNow() {
  const scout = useGame((st) => st.scout);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return scout ? scoutCharge(scout, now) : null;
}

function BatteryPill() {
  const sc = useScoutNow();
  if (!sc) return null;
  const pct = Math.floor(sc.battery);
  const tone = sc.grounded || pct < 20 ? s.batLow : pct < 50 ? s.batMid : s.batHigh;
  return (
    <Pill className={`${s.battery} ${sc.grounded ? s.batGrounded : ''}`} testId="battery">
      <span className={`${s.batBody} ${tone}`} aria-hidden>
        {Array.from({ length: 5 }, (_, i) => <i key={i} className={i < Math.ceil(pct / 20) ? s.on : ''} />)}
      </span>
      <span className="num" data-testid="battery-pct">{pct}%</span>
    </Pill>
  );
}

function GroundedBanner() {
  const sc = useScoutNow();
  const resumeAt = sc ? scoutResumeAt(sc) : null;
  if (!sc?.grounded || resumeAt === null) return null;
  const left = Math.max(0, Math.ceil((resumeAt - Date.now()) / 1000));
  return (
    <div className={`${s.banner} ${s.grounded}`} data-testid="scout-grounded">
      <BatteryCharging size={16} /> Scout recharging · flies again in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
    </div>
  );
}

/** Monde « partout » : repérage du quartier en cours, ou plafond du jour atteint. */
function RegionCard({ region }: { region: RegionStatus | undefined }) {
  if (!region || region.status === 'ready') return null;
  if (region.status === 'scouting') {
    return (
      <div className={s.regionCard} data-testid="scouting" role="status">
        <span className={s.regionArt}><Sprite def={SCOUT_SPRITE} scale={2} anim /></span>
        <span><b>Scouting your neighbourhood…</b><small>Mapping real cafés, parks and landmarks from OpenStreetMap.</small></span>
      </div>
    );
  }
  return (
    <div className={s.regionCard} data-testid="region-capped" role="status">
      <span className={s.regionArt}><Sprite def={SCOUT_SPRITE} scale={2} /></span>
      <span><b>No new neighbourhoods today</b><small>Our scouts are resting. <a href="/?demo=1">Fly a Remote Scout over Paris</a> meanwhile.</small></span>
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
      <div className={s.top}>
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
          <ModeBadge demo={demo} />
          {demo ? <BatteryPill /> : null}
          {gps === 'weak' ? <Pill className={s.warn}>Weak GPS</Pill> : null}
          <button type="button" className={s.mute} aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => { setMuted(!muted); setMutedState(!muted); }}>
            {muted ? <VolumeX size={18} strokeWidth={2.5} /> : <Volume2 size={18} strokeWidth={2.5} />}
          </button>
        </div>
        {serverDown ? <div className={s.banner}><WifiOff size={16} /> Offline — reconnecting…</div> : null}
        {inTransit ? <div className={s.banner}>In transit — catching paused</div> : null}
        {demo ? <GroundedBanner /> : null}
        <RegionCard region={world?.region} />
        {world?.objective ? (
          <button type="button" className={s.objective} data-testid="objective" onClick={() => mapCtl.recenter()}>
            <TargetIcon size={18} strokeWidth={3} /> <span>{world.objective.text}</span>
          </button>
        ) : null}
      </div>

      <div className={s.bottom}>
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
