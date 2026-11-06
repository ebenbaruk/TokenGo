// Spike NEAR AI Cloud (à lancer UNE fois quand NEARAI_AUTH_ACCOUNT / NEARAI_AUTH_KEY sont dans .env) :
//   node apps/server/scripts/nearai-spike.ts
// Fait : vérif clé full-access (lecture RPC mainnet) → login NEP-413 (signature de message, PAS une transaction) → refresh
// → ids org/workspace → solde → clé test $0.01 → PATCH $0.02 → 1 complétion (gpt-5-nano, max_tokens 20) → révocation.
// Dépense maximale : < $0.0001 (≈ 20 tokens de sortie à $0.40/M + ~30 tokens d'entrée). Aucune transaction on-chain.
import { openDb } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { makeCipher } from '../src/game/crypto.ts';
import { parseNearSecretKey } from '../src/nearai/nep413.ts';
import { createSession } from '../src/nearai/session.ts';
import { nearAiCredits } from '../src/nearai/provider.ts';

const cfg = loadConfig();
if (!cfg.NEARAI_AUTH_ACCOUNT || !cfg.NEARAI_AUTH_KEY) throw new Error('NEARAI_AUTH_ACCOUNT / NEARAI_AUTH_KEY manquants dans .env');
const $ = (nusd: number | undefined | null) => (nusd == null ? '—' : `$${(nusd / 1e9).toFixed(6)}`);
const step = (s: string) => console.log(`\n▶ ${s}`);
const MODEL = process.argv[2] ?? 'openai/gpt-5-nano';

// 0. la clé est-elle full-access sur mainnet ? (lecture seule)
step(`Clé de ${cfg.NEARAI_AUTH_ACCOUNT}`);
const { publicKeyStr } = parseNearSecretKey(cfg.NEARAI_AUTH_KEY);
console.log('  public key :', publicKeyStr);
try {
  const r = await fetch('https://rpc.mainnet.near.org', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_access_key', finality: 'final', account_id: cfg.NEARAI_AUTH_ACCOUNT, public_key: publicKeyStr } }),
  }).then((x) => x.json() as Promise<{ result?: { permission: unknown }; error?: unknown }>);
  console.log('  permission :', r.result ? JSON.stringify(r.result.permission) : `introuvable (${JSON.stringify(r.error).slice(0, 160)})`);
} catch (e) { console.log('  (RPC mainnet injoignable :', (e as Error).message, ')'); }

const db = openDb(':memory:'); // le spike ne touche pas à la base du jeu (son refresh token reste en mémoire)
const cipher = makeCipher(cfg.MASTER_KEY, cfg.SESSION_SECRET);
const mkSession = () => createSession({ base: cfg.NEARAI_BASE, accountId: cfg.NEARAI_AUTH_ACCOUNT!, secretKey: cfg.NEARAI_AUTH_KEY!, db, cipher, orgId: cfg.NEARAI_ORG_ID, workspaceId: cfg.NEARAI_WORKSPACE_ID });

step('Login NEP-413 (POST /v1/auth/near)');
const session = mkSession();
await session.accessToken();
console.log('  ok : access + refresh token reçus');

step('Refresh (POST /v1/users/me/access-tokens, nouvelle session = access token vide)');
await mkSession().accessToken();
console.log('  ok : refresh token tourné');

step('Organisations / workspaces');
const orgs = await session.request<{ organizations: { id: string; name: string; role: string }[] }>('GET', '/v1/organizations?limit=100');
for (const o of orgs.organizations) console.log(`  org ${o.id}  ${o.name}  (${o.role})`);
const ids = await session.ids();
console.log(`  → retenus : NEARAI_ORG_ID=${ids.orgId}  NEARAI_WORKSPACE_ID=${ids.workspaceId}`);

const credits = nearAiCredits(cfg, db, { session });
step('Solde organisation');
const bal = await session.request<Record<string, unknown>>('GET', `/v1/organizations/${ids.orgId}/usage/balance`).catch((e: Error) => ({ error: e.message }));
console.log(' ', JSON.stringify(bal));
const remaining = await credits.orgRemaining().catch(() => 0);
console.log('  remaining :', $(remaining));
if (remaining < 50_000_000) { console.log('\n✋ Solde < $0.05 : on s’arrête avant de créer une clé.'); process.exit(0); }

let keyId: string | null = null;
try {
  step('Création d’une clé test (spendLimit $0.01, expire 2026-12-31)');
  const k = await credits.createKey(`tg_spike_${Date.now()}`, 10_000_000);
  keyId = k.keyId;
  console.log(`  id ${k.keyId}  prefix ${k.prefix}`);

  step('PATCH spend-limit → $0.02');
  await credits.setLimit(k.keyId, 20_000_000);
  const listed = (await credits.listKeys()).find((x) => x.id === k.keyId);
  console.log('  spend_limit relu :', $(listed?.spend_limit?.amount));

  step(`Complétion streaming avec la clé (${MODEL}, max_tokens 20) — attente 11 s d’activation de la clé`);
  await new Promise((r) => setTimeout(r, 11_000));
  let out = '';
  for await (const piece of credits.chat(k.key, MODEL, 'Say hello from Paris in five words.', 20)) out += piece;
  console.log('  réponse :', JSON.stringify(out));

  await new Promise((r) => setTimeout(r, 3000));
  const used = await credits.usage([k.keyId]);
  console.log('  usage de la clé :', $(used[k.keyId]));
} finally {
  if (keyId) {
    step('Révocation de la clé test');
    await credits.revoke(keyId);
    console.log('  ok');
  }
}
console.log('\n✅ Spike terminé. Copier NEARAI_ORG_ID / NEARAI_WORKSPACE_ID dans .env (facultatif).');
