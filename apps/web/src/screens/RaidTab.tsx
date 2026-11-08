// Onglet « Raid » de la Forge (Docs/13 §6), visible pendant un raid sur cette Forge : le boss (PV en direct), sa faiblesse et
// sa résistance du moment, son équipe, le classement des dégâts en direct, mes assauts restants, choix de 3 modèles et Attack.
// Le serveur vérifie tout (distance, équipe, assauts) ; l'attaque est gratuite.
import { useEffect, useRef, useState } from 'react';
import { CATEGORY_INFO, MODEL_STATS, RAID, haversineM, type Family, type NodeView, type RaidAssaultView, type RaidView } from '@tokengo/shared';
import { Swords, Users, Clock3 } from 'lucide-react';
import { api, humanError } from '../lib/api.ts';
import { setMe, toast, useGame } from '../lib/store.ts';
import { patchRaid, useLiveRaid, useRaid } from '../lib/raid.ts';
import { radiusFor } from '../lib/nearby.ts';
import { famName, fmtCountdown } from '../lib/format.ts';
import { feedback, play } from '../lib/sound.ts';
import { Button } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS } from '../sprites/index.ts';
import { CatIcon } from './arenaUi.tsx';
import { BossArt, BossHpBar, FlyingHits, WeakTag, fmtHp } from './raidUi.tsx';
import { RaidAssault } from './RaidAssault.tsx';
import { RaidEndScreen } from './RaidEnd.tsx';
import s from './RaidTab.module.css';

export function RaidTab({ node, eventId }: { node: NodeView; eventId: number }) {
  const pos = useGame((st) => st.pos);
  const live = useLiveRaid();
  const hits = useRaid((st) => st.hits);
  const [v, setV] = useState<RaidView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [team, setTeam] = useState<Family[]>([]);
  const [assault, setAssault] = useState<RaidAssaultView | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const loadTimer = useRef(0);

  const load = () => api.raid(eventId).then((x) => {
    setV(x);
    setMe(x.me);
    patchRaid(x.raid);
  }).catch((e) => setErr(humanError(e)));
  useEffect(() => { void load(); }, [eventId]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // un coup de la ville → classement rafraîchi (au plus toutes les 2,5 s)
  useEffect(() => {
    if (!hits.length || assault) return;
    clearTimeout(loadTimer.current);
    loadTimer.current = window.setTimeout(() => void load(), 2500);
  }, [hits.length]);

  const toggle = (f: Family) => setTeam((t) => {
    if (t.includes(f)) { play('tap'); return t.filter((x) => x !== f); }
    if (t.length >= 3) { play('error'); return t; }
    play('pop');
    return [...t, f];
  });

  const r = v ? { ...v.raid, ...(live && live.eventId === v.raid.eventId ? { hp: Math.min(v.raid.hp, live.hp), weakness: live.weakness, resist: live.resist, sliceEndsAt: live.sliceEndsAt } : {}) } : null;
  const dist = pos ? haversineM(pos, node) : Infinity;
  const inRange = pos ? dist <= radiusFor('forge', pos) : false;
  const reason = !v || !r ? 'Loading…'
    : r.status !== 'active' ? 'This raid is over'
    : v.mine.assaultsLeft <= 0 ? `You used your ${RAID.assaultsPerRaid} assaults — cheer the city on!`
    : team.length < 3 ? `Pick ${3 - team.length} more model${team.length === 2 ? '' : 's'}`
    : !inRange ? `${Math.round(dist)} m away — get a bit closer` : null;

  const attack = async () => {
    if (!v || busy) return;
    setBusy(true);
    try {
      const x = await api.raidAttack(eventId, team);
      setMe(x.me);
      patchRaid(x.raid);
      useGame.setState({ lastResult: x });
      feedback('rogue', 'clash');
      setAssault(x.assault);
    } catch (e) { toast(humanError(e), 'bad'); play('error'); } finally { setBusy(false); }
  };

  if (assault) return <RaidAssault initial={assault} onClose={() => { setAssault(null); setTeam([]); void load(); }} />;
  if (err) return <p className={s.err}>{err}</p>;
  if (!v || !r) return <div className={s.loading}>Tracing the rogue model…</div>;
  if (r.status !== 'active' && v.result) return <RaidEndScreen result={v.result} inline />;
  const left = r.endsAt - now;
  const top = v.leaderboard[0]?.damage ?? 1;

  return (
    <div className={s.wrap} data-testid="raid-tab">
      <section className={s.boss} data-testid="raid-boss">
        <div className={s.bossArt}><BossArt bossId={r.bossId} scale={4} /><FlyingHits hits={hits} /></div>
        <div className={s.bossMain}>
          <div className={s.kind}>Rogue model · {r.status === 'active' ? 'loose!' : r.status === 'won' ? 'contained' : 'escaped'}</div>
          <div className={s.bossName} data-testid="raid-boss-name">{r.boss}</div>
          <div className={s.meta}>
            <span><Clock3 size={12} strokeWidth={3} /> <b className="num">{fmtCountdown(left)}</b></span>
            <span><Users size={12} strokeWidth={3} /> <b className="num">{r.participants}</b> fighting</span>
            <span className={s.bossTeam}>
              {v.bossTeam.map((m) => <span key={m.family} className={s.mini} title={`${famName(m.family)} · mastery ${m.mastery}`}><Sprite def={SHARDS[m.family]} scale={1} /></span>)}
            </span>
          </div>
        </div>
        <div className={s.bossHp}><BossHpBar hp={r.hp} max={r.maxHp} size="l" testId="raid-hp" /></div>
      </section>

      <div className={s.mine} data-testid="raid-mine">
        <span><small>Your damage</small><b className="num" data-testid="raid-my-damage">{fmtHp(v.mine.damage)}</b></span>
        <span><small>Rank</small><b className="num">{v.mine.rank ? `#${v.mine.rank}` : '—'}</b></span>
        <span><small>Assaults</small><b className="num" data-testid="raid-assaults-left">{v.mine.assaultsLeft}/{RAID.assaultsPerRaid}</b></span>
      </div>

      <div className={s.aff}>
        <WeakTag cat={r.weakness} kind="weak" big />
        <WeakTag cat={r.resist} kind="resist" />
        <small className={s.rotate}>shifts in <b className="num">{fmtCountdown(r.sliceEndsAt - now)}</b></small>
      </div>

      {v.openAssault ? <Button variant="gold" block testId="raid-resume" onClick={() => setAssault(v.openAssault)}><Swords size={18} /> Resume your assault</Button> : null}

      <div className={s.pickHead}>
        <h3>Strike team</h3>
        <span className={s.count} data-testid="raid-team-count">{team.length}/3</span>
        <small><CatIcon cat={r.weakness} size={11} /> = {CATEGORY_INFO[r.weakness].name} stat</small>
      </div>
      <div className={s.picks}>
        {v.families.map(({ family: f, owned, mastery }) => {
          const i = team.indexOf(f);
          return (
            <button key={f} type="button" className={`${s.pick} ${i >= 0 ? s.on : ''}`} disabled={owned < 1} aria-pressed={i >= 0}
              data-testid={`raid-pick-${f}`} onClick={() => toggle(f)}>
              {i >= 0 ? <span className={s.order}>{i + 1}</span> : null}
              <Sprite def={SHARDS[f]} scale={2} anim={i >= 0} />
              <b className={s.pickName}>{famName(f)}</b>
              <span className={s.pickStat}><CatIcon cat={r.weakness} size={11} /> {MODEL_STATS[f][r.weakness]}<small>M{mastery.level}</small></span>
              {owned < 1 ? <small className={s.none}>catch one</small> : null}
            </button>
          );
        })}
      </div>


      <section className={s.board} data-testid="raid-leaderboard">
        <h3>Damage board <small>live</small></h3>
        {v.leaderboard.length === 0 ? <p className={s.empty}>No one has landed a hit yet — be the first!</p> : (
          <ol>
            {v.leaderboard.map((l) => (
              <li key={`${l.rank}-${l.handle}`} className={l.me ? s.meRow : ''}>
                <span className={s.rank}>{l.rank}</span>
                <span className={s.who}>{l.handle}{l.agent ? <em>agent</em> : null}</span>
                <span className={s.dmgBar}><i style={{ width: `${Math.max(4, (l.damage / top) * 100)}%` }} /></span>
                <b className="num">{fmtHp(l.damage)}</b>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className={s.action}>
        <Button variant="gold" size="l" block testId="raid-attack" reason={reason} loading={busy} onClick={() => void attack()}>
          <Swords size={24} strokeWidth={2.8} /> Attack · {v.mine.assaultsLeft}/{RAID.assaultsPerRaid} left
        </Button>
        <div className={s.left}>Free · 3 rounds · win: 80 XP + 30 ƒ each, +40 ƒ for the top 3</div>
      </div>
    </div>
  );
}
