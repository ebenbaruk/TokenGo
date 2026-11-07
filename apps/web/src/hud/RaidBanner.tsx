// Bannière du Raid « Rogue Model » (Docs/13 §6) : « ⚠ ROGUE MODEL at Louvre — 3 120 / 4 400 HP — weak to ✍️ Writing ».
// PV en direct (SSE), chiffres de dégâts de la ville qui volent. Tap : ouvre la Forge du boss (onglet Raid) ou montre où elle est.
import { CATEGORY_INFO, haversineM, type CityEventView } from '@tokengo/shared';
import { useGame, openOverlay } from '../lib/store.ts';
import { useRaid } from '../lib/raid.ts';
import { fmtCountdown } from '../lib/format.ts';
import { mapCtl } from '../map/ctl.ts';
import { BossArt, BossHpBar, FlyingHits } from '../screens/raidUi.tsx';
import { CatIcon } from '../screens/arenaUi.tsx';
import s from './RaidBanner.module.css';

const OPEN_WITHIN_M = 1500;

export function RaidBanner({ e, left, where }: { e: CityEventView; left: number; where: string }) {
  const hits = useRaid((st) => st.hits);
  const r = e.raid;
  if (!r || r.status !== 'active') return null;
  const tap = () => {
    const st = useGame.getState();
    const node = st.world?.nodes.find((n) => n.id === r.forgeId);
    if (node && st.pos && haversineM(st.pos, node) <= OPEN_WITHIN_M) openOverlay({ kind: 'forge', node });
    else mapCtl.lookAt(e, 15.5);
  };
  return (
    <button type="button" className={s.banner} data-testid="event-banner" data-kind="rogue" onClick={tap}
      aria-label={`Rogue model ${r.boss} at ${r.forgeName}: ${r.hp} of ${r.maxHp} HP, weak to ${CATEGORY_INFO[r.weakness].name}. ${fmtCountdown(left)} left.`}>
      <span className={s.art}><BossArt bossId={r.bossId} scale={2} /></span>
      <span className={s.body}>
        <span className={s.title}><b className={s.warn}>⚠ ROGUE MODEL</b> at {r.forgeName}</span>
        <BossHpBar hp={r.hp} max={r.maxHp} size="s" testId="raid-banner-hp" />
        <span className={s.sub}>
          <span className={s.boss}>{r.boss}</span> · weak to <CatIcon cat={r.weakness} size={11} /> <b>{CATEGORY_INFO[r.weakness].name}</b>
          {where ? <> · <em>{where}</em></> : null}
        </span>
      </span>
      <span className={`${s.time} num`}>{fmtCountdown(left)}</span>
      <FlyingHits hits={hits} />
    </button>
  );
}
