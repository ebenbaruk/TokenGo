import type { CSSProperties } from 'react';
import { spriteStripUrl, type SpriteDef } from './engine.ts';
import s from './Sprite.module.css';

const ids = new WeakMap<SpriteDef, string>();
let seq = 0;
const idOf = (d: SpriteDef) => {
  let id = ids.get(d);
  if (!id) { id = `s${seq++}`; ids.set(d, id); }
  return id;
};

interface Props {
  def: SpriteDef;
  scale?: number;
  /** anime les frames en boucle (figé sur la frame 1 si prefers-reduced-motion) */
  anim?: boolean;
  /** frame fixe (ignorée si anim) */
  frame?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** Sprite pixel art en bande de frames CSS (aucun re-render React pour l'animation). */
export function Sprite({ def, scale = 3, anim = false, frame = 0, className, style, title }: Props) {
  const { url, w, h, n } = spriteStripUrl(idOf(def), def);
  const fps = def.fps ?? 2;
  const vars = {
    width: w * scale,
    height: h * scale,
    backgroundImage: `url(${url})`,
    backgroundSize: `${w * n * scale}px ${h * scale}px`,
    backgroundPosition: anim ? undefined : `${-(frame % n) * w * scale}px 0`,
    '--strip': `${-w * n * scale}px`,
    '--n': n,
    '--dur': `${n / fps}s`,
    ...style,
  } as CSSProperties;
  return <span role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
    className={`${s.sprite} ${anim && n > 1 ? s.anim : ''} ${className ?? ''}`} style={vars} />;
}
