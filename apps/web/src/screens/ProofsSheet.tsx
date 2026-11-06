// Profile › Proofs : compte NEAR du joueur, dernières opérations réglées, et « Verify my balance » —
// un appel de lecture RPC fait directement par le navigateur (mt_batch_balance_of), comparé à l'inventaire du jeu.
// C'est le seul écran du jeu où les mots NEAR / on-chain apparaissent.
import { useEffect, useState } from 'react';
import { ExternalLink, ShieldCheck, ShieldAlert } from 'lucide-react';
import { FAMILIES, type Family } from '@tokengo/shared';
import { api, humanError, type ProofsView } from '../lib/api.ts';
import { useGame } from '../lib/store.ts';
import { famName, fmtClock } from '../lib/format.ts';
import { Sheet, Button, Card } from '../ui/index.tsx';
import { Sprite } from '../sprites/Sprite.tsx';
import { SHARDS, FLUX } from '../sprites/index.ts';
import s from './ProofsSheet.module.css';

type Check = { token: string; chain: number; game: number }[];

async function viewBalances(rpcUrl: string, contract: string, account: string, tokens: readonly string[]): Promise<number[]> {
  const args = btoa(JSON.stringify({ account_id: account, token_ids: tokens }));
  const r = await fetch(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'tg', method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: contract, method_name: 'mt_batch_balance_of', args_base64: args } }),
  });
  const j = (await r.json()) as { result?: { result?: number[] }; error?: { cause?: { name?: string }; message?: string } };
  if (!j.result?.result) {
    // compte pas encore créé : le contrat répond 0 partout
    if (j.error) throw new Error(j.error.cause?.name ?? j.error.message ?? 'RPC error');
    return tokens.map(() => 0);
  }
  const vals = JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result))) as string[];
  return vals.map((v) => Number(v));
}

const tokenLabel = (t: string) => (t === 'flux' ? 'Flux' : t.startsWith('shard:') ? `${famName(t.slice(6) as Family)} shards` : t);
const tokenIcon = (t: string) => (t === 'flux' ? <Sprite def={FLUX} scale={1} /> : t.startsWith('shard:') && FAMILIES.includes(t.slice(6) as Family) ? <Sprite def={SHARDS[t.slice(6) as Family]} scale={1} /> : null);

export function ProofsSheet({ onClose }: { onClose: () => void }) {
  const me = useGame((st) => st.me);
  const [p, setP] = useState<ProofsView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  useEffect(() => { api.proofs().then(setP).catch((e) => setErr(humanError(e))); }, []);

  const verify = async () => {
    if (!p?.contract || !p.account || !me) return;
    setChecking(true); setCheckErr(null);
    try {
      const vals = await viewBalances(p.rpcUrl, p.contract, p.account, p.tokens);
      setCheck(p.tokens.map((t, i) => ({ token: t, chain: vals[i] ?? 0, game: t === 'flux' ? me.flux : me.shards[t.slice(6) as Family] ?? 0 })));
    } catch (e) {
      setCheckErr(`Couldn’t reach the NEAR RPC (${e instanceof Error ? e.message : 'error'}).`);
    } finally { setChecking(false); }
  };
  const allMatch = check?.every((c) => c.chain === c.game);

  return (
    <Sheet open onClose={onClose} full title="Proofs" subtitle="Your items, settled on NEAR testnet" testId="proofs-sheet">
      {err ? <p className={s.err}>{err}</p> : null}
      {!p ? <p className="dim">Loading…</p> : !p.enabled ? (
        <Card><p style={{ margin: 0 }}>On-chain settlement is switched off on this server. Your inventory lives in the game ledger only.</p></Card>
      ) : (
        <div className={s.stack}>
          <Card>
            <div className={s.label}>Your NEAR account</div>
            <div className={`${s.account} mono`} data-testid="near-account">{p.account ?? '—'}</div>
            <div className={s.row}>
              {p.accountUrl ? <a href={p.accountUrl} target="_blank" rel="noreferrer" className={s.link}>Open in explorer <ExternalLink size={12} /></a>
                : <span className="dim" style={{ fontSize: 13 }}>Created automatically with your first settled item.</span>}
            </div>
            <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Contract <span className="mono">{p.contract}</span> · NEP-245 multi-token · {p.pending} op{p.pending === 1 ? '' : 's'} waiting for the next batch</div>
          </Card>

          <Card testId="verify-card">
            <div className={s.label}>Verify my balance</div>
            <p style={{ margin: '0 0 10px', fontSize: 14 }}>Your browser asks a public NEAR node directly — no TokenGo server in between.</p>
            <Button variant="primary" block loading={checking} onClick={() => void verify()} testId="verify-btn" reason={p.account ? null : 'No account yet'}>Verify on-chain</Button>
            {checkErr ? <p className={s.err}>{checkErr}</p> : null}
            {check ? (
              <>
                <div className={`${s.verdict} ${allMatch ? s.ok : s.warn}`} data-testid="verify-result">
                  {allMatch ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
                  {allMatch ? 'Everything matches the chain.' : p.pending > 0 ? `${p.pending} op(s) still settling — the chain is a few seconds behind.` : 'Some balances differ — they settle in batches.'}
                </div>
                <table className={s.table}>
                  <thead><tr><th>Item</th><th>In game</th><th>On-chain</th></tr></thead>
                  <tbody>
                    {check.map((c) => (
                      <tr key={c.token}>
                        <td><span className={s.tok}>{tokenIcon(c.token)} {tokenLabel(c.token)}</span></td>
                        <td className="num">{c.game}</td>
                        <td className={`num ${c.chain === c.game ? s.same : s.diff}`}>{c.chain}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </Card>

          <Card>
            <div className={s.label}>Last settled operations</div>
            {p.ops.length === 0 ? <p className="dim" style={{ margin: 0 }}>Nothing settled yet. Catch, trade or compile — it shows up here after the next batch.</p> : (
              <ul className={s.ops}>
                {p.ops.map((o) => (
                  <li key={o.id}>
                    <span className={`${s.dir} ${o.direction === 'in' ? s.in : s.out}`}>{o.direction === 'in' ? '+' : '−'}{o.amount}</span>
                    <span className={s.tok}>{tokenIcon(o.token)} {tokenLabel(o.token)}</span>
                    <span className="dim" style={{ fontSize: 12 }}>{o.kind}{o.at ? ` · ${fmtClock(o.at)}` : ''}</span>
                    {o.url ? <a href={o.url} target="_blank" rel="noreferrer" className={s.link}>tx <ExternalLink size={11} /></a> : null}
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
