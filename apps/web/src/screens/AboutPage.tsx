// /about : ce que le jeu stocke, vie privée, suppression de compte, usage de NEAR, avertissement sur les crédits.
import { useEffect, useState } from 'react';
import type { Me, PublicConfig } from '@tokengo/shared';
import { api, humanError } from '../lib/api.ts';
import { PageShell } from './PageShell.tsx';
import { Button, Card } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { merchantSprite } from '../sprites/index.ts';
import s from './AboutPage.module.css';

export default function AboutPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => { void api.meIfSession().then(setMe); api.config().then(setConfig).catch(() => {}); }, []);

  const del = async () => {
    setBusy(true); setErr(null);
    try { await api.deleteMe(); setDone(true); setMe(null); } catch (e) { setErr(humanError(e)); } finally { setBusy(false); }
  };

  return (
    <PageShell title="About TokenGo" wide={false} testId="about-page"
      subtitle="A walking game where what you catch turns into real AI compute.">
      <div className={s.stack}>
        <Card className={s.intro}>
          <Sprite def={merchantSprite('grandma', 'margot')} scale={2} />
          <p>Walk around, catch <b>shards</b>, trade them with AI-run merchants whose prices follow supply and demand, and compile them at monument <b>Forges</b> into credits on your own NEAR AI Cloud API key.</p>
        </Card>

        <Card testId="about-howto">
          <h2>Play in 5 minutes</h2>
          <ol className={s.steps}>
            <li><b>Catch</b> — tap a glowing shard, then tap when the ring hits the dashed circle. Five families: DeepSeek, Qwen, Gemini, GPT, Claude (rarer = pricier).</li>
            <li><b>Sync</b> a relay (the little antennas) for Flux, the in-game coin.</li>
            <li><b>Trade</b> with AI shopkeepers. Their prices follow their stock — tap ⓘ “Why this price?” — so walking to another shop is arbitrage.</li>
            <li><b>Forge</b> a recipe of shards at a landmark: you get real inference credits on your own API key, and a Playground to spend them right away.</li>
          </ol>
        </Card>

        <Card>
          <h2>Two ways to play</h2>
          <p><b>👟 For real:</b> TokenGo is meant to be played walking. Anywhere in the world — outside Paris we map your neighbourhood from OpenStreetMap on the fly. Your phone’s GPS has to be really there.</p>
          <p><b>🕊 Remote Scout:</b> no time for a walk? Fly a pigeon-drone over Paris from your couch. Tap the map or the big button to fly; the battery limits how far, so walking stays the real game.</p>
        </Card>

        <Card>
          <h2>How NEAR is used</h2>
          <p>Shards and Flux are NEP-245 multi-tokens on NEAR <b>testnet</b> (contract <span className="mono">tokengo.testnet</span>). The game settles your items in batches; compiling burns the shards on-chain and the burn is your proof. You never need to install or pay anything. In <b>Profile › Proofs</b> your browser can check your balance on a public NEAR node.</p>
          <p>Merchants are AI agents (NEAR AI Cloud) that set their own prices and moods, always within the bounds of the public rules — the AI never moves value by itself.</p>
        </Card>

        <Card>
          <h2>About the credits</h2>
          {config?.simulatedCredits ? (
            <p data-testid="about-demo-season"><b>🧪 Demo season.</b> On this server the credits are <b>simulated</b>, so everyone can play for free during the hackathon. The rest is live: merchants, prices, events, and your items settled as NEP-245 tokens on NEAR testnet (the Forge burn is a real on-chain transaction). The real-credit pipe is already built and tested: next, each player gets a personal NEAR AI Cloud API key whose spend limit grows with every compile.</p>
          ) : null}
          <p>With a live reserve, credits are real NEAR AI Cloud inference credits on a personal API key, paid from a small city reserve. Amounts are small and limited per day. When the reserve runs low, payouts shrink — the game never promises more than it holds.</p>
        </Card>

        <Card>
          <h2>What we store</h2>
          <ul>
            <li>A random runner name and a session cookie (no email for guests). If you sign in with Google: your Google account id and email.</li>
            <li>Your last known position and movement state, only to check that actions happen where you are and to count distance walked. We don’t keep a history of your routes.</li>
            <li>Your inventory, Flux, XP, district and the actions you take (catches, trades, compiles).</li>
            <li>Your API key for credits you earned, encrypted at rest (AES-256-GCM); you can reveal it at any time. A hashed IP for anti-abuse.</li>
          </ul>
          <p className="dim">No ads, no trackers, no data sold. Maps by OpenFreeMap (© OpenMapTiles © OpenStreetMap contributors); fonts are self-hosted.</p>
        </Card>

        <Card testId="delete-card">
          <h2>Delete my account</h2>
          {done ? <p className={s.ok}>Your account and its data were deleted. Thanks for playing!</p> : !me ? (
            <p className="dim">No active session on this device.</p>
          ) : (
            <>
              <p>This revokes your API key, signs you out everywhere and anonymizes <b>{me.handle}</b> (name, email, position, district, IP hash are erased). Your past items stay as anonymous records, mirrored on the public testnet.</p>
              {!confirm ? <Button variant="danger" onClick={() => setConfirm(true)} testId="delete-start">Delete my account</Button> : (
                <div className={s.confirm}>
                  <b>Sure? This can’t be undone.</b>
                  <div className={s.row}>
                    <Button variant="danger" loading={busy} onClick={() => void del()} testId="delete-confirm">Yes, delete</Button>
                    <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
                  </div>
                </div>
              )}
              {err ? <p className={s.err}>{err}</p> : null}
            </>
          )}
        </Card>

        <p className="dim" style={{ textAlign: 'center', fontSize: 13 }}>Built for the NEAR hackathon · <a href="/lab">Economy Lab</a> · <a href="/pulse">City Pulse</a></p>
      </div>
    </PageShell>
  );
}
