// Combat d'arène (Docs/13 §4) en plein écran : épreuve au centre, adversaire en haut, mon équipe en bas.
// Choisir un modèle (le « rate-limited » est grisé) + une technique (coût en tokens) → Send → révélation des deux choix,
// barres de puissance, hallucination, commentaire, points. Fin : victoire / défaite, récompenses, maîtrise, couronne.
// Le serveur décide de tout ; on ne fait que montrer (et estimer ≈ la puissance avec les mêmes formules pures).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ARENA, CATEGORY_INFO, TECHNIQUES, TECHNIQUE_RULES, expectedPower,
  type ArenaBattleView, type ArenaPlayView, type ArenaRoundView, type Family, type Technique,
} from '@tokengo/shared';
import { X, Send, Hourglass, ChevronRight, Share2, Sparkles, TriangleAlert } from 'lucide-react';
import { api, ApiFail, humanError } from '../lib/api.ts';
import { setMe, toast, useGame } from '../lib/store.ts';
import { famName } from '../lib/format.ts';
import { buzz, feedback, play, HAPTIC } from '../lib/sound.ts';
import { arenaCard, shareImage } from '../lib/share.ts';
import { Button, Counter } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, XP_STAR, FLUX } from '../sprites/index.ts';
import { CROWN, SHIELD } from '../sprites/arena.grids.ts';
import { CAT_COLOR, CatIcon, MasteryBar } from './arenaUi.tsx';
import s from './ArenaBattle.module.css';

type Phase = 'choose' | 'sending' | 'reveal' | 'final';
const POWER_SCALE = 24; // puissance qui remplit la barre
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function Pips({ n, of, tone }: { n: number; of: number; tone: 'me' | 'opp' }) {
  return <span className={s.pips} aria-label={`${n} of ${of}`}>{Array.from({ length: of }, (_, i) => <i key={i} className={i < n ? s[`pip_${tone}`] : ''} />)}</span>;
}

function Tokens({ left, preview = 0, testId }: { left: number; preview?: number; testId?: string }) {
  return (
    <span className={s.tokens} data-testid={testId} data-left={left} aria-label={`${left} tokens left`}>
      {Array.from({ length: ARENA.tokenBudget }, (_, i) => (
        <i key={i} className={i < left - preview ? s.tokOn : i < left ? s.tokSpend : ''} />
      ))}
      <b className="num">{left}</b>
    </span>
  );
}

function PlayCard({ p, side, step, won }: { p: ArenaPlayView; side: 'me' | 'opp'; step: number; won: boolean }) {
  const pct = Math.min(100, (p.power / POWER_SCALE) * 100);
  return (
    <div className={`${s.play} ${s[`play_${side}`]} ${step >= 2 && won ? s.won : ''} ${step >= 2 && p.hallucinated ? s.halluc : ''}`}
      data-testid={`arena-play-${side}`} data-family={p.family} data-power={p.power} data-hallucinated={p.hallucinated ? '1' : '0'}>
      <span className={s.playArt}><Sprite def={SHARDS[p.family]} scale={3} anim /></span>
      <div className={s.playMain}>
        <div className={s.playTop}>
          <b>{side === 'me' ? 'Your' : 'Their'} {famName(p.family)}</b>
          <span className={s.techTag}>{TECHNIQUE_RULES[p.technique].name}</span>
        </div>
        <div className={s.power}>
          <span className={s.powerBar}><i style={{ width: step >= 1 ? `${pct}%` : '0%' }} /></span>
          <span className={s.powerNum}><Counter value={step >= 1 ? p.power : 0} format={(n) => n.toFixed(1)} showDelta={false} duration={700} /></span>
        </div>
      </div>
      {step >= 2 && p.hallucinated ? <span className={s.hallucTag}><TriangleAlert size={12} strokeWidth={3} /> hallucinated!</span> : null}
      {step >= 2 && won ? <span className={s.winTag}>WIN</span> : null}
    </div>
  );
}

export function ArenaBattle({ initial, onClose }: { initial: ArenaBattleView; onClose: () => void }) {
  const me = useGame((st) => st.me);
  const [b, setB] = useState(initial);
  const [phase, setPhase] = useState<Phase>(initial.status === 'open' ? 'choose' : 'final');
  const [fam, setFam] = useState<Family | null>(null);
  const [tech, setTech] = useState<Technique>('zero');
  const [last, setLast] = useState<ArenaRoundView | null>(null);
  const [step, setStep] = useState(0);
  const [crown, setCrown] = useState(false);
  const [sharing, setSharing] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const open = b.status === 'open';
  // pendant la révélation, on garde l'épreuve qui vient d'être jouée (b.challenge est déjà la suivante)
  const ch = phase === 'reveal' && last ? { category: last.category, prompt: last.prompt, index: last.index } : b.challenge;
  const cost = TECHNIQUE_RULES[tech].cost;
  const myTeam = b.me.team;

  const send = async () => {
    if (!fam || phase !== 'choose') return;
    setPhase('sending');
    play('whoosh');
    try {
      const r = await api.arenaPlay(b.battleId, fam, tech);
      if (!alive.current) return;
      useGame.setState({ lastResult: r });
      setLast(r.round);
      setStep(0);
      setPhase('reveal');
      feedback('clash', 'clash');
      await sleep(450);
      if (!alive.current) return;
      setStep(1);
      await sleep(900);
      if (!alive.current) return;
      setStep(2);
      const hall = r.round.me.hallucinated || r.round.opp.hallucinated;
      if (hall) play('glitch');
      setTimeout(() => {
        if (r.round.winner === 'me') { play('catch'); buzz(HAPTIC.good); } else if (r.round.winner === 'opp') { play('miss'); buzz(HAPTIC.miss); } else play('tap');
      }, hall ? 220 : 0);
      setB(r.battle);
      setMe(r.me, r.battle.result?.levelUp);
    } catch (e) {
      if (!alive.current) return;
      toast(humanError(e), 'bad');
      play('error');
      if (e instanceof ApiFail && e.code === 'EXPIRED') { onClose(); return; }
      setPhase('choose');
    }
  };

  const next = () => {
    if (open) { setPhase('choose'); setFam(null); setTech('zero'); setLast(null); setStep(0); play('tap'); return; }
    setPhase('final');
    const res = b.result;
    if (res?.outcome === 'won') feedback('level', 'perfect'); else play('fled');
    if (res?.becameChampion) setTimeout(() => { if (alive.current) { setCrown(true); feedback('crown', 'crown'); } }, 700);
  };

  const share = async () => {
    setSharing(true);
    try {
      const blob = await arenaCard(b, me?.handle ?? 'Runner');
      await shareImage(blob, `tokengo-arena-${b.battleId.slice(0, 8)}.png`,
        `I just became Champion of ${b.forgeName.split(' —')[0]} on TokenGo — my AI models won ${b.me.wins}–${b.opp.wins}.`, 'arena');
    } catch { toast('Could not make the card — try again.', 'bad'); } finally { setSharing(false); }
  };

  const oppArt = b.opponent.kind === 'champion' ? CROWN : SHIELD;
  const res = b.result;

  return (
    <div className={`${s.screen} pixel-pattern`} data-testid="arena-battle" data-status={b.status} role="dialog" aria-label="Arena battle">
      {/* ── haut : adversaire ── */}
      <header className={s.top}>
        <div className={s.round} data-testid="arena-round">
          {Array.from({ length: b.rounds }, (_, i) => {
            const h = b.history[i];
            return <i key={i} className={h ? s[`r_${h.winner}`] : i === b.history.length && open ? s.rNow : ''} />;
          })}
        </div>
        <span className={s.vs}>{b.forgeName.split(' —')[0]} arena</span>
        <button type="button" className={s.close} aria-label="Leave battle" data-testid="arena-close" onClick={onClose}><X size={20} strokeWidth={3} /></button>
      </header>
      {phase !== 'final' ? <section className={s.opp}>
        <span className={s.oppArt}><Sprite def={oppArt} scale={2} /></span>
        <div className={s.oppMain}>
          <div className={s.sideHead}><b className={s.oppName}>{b.opponent.name}</b><Pips n={b.opp.wins} of={ARENA.winsNeeded} tone="opp" /></div>
          <div className={s.oppTeam}>
            {b.opp.team.map((m) => (
              <span key={m.family} className={`${s.chip} ${b.opp.rateLimited === m.family ? s.chipRl : ''}`} title={famName(m.family)}>
                <Sprite def={SHARDS[m.family]} scale={1} /> {famName(m.family)} <small>M{m.mastery}</small>
                {b.opp.rateLimited === m.family ? <Hourglass size={11} strokeWidth={3} /> : null}
              </span>
            ))}
          </div>
          <Tokens left={b.opp.tokens} />
        </div>
      </section> : null}

      {/* ── centre : l'épreuve, puis la révélation ── */}
      <main className={s.center}>
        {phase !== 'final' && ch ? (
          <div className={`${s.challenge} ${phase === 'reveal' ? s.chCompact : ''}`} key={`c${ch.index}`} style={{ '--cat': CAT_COLOR[ch.category] } as CSSProperties} data-testid="arena-challenge" data-category={ch.category}>
            <div className={s.chHead}>
              <span className={s.catBadge}><CatIcon cat={ch.category} size={16} /> {CATEGORY_INFO[ch.category].name}</span>
              <span className={s.chNum}>Challenge {ch.index + 1}/{b.rounds}</span>
            </div>
            <p className={s.prompt}>“{ch.prompt}”</p>
            {b.affinities.length && phase !== 'reveal' ? <small className={s.aff}>Arena bonus +10%: {b.affinities.map(famName).join(' & ')}</small> : null}
          </div>
        ) : null}
        {phase === 'sending' ? <div className={s.thinking}><span /><span /><span /> both models are thinking…</div> : null}
        {phase === 'reveal' && last ? (
          <div className={s.reveal} data-testid="arena-reveal" data-winner={last.winner}>
            <PlayCard p={last.opp} side="opp" step={step} won={last.winner === 'opp'} />
            <span className={`${s.clash} ${step >= 1 ? s.clashOn : ''}`}>VS</span>
            <PlayCard p={last.me} side="me" step={step} won={last.winner === 'me'} />
            {step >= 2 ? <div className={s.line} data-testid="arena-line">{last.line}</div> : null}
          </div>
        ) : null}
        {phase === 'final' && res ? (
          <div className={s.final} data-testid="arena-result" data-outcome={res.outcome}>
            <div className={`${s.stamp} ${res.outcome === 'won' ? s.stampWin : s.stampLose}`}>{res.outcome === 'won' ? 'VICTORY!' : 'DEFEAT'}</div>
            <div className={s.score}><b>{b.me.wins}</b> – <b>{b.opp.wins}</b></div>
            <p className={s.finalLine}>{res.line}</p>
            {res.note ? <p className={s.note}>{res.note}</p> : null}
            <div className={s.rewards}>
              <span className={s.rw} data-testid="arena-xp"><Sprite def={XP_STAR} scale={1} /> +{res.xp} XP</span>
              <span className={s.rw} data-testid="arena-flux"><Sprite def={FLUX} scale={1} /> +{res.flux} ƒ</span>
              <span className={`${s.rw} ${s.rwFee}`}>fee −{res.fee} ƒ</span>
            </div>
            <div className={s.gains} data-testid="arena-mastery-gains">
              {myTeam.map((m) => {
                const g = res.masteryGains[m.family] ?? 0;
                const up = res.masteryUps.find((u) => u.family === m.family);
                return (
                  <div key={m.family} className={`${s.gain} ${up ? s.gainUp : ''}`}>
                    <Sprite def={SHARDS[m.family]} scale={2} anim={!!up} />
                    <span className={s.gainName}>{famName(m.family)}{up ? <em> Mastery {up.level}!</em> : null}</span>
                    <span className={s.gainXp}>+{g}</span>
                    {me ? <MasteryBar m={me.mastery[m.family]} testId={`arena-gain-${m.family}`} /> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </main>

      {/* ── bas : mon équipe, techniques, envoi ── */}
      <footer className={s.mine}>
        {phase !== 'final' ? <div className={s.sideHead}>
          <b>You</b><Pips n={b.me.wins} of={ARENA.winsNeeded} tone="me" />
          <Tokens left={b.me.tokens} preview={phase === 'choose' ? cost : 0} testId="arena-tokens" />
        </div> : null}
        {phase === 'choose' && b.challenge ? (
          <>
            <div className={s.models}>
              {myTeam.map((m) => {
                const rl = b.me.rateLimited === m.family;
                const cat = b.challenge!.category;
                const ev = expectedPower({ family: m.family, category: cat, technique: tech, mastery: m.mastery, affinities: b.affinities });
                return (
                  <button key={m.family} type="button" className={`${s.model} ${fam === m.family ? s.modelOn : ''}`} disabled={rl}
                    data-testid={`arena-model-${m.family}`} data-ratelimited={rl ? '1' : '0'} aria-pressed={fam === m.family}
                    onClick={() => { play('pop'); buzz(HAPTIC.tap); setFam(m.family); }}>
                    <Sprite def={SHARDS[m.family]} scale={2} anim={fam === m.family} />
                    <b className={s.modelName}>{famName(m.family)}</b>
                    {rl ? <span className={s.rl}><Hourglass size={11} strokeWidth={3} /> Rate-limited</span> : (
                      <span className={s.modelStat}><CatIcon cat={cat} size={12} /> <b className="num">≈{ev.toFixed(1)}</b><small>M{m.mastery}</small></span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className={s.techs} role="radiogroup" aria-label="Prompt technique">
              {TECHNIQUES.map((t) => {
                const r = TECHNIQUE_RULES[t];
                const no = r.cost > b.me.tokens;
                return (
                  <button key={t} type="button" role="radio" aria-checked={tech === t} disabled={no} data-testid={`arena-tech-${t}`}
                    className={`${s.tech} ${tech === t ? s.techOn : ''}`} onClick={() => { play('tap'); setTech(t); }}>
                    <b>{r.name}</b><small>{r.cost ? `${r.cost} tok` : 'free'}</small>
                  </button>
                );
              })}
            </div>
            <div className={s.hint}>{TECHNIQUE_RULES[tech].hint}</div>
            <Button variant="gold" size="l" block testId="arena-send" reason={fam ? null : 'Pick a model for this challenge'} onClick={() => void send()}>
              <Send size={22} strokeWidth={2.8} /> Send prompt
            </Button>
          </>
        ) : phase === 'sending' ? (
          <Button variant="gold" size="l" block loading testId="arena-send">Sending…</Button>
        ) : phase === 'reveal' ? (
          <Button variant="primary" size="l" block testId="arena-next" disabled={step < 2} onClick={next}>
            {open ? <>Next challenge <ChevronRight size={22} strokeWidth={3} /></> : <>See result <Sparkles size={20} strokeWidth={3} /></>}
          </Button>
        ) : (
          <div className={s.finalActions}>
            {res?.becameChampion ? <Button variant="primary" block testId="arena-share" loading={sharing} onClick={() => void share()}><Share2 size={18} /> Share card</Button> : null}
            <Button variant="gold" size="l" block testId="arena-done" onClick={onClose}>Back to the arena</Button>
          </div>
        )}
      </footer>

      {crown ? (
        <div className={s.crown} data-testid="arena-crown" onClick={() => setCrown(false)}>
          <div className={s.rays} />
          <div className={s.crownArt}><Sprite def={CROWN} scale={9} anim /></div>
          <h2 className={s.crownTitle}>You are now Champion of {b.forgeName.split(' —')[0]}!</h2>
          <p className={s.crownSub}>Your team defends the arena while you’re away · +4 ƒ every 10 min</p>
          <div className={s.crownTeam}>{myTeam.map((m) => <Sprite key={m.family} def={SHARDS[m.family]} scale={3} anim />)}</div>
          <span className={s.tapHint}>tap to continue</span>
        </div>
      ) : null}
    </div>
  );
}
