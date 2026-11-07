// Codex (Docs/02 §4) : carnet de collection — 5 familles × 5 variantes cosmétiques, silhouettes des cases inconnues,
// % de complétion, titres, records, carte partageable.
import { useEffect, useState, type CSSProperties } from 'react';
import { FAMILIES, VARIANTS, type CodexEntryView, type CodexView } from '@tokengo/shared';
import { Share2, Lock } from 'lucide-react';
import { api, humanError } from '../lib/api.ts';
import { useGame, toast } from '../lib/store.ts';
import { famName, RARITY_LABEL } from '../lib/format.ts';
import { play } from '../lib/sound.ts';
import { codexCard, shareImage } from '../lib/share.ts';
import { FAMILY_INFO } from '@tokengo/shared';
import { Sheet, Button } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { FAMILY_HEX, FAMILY_DARK } from '../sprites/index.ts';
import { shardVariant, shardSilhouette, VARIANT_LABEL, VARIANT_COLOR } from '../sprites/variants.ts';
import { MasteryBar } from './arenaUi.tsx';
import s from './CodexSheet.module.css';

function Cell({ e, onPick, picked }: { e: CodexEntryView; onPick: () => void; picked: boolean }) {
  return (
    <button type="button" className={`${s.cell} ${e.found ? s.found : s.unknown} ${picked ? s.picked : ''}`} onClick={onPick}
      data-testid={`codex-${e.family}-${e.variant}`} data-found={e.found ? '1' : '0'}
      style={{ '--fam': FAMILY_HEX[e.family], '--vc': VARIANT_COLOR[e.variant] } as CSSProperties} aria-label={e.found ? e.name : `Unknown ${VARIANT_LABEL[e.variant]} ${famName(e.family)}`}>
      <span className={s.art}><Sprite def={e.found ? shardVariant(e.family, e.variant) : shardSilhouette(e.family)} scale={3} anim={e.found} /></span>
      <span className={s.vLabel}>{VARIANT_LABEL[e.variant]}</span>
      {e.found ? <span className={`${s.count} num`}>×{e.count}</span> : <span className={s.q}>?</span>}
    </button>
  );
}

export function CodexSheet({ onClose }: { onClose: () => void }) {
  const me = useGame((st) => st.me);
  const [v, setV] = useState<CodexView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<CodexEntryView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.codex().then(setV).catch((e) => setErr(humanError(e))); }, []);

  const share = async () => {
    if (!v) return;
    setBusy(true);
    try {
      const blob = await codexCard(v, me?.handle ?? 'Runner');
      await shareImage(blob, `tokengo-codex-${v.found}of${v.total}.png`, `My TokenGo Shard Codex: ${v.found}/${v.total} (${v.pct}%)${v.title ? ` · ${v.title}` : ''}`, 'codex');
    } catch { toast('Could not make the card — try again.', 'bad'); } finally { setBusy(false); }
  };

  return (
    <Sheet open onClose={onClose} full title="Shard Codex" subtitle="Every family hides 5 looks. Catch them all." testId="codex-sheet">
      {err ? <p style={{ color: 'var(--berry)', fontWeight: 800 }}>{err}</p> : null}
      {!v ? <p className="dim">Opening the book…</p> : (
        <div className={s.stack}>
          <div className={s.hero} data-testid="codex-progress">
            <div className={s.heroTop}>
              <div>
                <div className={s.big}><span className="num">{v.found}</span><small>/{v.total}</small></div>
                <div className={s.title}>{v.title ?? 'No title yet'}</div>
              </div>
              <Button size="s" variant="gold" onClick={() => void share()} loading={busy} testId="codex-share"><Share2 size={16} /> Share</Button>
            </div>
            <div className={s.bar}><i style={{ width: `${v.pct}%` }} /><span>{v.pct}% collected</span></div>
            <div className={s.titles}>
              {v.titles.map((t) => (
                <span key={t.id} className={`${s.tTag} ${t.unlocked ? s.tOn : ''}`} title={`${t.need} entries`}>
                  {t.unlocked ? '★' : <Lock size={11} strokeWidth={3} />} {t.name} <small>{t.need}</small>
                </span>
              ))}
            </div>
          </div>

          {FAMILIES.map((f) => (
            <section key={f} className={s.family} style={{ '--fam': FAMILY_HEX[f], '--famDark': FAMILY_DARK[f] } as CSSProperties}>
              <header className={s.famHead}>
                <span className={s.famName}>{famName(f)}</span>
                <span className={s.famRar}>{RARITY_LABEL[FAMILY_INFO[f].rarity]}</span>
                <span className={`${s.famCount} num`}>{v.byFamily[f]}/{VARIANTS.length}</span>
                {v.byFamily[f] === VARIANTS.length ? <span className={s.complete}>complete!</span> : null}
              </header>
              {me?.mastery ? <div className={s.mastery}><span>Mastery</span><MasteryBar m={me.mastery[f]} testId={`codex-mastery-${f}`} /></div> : null}
              <div className={s.row}>
                {VARIANTS.map((variant) => {
                  const e = v.entries.find((x) => x.family === f && x.variant === variant)!;
                  return <Cell key={variant} e={e} picked={pick?.family === f && pick.variant === variant} onPick={() => { play('tap'); setPick(e); }} />;
                })}
              </div>
              {pick?.family === f ? (
              <div className={s.detail} data-testid="codex-detail" style={{ '--vc': VARIANT_COLOR[pick.variant] } as CSSProperties}>
                <Sprite def={pick.found ? shardVariant(pick.family, pick.variant) : shardSilhouette(pick.family)} scale={4} anim={pick.found} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={s.dName}>{pick.found ? pick.name : `??? ${famName(pick.family)}`}</div>
                  <div className={s.dSub}>{pick.found
                    ? `Caught ×${pick.count} · first on ${new Date(pick.firstAt!).toLocaleDateString('en-GB')}${pick.place ? ` at ${pick.place}` : ''}`
                    : `Hint: ${pick.hint}`}</div>
                  <div className={s.dNote}>Cosmetic look — same value at merchants and forges.</div>
                </div>
              </div>
              ) : null}
            </section>
          ))}

          <div className={s.records}>
            <div><b className="num">×{v.records.bestCombo}</b><span>best combo</span></div>
            <div><b className="num">{v.records.catches}</b><span>catches</span></div>
            <div><b className="num">{v.records.perfects}</b><span>perfects</span></div>
            <div><b className="num">{v.records.routesDone}</b><span>daily routes</span></div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
