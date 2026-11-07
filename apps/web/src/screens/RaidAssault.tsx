// Assaut de raid (Docs/13 §6) : l'écran de combat de l'Arène, adapté. En haut, le boss et SA BARRE DE PV (au lieu du score) ;
// au centre l'épreuve (badge « WEAK ×1.5 » / « RESIST ×0.6 ») puis la révélation et les dégâts qui volent ; en bas mon équipe,
// la technique (budget 6 tokens) et Send. 3 manches, toutes jouées. Fin : total infligé ; si le boss tombe, écran collectif.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  CATEGORY_INFO, RAID, TECHNIQUES, TECHNIQUE_RULES, expectedPower, raidCatMult,
  type ArenaPlayView, type Family, type RaidAssaultView, type RaidResultView, type RaidRoundView, type Technique,
} from '@tokengo/shared';
import { X, Send, Hourglass, ChevronRight, Sparkles, TriangleAlert } from 'lucide-react';
import { api, ApiFail, humanError } from '../lib/api.ts';
import { setMe, toast, useGame } from '../lib/store.ts';
import { markEndShown, patchRaid, pushHit, useLiveRaid, useRaid } from '../lib/raid.ts';
import { famName } from '../lib/format.ts';
import { buzz, feedback, play, HAPTIC } from '../lib/sound.ts';
import { Button, Counter } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS } from '../sprites/index.ts';
import { CAT_COLOR, CatIcon } from './arenaUi.tsx';
import { BossArt, BossHpBar, fmtHp } from './raidUi.tsx';
import { RaidEndScreen } from './RaidEnd.tsx';
import a from './ArenaBattle.module.css';
import s from './RaidAssault.module.css';

type Phase = 'choose' | 'sending' | 'reveal' | 'final';
const POWER_SCALE = 24;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function Tokens({ left, preview = 0, testId }: { left: number; preview?: number; testId?: string }) {
  return (
    <span className={a.tokens} data-testid={testId} data-left={left} aria-label={`${left} tokens left`}>
      {Array.from({ length: RAID.tokenBudget }, (_, i) => <i key={i} className={i < left - preview ? a.tokOn : i < left ? a.tokSpend : ''} />)}
      <b className="num">{left}</b>
    </span>
  );
}

function PlayCard({ p, side, step, won, bossName }: { p: ArenaPlayView; side: 'me' | 'opp'; step: number; won: boolean; bossName: string }) {
  const pct = Math.min(100, (p.power / POWER_SCALE) * 100);
  return (
    <div className={`${a.play} ${a[`play_${side}`]} ${step >= 2 && won ? a.won : ''} ${step >= 2 && p.hallucinated ? a.halluc : ''} ${side === 'opp' ? s.bossPlay : ''}`}
      data-testid={`raid-play-${side}`} data-family={p.family} data-power={p.power}>
      <span className={a.playArt}><Sprite def={SHARDS[p.family]} scale={3} anim /></span>
      <div className={a.playMain}>
        <div className={a.playTop}>
          <b>{side === 'me' ? 'Your' : `${bossName}’s`} {famName(p.family)}</b>
          <span className={a.techTag}>{TECHNIQUE_RULES[p.technique].name}</span>
        </div>
        <div className={a.power}>
          <span className={a.powerBar}><i style={{ width: step >= 1 ? `${pct}%` : '0%' }} /></span>
          <span className={a.powerNum}><Counter value={step >= 1 ? p.power : 0} format={(n) => n.toFixed(1)} showDelta={false} duration={700} /></span>
        </div>
      </div>
      {step >= 2 && p.hallucinated ? <span className={a.hallucTag}><TriangleAlert size={12} strokeWidth={3} /> hallucinated!</span> : null}
      {step >= 2 && won ? <span className={a.winTag}>WIN</span> : null}
    </div>
  );
}

export function RaidAssault({ initial, onClose }: { initial: RaidAssaultView; onClose: () => void }) {
  const live = useLiveRaid();
  const [v, setV] = useState(initial);
  const [phase, setPhase] = useState<Phase>(initial.status === 'open' ? 'choose' : 'final');
  const [fam, setFam] = useState<Family | null>(null);
  const [tech, setTech] = useState<Technique>('zero');
  const [last, setLast] = useState<RaidRoundView | null>(null);
  const [step, setStep] = useState(0);
  const [hp, setHp] = useState<{ hp: number; max: number } | null>(live ? { hp: live.hp, max: live.maxHp } : null);
  const [shake, setShake] = useState(0);
  const [result, setResult] = useState<RaidResultView | null>(null);
  const [showEnd, setShowEnd] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    useRaid.setState({ assaultOpen: true });
    return () => { alive.current = false; useRaid.setState({ assaultOpen: false }); };
  }, []);
  // PV de la ville en direct (coups des autres joueurs et des runners)
  useEffect(() => { if (live && live.eventId === v.eventId) setHp((h) => ({ hp: Math.min(h?.hp ?? live.hp, live.hp), max: live.maxHp })); }, [live?.hp]);

  const open = v.status === 'open';
  const ch = phase === 'reveal' && last ? { category: last.category, prompt: last.prompt, index: last.index } : v.challenge;
  const cost = TECHNIQUE_RULES[tech].cost;
  const mult = ch ? raidCatMult(ch.category, v.weakness, v.resist) : 1;

  const send = async () => {
    if (!fam || phase !== 'choose') return;
    setPhase('sending');
    play('whoosh');
    try {
      const r = await api.raidPlay(v.assaultId, fam, tech);
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
      if (r.round.me.hallucinated || r.round.opp.hallucinated) play('glitch');
      // le coup porte : chiffre qui vole, secousse, PV qui descendent
      await sleep(250);
      if (!alive.current) return;
      setStep(3);
      if (r.round.damage > 0) {
        pushHit(r.round.damage, 'you', true);
        play('raidHit');
        buzz(HAPTIC.raidHit);
        setShake((n) => n + 1);
      }
      setHp({ hp: r.raid.hp, max: r.raid.maxHp });
      patchRaid(r.raid);
      setV(r.assault);
      setMe(r.me, r.result?.levelUp);
      if (r.result) { setResult(r.result); markEndShown(v.eventId); }
    } catch (e) {
      if (!alive.current) return;
      toast(humanError(e), 'bad');
      play('error');
      if (e instanceof ApiFail && (e.code === 'EXPIRED' || e.code === 'RAID_OVER')) { onClose(); return; }
      setPhase('choose');
    }
  };

  const next = () => {
    if (result) { setPhase('final'); setShowEnd(true); feedback('raidWin', 'raidWin'); return; }
    if (open) { setPhase('choose'); setFam(null); setTech('zero'); setLast(null); setStep(0); play('tap'); return; }
    setPhase('final');
    feedback('level', 'perfect');
  };

  const h = hp ?? { hp: 0, max: 1 };
  return (
    <div className={`${a.screen} ${s.screen} pixel-pattern`} data-testid="raid-assault" data-status={v.status} role="dialog" aria-label="Raid assault">
      <header className={a.top}>
        <div className={a.round} data-testid="raid-round">
          {Array.from({ length: v.rounds }, (_, i) => {
            const r = v.history[i];
            return <i key={i} className={r ? a[`r_${r.winner}`] : i === v.history.length && open ? a.rNow : ''} />;
          })}
        </div>
        <span className={a.vs}>Raid · {v.boss}</span>
        <button type="button" className={a.close} aria-label="Leave assault" data-testid="raid-close" onClick={onClose}><X size={20} strokeWidth={3} /></button>
      </header>

      {/* ── haut : le boss et sa barre de PV ── */}
      <section className={`${s.boss} ${shake ? s.shake : ''}`} key={`b${shake}`}>
        <span className={s.bossArt}><BossArt bossId={live?.bossId ?? 'glitch9'} scale={3} /></span>
        <div className={s.bossMain}>
          <div className={a.sideHead}>
            <b className={s.bossName}>{v.boss}</b>
            <span className={s.affs}>
              <span className={s.wk}><CatIcon cat={v.weakness} size={11} /> ×1.5</span>
              <span className={s.rs}><CatIcon cat={v.resist} size={11} /> ×0.6</span>
            </span>
          </div>
          <BossHpBar hp={h.hp} max={h.max} testId="raid-assault-hp" />
          <div className={a.oppTeam}>
            {v.opp.team.map((m) => (
              <span key={m.family} className={`${a.chip} ${v.opp.rateLimited === m.family ? a.chipRl : ''}`} title={famName(m.family)}>
                <Sprite def={SHARDS[m.family]} scale={1} /> {famName(m.family)} <small>M{m.mastery}</small>
                {v.opp.rateLimited === m.family ? <Hourglass size={11} strokeWidth={3} /> : null}
              </span>
            ))}
            <Tokens left={v.opp.tokens} />
          </div>
        </div>
        {phase === 'reveal' && last && step >= 3 && last.damage > 0 ? (
          <span className={s.bigHit} key={`h${last.index}`} data-testid="raid-hit">−{last.damage}</span>
        ) : null}
      </section>

      {/* ── centre ── */}
      <main className={a.center}>
        {phase !== 'final' && ch ? (
          <div className={`${a.challenge} ${phase === 'reveal' ? a.chCompact : ''}`} key={`c${ch.index}`} style={{ '--cat': CAT_COLOR[ch.category] } as CSSProperties}
            data-testid="raid-challenge" data-category={ch.category}>
            <div className={a.chHead}>
              <span className={a.catBadge}><CatIcon cat={ch.category} size={16} /> {CATEGORY_INFO[ch.category].name}</span>
              {mult !== 1 ? <span className={`${s.ribbon} ${mult > 1 ? s.ribbonWeak : s.ribbonResist}`}>{mult > 1 ? 'WEAK ×1.5' : 'RESIST ×0.6'}</span>
                : <span className={a.chNum}>Round {ch.index + 1}/{v.rounds}</span>}
            </div>
            <p className={a.prompt}>“{ch.prompt}”</p>
          </div>
        ) : null}
        {phase === 'sending' ? <div className={a.thinking}><span /><span /><span /> your model attacks…</div> : null}
        {phase === 'reveal' && last ? (
          <div className={a.reveal} data-testid="raid-reveal" data-winner={last.winner}>
            <PlayCard p={last.opp} side="opp" step={step} won={last.winner === 'opp'} bossName={v.boss} />
            <span className={`${a.clash} ${step >= 1 ? a.clashOn : ''}`}>VS</span>
            <PlayCard p={last.me} side="me" step={step} won={last.winner === 'me'} bossName={v.boss} />
            {step >= 2 ? (
              <div className={s.dmgLine} data-testid="raid-round-damage" data-damage={last.damage}>
                <b className="num">−{last.damage} HP</b>
                <span>{last.me.power.toFixed(1)} power × {RAID.damageScale}{mult !== 1 ? ` × ${mult} ${mult > 1 ? 'weakness!' : 'resisted'}` : ''}{last.winner === 'me' ? ' × 1.5 round won' : ''}</span>
              </div>
            ) : null}
            {step >= 2 ? <div className={a.line}>{last.line}</div> : null}
          </div>
        ) : null}
        {phase === 'final' && !showEnd ? (
          <div className={a.final} data-testid="raid-assault-result">
            <div className={`${a.stamp} ${s.stamp}`}>HIT!</div>
            <div className={s.total}><small>This assault</small><b className="num" data-testid="raid-assault-damage"><Counter value={v.damage} showDelta={false} duration={900} format={(n) => fmtHp(n)} /></b><small>damage to {v.boss}</small></div>
            <div className={s.rounds}>
              {v.history.map((r) => (
                <span key={r.index} className={s.roundChip} style={{ '--cat': CAT_COLOR[r.category] } as CSSProperties}>
                  <CatIcon cat={r.category} size={12} /> <Sprite def={SHARDS[r.me.family]} scale={1} /> <b className="num">−{r.damage}</b>{r.winner === 'me' ? <em>won</em> : null}
                </span>
              ))}
            </div>
            <p className={a.finalLine}>Every hit counts — the whole city sees the bar drop.</p>
          </div>
        ) : null}
      </main>

      {/* ── bas : mon équipe, techniques, envoi ── */}
      <footer className={a.mine}>
        {phase !== 'final' ? <div className={a.sideHead}>
          <b>You</b><span className={s.dealt}>dealt <b className="num">{fmtHp(v.damage)}</b></span>
          <Tokens left={v.me.tokens} preview={phase === 'choose' ? cost : 0} testId="raid-tokens" />
        </div> : null}
        {phase === 'choose' && v.challenge ? (
          <>
            <div className={a.models}>
              {v.me.team.map((m) => {
                const rl = v.me.rateLimited === m.family;
                const cat = v.challenge!.category;
                const ev = expectedPower({ family: m.family, category: cat, technique: tech, mastery: m.mastery, affinities: v.affinities });
                return (
                  <button key={m.family} type="button" className={`${a.model} ${fam === m.family ? a.modelOn : ''}`} disabled={rl}
                    data-testid={`raid-model-${m.family}`} data-ratelimited={rl ? '1' : '0'} aria-pressed={fam === m.family}
                    onClick={() => { play('pop'); buzz(HAPTIC.tap); setFam(m.family); }}>
                    <Sprite def={SHARDS[m.family]} scale={2} anim={fam === m.family} />
                    <b className={a.modelName}>{famName(m.family)}</b>
                    {rl ? <span className={a.rl}><Hourglass size={11} strokeWidth={3} /> Rate-limited</span> : (
                      <span className={a.modelStat}><CatIcon cat={cat} size={12} /> <b className="num">≈{Math.round(ev * RAID.damageScale * mult)}</b><small>dmg</small></span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className={a.techs} role="radiogroup" aria-label="Prompt technique">
              {TECHNIQUES.map((t) => {
                const r = TECHNIQUE_RULES[t];
                return (
                  <button key={t} type="button" role="radio" aria-checked={tech === t} disabled={r.cost > v.me.tokens} data-testid={`raid-tech-${t}`}
                    className={`${a.tech} ${tech === t ? a.techOn : ''}`} onClick={() => { play('tap'); setTech(t); }}>
                    <b>{r.name}</b><small>{r.cost ? `${r.cost} tok` : 'free'}</small>
                  </button>
                );
              })}
            </div>
            <div className={a.hint}>{TECHNIQUE_RULES[tech].hint}</div>
            <Button variant="gold" size="l" block testId="raid-send" reason={fam ? null : 'Pick a model for this round'} onClick={() => void send()}>
              <Send size={22} strokeWidth={2.8} /> Attack!
            </Button>
          </>
        ) : phase === 'sending' ? (
          <Button variant="gold" size="l" block loading testId="raid-send">Attacking…</Button>
        ) : phase === 'reveal' ? (
          <Button variant="primary" size="l" block testId="raid-next" disabled={step < 3} onClick={next}>
            {result ? <>It’s going down! <Sparkles size={20} strokeWidth={3} /></> : open ? <>Next round <ChevronRight size={22} strokeWidth={3} /></> : <>See damage <Sparkles size={20} strokeWidth={3} /></>}
          </Button>
        ) : (
          <Button variant="gold" size="l" block testId="raid-done" onClick={onClose}>Back to the raid</Button>
        )}
      </footer>

      {showEnd && result ? <RaidEndScreen result={result} onClose={onClose} /> : null}
    </div>
  );
}
