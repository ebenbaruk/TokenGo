// Feuilles secondaires : Bag (inventaire), Quests (recettes du jour + contrats), Dash (Remote Scout), Menu.
import { useEffect, useState } from 'react';
import { FAMILIES, FAMILY_INFO, haversineM, type Family, type ForgeView, type NodeView } from '@tokengo/shared';
import { Zap, Info, Volume2, VolumeX, UserRound, ShieldCheck, Activity, FlaskConical, Users, BookOpen, Vibrate, VibrateOff, Route as RouteIcon } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useGame, openOverlay, setShowRunners } from '../lib/store.ts';
import { famName, fmtDist, fmtUsd, RARITY_LABEL } from '../lib/format.ts';
import { dashCost, walkTo } from '../geo/engine.ts';
import { Sheet, Button, Card } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, FLUX, XP_STAR, FORGE, RELAY, marketSprite, merchantSprite, BADGE } from '../sprites/index.ts';
import { isMuted, setMuted, hapticsOn, setHaptics, canVibrate, buzz, HAPTIC } from '../lib/sound.ts';
import s from './MiscSheets.module.css';

export function BagSheet({ onClose }: { onClose: () => void }) {
  const me = useGame((st) => st.me);
  if (!me) return null;
  return (
    <Sheet open onClose={onClose} title="Bag" subtitle={`${me.handle} · Level ${me.level}`} testId="bag-sheet">
      <div className={s.grid}>
        {FAMILIES.map((f) => (
          <div key={f} className={`${s.slot} ${me.shards[f] === 0 ? s.empty : ''}`} data-testid={`bag-${f}`}>
            <Sprite def={SHARDS[f]} scale={3} anim={me.shards[f] > 0} />
            <div className={s.slotName}>{famName(f)}</div>
            <div className={s.slotRar}>{RARITY_LABEL[FAMILY_INFO[f].rarity]}</div>
            <div className={`${s.qty} num`}>×{me.shards[f]}</div>
          </div>
        ))}
        <div className={s.slot}>
          <Sprite def={FLUX} scale={3} />
          <div className={s.slotName}>Flux</div>
          <div className={s.slotRar}>soft coin</div>
          <div className={`${s.qty} num`}>{me.flux.toLocaleString('en-US')}</div>
        </div>
      </div>
      <Card style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Sprite def={XP_STAR} scale={3} />
        <div style={{ flex: 1 }}>
          <div className="pixel" style={{ fontSize: 20 }}>Level {me.level}</div>
          <div className="dim" style={{ fontSize: 14 }}>{me.xpInto} / {me.xpNeed} XP · walked {fmtDist(me.walkedM)}</div>
        </div>
      </Card>
    </Sheet>
  );
}

export function QuestsSheet({ onClose }: { onClose: () => void }) {
  const world = useGame((st) => st.world);
  const pos = useGame((st) => st.pos);
  const me = useGame((st) => st.me);
  const [forge, setForge] = useState<ForgeView | null>(null);
  const forges = (world?.nodes ?? []).filter((n) => n.kind === 'forge');
  const nearest = pos ? [...forges].sort((a, b) => haversineM(pos, a) - haversineM(pos, b))[0] : forges[0];
  useEffect(() => { if (nearest) api.forge(nearest.id).then(setForge).catch(() => {}); }, [nearest?.id]);
  const contracts = (world?.nodes ?? []).filter((n) => n.kind === 'market' && n.merchant?.hasContract && n.merchant.status !== 'closed')
    .map((n) => ({ n, d: pos ? haversineM(pos, n) : 0 })).sort((a, b) => a.d - b.d).slice(0, 5);
  return (
    <Sheet open onClose={onClose} title="Quests" subtitle="Today’s recipes & contracts nearby" testId="quests-sheet">
      {world?.objective ? <div className={s.objective}>◎ {world.objective.text}</div> : null}
      <h3 className={s.h3}>Forge recipes {nearest ? `· ${nearest.name}` : ''}</h3>
      {forge ? forge.recipes.map((r) => (
        <button key={r.tier} type="button" className={s.row} onClick={() => nearest && openOverlay({ kind: 'forge', node: nearest })}>
          <Sprite def={FORGE} scale={1} />
          <div className={s.rowMain}>
            <div className={s.rowTitle}>{r.label}</div>
            <div className={s.need}>{(Object.entries(r.needs) as [Family, number][]).map(([f, q]) => (
              <span key={f} className={(r.missing[f] ?? 0) > 0 ? s.miss : ''}><Sprite def={SHARDS[f]} scale={1} /> {q - (r.missing[f] ?? 0)}/{q}</span>
            ))}</div>
          </div>
          <div className={s.rowEnd}>{r.locked ? <span className="dim">{r.locked}</span> : r.payoutNusd > 0 ? fmtUsd(r.payoutNusd) : 'XP'}</div>
        </button>
      )) : <p className="dim">{nearest ? 'Loading recipes…' : 'No forge nearby — head to a monument.'}</p>}
      <h3 className={s.h3}>Contracts nearby</h3>
      {contracts.length === 0 ? <p className="dim">No open contracts around. Merchants post new ones often.</p> : contracts.map(({ n, d }) => (
        <button key={n.id} type="button" className={s.row} onClick={() => openOverlay({ kind: 'merchant', node: n })}>
          <Sprite def={merchantSprite(n.merchant!.archetype, n.merchant!.id)} scale={1} />
          <div className={s.rowMain}>
            <div className={s.rowTitle}>{n.merchant!.name}</div>
            <div className="dim" style={{ fontSize: 13 }}>{n.name}</div>
          </div>
          <div className={s.rowEnd}>{n.merchant!.contractFamily ? <Sprite def={SHARDS[n.merchant!.contractFamily]} scale={2} /> : <Sprite def={BADGE} scale={2} />}<span>{fmtDist(d)}</span></div>
        </button>
      ))}
    </Sheet>
  );
}

export function JumpSheet({ node, onClose, onOpen }: { node: NodeView; onClose: () => void; onOpen: () => void }) {
  const pos = useGame((st) => st.pos);
  const d = pos ? haversineM(pos, node) : 0;
  const dash = dashCost(node);
  const icon = node.kind === 'forge' ? <Sprite def={FORGE} scale={2} anim /> : node.kind === 'market'
    ? <Sprite def={marketSprite(node.merchant?.id ?? node.id, node.merchant?.status === 'closed')} scale={2} /> : <Sprite def={RELAY} scale={2} anim />;
  return (
    <Sheet open onClose={onClose} title={node.name} subtitle={`${node.kind === 'market' ? node.merchant?.name ?? 'Market' : node.kind} · ${fmtDist(d)} away`} icon={icon} testId="jump-sheet">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Button variant="primary" size="l" block testId="jump-btn" disabled={!!dash && !dash.ok}
          reason={!dash || dash.ok ? null : dash.tooFar ? 'Too far for one dash — fly closer first' : 'Not enough battery — fly there or wait a bit'}
          onClick={() => {
            onClose();
            // atterrit à ~12 m du nœud (dans le rayon d'action)
            const k = Math.max(0, (d - 12) / Math.max(d, 1));
            if (pos) walkTo({ lat: pos.lat + (node.lat - pos.lat) * k, lng: pos.lng + (node.lng - pos.lng) * k }, 3000);
          }}>⚡ Dash here{dash ? <small style={{ opacity: 0.8 }}> · −{Math.max(1, Math.round(dash.cost))}% battery</small> : null}</Button>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button block onClick={() => { onClose(); if (pos) walkTo(node); }} testId="fly-btn">Fly there</Button>
          <Button block variant="ghost" onClick={onOpen} testId="peek-btn">Peek</Button>
        </div>
        <p className="dim" style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>Remote Scout: dashes cost 1.5× battery. Real rewards still need you in range.</p>
      </div>
    </Sheet>
  );
}

export function MenuSheet({ onClose }: { onClose: () => void }) {
  const me = useGame((st) => st.me);
  const [muted, setM] = useState(isMuted());
  const [haptics, setH] = useState(hapticsOn());
  const showRunners = useGame((st) => st.showRunners);
  return (
    <Sheet open onClose={onClose} title={me?.handle ?? 'Runner'} subtitle={me ? `Level ${me.level} · ${me.kind === 'guest' ? 'Guest' : 'Google'} · ${me.mode === 'demo' ? 'Remote Scout' : 'Walking (GPS)'}` : undefined} testId="menu-sheet">
      <div className={s.menu}>
        <Button block variant="gold" onClick={() => openOverlay({ kind: 'credits' })} testId="menu-credits"><Zap size={20} /> Credits & Playground</Button>
        <div className={s.menuGrid}>
          <Button block variant="primary" onClick={() => openOverlay({ kind: 'codex' })} testId="menu-codex"><BookOpen size={20} /> Codex</Button>
          <Button block variant="primary" onClick={() => openOverlay({ kind: 'route' })} testId="menu-route"><RouteIcon size={20} /> Daily Route</Button>
          <Button block onClick={() => openOverlay({ kind: 'profile' })} testId="menu-profile"><UserRound size={20} /> Profile</Button>
          <Button block onClick={() => openOverlay({ kind: 'proofs' })} testId="menu-proofs"><ShieldCheck size={20} /> Proofs</Button>
          <Button block onClick={() => { location.href = '/pulse'; }}><Activity size={20} /> Pulse</Button>
          <Button block onClick={() => { location.href = '/lab'; }}><FlaskConical size={20} /> Lab</Button>
        </div>
        <Button block variant="ghost" onClick={() => { location.href = '/about'; }}><Info size={20} /> About & privacy</Button>
        <Button block variant="ghost" onClick={() => setShowRunners(!showRunners)} testId="toggle-runners"><Users size={20} /> Other runners on map: {showRunners ? 'on' : 'off'}</Button>
        <Button block variant="ghost" onClick={() => { setMuted(!muted); setM(!muted); }}>{muted ? <VolumeX size={20} /> : <Volume2 size={20} />} Sound: {muted ? 'off' : 'on'}</Button>
        {canVibrate() ? (
          <Button block variant="ghost" testId="toggle-haptics" onClick={() => { setHaptics(!haptics); setH(!haptics); if (!haptics) buzz(HAPTIC.good); }}>
            {haptics ? <Vibrate size={20} /> : <VibrateOff size={20} />} Vibration: {haptics ? 'on' : 'off'}
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
