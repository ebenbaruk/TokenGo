import { useEffect, useState } from 'react';
import type { Me } from '@tokengo/shared';
import { api, humanError } from '../lib/api.ts';
import { useGame, setMe } from '../lib/store.ts';
import { probeGps, startPlay } from '../geo/engine.ts';
import { Button } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { AVATAR } from '../sprites/index.ts';
import s from './Splash.module.css';

const wantsDemo = () => new URLSearchParams(location.search).get('demo') === '1';

export function Splash() {
  const [existing, setExisting] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.me().then(setExisting).catch(() => {}); }, []);

  const play = async () => {
    setBusy(true);
    setErr(null);
    try {
      let demo = wantsDemo() || !navigator.geolocation || !window.isSecureContext;
      let start = null;
      if (!demo) {
        start = await probeGps();
        if (!start) demo = true;
      }
      let me = existing;
      if (!me || (demo && me.mode !== 'demo')) {
        const r = await api.guest(demo);
        me = (r.me ?? r) as Me;
      }
      setMe(me);
      useGame.setState({ phase: 'play' });
      startPlay({ demo: demo || me.mode === 'demo', start });
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.splash} data-testid="splash">
      <div className={s.top}>
        <h1 className={s.logo}><img src="/art/logo.png" alt="TokenGo" width={720} height={170} /></h1>
        <p className={s.tagline}>Walk Paris. Catch AI. Spend it for real.</p>
      </div>
      <div className={s.actions}>
        <div className={s.hero}><Sprite def={AVATAR} scale={4} anim /></div>
        <Button variant="gold" size="l" block onClick={play} loading={busy} testId="play-guest">
          {existing ? `Continue as ${existing.handle}` : 'Play as guest'}
        </Button>
        {err ? <div className={s.err} role="alert">{err}</div> : null}
        <p className={s.small}>
          {wantsDemo() ? '🎯 Demo Walk: tap the map to walk around Paris.' : 'We use your location to put shards around you. No location? You’ll get Demo Walk.'}
        </p>
      </div>
    </div>
  );
}
