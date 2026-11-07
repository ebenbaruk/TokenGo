// Missions du jour (Docs/13 §7) : 3 cartes en haut de la feuille Quests (barre de progression, Claim, petite fête),
// puis le coffre du jour (les 3 réclamées → +60 ƒ + 1 Gemini). Le serveur décide de tout ; on rafraîchit quand `me.missions` change.
import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import type { MissionClaimResponse, MissionView, MissionsView } from '@tokengo/shared';
import { api, ApiFail } from '../lib/api.ts';
import { setMe, toast, useGame } from '../lib/store.ts';
import { feedback, play } from '../lib/sound.ts';
import { famName, fmtSpan } from '../lib/format.ts';
import { Button, Counter } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { FLUX, SHARDS } from '../sprites/index.ts';
import { CHEST, CHEST_OPEN } from '../sprites/missions.grids.ts';
import s from './MissionsPanel.module.css';

const GROUP_COLOR: Record<MissionView['group'], string> = { arena: 'var(--sun)', explore: 'var(--cyan)', trade: 'var(--lime)', raid: 'var(--berry)' };
const CONFETTI = ['#ffcd75', '#38b764', '#41a6f6', '#b13e53', '#f4f4f4', '#ef7d57'];

export function MissionsPanel() {
  const badge = useGame((st) => st.me?.missions);
  const [v, setV] = useState<MissionsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [burst, setBurst] = useState<string | null>(null);
  const [chest, setChest] = useState<MissionClaimResponse['chest']>(null);
  const [err, setErr] = useState(false);

  // pastille de Me (progression faite ailleurs) → on relit la liste
  const key = badge ? `${badge.ready}:${badge.claimed}:${badge.readyIds.join(',')}` : '';
  useEffect(() => { api.missions().then((r) => { setV(r); setErr(false); }).catch(() => setErr(true)); }, [key]);

  const claim = async (m: MissionView) => {
    setBusy(m.id);
    try {
      const r = await api.claimMission(m.id);
      setV(r.missions);
      setMe(r.me, r.levelUp);
      setBurst(m.id);
      setTimeout(() => setBurst(null), 1400);
      feedback('coin', 'good');
      if (r.chest) {
        setTimeout(() => { setChest(r.chest); play('route'); }, 650);
      }
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Could not claim — try again.', 'bad');
      play('error');
    } finally { setBusy(null); }
  };

  if (!v) return err ? <p className="dim">Missions are napping — pull to refresh in a moment.</p> : <div className={s.skeleton} aria-busy />;
  const claimed = v.claimed;
  return (
    <section className={s.panel} data-testid="missions">
      <div className={s.head}>
        <h3 className={s.h3}>Daily missions</h3>
        <span className={s.reset}>new in {fmtSpan(v.resetAt - Date.now())}</span>
      </div>
      {v.missions.map((m) => {
        const ready = m.done && !m.claimed;
        const pct = Math.round((m.progress / m.goal) * 100);
        return (
          <div key={m.id} className={`${s.card} ${ready ? s.ready : ''} ${m.claimed ? s.claimed : ''}`} data-testid={`mission-${m.id}`}
            data-state={m.claimed ? 'claimed' : ready ? 'ready' : 'todo'}>
            <div className={s.icon} style={{ background: GROUP_COLOR[m.group] }} aria-hidden>{m.icon}</div>
            <div className={s.main}>
              <div className={s.title}>{m.title}</div>
              <div className={s.hint}>{m.hint}</div>
              <div className={s.barRow}>
                <span className={s.bar}><i style={{ width: `${pct}%` }} /></span>
                <span className={`${s.count} num`} data-testid={`mission-${m.id}-progress`}>{m.progress}/{m.goal}</span>
              </div>
            </div>
            <div className={s.end}>
              {m.claimed ? (
                <span className={s.done}><Check size={18} strokeWidth={4} /> Done</span>
              ) : ready ? (
                <Button variant="gold" size="s" loading={busy === m.id} onClick={() => void claim(m)} testId={`mission-${m.id}-claim`}>Claim</Button>
              ) : (
                <span className={s.reward}><b>+{m.reward.xp}</b> XP<br /><b>+{m.reward.flux}</b> ƒ</span>
              )}
            </div>
            {burst === m.id ? (
              <div className={s.burst} aria-hidden>
                {Array.from({ length: 14 }, (_, i) => (
                  <i key={i} style={{ '--a': `${i * 26}deg`, '--c': CONFETTI[i % CONFETTI.length], '--d': `${(i % 4) * 0.03}s` } as CSSProperties} />
                ))}
                <span className={s.float}>+{m.reward.xp} XP · +{m.reward.flux} ƒ</span>
              </div>
            ) : null}
          </div>
        );
      })}
      <div className={`${s.chest} ${v.chest.opened ? s.chestOpen : ''}`} data-testid="mission-chest" data-opened={v.chest.opened ? 1 : 0}>
        <Sprite def={v.chest.opened ? CHEST_OPEN : CHEST} scale={3} anim={v.chest.opened} />
        <div className={s.main}>
          <div className={s.title}>{v.chest.opened ? 'Daily chest opened!' : 'Daily chest'}</div>
          <div className={s.hint}>{v.chest.opened ? 'Come back tomorrow for 3 new missions.' : `Claim all 3 → +${v.chest.flux} ƒ + 1 ${famName(v.chest.shard)}`}</div>
        </div>
        <div className={s.pips} aria-label={`${claimed} of 3 claimed`}>
          {[0, 1, 2].map((i) => <i key={i} className={i < claimed ? s.pipOn : ''} />)}
        </div>
      </div>
      {chest ? <ChestParty chest={chest} onClose={() => setChest(null)} /> : null}
    </section>
  );
}

/** Coffre du jour : il s'ouvre, les récompenses roulent. */
function ChestParty({ chest, onClose }: { chest: NonNullable<MissionClaimResponse['chest']>; onClose: () => void }) {
  return createPortal(
    <div className={s.party} data-testid="chest-party" onClick={onClose}>
      <div className={s.confetti} aria-hidden>
        {Array.from({ length: 28 }, (_, i) => (
          <i key={i} style={{ '--x': `${(i * 37) % 100}%`, '--d': `${(i % 9) * 0.12}s`, '--c': CONFETTI[i % CONFETTI.length], '--r': `${(i % 5) * 40 - 80}deg` } as CSSProperties} />
        ))}
      </div>
      <div className={s.partyCard} onClick={(e) => e.stopPropagation()}>
        <div className={s.kicker}>3 / 3 missions done</div>
        <div className={s.partyChest}><Sprite def={CHEST_OPEN} scale={6} anim /></div>
        <h2 className={s.partyTitle}>Chest unlocked!</h2>
        <div className={s.partyRewards}>
          <span><Sprite def={FLUX} scale={3} /><Counter value={chest.flux} format={(n) => `+${Math.round(n)}`} showDelta={false} /> ƒ</span>
          <span><Sprite def={SHARDS[chest.shard]} scale={3} anim />+1 {famName(chest.shard)}</span>
        </div>
        <Button variant="gold" block onClick={onClose} testId="chest-close">Sweet!</Button>
      </div>
    </div>,
    document.body,
  );
}
