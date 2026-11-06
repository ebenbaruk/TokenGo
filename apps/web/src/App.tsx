import { lazy, Suspense } from 'react';
import { haversineM, type NodeView, type SpawnView, type LatLng } from '@tokengo/shared';
import { useGame, openOverlay, closeOverlay, toast } from './lib/store.ts';
import { radiusFor, type Target } from './lib/nearby.ts';
import { walkTo } from './geo/engine.ts';
import type { MapHandlers } from './map/GameMap.tsx';
import { Hud } from './hud/Hud.tsx';
import { ToastHost } from './hud/Toasts.tsx';
import { Tutorial, DistrictSheet } from './hud/Tutorial.tsx';
import { Splash } from './screens/Splash.tsx';
import { CatchScreen } from './screens/CatchScreen.tsx';
import { RelaySheet } from './screens/RelaySheet.tsx';
import { MerchantSheet } from './screens/MerchantSheet.tsx';
import { ForgeScreen } from './screens/ForgeScreen.tsx';
import { CreditsScreen } from './screens/CreditsScreen.tsx';
import { BagSheet, QuestsSheet, JumpSheet, MenuSheet } from './screens/MiscSheets.tsx';
import { ProfileSheet } from './screens/ProfileSheet.tsx';
import { ProofsSheet } from './screens/ProofsSheet.tsx';

const GameMap = lazy(() => import('./map/GameMap.tsx'));

function openNode(n: NodeView) {
  if (n.kind === 'relay') openOverlay({ kind: 'relay', node: n });
  else if (n.kind === 'market') openOverlay({ kind: 'merchant', node: n });
  else openOverlay({ kind: 'forge', node: n });
}

function onAction(t: Target) {
  if (t.kind === 'spawn') openOverlay({ kind: 'catch', spawn: t.spawn });
  else openNode(t.node);
}

function onSpawn(sp: SpawnView) {
  const { pos, demo } = useGame.getState();
  if (!pos) return;
  const d = haversineM(pos, sp);
  if (d <= radiusFor('spawn', pos)) return openOverlay({ kind: 'catch', spawn: sp });
  toast(`${Math.round(d)} m away — get a bit closer.`, 'info');
  if (demo) walkTo(sp);
}

function onNode(n: NodeView) {
  const { pos, demo } = useGame.getState();
  if (!pos) return openNode(n);
  const d = haversineM(pos, n);
  if (demo && d > radiusFor(n.kind, pos) && d < 2000) return openOverlay({ kind: 'jump', node: n });
  openNode(n);
}

function onGround(p: LatLng) {
  if (useGame.getState().demo) walkTo(p);
}

const handlers: MapHandlers = { onSpawn, onNode, onGround };

export function App() {
  const phase = useGame((s) => s.phase);
  const overlay = useGame((s) => s.overlay);
  if (phase === 'splash') return <><Splash /><ToastHost /></>;
  return (
    <>
      <Suspense fallback={<div style={{ position: 'absolute', inset: 0, background: 'var(--bg)' }} />}><GameMap handlers={handlers} /></Suspense>
      <Hud onAction={onAction} />
      <Tutorial />
      {overlay?.kind === 'catch' ? <CatchScreen key={overlay.spawn.id} spawn={overlay.spawn} onClose={closeOverlay} /> : null}
      {overlay?.kind === 'relay' ? <RelaySheet key={overlay.node.id} node={overlay.node} onClose={closeOverlay} /> : null}
      {overlay?.kind === 'merchant' ? <MerchantSheet key={overlay.node.id} node={overlay.node} onClose={closeOverlay} /> : null}
      {overlay?.kind === 'forge' ? <ForgeScreen key={overlay.node.id} node={overlay.node} onClose={closeOverlay} /> : null}
      {overlay?.kind === 'credits' ? <CreditsScreen onClose={closeOverlay} /> : null}
      {overlay?.kind === 'bag' ? <BagSheet onClose={closeOverlay} /> : null}
      {overlay?.kind === 'quests' ? <QuestsSheet onClose={closeOverlay} /> : null}
      {overlay?.kind === 'menu' ? <MenuSheet onClose={closeOverlay} /> : null}
      {overlay?.kind === 'profile' ? <ProfileSheet onClose={closeOverlay} /> : null}
      {overlay?.kind === 'proofs' ? <ProofsSheet onClose={closeOverlay} /> : null}
      {overlay?.kind === 'district' ? <DistrictSheet onClose={closeOverlay} /> : null}
      {overlay?.kind === 'jump' ? <JumpSheet node={overlay.node} onClose={closeOverlay} onOpen={() => openNode(overlay.node)} /> : null}
      <ToastHost />
    </>
  );
}
