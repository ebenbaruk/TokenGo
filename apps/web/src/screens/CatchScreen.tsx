// Mini-jeu « Lock-on » (Docs/02 §4, Docs/09 §4 Capture). Le client mesure l'écart anneau/cible ; le serveur décide
// (résultat, combo, variante du Codex). Juice : aura de combo, son qui monte avec le combo, secousse + confettis sur
// PERFECT, révélation de la variante, compteur d'XP qui roule, éclat qui vole jusqu'au sac.
// Décodage « Next token » (Docs/13 §3) : Rare/Épique → carte DECODE obligatoire après le Lock-on ; Commun → bouton bonus.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CATCH, DECODE, FAMILY_INFO, judgeTap, type CatchStartResponse, type CatchResolveResponse, type DecodeView, type SpawnView } from '@tokengo/shared';
import { api, ApiFail, humanError } from '../lib/api.ts';
import { useGame, setMe, toast, hideSpawn, flyToBag } from '../lib/store.ts';
import { famName, RARITY_LABEL } from '../lib/format.ts';
import { play, buzz, HAPTIC, feedback } from '../lib/sound.ts';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, FAMILY_HEX, XP_STAR } from '../sprites/index.ts';
import { shardVariant, VARIANT_COLOR, FLAME } from '../sprites/variants.ts';
import { Button, Counter } from '../ui/index.tsx';
import { DecodeCard, type DecodeVerdictView } from './DecodeCard.tsx';
import s from './CatchScreen.module.css';

const RING_FROM = 1.9; // l'anneau est visible dès le début du cycle sur un écran de 390 px (2.6 le cachait un tiers du temps)
const RING_TO = 0.35;
const TARGET = 1;
const DARK_BG = new Set(['qwen']);
/** demi-tons de montée du son de capture par niveau de combo */
const COMBO_SEMITONES = 2;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Décodage en cours : question, obligatoire ou bonus, verdict une fois répondu. */
interface DecodeState { view: DecodeView; mode: 'required' | 'bonus'; lock?: 'perfect' | 'good' | undefined; verdict: DecodeVerdictView | null; outcome: string | null; glitch: boolean }

/** Combo encore vivant (même règle que le serveur : 90 s depuis la dernière capture). */
function liveCombo(): number {
  const me = useGame.getState().me;
  if (!me || !me.comboExpiresAt || me.comboExpiresAt < Date.now()) return 0;
  return me.combo;
}

export function CatchScreen({ spawn, onClose }: { spawn: SpawnView; onClose: () => void }) {
  const fam = spawn.family;
  const [params, setParams] = useState<CatchStartResponse | null>(null);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [result, setResult] = useState<CatchResolveResponse | null>(null);
  const [resolving, setResolving] = useState(false);
  const [shake, setShake] = useState<'' | 'small' | 'big'>('');
  const [reveal, setReveal] = useState(false);
  const [combo0] = useState(liveCombo);
  const [decode, setDecode] = useState<DecodeState | null>(null);
  const [bonus, setBonus] = useState<'ready' | 'opening' | 'won' | 'lost' | null>(null);
  const [hallucinated, setHallucinated] = useState(false);
  const [decoded, setDecoded] = useState(false);
  const roundStart = useRef(0); // index du premier tap de ce Lock-on (relance après un Décodage raté)
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
    if (!params || result || decode) return;
    let raf = 0;
    const tick = (t: number) => {
      const elapsed = t - t0.current;
      const k = (elapsed % params.ringMs) / params.ringMs;
      const sc = RING_FROM + (RING_TO - RING_FROM) * k;
      scaleRef.current = sc;
      if (ring.current) {
        ring.current.style.transform = `translate(-50%, -50%) scale(${sc})`;
        // l'anneau s'éclaire quand il entre dans la fenêtre « good »
        ring.current.dataset.hot = Math.abs(sc - TARGET) <= params.goodPct ? '1' : '0';
      }
      // pas de tap pendant 3 cycles → compte comme un raté
      if (elapsed > params.ringMs * 3 * (offsets.length + 1) && !done.current) { registerTap(1); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, result, offsets.length, decode]);

  const bump = (k: 'small' | 'big') => { setShake(k); setTimeout(() => setShake(''), k === 'big' ? 520 : 300); };

  const resolve = async (all: number[]) => {
    if (!params || done.current) return;
    done.current = true;
    setResolving(true);
    try {
      const r = await api.catchResolve({ attemptId: params.attemptId, offsets: all.slice(roundStart.current) });
      useGame.setState({ lastResult: r });
      if (r.result === 'decode' && r.decode) {
        // Lock-on réussi sur un Rare/Épique : l'écran bascule sur la carte DECODE (rien n'est encore gagné)
        feedback('decodeIn', 'reveal');
        bump('small');
        setDecode({ view: r.decode, mode: 'required', lock: r.lock, verdict: null, outcome: null, glitch: false });
        return;
      }
      applyResult(r);
    } catch (e) {
      toast(humanError(e), 'bad');
      onClose();
    } finally {
      setResolving(false);
    }
  };

  /** Affiche le résultat final d'une capture (après le Lock-on, ou après le Décodage). */
  const applyResult = (r: CatchResolveResponse) => {
    {
      useGame.setState({ lastResult: r });
      setResult(r);
      setMe(r.me, r.levelUp);
      if (r.bonusDecode) setBonus('ready');
      if (r.result === 'perfect' || r.result === 'good') {
        hideSpawn(spawn.id);
        const pitch = Math.min(4, Math.max(0, r.combo - 1)) * COMBO_SEMITONES;
        if (r.result === 'perfect') { feedback('perfect', 'perfect', pitch); bump('big'); } else { feedback('catch', 'good', pitch); bump('small'); }
        // révélation de la variante, un temps après l'explosion
        if (r.codex) {
          setTimeout(() => {
            setReveal(true);
            if (r.codex!.variant === 'shiny') feedback('shiny', 'shiny');
            else if (r.codex!.isNew) play('discover');
          }, 650);
          if (r.codex.newTitle) setTimeout(() => toast(`New title: ${r.codex!.newTitle}!`, 'good', 'level', 3500), 1200);
        }
      } else if (r.result === 'fled') {
        hideSpawn(spawn.id);
        play('fled');
      } else { play('miss'); buzz(HAPTIC.miss); }
    }
  };

  /** Réponse au Décodage (choiceId null = temps écoulé). Le serveur juge ; on joue le feedback puis la suite. */
  const answerDecode = async (choiceId: string | null) => {
    if (!params || !decode || decode.verdict) return;
    const mode = decode.mode;
    try {
      const a = await api.decodeAnswer(params.attemptId, choiceId);
      const ok = a.verdict === 'correct';
      const verdict = { verdict: a.verdict, correctId: a.correctId, chosen: choiceId };
      if (ok) { feedback('decoded', 'decoded'); bump('small'); } else { feedback('glitch', 'glitch'); bump('big'); }
      if (mode === 'bonus') {
        const b = a.bonus!;
        setMe(b.me, b.levelUp);
        setDecode((d) => d && { ...d, verdict, glitch: !ok, outcome: ok ? `+${b.xp} XP · Shiny chance ×${DECODE.luckyShinyMult} next catch` : 'No bonus this time' });
        setBonus(ok ? 'won' : 'lost');
        await wait(ok ? 1300 : 1500);
        setDecode(null);
        return;
      }
      setDecode((d) => d && { ...d, verdict, glitch: !ok });
      await wait(ok ? 1200 : 1400);
      const c = a.catch!;
      if (ok) setDecoded(true);
      setDecode(null);
      if (c.triesLeft) {
        // l'éclat n'a pas fui : on relance le Lock-on avec les essais restants (même tentative côté serveur)
        setMe(c.me, null);
        const used = params.tries - c.triesLeft;
        roundStart.current = used;
        setOffsets(Array.from({ length: used }, () => 1));
        setFlash('Hallucinated! Lock on again');
        setTimeout(() => setFlash(null), 1800);
        t0.current = performance.now();
        done.current = false;
        return;
      }
      if (!ok) setHallucinated(true);
      applyResult(c);
    } catch (e) {
      toast(humanError(e), 'bad');
      onClose();
    }
  };

  /** Bouton « Decode bonus » (Commun / Peu commun) : le chrono part à l'ouverture. */
  const openBonus = async () => {
    if (!params || bonus !== 'ready') return;
    setBonus('opening');
    try {
      const v = await api.decodeOpen(params.attemptId);
      feedback('decodeIn', 'reveal');
      setDecode({ view: v, mode: 'bonus', verdict: null, outcome: null, glitch: false });
    } catch (e) {
      setBonus(null);
      toast(humanError(e), 'bad');
    }
  };

  const registerTap = (forced?: number) => {
    if (!params || done.current || resolving || decode) return;
    const off = forced ?? Math.min(1, Math.abs(scaleRef.current - TARGET) / TARGET);
    const all = [...offsets, off];
    setOffsets(all);
    const q = judgeTap(off, params);
    if (q !== 'miss' || all.length >= params.tries) { void resolve(all); return; }
    play('miss');
    buzz(HAPTIC.miss);
    bump('small');
    setFlash(off > 0.5 ? 'Way off!' : 'Close!');
    setTimeout(() => setFlash(null), 600);
    t0.current = performance.now();
  };

  const caught = result && (result.result === 'perfect' || result.result === 'good');
  const close = () => {
    if (caught && result) flyToBag(fam, result.codex?.variant ?? 'classic', result.qty);
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!result || decode || bonus === 'opening') return;
    const ok = result.result === 'perfect' || result.result === 'good';
    // bonus de Décodage proposé : on laisse le temps de le voir (Continue reste là pour passer)
    const base = ok ? (result.codex?.isNew || result.codex?.variant === 'shiny' ? 3600 : 2800) : 2000;
    const t = setTimeout(() => closeRef.current(), bonus === 'ready' ? base + 6000 : bonus ? 2400 : base);
    return () => clearTimeout(t);
  }, [result, decode, bonus]);

  const info = FAMILY_INFO[fam];
  const sparkles = 6 + ['common', 'uncommon', 'rare', 'epic'].indexOf(info.rarity) * 2; // plus rare = plus d'étincelles
  const perfect = result?.result === 'perfect';
  const variant = result?.codex?.variant ?? 'classic';
  const heat = Math.min(1, combo0 / CATCH.comboMax); // aura du combo en cours
  const nParticles = perfect ? 28 : 16;
  return (
    <div className={`${s.screen} pixel-pattern ${DARK_BG.has(fam) ? s.dark : ''} ${shake === 'big' ? s.shakeBig : shake === 'small' ? s.shakeSmall : ''}`}
      style={{ backgroundColor: FAMILY_HEX[fam] }}
      data-testid="catch-screen" onPointerDown={() => { if (!result && !decode) registerTap(); }}>
      <header className={s.head}>
        <h2>{famName(fam)} Shard</h2>
        <span className={s.rarity}>{RARITY_LABEL[info.rarity]}</span>
        {!result && combo0 >= 1 ? (
          <div className={s.comboChip} data-testid="catch-combo" style={{ '--heat': heat } as CSSProperties}>
            <Sprite def={FLAME} scale={2} anim />
            combo ×{combo0} <small>→ next ×{Math.min(CATCH.comboMax, combo0 + 1)}</small>
          </div>
        ) : null}
      </header>

      <div className={s.stage}>
        {!result ? (
          <>
            <div className={s.glow} style={{ '--glow': FAMILY_HEX[fam] } as CSSProperties} aria-hidden />
            {combo0 >= 2 ? <div className={s.aura} style={{ '--heat': heat } as CSSProperties} aria-hidden /> : null}
            <div className={s.orbit} aria-hidden>
              {Array.from({ length: sparkles }, (_, i) => (
                <i key={i} style={{ '--a': `${(360 / sparkles) * i}deg`, '--d': `${(i % 3) * 0.2}s` } as CSSProperties} />
              ))}
            </div>
            <div className={s.target} />
            {params ? <div ref={ring} className={s.ring} /> : null}
            <div className={s.shard}><Sprite def={SHARDS[fam]} scale={10} anim /></div>
            {flash ? <div className={s.flash}>{flash}</div> : null}
          </>
        ) : caught ? (
          <div className={s.result} data-testid="catch-result">
            {perfect ? <div className={s.whiteout} aria-hidden /> : null}
            <div className={s.shock} aria-hidden />
            <div className={s.burst} aria-hidden>
              {Array.from({ length: nParticles }, (_, i) => (
                <i key={i} style={{
                  '--a': `${(360 / nParticles) * i + (i % 2) * 7}deg`, '--r': `${120 + (i % 4) * 34}px`, '--s': `${6 + (i % 3) * 4}px`,
                  '--c': i % 4 === 0 ? '#fff' : i % 4 === 1 ? '#ffcd75' : FAMILY_HEX[fam], '--dl': `${(i % 5) * 25}ms`,
                } as CSSProperties} />
              ))}
            </div>
            <div className={`${s.prize} ${reveal ? s.prizeOn : ''}`} style={{ '--vc': VARIANT_COLOR[variant] } as CSSProperties} data-variant={variant}>
              {reveal && variant !== 'classic' ? <div className={s.rays} aria-hidden /> : null}
              <span className={s.prizeArt}><Sprite def={reveal ? shardVariant(fam, variant) : SHARDS[fam]} scale={7} anim /></span>
            </div>
            <div className={s.card}>
              <div className={s.big}>+{result.qty} {famName(fam)} Shard{result.qty > 1 ? 's' : ''}</div>
              <div className={s.grade}>{perfect ? (result.qty > 1 ? 'PERFECT · Clean lock! Bonus shard.' : 'PERFECT · Clean lock!') : 'Locked. Nice!'}{decoded ? ' Decoded ⚡' : ''}</div>
              {result.codex ? (
                <div className={`${s.variant} ${reveal ? s.variantOn : ''}`} data-testid="catch-variant" data-variant={result.codex.variant}>
                  {result.codex.isNew ? <span className={s.newTag}>NEW</span> : null}
                  <b>{result.codex.name}</b>
                  <span className={s.codexCount}>Codex {result.codex.found}/{result.codex.total}</span>
                </div>
              ) : null}
              <div className={s.xp}><Sprite def={XP_STAR} scale={2} /> <Counter value={reveal || !result.codex ? result.xp : result.xp - result.codex.xp} format={(n) => `+${Math.round(n)} XP`} showDelta={false} duration={600} testId="catch-xp" /></div>
              {result.combo > 1 ? (
                <div className={s.comboBig} data-testid="catch-combo-result" style={{ '--heat': Math.min(1, result.combo / CATCH.comboMax) } as CSSProperties}>
                  <Sprite def={FLAME} scale={3} anim />
                  COMBO ×{result.combo}
                </div>
              ) : null}
              {result.lucky ? <div className={s.lucky} data-testid="catch-lucky">⚡ Lucky catch · Shiny chance ×{DECODE.luckyShinyMult}</div> : null}
              {bonus === 'won' ? <div className={s.bonusWon} data-testid="decode-bonus-won">⚡ Decoded! +{DECODE.bonusXp} XP · luckier next catch</div> : null}
            </div>
          </div>
        ) : (
          <div className={s.result} data-testid="catch-result">
            <div className={result.result === 'fled' ? s.dissolve : s.wobble}><Sprite def={SHARDS[fam]} scale={6} /></div>
            <div className={s.card}>
              <div className={s.big}>{result.result === 'fled' ? (hallucinated ? 'It hallucinated…' : 'It fled…') : 'Missed!'}</div>
              <div className={s.grade}>{result.result === 'fled' ? (hallucinated ? '…and slipped away. Read fast, pick the next token!' : 'Rare shards are skittish. Next one!') : 'Out of tries — it’s still out there.'}</div>
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
          <div className={s.footRow}>
            {bonus === 'ready' || bonus === 'opening' ? (
              <Button variant="gold" onClick={() => void openBonus()} loading={bonus === 'opening'} testId="decode-bonus">Decode bonus ⚡</Button>
            ) : null}
            <Button variant="secondary" onClick={close} testId="catch-continue">Continue</Button>
          </div>
        )}
      </footer>

      {decode ? (
        <DecodeCard family={fam} view={decode.view} mode={decode.mode} lock={decode.lock} verdict={decode.verdict} outcome={decode.outcome}
          glitch={decode.glitch} onPick={(id) => void answerDecode(id)} />
      ) : null}
    </div>
  );
}
