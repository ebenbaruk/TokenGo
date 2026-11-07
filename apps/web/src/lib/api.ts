// Client HTTP du contrat packages/shared/src/api.ts. Le serveur est autoritaire ; le client n'envoie que des intentions.
import type {
  ApiError, ErrorCode, Me, MoveRequest, MoveResponse, WorldResponse, WalkersResponse, CatchStartResponse, CatchResolveRequest, CatchResolveResponse,
  SyncResponse, MerchantView, QuoteRequest, QuoteResponse, TradeResponse, ForgeView, CompileRequest, CompileResponse, CreditsView,
  PulseResponse, PublicConfig, LeaderboardsResponse, LabSnapshot, CodexView, HaggleCard, HaggleView, HaggleDealResponse,
  ArenaView, ArenaStartResponse, ArenaPlayResponse, Family, Technique,
  DecodeView, DecodeAnswerResponse,
  RaidView, RaidStartResponse, RaidPlayResponse, // Raid (Docs/13 §6)
} from '@tokengo/shared';

export class ApiFail extends Error {
  code: ErrorCode | 'NETWORK';
  status: number;
  extra: Record<string, unknown>;
  constructor(code: ErrorCode | 'NETWORK', message: string, status: number, extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const HUMAN: Partial<Record<ApiFail['code'], string>> = {
  NETWORK: 'Can’t reach the city server. Check your connection.',
  UNAUTHENTICATED: 'Session expired — tap Play again.',
  RATE_LIMITED: 'Whoa, slow down a little.',
  NO_POSITION: 'Waiting for your position…',
  TOO_FAR: 'Too far — get a bit closer.',
  IN_TRANSIT: 'In transit — catching paused.',
  SUSPICIOUS_MOVE: 'Re-syncing your position… try again in a few minutes.',
  COOLDOWN: 'Still recharging.',
  LEVEL_LOCKED: 'Level too low for that (yet).',
  ALREADY_CAUGHT: 'Already caught that one.',
  EXPIRED: 'Too slow — it expired.',
  INSUFFICIENT: 'You don’t have enough for that.',
  PRICE_MOVED: 'Price moved — here’s a fresh quote.',
  RESERVE_LOW: 'The city’s reserve is low — try a smaller recipe.',
  FORGE_PAUSED: 'Forges are paused for maintenance.',
  CLOSED: 'This shop is closed.',
  NOT_BUYING: 'Not buying right now.',
  MERCHANT_NO_FLUX: 'My till is empty. Sell me nothing, invest in me everything.',
  OUT_OF_STOCK: 'Out of stock.',
  CONTRACT_LOCK: 'Reserved for my contract.',
  BAD_QTY: 'Pick a valid quantity.',
  NO_CONTRACT: 'No contract here right now.',
  NOT_STRUGGLING: 'This shop is doing fine.',
  BAD_AMOUNT: 'Pick a valid amount.',
  DEMO_CANNOT_SELL: 'Demo accounts can’t do that.',
  TUTORIAL_INCOMPLETE: 'Finish the tutorial steps first.',
  HAGGLE_NO_ROOM: 'Already my rock-bottom price — no haggling.',
  // Arène (Docs/13 §4)
  MODEL_RATE_LIMITED: 'That model is rate-limited this round — rotate your team.',
  NO_TOKENS: 'Not enough tokens left for that technique.',
  OWN_ARENA: 'You already hold this arena.',
  BAD_TEAM: 'Pick 3 different models you own.',
  // Raid « Rogue Model » (Docs/13 §6)
  RAID_OVER: 'The rogue model is gone.',
  NO_ASSAULTS: 'You used your 3 assaults on this rogue model.',
};

/** Message humain (court, ton du jeu) par code d'erreur. */
export function humanError(e: unknown): string {
  if (!(e instanceof ApiFail)) return 'Something glitched. Try again.';
  if (e.code === 'RATE_LIMITED' && e.extra.quota) {
    const lim = typeof e.extra.limit === 'number' ? ` (${e.extra.limit}/day)` : '';
    return `Daily limit reached for ${String(e.extra.quota).replace(/[-_]/g, ' ')}${lim} — come back tomorrow.`;
  }
  return HUMAN[e.code] ?? e.message ?? 'Something glitched.';
}

// Indice local « une session existe probablement » (le cookie est httpOnly) : évite un /api/me → 401
// (erreur rouge dans la console) à chaque visite d'un nouveau joueur.
const SESSION_HINT = 'tg.session';
export const hasSessionHint = (): boolean => { try { return localStorage.getItem(SESSION_HINT) === '1'; } catch { return true; } };
const setSessionHint = (on: boolean) => { try { if (on) localStorage.setItem(SESSION_HINT, '1'); else localStorage.removeItem(SESSION_HINT); } catch { /* */ } };

async function req<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiFail('NETWORK', 'network', 0);
  }
  if (res.status === 401) setSessionHint(false);
  else if (res.ok && (path.startsWith('/auth/') || path.startsWith('/api/me'))) setSessionHint(path !== '/api/me' || method !== 'DELETE');
  if (!res.ok) {
    let err: ApiError | null = null;
    try { err = (await res.json()) as ApiError; } catch { /* corps non JSON */ }
    const fallback = { code: (res.status === 401 ? 'UNAUTHENTICATED' : 'BAD_REQUEST') as ErrorCode, message: res.statusText };
    const { code, message, ...extra } = err?.error ?? fallback;
    throw new ApiFail(code, message, res.status, extra);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

// ── Preuves on-chain (type local : ProofsView n'est pas dans packages/shared/src/api.ts) ──
export interface ProofsView {
  enabled: boolean; contract: string | null; rpcUrl: string; tokens: readonly string[];
  account: string | null; accountCreated: boolean; accountUrl: string | null; pending: number;
  ops: { id: number; kind: string; direction: 'in' | 'out'; token: string; amount: number; memo: string | null; counterparty: string | null; txHash: string | null; url: string | null; at: number | null }[];
}

export const api = {
  guest: (demo: boolean, token?: string) => req<{ me?: Me } & Partial<Me>>('POST', '/auth/guest', token ? { demo, token } : { demo }),
  me: () => req<Me>('GET', '/api/me'),
  /** /api/me seulement s'il y a probablement une session (sinon null, sans requête). */
  meIfSession: (force = false): Promise<Me | null> => (force || hasSessionHint() ? req<Me>('GET', '/api/me').catch(() => null) : Promise.resolve(null)),
  move: (b: MoveRequest) => req<MoveResponse>('POST', '/api/move', b),
  world: (lat: number, lng: number) => req<WorldResponse>('GET', `/api/world?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`),
  walkers: (lat: number, lng: number) => req<WalkersResponse>('GET', `/api/walkers?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`),
  catchStart: (spawnId: string) => req<CatchStartResponse>('POST', '/api/catch/start', { spawnId }),
  catchResolve: (b: CatchResolveRequest) => req<CatchResolveResponse>('POST', '/api/catch/resolve', b),
  // Décodage « Next token » (Docs/13 §3)
  decodeOpen: (attemptId: string) => req<DecodeView>('POST', `/api/catch/${enc(attemptId)}/decode/open`, {}),
  decodeAnswer: (attemptId: string, choiceId: string | null) => req<DecodeAnswerResponse>('POST', `/api/catch/${enc(attemptId)}/decode`, { choiceId }),
  codex: () => req<CodexView>('GET', '/api/codex'),
  sync: (nodeId: string) => req<SyncResponse>('POST', '/api/relay/sync', { nodeId }),
  merchant: (id: string) => req<MerchantView>('GET', `/api/merchant/${enc(id)}`),
  quote: (id: string, b: QuoteRequest) => req<QuoteResponse>('POST', `/api/merchant/${enc(id)}/quote`, b),
  trade: (id: string, quoteId: string) => req<TradeResponse>('POST', `/api/merchant/${enc(id)}/trade`, { quoteId }),
  haggleStart: (id: string, b: QuoteRequest) => req<HaggleView>('POST', `/api/merchant/${enc(id)}/haggle`, b),
  hagglePlay: (id: string, haggleId: string, card: HaggleCard) => req<HaggleView>('POST', `/api/merchant/${enc(id)}/haggle/play`, { haggleId, card }),
  haggleDeal: (id: string, haggleId: string) => req<HaggleDealResponse>('POST', `/api/merchant/${enc(id)}/haggle/deal`, { haggleId }),
  deliver: (id: string) => req<TradeResponse>('POST', `/api/merchant/${enc(id)}/contract/deliver`, {}),
  rescue: (id: string, flux: number) =>
    req<{ me: Me; merchant: MerchantView; xp?: number; levelUp?: number | null }>('POST', `/api/merchant/${enc(id)}/rescue`, { flux }),
  forge: (id: string) => req<ForgeView>('GET', `/api/forge/${enc(id)}`),
  compile: (id: string, b: CompileRequest) => req<CompileResponse>('POST', `/api/forge/${enc(id)}/compile`, b),
  credits: () => req<CreditsView>('GET', '/api/credits'),
  reveal: () => req<{ key: string }>('POST', '/api/credits/reveal', {}),
  pulse: () => req<PulseResponse>('GET', '/api/pulse'),
  config: () => req<PublicConfig>('GET', '/api/config'),
  labSnapshot: () => req<LabSnapshot>('GET', '/api/lab/snapshot'),
  proofs: () => req<ProofsView>('GET', '/api/proofs'),
  leaderboards: () => req<LeaderboardsResponse>('GET', '/api/leaderboards'),
  setHandle: (handle: string) => req<{ me?: Me } & Partial<Me>>('POST', '/api/me/handle', { handle }),
  setDistrict: (district: number) => req<{ me?: Me } & Partial<Me>>('POST', '/api/me/district', { district }),
  deleteMe: () => req<{ ok: boolean }>('DELETE', '/api/me'),
  // ── Arène des modèles (Docs/13 §4) ──
  arena: (forgeId: string) => req<ArenaView>('GET', `/api/arena/${enc(forgeId)}`),
  arenaStart: (forgeId: string, team: Family[]) => req<ArenaStartResponse>('POST', `/api/arena/${enc(forgeId)}/start`, { team }),
  arenaPlay: (battleId: string, family: Family, technique: Technique) =>
    req<ArenaPlayResponse>('POST', `/api/arena/battle/${enc(battleId)}/play`, { family, technique }),
  greet: (id: string) => req<{ greeting: string; source: 'llm' | 'lines' }>('GET', `/api/merchant/${enc(id)}/greet`),
  // ── Raid « Rogue Model » (Docs/13 §6) ──
  raid: (eventId: number) => req<RaidView>('GET', `/api/raid/${eventId}`),
  raidAttack: (eventId: number, team: Family[]) => req<RaidStartResponse>('POST', `/api/raid/${eventId}/attack`, { team }),
  raidPlay: (assaultId: string, family: Family, technique: Technique) =>
    req<RaidPlayResponse>('POST', `/api/raid/assault/${enc(assaultId)}/play`, { family, technique }),
  /** Réponse en texte brut streamé. */
  async playground(model: string, prompt: string, onChunk: (t: string) => void, signal?: AbortSignal): Promise<void> {
    let res: Response;
    try {
      res = await fetch('/api/credits/playground', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt }), signal,
      });
    } catch { throw new ApiFail('NETWORK', 'network', 0); }
    if (!res.ok || !res.body) {
      let err: ApiError | null = null;
      try { err = (await res.json()) as ApiError; } catch { /* */ }
      throw new ApiFail((err?.error.code ?? 'BAD_REQUEST') as ErrorCode, err?.error.message ?? res.statusText, res.status);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(dec.decode(value, { stream: true }));
    }
  },
};

/** Certaines routes renvoient `Me`, d'autres `{ me }` : on accepte les deux. */
export const unwrapMe = (r: { me?: Me } & Partial<Me>): Me | null => (r.me ?? (r.id ? (r as Me) : null));
