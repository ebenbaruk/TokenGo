// Relay : grand disque « Swipe to sync », loot qui jaillit, compte à rebours de recharge.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { haversineM, type NodeView, type SyncResponse } from '@tokengo/shared';
import { api, humanError } from '../lib/api.ts';
import { useGame, setMe, toast } from '../lib/store.ts';
import { radiusFor } from '../lib/nearby.ts';
import { refreshWorld } from '../geo/engine.ts';
import { famName, fmtCountdown } from '../lib/format.ts';
import { play, buzz } from '../lib/sound.ts';
import { Sheet } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { RELAY, RELAY_COOLDOWN, FLUX, XP_STAR, SHARDS } from '../sprites/index.ts';
import s from './RelaySheet.module.css';

export function RelaySheet({ node, onClose }: { node: NodeView; onClose: () => void }) {
  const pos = useGame((st) => st.pos);
  const [cooldownUntil, setCooldownUntil] = useState(node.cooldownUntil ?? 0);
  const [now, setNow] = useState(Date.now());
  const [loot, setLoot] = useState<SyncResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [rot, setRot] = useState(0);
  const drag = useRef<{ x: number; y: number; acc: number } | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

  const dist = pos ? haversineM(pos, node) : Infinity;
  const inRange = pos ? dist <= radiusFor('relay', pos) : false;
  const cd = cooldownUntil - now;
  const reason = cd > 0 ? `Relay recharging · ${fmtCountdown(cd)}` : !inRange ? `${Math.round(dist)} m away — get a bit closer` : null;

  const doSync = async () => {
    if (busy || reason) return;
    setBusy(true);
    play('sync');
    buzz(30);
    try {
      const r = await api.sync(node.id);
      useGame.setState({ lastResult: r });
      setLoot(r);
      setCooldownUntil(r.cooldownUntil);
      setMe(r.me, r.levelUp);
      void refreshWorld(true);
      play('catch');
    } catch (e) {
      toast(humanError(e), 'bad');
      play('error');
    } finally {
      setBusy(false);
    }
  };

  const down = (e: RPointerEvent) => { if (reason || busy) return; drag.current = { x: e.clientX, y: e.clientY, acc: 0 }; (e.target as Element).setPointerCapture(e.pointerId); };
  const move = (e: RPointerEvent) => {
    if (!drag.current) return;
    const d = Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y);
    drag.current.acc += d;
    drag.current.x = e.clientX; drag.current.y = e.clientY;
    setRot((r) => r + d * 2.2);
    if (drag.current.acc > 140) { drag.current = null; void doSync(); }
  };
  const up = () => { drag.current = null; };

  return (
    <Sheet open onClose={onClose} title={node.name} subtitle={`Relay · ${node.category} · ${Number.isFinite(dist) ? `${Math.round(dist)} m` : ''}`}
      icon={<Sprite def={cd > 0 ? RELAY_COOLDOWN : RELAY} scale={2} anim />} testId="relay-sheet">
      <div className={s.wrap}>
        <div className={`${s.disc} ${reason ? s.off : ''} ${busy ? s.spinning : ''}`} style={{ transform: `rotate(${rot}deg)` }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onKeyDown={(e) => { if (e.key === 'Enter') void doSync(); }}
          role="button" tabIndex={0} aria-label="Swipe to sync" data-testid="sync-disc">
          <div className={s.inner}><Sprite def={cd > 0 ? RELAY_COOLDOWN : RELAY} scale={3} anim={!reason} /></div>
        </div>
        {cd > 0 ? (
          <div className={s.cd}>
            <svg width={64} height={64} viewBox="0 0 64 64" aria-hidden>
              <circle cx={32} cy={32} r={26} fill="none" stroke="var(--mist)" strokeWidth={8} />
              <circle cx={32} cy={32} r={26} fill="none" stroke="var(--sky)" strokeWidth={8} strokeDasharray={`${163 * (1 - cd / 300_000)} 163`} transform="rotate(-90 32 32)" />
            </svg>
            <span className="num">{fmtCountdown(cd)}</span>
          </div>
        ) : null}
        <div className={s.label} data-testid="relay-status">{reason ?? (busy ? 'Syncing…' : 'Swipe the disc to sync')}</div>
        {loot ? (
          <div className={s.loot} data-testid="relay-loot">
            <span className={s.item} style={{ animationDelay: '0s' }}><Sprite def={FLUX} scale={3} /> +{loot.flux} ƒ</span>
            {loot.shard ? <span className={s.item} style={{ animationDelay: '.12s' }}><Sprite def={SHARDS[loot.shard]} scale={3} /> +1 {famName(loot.shard)}</span> : null}
            <span className={s.item} style={{ animationDelay: '.24s' }}><Sprite def={XP_STAR} scale={3} /> +{loot.xp} XP{loot.firstVisit ? ' · New node!' : ''}</span>
          </div>
        ) : null}
        {node.affinities.length ? <p className="dim" style={{ margin: 0, fontSize: 14 }}>This spot attracts {node.affinities.map(famName).join(' & ')} shards.</p> : null}
      </div>
    </Sheet>
  );
}
