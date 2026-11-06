// Profil : pseudo modifiable, district, stats, classements. + sélecteur d'arrondissement réutilisé par l'onboarding.
import { useEffect, useState } from 'react';
import { Pencil, Check, Footprints } from 'lucide-react';
import { FAMILIES, haversineM } from '@tokengo/shared';
import type { LeaderboardsResponse } from '@tokengo/shared';
import { api, humanError, unwrapMe } from '../lib/api.ts';
import { useGame, setMe, toast, openOverlay } from '../lib/store.ts';
import { fmtDist, fmtInt } from '../lib/format.ts';
import { Sheet, Button, Card, Tabs } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { AVATAR, XP_STAR, FLUX, SHARDS } from '../sprites/index.ts';
import s from './ProfileSheet.module.css';

export const districtName = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** Arrondissement le plus probable : celui du nœud le plus proche (fichier monde statique, chargé à la demande). */
export async function guessDistrict(): Promise<number | null> {
  const { pos } = useGame.getState();
  if (!pos) return null;
  const { default: world } = await import('../../../../data/world/paris.json');
  let best: { d: number; n: number } | null = null;
  for (const node of (world as { nodes: { lat: number; lng: number; district: number }[] }).nodes) {
    if (!node.district) continue;
    const d = haversineM(pos, node);
    if (!best || d < best.d) best = { d, n: node.district };
  }
  return best && best.d < 3000 ? best.n : null;
}

export function DistrictPicker({ value, onPick, busy }: { value: number | null; onPick: (n: number) => void; busy?: boolean }) {
  return (
    <div className={s.districts} role="radiogroup" aria-label="District" data-testid="district-picker">
      {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} disabled={busy}
          className={`${s.district} ${value === n ? s.districtOn : ''}`} onClick={() => onPick(n)}>
          <b>{n}</b><small>{n === 1 ? 'er' : 'e'}</small>
        </button>
      ))}
    </div>
  );
}

type BoardTab = 'runners' | 'traders' | 'patrons' | 'districts';
const BOARD_UNIT: Record<BoardTab, string> = { runners: 'XP', traders: 'ƒ profit', patrons: 'ƒ invested', districts: 'pts' };
function boardRows(b: LeaderboardsResponse, tab: BoardTab): { name: string; value: number; me?: boolean; agent?: boolean }[] {
  if (tab === 'districts') return b.districts.map((d) => ({ name: `${districtName(d.district)} arr. · ${d.players} runner${d.players === 1 ? '' : 's'}`, value: d.points }));
  return b[tab].map((e) => ({ name: e.handle, value: e.value, me: e.me, agent: e.agent }));
}

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const me = useGame((st) => st.me);
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState(me?.handle ?? '');
  const [busy, setBusy] = useState(false);
  const [boards, setBoards] = useState<LeaderboardsResponse | null>(null);
  const [boardErr, setBoardErr] = useState<string | null>(null);
  const [tab, setTab] = useState<BoardTab>('runners');
  useEffect(() => {
    api.leaderboards().then(setBoards)
      .catch(() => setBoardErr('Leaderboards are warming up — check back soon.'));
  }, []);
  if (!me) return null;

  const saveHandle = async () => {
    const h = handle.trim();
    if (h === me.handle) { setEditing(false); return; }
    setBusy(true);
    try {
      const next = unwrapMe(await api.setHandle(h));
      setMe(next ?? { ...me, handle: h });
      setEditing(false);
      toast('Name updated', 'good');
    } catch (e) { toast(humanError(e), 'bad'); } finally { setBusy(false); }
  };
  const pickDistrict = async (n: number) => {
    setBusy(true);
    try {
      const next = unwrapMe(await api.setDistrict(n));
      setMe(next ?? { ...me, district: n });
      toast(`You now play for the ${districtName(n)} arrondissement`, 'good');
    } catch (e) { toast(humanError(e), 'bad'); } finally { setBusy(false); }
  };
  const shards = FAMILIES.reduce((a, f) => a + me.shards[f], 0);
  const rows = boards ? boardRows(boards, tab) : [];

  return (
    <Sheet open onClose={onClose} full title="Profile" testId="profile-sheet">
      <div className={s.stack}>
        <Card className={s.head}>
          <span className={s.avatar}><Sprite def={AVATAR} scale={3} anim /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <div className={s.editRow}>
                <input className={s.input} value={handle} maxLength={20} autoFocus onChange={(e) => setHandle(e.target.value)} aria-label="Runner name"
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveHandle(); }} data-testid="handle-input" />
                <Button size="s" variant="primary" loading={busy} ariaLabel="Save name" onClick={() => void saveHandle()}><Check size={18} /></Button>
              </div>
            ) : (
              <button type="button" className={s.handle} onClick={() => { setHandle(me.handle); setEditing(true); }} data-testid="handle-edit">
                {me.handle} <Pencil size={16} />
              </button>
            )}
            <div className="dim" style={{ fontWeight: 800, fontSize: 14 }}>
              Level {me.level} · {me.kind === 'guest' ? 'Guest' : 'Google'} · {me.district ? `${districtName(me.district)} arr.` : 'no district yet'}
            </div>
          </div>
        </Card>

        <div className={s.stats}>
          <div><Sprite def={XP_STAR} scale={2} /><b className="num">{fmtInt(me.xp)}</b><span>XP</span></div>
          <div><Sprite def={FLUX} scale={2} /><b className="num">{fmtInt(me.flux)}</b><span>Flux</span></div>
          <div><Sprite def={SHARDS.gemini} scale={2} /><b className="num">{shards}</b><span>shards</span></div>
          <div><Footprints size={28} strokeWidth={2.5} className={s.walk} /><b className="num">{fmtDist(me.walkedM)}</b><span>walked</span></div>
        </div>

        <Card>
          <div className={s.label}>Your district</div>
          <p className="dim" style={{ margin: '0 0 10px', fontSize: 14 }}>Your catches, trades and compiles score for it. The weekly winner gets +20 % shards.</p>
          <DistrictPicker value={me.district} onPick={(n) => void pickDistrict(n)} busy={busy} />
        </Card>

        <Card testId="leaderboards">
          <div className={s.label}>Leaderboards</div>
          {boardErr ? <p className="dim" style={{ margin: 0 }}>{boardErr}</p> : !boards ? <p className="dim" style={{ margin: 0 }}>Loading…</p> : (
            <>
              <div className={s.boardTabs}><Tabs value={tab} onChange={setTab} items={[{ id: 'runners', label: 'Runners' }, { id: 'traders', label: 'Traders' }, { id: 'patrons', label: 'Patrons' }, { id: 'districts', label: 'Arr.' }]} /></div>
              <ol className={s.board}>
                {rows.length === 0 ? <li className="dim">Nobody yet this week — be first!</li> : rows.slice(0, 10).map((r, i) => (
                  <li key={i} className={r.me || r.name === me.handle ? s.meRow : ''}>
                    <span className={s.rank}>{i + 1}</span><span className={s.rName}>{r.name}{r.agent ? <span className={s.agent}>agent</span> : null}</span><span className="num">{fmtInt(r.value)} <small className="dim">{BOARD_UNIT[tab]}</small></span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Card>

        <div className={s.links}>
          <Button block onClick={() => openOverlay({ kind: 'proofs' })} testId="open-proofs">Proofs</Button>
          <Button block variant="ghost" onClick={() => { location.href = '/about'; }}>About & privacy</Button>
        </div>
      </div>
    </Sheet>
  );
}
