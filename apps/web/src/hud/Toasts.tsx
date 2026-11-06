import clsx from 'clsx';
import { useGame } from '../lib/store.ts';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, FLUX, XP_STAR } from '../sprites/index.ts';
import s from '../ui/ui.module.css';

export function ToastHost() {
  const toasts = useGame((st) => st.toasts);
  return (
    <div className={s.toasts} aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={clsx(s.toast, t.tone === 'good' && s.good, t.tone === 'bad' && s.bad)} data-testid="toast">
          {t.icon === 'flux' ? <Sprite def={FLUX} scale={2} /> : t.icon === 'xp' || t.icon === 'level' ? <Sprite def={XP_STAR} scale={2} />
            : t.icon ? <Sprite def={SHARDS[t.icon]} scale={2} /> : null}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
