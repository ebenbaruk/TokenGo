// Forge (Docs/09 §4) : enclume dorée sur aplat plum, recettes du jour, Hold to Compile, ticket de crédit.
import { useEffect, useState, type CSSProperties } from 'react';
import { equivalences, formatTokens, haversineM, type CompileResponse, type Family, type ForgeView, type NodeView, type RecipeView } from '@tokengo/shared';
import { X, ExternalLink, Lock, Share2 } from 'lucide-react';
import { api, humanError } from '../lib/api.ts';
import { useGame, setMe, toast, openOverlay } from '../lib/store.ts';
import { radiusFor } from '../lib/nearby.ts';
import { famName, fmtDist, fmtUsd, txUrl } from '../lib/format.ts';
import { play, buzz, feedback, HAPTIC } from '../lib/sound.ts';
import { creditCard, shareImage } from '../lib/share.ts';
import { HoldButton, Button } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { FORGE, SHARDS, FLUX, XP_STAR } from '../sprites/index.ts';
import s from './ForgeScreen.module.css';

type Phase = 'pick' | 'fusing' | 'ticket';

function slotsOf(r: RecipeView): { f: Family; filled: boolean }[] {
  const out: { f: Family; filled: boolean }[] = [];
  for (const [f, q] of Object.entries(r.needs) as [Family, number][]) {
    const miss = r.missing[f] ?? 0;
    for (let i = 0; i < q; i++) out.push({ f, filled: i < q - miss });
  }
  return out;
}

export function ForgeScreen({ node, onClose }: { node: NodeView; onClose: () => void }) {
  const me = useGame((st) => st.me);
  const pos = useGame((st) => st.pos);
  const [forge, setForge] = useState<ForgeView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<RecipeView['tier'] | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [res, setRes] = useState<CompileResponse | null>(null);
  const [flying, setFlying] = useState<Family[]>([]);
  const [sharing, setSharing] = useState(false);
  const share = async () => {
    if (!res) return;
    setSharing(true);
    try {
      const blob = await creditCard(res, forge?.name ?? node.name, flying);
      const text = res.payoutNusd > 0
        ? `I walked around, caught AI shards and compiled ${fmtUsd(res.payoutNusd)} of real NEAR AI Cloud compute on TokenGo.`
        : 'Compiled shards at a TokenGo Forge.';
      await shareImage(blob, `tokengo-credit-${res.compileId.slice(0, 8)}.png`, text, 'ticket');
    } catch { toast('Could not make the card — try again.', 'bad'); } finally { setSharing(false); }
  };

  const load = () => api.forge(node.id).then((f) => {
    setForge(f);
    setSel((cur) => cur ?? (f.recipes.find((r) => !r.locked && Object.keys(r.missing).length === 0)?.tier ?? f.recipes[0]?.tier ?? null));
  }).catch((e) => setErr(humanError(e)));
  useEffect(() => { void load(); }, [node.id]);

  const dist = pos ? haversineM(pos, node) : Infinity;
  const inRange = pos ? dist <= radiusFor('forge', pos) : false;
  const recipe = forge?.recipes.find((r) => r.tier === sel) ?? null;
  const missingCount = recipe ? Object.values(recipe.missing).reduce((a, b) => a + (b ?? 0), 0) : 0;
  const reason = !recipe ? 'Pick a recipe'
    : recipe.locked ? recipe.locked
    : forge?.reserve.forgePaused ? 'Forges are paused for maintenance'
    : missingCount > 0 ? `Missing ${Object.entries(recipe.missing).filter(([, q]) => q).map(([f, q]) => `${q} ${famName(f as Family)}`).join(', ')}`
    : (me?.flux ?? 0) < recipe.fee ? `Needs ${recipe.fee} ƒ fee — you have ${me?.flux ?? 0}`
    : !inRange ? `${Math.round(dist)} m away — get a bit closer` : null;

  const compile = async () => {
    if (!recipe) return;
    setFlying(slotsOf(recipe).map((x) => x.f));
    setPhase('fusing');
    play('forge');
    buzz(HAPTIC.forge);
    const t0 = Date.now();
    try {
      const r = await api.compile(node.id, { tier: recipe.tier });
      useGame.setState({ lastResult: r });
      await new Promise((ok) => setTimeout(ok, Math.max(0, 1900 - (Date.now() - t0))));
      setRes(r);
      setMe(r.me, r.levelUp);
      setPhase('ticket');
      feedback(r.payoutNusd > 0 ? 'discover' : 'level', 'perfect');
      void load();
    } catch (e) {
      toast(humanError(e), 'bad');
      play('error');
      setPhase('pick');
    }
  };

  return (
    <div className={`${s.screen} pixel-pattern`} data-testid="forge-screen">
      <header className={s.head}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className={s.title}>{forge?.name ?? node.name}</h2>
          <div className={s.sub}>Forge · {Number.isFinite(dist) ? fmtDist(dist) : ''}{forge ? ` · theme ${forge.theme.map(famName).join(' & ')}` : ''}</div>
        </div>
        <button type="button" className={s.close} onClick={onClose} aria-label="Close" data-testid="forge-close"><X strokeWidth={3} /></button>
      </header>

      <div className={`${s.anvil} ${phase === 'fusing' ? s.fusing : ''}`}>
        <div className={s.glow} />
        <Sprite def={FORGE} scale={5} anim />
        {phase === 'fusing' ? flying.map((f, i) => (
          <span key={i} className={s.fly} style={{ '--x': `${(i - (flying.length - 1) / 2) * 34}px`, '--d': `${i * 70}ms` } as CSSProperties}>
            <Sprite def={SHARDS[f]} scale={2} />
          </span>
        )) : null}
        {phase === 'fusing' ? <div className={s.flash} /> : null}
      </div>

      {err ? <p className={s.err}>{err}</p> : null}

      {phase !== 'ticket' ? (
        <>
          <div className={s.cards} role="listbox" aria-label="Recipes">
            {(forge?.recipes ?? []).map((r) => {
              const eq = r.payoutNusd > 0 ? equivalences(r.payoutNusd) : null;
              const ready = !r.locked && Object.values(r.missing).every((q) => !q);
              return (
                <button key={r.tier} type="button" role="option" aria-selected={sel === r.tier} data-testid={`recipe-${r.tier}`}
                  className={`${s.card} ${sel === r.tier ? s.selected : ''} ${r.locked ? s.locked : ''}`}
                  onClick={() => { play('tap'); setSel(r.tier); }}>
                  <div className={s.cardHead}>
                    <span className={s.cardTitle}>{r.label}</span>
                    {r.locked ? <Lock size={16} strokeWidth={3} /> : ready ? <span className={s.ready}>ready</span> : null}
                  </div>
                  <div className={s.slots}>
                    {slotsOf(r).map((x, i) => (
                      <span key={i} className={`${s.slot} ${x.filled ? '' : s.emptySlot}`}><Sprite def={SHARDS[x.f]} scale={2} /></span>
                    ))}
                  </div>
                  <div className={s.payout}>
                    {r.payoutNusd > 0 ? <><b>≈ {fmtUsd(r.payoutNusd)}</b><span>≈ {eq!.chats} DeepSeek chats</span></> : <b>XP only</b>}
                  </div>
                  <div className={s.fee}><Sprite def={FLUX} scale={1} /> fee {r.fee} ƒ · Lv {r.level}</div>
                  {r.payoutNote ? <div className={s.note}>{r.payoutNote}</div> : null}
                </button>
              );
            })}
            {!forge && !err ? <div className={s.loading}>Heating up…</div> : null}
          </div>
          {phase === 'fusing' ? <p className={s.wait}>Fusing your shards… a few seconds.</p> : null}
          <div className={s.action}>
            <HoldButton testId="compile-btn" reason={phase === 'fusing' ? 'Compiling…' : reason} onConfirm={() => void compile()}>
              {phase === 'fusing' ? 'Compiling…' : 'Hold to Compile'}
            </HoldButton>
          </div>
        </>
      ) : res ? (
        <div className={s.ticketWrap}>
          <div className={s.ticket} data-testid="credit-ticket">
            {res.simulated ? <span className={s.simBadge}>simulated</span> : null}
            <div className={s.ticketLabel}>{res.payoutNusd > 0 ? 'Compiled. This is real compute now.' : 'Compiled!'}</div>
            <div className={s.amount}>{res.payoutNusd > 0 ? `+${fmtUsd(res.payoutNusd)}` : `+${res.xp} XP`}</div>
            {res.payoutNusd > 0 ? (
              <ul className={s.equiv}>
                <li>≈ {res.equiv.chats} DeepSeek chats</li>
                {res.equiv.tokens.slice(0, 3).map((t) => <li key={t.model}>≈ {formatTokens(t.tokens)} {t.label} tokens</li>)}
              </ul>
            ) : null}
            {res.pending ? <div className={s.pendingTicket} data-testid="ticket-pending">Credit pending — it reaches your key automatically within minutes.</div> : null}
            {res.note ? <div className={s.note2}>{res.note}</div> : null}
            <div className={s.ticketXp}><Sprite def={XP_STAR} scale={2} /> +{res.xp} XP</div>
            {res.burnTx ? <a className={s.proof} href={txUrl(res.burnTx)} target="_blank" rel="noreferrer">Burn proof <ExternalLink size={12} /></a> : null}
          </div>
          <div className={s.ticketActions}>
            {res.payoutNusd > 0 ? <Button variant="gold" size="l" block testId="try-now" onClick={() => openOverlay({ kind: 'credits' })}>Try it now</Button> : null}
            <Button variant="primary" block testId="ticket-share" loading={sharing} onClick={() => void share()}><Share2 size={18} /> Share card</Button>
            <Button block onClick={() => { setPhase('pick'); setRes(null); }}>Back to the forge</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
