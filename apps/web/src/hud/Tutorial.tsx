// Tutoriel guidé par Margot (Docs/02 §7) : une bulle d'une phrase par étape, pilotée par me.tutorial, sautable.
// Fin : confettis, puis choix du district (pré-sélectionné selon la position).
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { TutorialState } from '@tokengo/shared';
import { useGame, openOverlay, setMe, toast } from '../lib/store.ts';
import { api, humanError, unwrapMe } from '../lib/api.ts';
import { play } from '../lib/sound.ts';
import { Sprite } from '../sprites/Sprite.tsx';
import { merchantSprite } from '../sprites/index.ts';
import { Sheet, Button } from '../ui/index.tsx';
import { DistrictPicker, districtName, guessDistrict } from '../screens/ProfileSheet.tsx';
import s from './Tutorial.module.css';

const SKIP_KEY = 'tg.tutorialSkipped';
const MARGOT = merchantSprite('grandma', 'margot');

type Step = keyof TutorialState | 'done';
const LINES: Record<Step, { text: string; cta?: string }> = {
  caught: { text: 'Hi, I’m Margot! See that glowing shard? Tap Catch, then tap again when the ring hits the dashed circle.' },
  synced: { text: 'Lovely catch! Now find a relay — the little antenna — and swipe its disc to sync.' },
  traded: { text: 'Merchants buy and sell shards. Open a shop, tap ⓘ “Why this price?”, then sell me one.' },
  firstCompile: { text: 'You’re ready: walk to the Forge and hold Compile. First Compile is on the city!' },
  playground: { text: 'That’s real compute now. Open Credits and ask the Playground anything.', cta: 'Open Credits' },
  done: { text: 'You’re a Runner now. Paris is yours!' },
};
const ORDER: (keyof TutorialState)[] = ['caught', 'synced', 'traded', 'firstCompile', 'playground'];

const skipped = () => { try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } };

export function Tutorial() {
  const me = useGame((st) => st.me);
  const overlay = useGame((st) => st.overlay);
  const [hidden, setHidden] = useState<Step | null>(null);
  const [off, setOff] = useState(skipped());
  const [confetti, setConfetti] = useState(false);
  const prevDone = useRef<boolean | null>(null);

  const step: Step = me ? ORDER.find((k) => !me.tutorial[k]) ?? 'done' : 'caught';
  const allDone = step === 'done';

  useEffect(() => {
    if (!me) return;
    if (prevDone.current === false && allDone) {
      setConfetti(true);
      play('level');
      setTimeout(() => setConfetti(false), 3200);
      if (!me.district) setTimeout(() => openOverlay({ kind: 'district' }), 1800);
    }
    prevDone.current = allDone;
  }, [allDone, me]);

  const showBubble = me && !overlay && hidden !== step && (allDone ? confetti : !off);
  return (
    <>
      {confetti ? <Confetti /> : null}
      {showBubble ? (
        <div className={s.coach} data-testid="tutorial" role="status">
          <span className={s.portrait}><Sprite def={MARGOT} scale={2} anim /></span>
          <div className={s.bubble}>
            <div className={s.who}>Margot <span className={s.count}>{allDone ? '✓' : `${ORDER.indexOf(step as keyof TutorialState) + 1}/5`}</span></div>
            <p>{LINES[step].text}</p>
            <div className={s.actions}>
              {LINES[step].cta ? <button type="button" className={s.cta} onClick={() => openOverlay({ kind: 'credits' })}>{LINES[step].cta}</button> : null}
              {!allDone ? <button type="button" className={s.skip} onClick={() => { try { localStorage.setItem(SKIP_KEY, '1'); } catch { /* */ } setOff(true); }} data-testid="tutorial-skip">Skip tutorial</button> : null}
            </div>
          </div>
          <button type="button" className={s.close} aria-label="Hide tip" onClick={() => setHidden(step)}><X size={16} strokeWidth={3} /></button>
        </div>
      ) : null}
    </>
  );
}

function Confetti() {
  const colors = ['#ffcd75', '#ef7d57', '#a7f070', '#41a6f6', '#b13e53', '#73eff7', '#5d275d'];
  return (
    <div className={s.confetti} aria-hidden data-testid="confetti">
      {Array.from({ length: 48 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 12) * 0.08}s`, animationDuration: `${1.8 + (i % 5) * 0.3}s` }} />
      ))}
    </div>
  );
}

/** Choix du district (fin d'onboarding, ou depuis le profil). */
export function DistrictSheet({ onClose }: { onClose: () => void }) {
  const me = useGame((st) => st.me);
  const [pick, setPick] = useState<number | null>(me?.district ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!pick) void guessDistrict().then((d) => { if (d) setPick((p) => p ?? d); }); }, []);
  const save = async () => {
    if (!pick || !me) return;
    setBusy(true);
    try {
      setMe(unwrapMe(await api.setDistrict(pick)) ?? { ...me, district: pick });
      toast(`Welcome to the ${districtName(pick)} arrondissement team!`, 'good');
      onClose();
    } catch (e) { toast(humanError(e), 'bad'); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title="Pick your district" subtitle="Your points help your arrondissement win the week." testId="district-sheet">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <DistrictPicker value={pick} onPick={setPick} busy={busy} />
        <Button variant="gold" size="l" block loading={busy} reason={pick ? null : 'Pick one above'} onClick={() => void save()} testId="district-save">
          {pick ? `Play for the ${districtName(pick)}` : 'Play for…'}
        </Button>
        <Button variant="ghost" block onClick={onClose}>Later</Button>
      </div>
    </Sheet>
  );
}
