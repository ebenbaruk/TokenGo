// /dev/ui : galerie de tous les sprites et composants (vérification visuelle Playwright).
import { useState } from 'react';
import { FAMILIES } from '@tokengo/shared';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, AVATAR, RELAY, RELAY_COOLDOWN, FORGE, FLUX, XP_STAR, LOCK, BADGE, marketSprite, merchantSprite } from '../sprites/index.ts';
import { Button, Pill, Counter, Tabs, Stepper, SlideToConfirm, HoldButton, ShardIcon, Gauge, Sparkline, Card, Sheet } from '../ui/index.tsx';
import { ToastHost } from '../hud/Toasts.tsx';
import { toast } from '../lib/store.ts';
import { VARIANTS } from '@tokengo/shared';
import { shardVariant, shardSilhouette, FLAME, VARIANT_LABEL } from '../sprites/variants.ts';
import { FAMILY_HEX } from '../sprites/index.ts';

const ARCH = ['gambler', 'hoarder', 'scholar', 'hustler', 'grandma', 'purist', 'trendchaser', 'nightowl'];

export default function DevGallery() {
  const section = new URLSearchParams(location.search).get('s') ?? 'sprites';
  const scale = Number(new URLSearchParams(location.search).get('scale') ?? 4);
  const [n, setN] = useState(1280);
  const [qty, setQty] = useState(2);
  const [tab, setTab] = useState<'trade' | 'contract' | 'rescue'>('trade');
  const [sheet, setSheet] = useState(false);
  const box = { display: 'flex', flexWrap: 'wrap' as const, gap: 16, alignItems: 'flex-end', padding: 12 };
  const label = (t: string) => <div style={{ fontSize: 12, textAlign: 'center' as const }}>{t}</div>;
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 12, background: 'var(--bg)' }}>
      {section === 'variants' && (
        <>
          <h2>Codex variants</h2>
          {FAMILIES.map((f) => (
            <div key={f} style={{ ...box, background: FAMILY_HEX[f] }}>
              <div>{[0].map((fr) => <Sprite key={fr} def={shardSilhouette(f)} scale={scale} />)}{label('?')}</div>
              {VARIANTS.map((v) => <div key={v}>{[0, 1].map((fr) => <Sprite key={fr} def={shardVariant(f, v)} scale={scale} frame={fr} />)}{label(VARIANT_LABEL[v])}</div>)}
            </div>
          ))}
          <div style={box}>{[0, 1, 2].map((fr) => <Sprite key={fr} def={FLAME} scale={scale} frame={fr} />)}</div>
        </>
      )}
      {section === 'sprites' && (
        <>
          <h2>Shards</h2>
          <div style={box}>{FAMILIES.map((f) => <div key={f}>{[0, 1].map((fr) => <Sprite key={fr} def={SHARDS[f]} scale={scale} frame={fr} />)}{label(f)}</div>)}</div>
          <div style={{ ...box, background: '#41a6f6' }}>{FAMILIES.map((f) => <Sprite key={f} def={SHARDS[f]} scale={scale} anim />)}</div>
          <h2>Avatar · nodes</h2>
          <div style={box}>
            {[0, 1].map((fr) => <Sprite key={fr} def={AVATAR} scale={scale} frame={fr} />)}
            {[0, 1].map((fr) => <Sprite key={`r${fr}`} def={RELAY} scale={scale} frame={fr} />)}
            <Sprite def={RELAY_COOLDOWN} scale={scale} />
            <Sprite def={marketSprite('osm:node/1')} scale={scale} />
            <Sprite def={marketSprite('osm:node/7')} scale={scale} frame={1} />
            <Sprite def={marketSprite('osm:node/1', true)} scale={scale} />
          </div>
          <div style={box}>
            {[0, 1, 2].map((fr) => <Sprite key={fr} def={FORGE} scale={scale} frame={fr} />)}
            <Sprite def={FLUX} scale={scale} /><Sprite def={XP_STAR} scale={scale} /><Sprite def={LOCK} scale={scale} /><Sprite def={BADGE} scale={scale} />
          </div>
        </>
      )}
      {section === 'merchants' && (
        <>
          <h2>Merchants (idle / talk / joy)</h2>
          {ARCH.map((a, i) => (
            <div key={a} style={box}>
              {[0, 1, 2].map((fr) => <Sprite key={fr} def={merchantSprite(a, `osm:node/${i * 37 + 5}`)} scale={scale} frame={fr} />)}
              <Sprite def={merchantSprite(a, `osm:node/${i * 91 + 2}`)} scale={scale} />
              {label(a)}
            </div>
          ))}
        </>
      )}
      {section === 'ui' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 380 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="primary" size="l" onClick={() => { setN(n + 37); toast('+1 Claude Shard · PERFECT', 'good', 'claude'); }}>Catch</Button>
            <Button variant="gold" onClick={() => setN(n - 12)}>Compile</Button>
            <Button reason="47 m away — get a bit closer">Sync</Button>
            <Button variant="danger" size="s" onClick={() => toast('Too far — get a bit closer.', 'bad')}>Error</Button>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Pill><Sprite def={FLUX} scale={2} /><Counter value={n} /></Pill>
            <Pill style={{ background: 'var(--sun)' }}>$0.214</Pill>
            {FAMILIES.map((f) => <ShardIcon key={f} family={f} />)}
          </div>
          <Tabs value={tab} onChange={setTab} items={[{ id: 'trade', label: 'Trade' }, { id: 'contract', label: 'Contract', dot: true }, { id: 'rescue', label: 'Rescue' }]} />
          <Stepper value={qty} max={5} onChange={setQty} />
          <SlideToConfirm label="Slide to buy · 146 ƒ" onConfirm={() => toast('Traded!', 'good')} />
          <HoldButton onConfirm={() => toast('Compiled!', 'good')}>Hold to Compile</HoldButton>
          <Card><Gauge value={3} max={8} mark={6} /><div style={{ height: 8 }} /><Sparkline points={[40, 42, 41, 47, 52, 50, 58]} /></Card>
          <Button onClick={() => setSheet(true)}>Open sheet</Button>
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Fontaine Molière" subtitle="Relay · 32 m">
            <p>Sheet body</p>
          </Sheet>
          <ToastHost />
        </div>
      )}
    </div>
  );
}
