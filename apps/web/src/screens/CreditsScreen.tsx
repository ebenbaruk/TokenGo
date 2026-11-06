// Credits : clé API (masquée, Reveal/Copy), solde, usage, équivalences, Playground streamé, snippets, historique.
import { useEffect, useRef, useState } from 'react';
import { equivalences, formatTokens, type CreditsView } from '@tokengo/shared';
import { Copy, Eye, EyeOff, Send, ExternalLink } from 'lucide-react';
import { api, humanError } from '../lib/api.ts';
import { toast } from '../lib/store.ts';
import { refreshMe } from '../geo/engine.ts';
import { fmtUsd, txUrl } from '../lib/format.ts';
import { Sheet, Button, Card, Gauge, Tabs } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { XP_STAR } from '../sprites/index.ts';
import s from './CreditsScreen.module.css';

/** Modèles servis dans une enclave vérifiable (TEE) sur NEAR AI Cloud. */
const TEE_MODELS = new Set(['z-ai/glm-5.3-flash', 'Qwen/Qwen3.8-27B']);
const mask = (prefix: string | null) => `${prefix ?? 'sk-'}${'•'.repeat(18)}`;

export function CreditsScreen({ onClose }: { onClose: () => void }) {
  const [c, setC] = useState<CreditsView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [snip, setSnip] = useState<'curl' | 'sdk'>('curl');
  useEffect(() => { api.credits().then(setC).catch((e) => setErr(humanError(e))); }, []);

  const reveal = async () => {
    if (show) { setShow(false); return; }
    try { if (!key) setKey((await api.reveal()).key); setShow(true); } catch (e) { toast(humanError(e), 'bad'); }
  };
  const copy = async () => {
    try {
      const k = key ?? (await api.reveal()).key;
      setKey(k);
      await navigator.clipboard.writeText(k);
      toast('API key copied', 'good');
    } catch (e) { toast(humanError(e), 'bad'); }
  };

  const eq = c ? equivalences(c.remainingNusd) : null;
  const shownKey = show && key ? key : mask(c?.keyPrefix ?? null);
  const snippetKey = '$TOKENGO_KEY';
  const model = c?.models[0]?.id ?? 'deepseek/deepseek-v4.1-flash';
  const snippets = {
    curl: `curl ${c?.baseUrl ?? ''}/chat/completions \\\n  -H "Authorization: Bearer ${snippetKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Hi!"}]}'`,
    sdk: `import OpenAI from "openai";\nconst client = new OpenAI({\n  baseURL: "${c?.baseUrl ?? ''}",\n  apiKey: process.env.TOKENGO_KEY, // ${mask(c?.keyPrefix ?? null)}\n});\nconst r = await client.chat.completions.create({\n  model: "${model}",\n  messages: [{ role: "user", content: "Hi!" }],\n});`,
  };

  return (
    <Sheet open onClose={onClose} full title="Your credits" subtitle={c ? `Real compute on NEAR AI Cloud${c.simulated ? ' · simulated' : ''}` : undefined} testId="credits-screen">
      {err ? <p style={{ color: 'var(--berry)', fontWeight: 800 }}>{err}</p> : null}
      {!c ? <p className="dim">Loading…</p> : (
        <div className={s.stack}>
          <div className={s.balance} data-testid="credits-balance">
            {c.simulated ? <span className={s.sim}>simulated</span> : null}
            <div className={s.balLabel}>Remaining</div>
            <div className={s.balAmount}>{fmtUsd(c.remainingNusd)}</div>
            <Gauge value={c.usageNusd} max={Math.max(c.limitNusd, 1)} color="var(--orange)" height={14} />
            <div className={s.balSub}>{fmtUsd(c.usageNusd)} used of {fmtUsd(c.limitNusd)} · valid until {c.expiresAt}</div>
            {c.pendingNusd > 0 ? <div className={s.pendingBox} data-testid="credits-pending">+{fmtUsd(c.pendingNusd)} credit pending — it lands on your key automatically in a few minutes.</div> : null}
            {eq && c.remainingNusd > 0 ? (
              <div className={s.eqs}>
                <span>≈ {eq.chats} chats</span>
                {eq.tokens.map((t) => <span key={t.model}>≈ {formatTokens(t.tokens)} {t.label}</span>)}
              </div>
            ) : null}
          </div>

          <Card>
            <div className={s.cardTitle}>Your API key</div>
            {c.hasKey ? (
              <>
                <div className={`${s.key} mono`} data-testid="api-key">{shownKey}</div>
                <div className={s.row}>
                  <Button size="s" onClick={() => void reveal()} testId="reveal-key">{show ? <EyeOff size={16} /> : <Eye size={16} />} {show ? 'Hide' : 'Reveal'}</Button>
                  <Button size="s" onClick={() => void copy()} testId="copy-key"><Copy size={16} /> Copy</Button>
                </div>
              </>
            ) : <p className="dim" style={{ margin: 0 }}>Compile at a Forge to get your personal key — First Compile is on the city.</p>}
          </Card>

          {c.hasKey ? <Playground models={c.models} /> : null}

          <Card>
            <div className={s.cardTitle}>Use it anywhere</div>
            <Tabs value={snip} onChange={setSnip} items={[{ id: 'curl', label: 'curl' }, { id: 'sdk', label: 'OpenAI SDK' }]} />
            <pre className={s.code}>{snippets[snip]}</pre>
            <div className="dim" style={{ fontSize: 12 }}>Base URL: <span className="mono">{c.baseUrl}</span></div>
          </Card>

          <Card>
            <div className={s.cardTitle}>Grants</div>
            {c.grants.length === 0 ? <p className="dim" style={{ margin: 0 }}>No grants yet. Your first one is a Forge away.</p> : (
              <ul className={s.grants}>
                {c.grants.map((g, i) => (
                  <li key={i}>
                    <Sprite def={XP_STAR} scale={1} />
                    <span className={s.gMain}><b>+{fmtUsd(g.amountNusd)}</b> · {g.tier} @ {g.forge}{g.pending ? <span className={s.pending}>credit pending</span> : null}</span>
                    <span className="dim">{new Date(g.at).toLocaleDateString('en-GB')}</span>
                    {g.burnTx ? <a href={txUrl(g.burnTx)} target="_blank" rel="noreferrer">proof <ExternalLink size={11} /></a> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Sheet>
  );
}

function Playground({ models }: { models: CreditsView['models'] }) {
  const [model, setModel] = useState(models[0]?.id ?? '');
  const [prompt, setPrompt] = useState('In one sentence: why is Paris called the City of Light?');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const ask = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setOut('');
    abort.current = new AbortController();
    try {
      await api.playground(model, prompt, (t) => setOut((o) => o + t), abort.current.signal);
      setTimeout(() => void refreshMe(), 800); // le Playground consomme des crédits
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setOut((o) => o || `⚠ ${humanError(e)}`);
    } finally { setBusy(false); }
  };
  return (
    <Card testId="playground">
      <div className={s.cardTitle}>Playground</div>
      <div className={s.models}>
        {models.map((m) => (
          <button key={m.id} type="button" className={`${s.model} ${model === m.id ? s.modelOn : ''}`} onClick={() => setModel(m.id)}>
            {m.label}<small>{m.tier}{TEE_MODELS.has(m.id) ? <span className={s.tee} title="Runs in a verifiable secure enclave (TEE)">TEE</span> : null}</small>
          </button>
        ))}
      </div>
      <textarea className={s.prompt} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Prompt" data-testid="prompt" />
      <Button variant="primary" block loading={busy} onClick={() => void ask()} testId="ask-btn"><Send size={18} /> Ask</Button>
      {out ? <div className={s.answer} data-testid="answer">{out}</div> : null}
    </Card>
  );
}
