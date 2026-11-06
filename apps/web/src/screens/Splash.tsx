// Splash + choix de connexion + explication de la localisation avant la demande système (Docs/02 §7).
import { useEffect, useState } from 'react';
import { MapPin, Footprints } from 'lucide-react';
import type { Me, PublicConfig } from '@tokengo/shared';
import { api, humanError, unwrapMe } from '../lib/api.ts';
import { useGame, setMe, toast } from '../lib/store.ts';
import { probeGps, startPlay } from '../geo/engine.ts';
import { Button } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { AVATAR, SHARDS } from '../sprites/index.ts';
import s from './Splash.module.css';

const params = new URLSearchParams(location.search);
// lien juges : /?demo=1&k=<DEMO_TOKEN> → compte démo niveau 7 (crédits réels du Judge Pool)
const passToken = params.get('k') ?? undefined;
const wantsDemo = () => params.get('demo') === '1' || !!passToken;
const AUTH_ERRORS: Record<string, string> = {
  state: 'Google sign-in expired — please try again.',
  exchange: 'Google sign-in failed — please try again.',
  unverified: 'Your Google email isn’t verified.',
  email_taken: 'That Google account is already linked to another runner.',
  disabled: 'Google sign-in is off on this server.',
};

export function Splash() {
  const [existing, setExisting] = useState<Me | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [step, setStep] = useState<'start' | 'location'>('start');
  const [busy, setBusy] = useState<'gps' | 'demo' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void api.meIfSession(params.get('auth') === 'google').then(setExisting);
    api.config().then(setConfig).catch(() => {});
    const auth = params.get('auth');
    if (auth === 'error') setErr(AUTH_ERRORS[params.get('reason') ?? ''] ?? 'Google sign-in failed.');
    if (auth) history.replaceState(null, '', location.pathname + (wantsDemo() ? '?demo=1' : ''));
    if (auth === 'google') {
      const outcome = params.get('outcome');
      toast(outcome === 'upgraded' ? 'Signed in with Google — your guest progress is saved.' : outcome === 'created' ? 'Welcome, Runner! Your Google account is ready.' : 'Welcome back!', 'good');
    }
  }, []);

  const enter = async (demo: boolean, start: { lat: number; lng: number } | null) => {
    let me = existing;
    const needsPass = !!passToken && !(me && me.mode === 'demo' && me.level >= 7);
    if (!me || needsPass || (demo && me.mode !== 'demo' && me.kind === 'guest')) {
      try { me = unwrapMe(await api.guest(demo, passToken)); }
      catch (e) { if (!me) throw e; toast('Demo pass already used today — continuing your session.', 'info'); }
    }
    if (!me) throw new Error('no session');
    setMe(me);
    useGame.setState({ phase: 'play' });
    startPlay({ demo: demo || me.mode === 'demo', start });
  };

  const play = async (mode: 'auto' | 'gps' | 'demo') => {
    setErr(null);
    const gpsPossible = Boolean(navigator.geolocation) && window.isSecureContext;
    if (mode === 'auto') {
      if (wantsDemo() || !gpsPossible) mode = 'demo';
      else if (existing?.mode === 'demo') mode = 'demo';
      else { setStep('location'); return; } // explication avant la demande système
    }
    setBusy(mode);
    try {
      let start = null;
      let demo = mode === 'demo';
      if (!demo) {
        start = await probeGps();
        if (!start) { demo = true; toast('No location — switching to Demo Walk.', 'info'); }
      }
      await enter(demo, start);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={s.splash} data-testid="splash">
      <div className={s.top}>
        <h1 className={s.logo}><img src="/art/logo.png" alt="TokenGo" width={720} height={170} /></h1>
        <p className={s.tagline}>Walk Paris. Catch AI. Spend it for real.</p>
      </div>

      {step === 'start' ? (
        <div className={s.actions}>
          <div className={s.hero}><Sprite def={AVATAR} scale={4} anim /></div>
          <Button variant="gold" size="l" block onClick={() => void play('auto')} loading={busy !== null} testId="play-guest">
            {existing ? `Continue as ${existing.handle}` : 'Play as guest'}
          </Button>
          {config?.googleEnabled && existing?.kind !== 'google' ? (
            <a className={s.google} href="/auth/google" data-testid="google-btn">
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
              {existing ? 'Save progress with Google' : 'Continue with Google'}
            </a>
          ) : null}
          {err ? <div className={s.err} role="alert">{err}</div> : null}
          <p className={s.small}>
            {wantsDemo() ? '🎯 Demo Walk: tap the map to walk around Paris.' : 'Real credits for real walks. Nothing to install.'}
          </p>
        </div>
      ) : (
        <div className={s.actions} data-testid="location-explainer">
          <div className={s.locArt} aria-hidden>
            <MapPin size={40} strokeWidth={2.5} className={s.pin} />
            <Sprite def={AVATAR} scale={3} anim />
            <Sprite def={SHARDS.gemini} scale={2} anim />
            <Sprite def={SHARDS.claude} scale={2} anim />
          </div>
          <h2 className={s.locTitle}>Shards spawn around you</h2>
          <p className={s.locText}>We use your location only while you play, to put shards on your streets and check you’re really there.</p>
          <Button variant="primary" size="l" block onClick={() => void play('gps')} loading={busy === 'gps'} testId="allow-location">
            <MapPin size={22} /> Use my location
          </Button>
          <Button block onClick={() => void play('demo')} loading={busy === 'demo'} testId="use-demo">
            <Footprints size={20} /> Demo Walk instead
          </Button>
          {err ? <div className={s.err} role="alert">{err}</div> : null}
        </div>
      )}
    </div>
  );
}
