// Écran de fin collectif du Raid (Docs/13 §6) : « The city contained Overfit Prime! » + ta part des dégâts, récompenses,
// top 3, titre Codex « Rogue Slayer », maîtrise. Monté par l'écran d'assaut (dernier coup) ou par RaidEndHost (annonce SSE).
import { useEffect, useState, type CSSProperties } from 'react';
import type { Family, RaidResultView } from '@tokengo/shared';
import { api } from '../lib/api.ts';
import { toast, useGame } from '../lib/store.ts';
import { clearRaidEnd, isEndShown, markEndShown, useRaid } from '../lib/raid.ts';
import { famName } from '../lib/format.ts';
import { feedback, play } from '../lib/sound.ts';
import { Button, Counter } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, XP_STAR, FLUX } from '../sprites/index.ts';
import { bossSprite } from '../sprites/raid.grids.ts';
import { RAID_BOSSES } from '@tokengo/shared';
import { fmtHp } from './raidUi.tsx';
import s from './RaidEnd.module.css';

const bossIdOf = (name: string) => RAID_BOSSES.find((b) => b.name === name)?.id ?? 'glitch9';

export function RaidEndScreen({ result: r, onClose, inline }: { result: RaidResultView; onClose?: () => void; inline?: boolean }) {
  const won = r.outcome === 'won';
  const pct = Math.round(r.share * 100);
  const body = (
    <div className={`${s.card} ${won ? s.won : s.lost}`} data-testid="raid-end" data-outcome={r.outcome}>
      <div className={s.bossWrap}>
        {won ? <div className={s.rays} /> : null}
        <span className={won ? s.shatter : s.escape}><Sprite def={bossSprite(bossIdOf(r.boss))} scale={inline ? 4 : 6} anim /></span>
      </div>
      <div className={`${s.stamp} ${won ? s.stampWin : s.stampLose}`}>{won ? 'CONTAINED!' : 'ESCAPED'}</div>
      <h2 className={s.title} data-testid="raid-end-title">{won ? `The city contained ${r.boss}!` : `${r.boss} slipped away…`}</h2>
      <div className={s.share} data-testid="raid-end-share">
        <span><small>Your damage</small><b className="num"><Counter value={r.damage} showDelta={false} duration={1000} format={(n) => fmtHp(n)} /></b></span>
        <span><small>Your share</small><b className="num">{pct}%</b></span>
        <span><small>Rank</small><b className="num">{r.rank ? `#${r.rank}` : '—'}</b></span>
      </div>
      <div className={s.meter}><i style={{ width: `${Math.max(2, pct)}%` }} /><span>you · the city</span></div>
      <div className={s.rewards}>
        <span className={s.rw} data-testid="raid-end-xp"><Sprite def={XP_STAR} scale={1} /> +{r.xp} XP</span>
        {r.flux > 0 ? <span className={`${s.rw} ${s.rwFlux}`} data-testid="raid-end-flux"><Sprite def={FLUX} scale={1} /> +{r.flux} ƒ</span> : null}
        {r.top3 ? <span className={`${s.rw} ${s.rwTop}`} data-testid="raid-end-top3" title="+40 ƒ included">★ Top 3 bonus</span> : null}
      </div>
      {r.title ? (
        <div className={s.title2} data-testid="raid-end-codex-title">
          <span className={s.badge}>★</span>
          <span><small>New Codex title</small><b>{r.title}</b></span>
        </div>
      ) : null}
      {Object.keys(r.masteryGains).length ? (
        <div className={s.gains}>
          {(Object.entries(r.masteryGains) as [Family, number][]).map(([f, g], i) => (
            <span key={f} className={s.gain} style={{ '--d': `${0.5 + i * 0.12}s` } as CSSProperties}>
              <Sprite def={SHARDS[f]} scale={2} anim /> <b>{famName(f)}</b> <em>+{g} mastery</em>
              {r.masteryUps.find((u) => u.family === f) ? <strong>M{r.masteryUps.find((u) => u.family === f)!.level}!</strong> : null}
            </span>
          ))}
        </div>
      ) : null}
      <p className={s.foot}>{won ? 'No shards created, no credits touched — just glory, XP and Flux.' : 'Consolation XP for showing up. The next rogue model won’t be so lucky.'}</p>
      {onClose ? <Button variant="gold" size="l" block testId="raid-end-close" onClick={onClose}>{won ? 'Victory lap' : 'Back to the map'}</Button> : null}
    </div>
  );
  if (inline) return <div className={s.inline}>{body}</div>;
  return <div className={s.overlay} role="dialog" aria-label="Raid result">{body}</div>;
}

/**
 * Annonce de fin (SSE `city.raid.end`) pour les autres joueurs : si j'ai participé, l'écran collectif avec MA part ;
 * sinon un toast. Attend qu'aucun écran d'assaut ne soit ouvert (celui du dernier coup montre déjà la fin).
 */
export function RaidEndHost() {
  const end = useRaid((st) => st.end);
  const assaultOpen = useRaid((st) => st.assaultOpen);
  const [res, setRes] = useState<RaidResultView | null>(null);
  useEffect(() => {
    if (!end || assaultOpen) return;
    let gone = false;
    const t = setTimeout(() => {
      if (isEndShown(end.eventId)) { clearRaidEnd(); return; }
      markEndShown(end.eventId);
      api.raid(end.eventId).then((v) => {
        if (gone) return;
        if (v.result) {
          setRes(v.result);
          if (v.result.outcome === 'won') feedback('raidWin', 'raidWin'); else play('fled');
        } else {
          toast(end.text, end.outcome === 'won' ? 'good' : 'info', 'xp', 4500);
          clearRaidEnd();
        }
      }).catch(() => clearRaidEnd());
    }, 1200);
    return () => { gone = true; clearTimeout(t); };
  }, [end, assaultOpen]);
  const phase = useGame((st) => st.phase);
  if (!res || phase !== 'play') return null;
  return <RaidEndScreen result={res} onClose={() => { setRes(null); clearRaidEnd(); }} />;
}
