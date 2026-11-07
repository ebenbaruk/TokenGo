// Éclats qui volent jusqu'au sac après une capture (arc + rétrécissement), puis rebond du bouton Bag.
import { useEffect, useRef } from 'react';
import { useGame, landFlyer, type Flyer } from '../lib/store.ts';
import { Sprite } from '../sprites/Sprite.tsx';
import { shardVariant } from '../sprites/variants.ts';
import { play } from '../lib/sound.ts';

function One({ f }: { f: Flyer }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = el.current;
    const bag = document.querySelector('[data-testid="bag-btn"]')?.getBoundingClientRect();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!node || !bag || reduce || typeof node.animate !== 'function') { landFlyer(f.id); return; }
    // origine relative au cadre du jeu (plein écran sur téléphone, cadre de téléphone sur ordinateur)
    const root = document.getElementById('root')?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const x0 = root.left + root.width / 2;
    const y0 = root.top + root.height * 0.42;
    const dx = bag.left + bag.width / 2 - x0;
    const dy = bag.top + bag.height / 2 - y0;
    const side = f.id % 2 ? 1 : -1;
    const anim = node.animate([
      { transform: 'translate(-50%, -50%) scale(1.6)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.15 + side * 50}px), calc(-50% + ${-60}px)) scale(1.5) rotate(${side * 15}deg)`, opacity: 1, offset: 0.25 },
      { transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${dy * 0.55}px)) scale(.9) rotate(${side * -20}deg)`, opacity: 1, offset: 0.7 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.35)`, opacity: 0.9 },
    ], { duration: 720, delay: f.delay, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'both' });
    anim.onfinish = () => { play('coin'); landFlyer(f.id); };
    return () => anim.cancel();
  }, [f]);
  return (
    <div ref={el} style={{ position: 'fixed', left: '50%', top: '42%', zIndex: 60, pointerEvents: 'none', filter: 'drop-shadow(2px 3px 0 rgba(26,28,44,.35))' }} data-testid="flyer">
      <Sprite def={shardVariant(f.family, f.variant)} scale={4} />
    </div>
  );
}

export function FlyLayer() {
  const flyers = useGame((st) => st.flyers);
  return <>{flyers.map((f) => <One key={f.id} f={f} />)}</>;
}
