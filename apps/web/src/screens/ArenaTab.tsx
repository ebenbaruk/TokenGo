// Onglet « Arena » de la Forge (Docs/13 §4) : qui tient l'arène (Gardien ou Champion) et son équipe, choix de 3 modèles
// (stats de jeu + maîtrise), bouton Fight (frais affichés). Le serveur vérifie tout (distance, niveau, frais, quota).
import { useEffect, useState } from 'react';
import { FAMILY_INFO, MODEL_STYLE, haversineM, type ArenaBattleView, type ArenaView, type Family, type NodeView } from '@tokengo/shared';
import { Swords, Clock3 } from 'lucide-react';
import { api, humanError } from '../lib/api.ts';
import { setMe, toast, useGame } from '../lib/store.ts';
import { radiusFor } from '../lib/nearby.ts';
import { famName, RARITY_LABEL } from '../lib/format.ts';
import { feedback, play } from '../lib/sound.ts';
import { Button } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, FLUX } from '../sprites/index.ts';
import { CROWN, SHIELD } from '../sprites/arena.grids.ts';
import { MasteryBar, StatBars } from './arenaUi.tsx';
import { ArenaBattle } from './ArenaBattle.tsx';
import s from './ArenaTab.module.css';

const hoursLeft = (t: number) => {
  const h = Math.max(0, (t - Date.now()) / 3600_000);
  return h >= 1 ? `${Math.floor(h)} h` : `${Math.max(1, Math.round(h * 60))} min`;
};

export function ArenaTab({ node }: { node: NodeView }) {
  const me = useGame((st) => st.me);
  const pos = useGame((st) => st.pos);
  const [v, setV] = useState<ArenaView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [team, setTeam] = useState<Family[]>([]);
  const [battle, setBattle] = useState<ArenaBattleView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.arena(node.id).then((x) => {
    setV(x);
    setMe(x.me);
    if (x.income && x.income.paid > 0) toast(`+${x.income.paid} ƒ Champion income`, 'good', 'flux');
  }).catch((e) => setErr(humanError(e)));
  useEffect(() => { void load(); }, [node.id]);

  const toggle = (f: Family) => {
    setTeam((t) => {
      if (t.includes(f)) { play('tap'); return t.filter((x) => x !== f); }
      if (t.length >= 3) { play('error'); return t; }
      play('pop');
      return [...t, f];
    });
  };

  const dist = pos ? haversineM(pos, node) : Infinity;
  const inRange = pos ? dist <= radiusFor('forge', pos) : false;
  const reason = !v ? 'Loading…'
    : v.locked ? v.locked
    : v.battlesLeft <= 0 ? 'Daily battle limit reached — come back tomorrow'
    : team.length < 3 ? `Pick ${3 - team.length} more model${team.length === 2 ? '' : 's'}`
    : (me?.flux ?? 0) < v.fee ? `Entry fee ${v.fee} ƒ — you have ${me?.flux ?? 0}`
    : !inRange ? `${Math.round(dist)} m away — get a bit closer` : null;

  const fight = async () => {
    if (!v || busy) return;
    setBusy(true);
    try {
      const r = await api.arenaStart(node.id, team);
      setMe(r.me);
      useGame.setState({ lastResult: r });
      feedback('clash', 'clash');
      setBattle(r.battle);
    } catch (e) { toast(humanError(e), 'bad'); play('error'); } finally { setBusy(false); }
  };

  if (battle) return <ArenaBattle initial={battle} onClose={() => { setBattle(null); setTeam([]); void load(); }} />;
  if (err) return <p className={s.err}>{err}</p>;
  if (!v) return <div className={s.loading}>Opening the arena…</div>;
  const h = v.holder;
  const champ = h.kind === 'champion';

  return (
    <div className={s.wrap} data-testid="arena-tab">
      <section className={`${s.holder} ${champ ? s.champ : ''}`} data-testid="arena-holder" data-kind={h.kind}>
        <div className={s.holderArt}><Sprite def={champ ? CROWN : SHIELD} scale={champ ? 3 : 4} anim={champ} /></div>
        <div className={s.holderMain}>
          <div className={s.holderKind}>{champ ? (h.mine ? 'You are the Champion' : 'Champion') : 'Guardian'}</div>
          <div className={s.holderName}>{h.name}</div>
          <div className={s.holderSub}>
            {champ ? <><Clock3 size={12} strokeWidth={3} /> {h.mine ? `Stay active: the Sentinel returns in ${hoursLeft(h.expiresAt!)}` : `Holding since ${new Date(h.since!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ghost team`}</>
              : 'Beat the Sentinel to take the arena'}
          </div>
          <div className={s.holderTeam}>
            {h.team.map((m) => (
              <span key={m.family} className={s.mini} title={famName(m.family)}>
                <Sprite def={SHARDS[m.family]} scale={2} /><b>M{m.mastery}</b>
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className={s.bonus}>Arena bonus <b>+10%</b> {v.affinities.map((f) => <span key={f}><Sprite def={SHARDS[f]} scale={1} /> {famName(f)}</span>)}</div>
      {v.income ? <div className={s.income} data-testid="arena-income"><Sprite def={FLUX} scale={1} /> +4 ƒ every 10 min held · {v.income.paidToday}/{v.income.maxDay} ƒ today</div> : null}
      {v.openBattle ? (
        <Button variant="gold" block testId="arena-resume" onClick={() => setBattle(v.openBattle)}><Swords size={18} /> Resume your battle</Button>
      ) : null}

      <div className={s.pickHead}>
        <h3>Your team</h3>
        <span className={s.count} data-testid="arena-team-count">{team.length}/3</span>
        <small>game stats · not benchmarks</small>
      </div>
      <div className={s.list}>
        {v.families.map(({ family: f, owned, mastery }) => {
          const i = team.indexOf(f);
          const off = owned < 1;
          return (
            <button key={f} type="button" className={`${s.fam} ${i >= 0 ? s.on : ''}`} disabled={off} aria-pressed={i >= 0}
              data-testid={`arena-pick-${f}`} onClick={() => toggle(f)}>
              <span className={s.famArt}>
                <Sprite def={SHARDS[f]} scale={2} anim={i >= 0} />
                {i >= 0 ? <span className={s.order}>{i + 1}</span> : null}
              </span>
              <span className={s.famMain}>
                <span className={s.famTop}>
                  <b className={s.famName}>{famName(f)}</b>
                  <small>{RARITY_LABEL[FAMILY_INFO[f].rarity]} · ×{owned}</small>
                </span>
                <span className={s.style}>{off ? 'Catch one to field it' : MODEL_STYLE[f]}</span>
                <MasteryBar m={mastery} testId={`arena-mastery-${f}`} />
              </span>
              <span className={s.famStats}><StatBars family={f} /></span>
            </button>
          );
        })}
      </div>

      <div className={s.action}>
        <Button variant="gold" size="l" block testId="arena-fight" reason={reason} loading={busy} onClick={() => void fight()}>
          <Swords size={24} strokeWidth={2.8} /> Fight · {v.fee} ƒ
        </Button>
        <div className={s.left} data-testid="arena-left">{v.battlesLeft}/{v.battlesPerDay} battles left today · win 60 XP + 20 ƒ{champ ? ' (Champion: 100 XP + 30 ƒ + the crown)' : ' + the crown'}</div>
      </div>
    </div>
  );
}
