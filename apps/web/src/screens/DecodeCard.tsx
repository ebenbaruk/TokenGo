// Décodage « Next token » (Docs/13 §3) : 2ᵉ temps de capture. Une phrase avec un trou clignotant, 3 jetons en gros
// boutons, une barre de temps qui fond. Le client ne connaît PAS la bonne réponse : il envoie un id opaque, le serveur
// juge (délai mesuré côté serveur). Après la réponse, `verdict` colore les jetons et lance le feedback.
import { useEffect, useRef, type CSSProperties } from 'react';
import type { DecodeView, Family } from '@tokengo/shared';
import { famName } from '../lib/format.ts';
import { play } from '../lib/sound.ts';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, FAMILY_HEX, FAMILY_DARK } from '../sprites/index.ts';
import s from './DecodeCard.module.css';

export interface DecodeVerdictView { verdict: 'correct' | 'wrong' | 'late'; correctId: string; chosen: string | null }

interface Props {
  family: Family;
  view: DecodeView;
  mode: 'required' | 'bonus';
  /** qualité du Lock-on qui a ouvert la question (obligatoire) */
  lock?: 'perfect' | 'good' | undefined;
  verdict: DecodeVerdictView | null;
  /** ligne de résultat (bonus : « +5 XP · Lucky next catch ») */
  outcome?: string | null;
  glitch: boolean;
  onPick: (choiceId: string | null) => void;
}

/** « 2, 4, 8, 16, ___ » → texte + curseur clignotant (ou le jeton trouvé, en couleur). */
function Prompt({ text, fill, ok }: { text: string; fill: string | null; ok: boolean }) {
  const [before, after = ''] = text.split('___');
  return (
    <p className={`${s.prompt} ${text.length > 30 ? s.long : ""}`} data-testid="decode-prompt">
      {before}
      {fill ? <span className={`${s.fill} ${ok ? s.fillOk : s.fillBad}`}>{fill}</span> : <span className={s.blank} aria-label="blank">___</span>}
      {after}
    </p>
  );
}

export function DecodeCard({ family, view, mode, lock, verdict, outcome, glitch, onPick }: Props) {
  const picked = useRef(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  // chrono local (affichage) ; le serveur reste juge du délai. Tic-tac sur les 2 dernières secondes.
  useEffect(() => {
    picked.current = false;
    const ticks = [view.deadlineMs - 2000, view.deadlineMs - 1000].filter((x) => x > 0)
      .map((at) => setTimeout(() => { if (!picked.current) play('tick'); }, at));
    const out = setTimeout(() => {
      if (picked.current) return;
      picked.current = true;
      pickRef.current(null);
    }, view.deadlineMs + 150);
    return () => { clearTimeout(out); ticks.forEach(clearTimeout); };
  }, [view.id, view.prompt, view.deadlineMs]);

  const pick = (id: string) => {
    if (picked.current || verdict) return;
    picked.current = true;
    pickRef.current(id);
  };

  const ok = verdict?.verdict === 'correct';
  const correctText = verdict ? view.choices.find((c) => c.id === verdict.correctId)?.text ?? null : null;
  const stateOf = (id: string): string => {
    if (!verdict) return picked.current ? 'wait' : 'idle';
    if (id === verdict.correctId) return 'right';
    if (id === verdict.chosen) return 'wrong';
    return 'dim';
  };
  return (
    <div className={`${s.wrap} pixel-pattern ${glitch ? s.glitch : ''}`} data-testid="decode-card" data-mode={mode}
      data-verdict={verdict?.verdict ?? ''}
      style={{ backgroundColor: FAMILY_HEX[family], '--fam': FAMILY_HEX[family], '--famDark': FAMILY_DARK[family], '--t': `${view.deadlineMs}ms` } as CSSProperties}
      onPointerDown={(e) => e.stopPropagation()}>
      <header className={s.head}>
        <span className={s.mini}><Sprite def={SHARDS[family]} scale={3} anim /></span>
        <div>
          <div className={s.kicker}>{mode === 'bonus' ? 'Bonus decode ⚡' : lock === 'perfect' ? 'PERFECT lock · now decode' : 'Locked · now decode'}</div>
          <h2 className={s.title}>DECODE</h2>
        </div>
      </header>

      <div className={s.term}>
        <div className={s.termBar}><i /><i /><i /><span>{famName(family).toLowerCase()} › next token</span></div>
        <Prompt text={view.prompt} fill={verdict ? correctText : null} ok={ok} />
        <div className={s.timer} aria-hidden><div className={`${s.timeFill} ${verdict ? s.timeStop : ''}`} key={view.id + view.prompt} /></div>
      </div>

      <div className={s.chips} role="group" aria-label="Pick the next token">
        {view.choices.map((c, i) => (
          <button key={c.id} type="button" className={s.chip} data-state={stateOf(c.id)} data-choice-id={c.id} data-testid={`decode-choice-${i}`}
            style={{ '--i': i } as CSSProperties}
            onPointerDown={(e) => { e.stopPropagation(); pick(c.id); }}
            onClick={() => pick(c.id)}>
            <span className={s.chipIdx}>{i + 1}</span>
            <span className={s.chipText}>{c.text}</span>
          </button>
        ))}
      </div>

      <div className={s.foot}>
        {verdict ? (
          ok ? <div className={s.stamp} data-testid="decode-ok">DECODED!</div>
            : <div className={s.halluc} data-testid="decode-bad" data-text="hallucinated…">hallucinated…</div>
        ) : <div className={s.hint}>{mode === 'bonus' ? 'Bonus: +XP & a luckier next catch' : 'Pick the token that comes next'}</div>}
        {outcome ? <div className={s.outcome} data-testid="decode-outcome">{outcome}</div> : null}
      </div>

      {ok ? (
        <div className={s.burst} aria-hidden>
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{ '--a': `${i * 20}deg`, '--r': `${110 + (i % 3) * 40}px`, '--c': i % 3 === 0 ? '#fff' : i % 3 === 1 ? '#a7f070' : FAMILY_HEX[family] } as CSSProperties} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
