// Mini-jeu « Lock-on » (Docs/02 §4, Docs/09 §4 Capture). Le client mesure l'écart anneau/cible ; le serveur décide.
import { useEffect, useRef, useState } from 'react';
import { FAMILY_INFO, judgeTap, type CatchStartResponse, type CatchResolveResponse, type SpawnView } from '@tokengo/shared';
import { api, ApiFail, humanError } from '../lib/api.ts';
import { useGame, setMe, toast, hideSpawn } from '../lib/store.ts';
import { famName, RARITY_LABEL } from '../lib/format.ts';
import { play, buzz } from '../lib/sound.ts';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, FAMILY_HEX, XP_STAR } from '../sprites/index.ts';
import { Button } from '../ui/index.tsx';
import s from './CatchScreen.module.css';

const RING_FROM = 2.6;
const RING_TO = 0.35;
const TARGET = 1;
const DARK_BG = new Set(['qwen']);

export function CatchScreen({ spawn, onClose }: { spawn: SpawnView; onClose: () => void }) {
  const fam = spawn.family;
  const [params, setParams] = useState<CatchStartResponse | null>(null);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [result, setResult] = useState<CatchResolveResponse | null>(null);
  const [resolving, setResolving] = useState(false);
  const ring = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(RING_FROM);
  const t0 = useRef(0);
  const done = useRef(false);

  // démarrage de la tentative
  useEffect(() => {
    let alive = true;
    api.catchStart(spawn.id).then((p) => { if (alive) { setParams(p); t0.current = performance.now(); } }).catch((e) => {
      if (!alive) return;
      if (e instanceof ApiFail && (e.code === 'ALREADY_CAUGHT' || e.code === 'EXPIRED')) hideSpawn(spawn.id);
      toast(humanError(e), 'bad');
      play('error');
      onClose();
    });
    return () => { alive = false; };
  }, [spawn.id, onClose]);

  // anneau qui se resserre (rAF, sans re-render React)
  useEffect(() => {
    if (!params || result) return;
    let raf = 0;
    const tick = (t: number) => {
      const elapsed = t - t0.current;
      const k = (elapsed % params.ringMs) / params.ringMs;
      const sc = RING_FROM + (RING_TO - RING_FROM) * k;
      scaleRef.current = sc;
      if (ring.current) ring.current.style.transform = `translate(-50%, -50%) scale(${sc})`;
      // pas de tap pendant 3 cycles → compte comme un raté
      if (elapsed > params.ringMs * 3 * (offsets.length + 1) && !done.current) { registerTap(1); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, result, offsets.length]);

  const resolve = async (all: number[]) => {
    if (!params || done.current) return;
    done.current = true;
    setResolving(true);
    try {
      const r = await api.catchResolve({ attemptId: params.attemptId, offsets: all });
      useGame.setState({ lastResult: r });
      setResult(r);
      setMe(r.me, r.levelUp);
      if (r.result === 'perfect' || r.result === 'good') {
        hideSpawn(spawn.id);
        play(r.result === 'perfect' ? 'perfect' : 'catch');
        buzz(r.result === 'perfect' ? [30, 40, 60] : 40);
      } else if (r.result === 'fled') {
        hideSpawn(spawn.id);
        play('fled');
      } else play('miss');
    } catch (e) {
      toast(humanError(e), 'bad');
      onClose();
    } finally {
      setResolving(false);
    }
  };

  const registerTap = (forced?: number) => {
    if (!params || done.current || resolving) return;
    const off = forced ?? Math.min(1, Math.abs(scaleRef.current - TARGET) / TARGET);
    const all = [...offsets, off];
    setOffsets(all);
    const q = judgeTap(off, params);
    if (q !== 'miss' || all.length >= params.tries) { void resolve(all); return; }
    play('miss');
    setFlash(off > 0.5 ? 'Way off!' : 'Close!');
    setTimeout(() => setFlash(null), 600);
    t0.current = performance.now();
  };

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(onClose, result.result === 'perfect' || result.result === 'good' ? 2600 : 2000);
    return () => clearTimeout(t);
  }, [result, onClose]);

  const info = FAMILY_INFO[fam];
  const sparkles = 6 + ['common', 'uncommon', 'rare', 'epic'].indexOf(info.rarity) * 2; // plus rare = plus d'étincelles
  const caught = result && (result.result === 'perfect' || result.result === 'good');
  return (
    <div className={`${s.screen} pixel-pattern ${DARK_BG.has(fam) ? s.dark : ''}`} style={{ backgroundColor: FAMILY_HEX[fam] }}
      data-testid="catch-screen" onPointerDown={() => { if (!result) registerTap(); }}>
      <header className={s.head}>
        <h2>{famName(fam)} Shard</h2>
        <span className={s.rarity}>{RARITY_LABEL[info.rarity]}</span>
      </header>

      <div className={s.stage}>
        {!result ? (
          <>
            <div className={s.glow} style={{ '--glow': FAMILY_HEX[fam] } as React.CSSProperties} aria-hidden />
            <div className={s.orbit} aria-hidden>
              {Array.from({ length: sparkles }, (_, i) => (
                <i key={i} style={{ '--a': `${(360 / sparkles) * i}deg`, '--d': `${(i % 3) * 0.2}s` } as React.CSSProperties} />
              ))}
            </div>
            <div className={s.target} />
            {params ? <div ref={ring} className={s.ring} /> : null}
            <div className={s.shard}><Sprite def={SHARDS[fam]} scale={10} anim /></div>
            {flash ? <div className={s.flash}>{flash}</div> : null}
          </>
        ) : caught ? (
          <div className={s.result} data-testid="catch-result">
            <div className={s.burst} aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ '--a': `${i * 20}deg`, '--c': i % 3 ? FAMILY_HEX[fam] : '#fff' } as React.CSSProperties} />)}</div>
            <Sprite def={SHARDS[fam]} scale={6} anim />
            <div className={s.card}>
              <div className={s.big}>+{result.qty} {famName(fam)} Shard{result.qty > 1 ? 's' : ''}</div>
              <div className={s.grade}>{result.result === 'perfect' ? (result.qty > 1 ? 'PERFECT · Clean lock! Bonus shard.' : 'PERFECT · Clean lock!') : 'Locked. Nice!'}</div>
              <div className={s.xp}><Sprite def={XP_STAR} scale={2} /> +{result.xp} XP{result.combo > 1 ? ` · combo ×${result.combo}` : ''}</div>
            </div>
          </div>
        ) : (
          <div className={s.result} data-testid="catch-result">
            <div className={result.result === 'fled' ? s.dissolve : s.wobble}><Sprite def={SHARDS[fam]} scale={6} /></div>
            <div className={s.card}>
              <div className={s.big}>{result.result === 'fled' ? 'It fled…' : 'Missed!'}</div>
              <div className={s.grade}>{result.result === 'fled' ? 'Rare shards are skittish. Next one!' : 'Out of tries — it’s still out there.'}</div>
            </div>
          </div>
        )}
      </div>

      <footer className={s.foot} onPointerDown={(e) => e.stopPropagation()}>
        {!result ? (
          <>
            <div className={s.tries} aria-label="tries left">
              {Array.from({ length: params?.tries ?? 3 }, (_, i) => <i key={i} className={i < offsets.length ? s.used : ''} />)}
            </div>
            <div className={s.hint}>{params ? 'Tap when the ring hits the dashed circle!' : 'Locking on…'}</div>
            <Button variant="ghost" size="s" onClick={onClose} testId="catch-run">Run away</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose} testId="catch-continue">Continue</Button>
        )}
      </footer>
    </div>
  );
}
