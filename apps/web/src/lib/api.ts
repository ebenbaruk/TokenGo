// Client HTTP du contrat packages/shared/src/api.ts. Le serveur est autoritaire ; le client n'envoie que des intentions.
import type {
  ApiError, ErrorCode, Me, MoveRequest, MoveResponse, WorldResponse, CatchStartResponse, CatchResolveRequest, CatchResolveResponse,
  SyncResponse, MerchantView, QuoteRequest, QuoteResponse, TradeResponse, ForgeView, CompileRequest, CompileResponse, CreditsView,
  PulseResponse,
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
  SUSPICIOUS_MOVE: 'That jump looked odd. Actions paused for a moment.',
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
};

/** Message humain (court, ton du jeu) par code d'erreur. */
export function humanError(e: unknown): string {
  if (!(e instanceof ApiFail)) return 'Something glitched. Try again.';
  return HUMAN[e.code] ?? e.message ?? 'Something glitched.';
}

async function req<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
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
export const api = {
  guest: (demo: boolean) => req<{ me?: Me } & Partial<Me>>('POST', '/auth/guest', { demo }),
  me: () => req<Me>('GET', '/api/me'),
  move: (b: MoveRequest) => req<MoveResponse>('POST', '/api/move', b),
  world: (lat: number, lng: number) => req<WorldResponse>('GET', `/api/world?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`),
  catchStart: (spawnId: string) => req<CatchStartResponse>('POST', '/api/catch/start', { spawnId }),
  catchResolve: (b: CatchResolveRequest) => req<CatchResolveResponse>('POST', '/api/catch/resolve', b),
  sync: (nodeId: string) => req<SyncResponse>('POST', '/api/relay/sync', { nodeId }),
  merchant: (id: string) => req<MerchantView>('GET', `/api/merchant/${enc(id)}`),
  quote: (id: string, b: QuoteRequest) => req<QuoteResponse>('POST', `/api/merchant/${enc(id)}/quote`, b),
  trade: (id: string, quoteId: string) => req<TradeResponse>('POST', `/api/merchant/${enc(id)}/trade`, { quoteId }),
  deliver: (id: string) => req<TradeResponse>('POST', `/api/merchant/${enc(id)}/contract/deliver`, {}),
  rescue: (id: string, flux: number) =>
    req<{ me: Me; merchant: MerchantView; xp?: number; levelUp?: number | null }>('POST', `/api/merchant/${enc(id)}/rescue`, { flux }),
  forge: (id: string) => req<ForgeView>('GET', `/api/forge/${enc(id)}`),
  compile: (id: string, b: CompileRequest) => req<CompileResponse>('POST', `/api/forge/${enc(id)}/compile`, b),
  credits: () => req<CreditsView>('GET', '/api/credits'),
  reveal: () => req<{ key: string }>('POST', '/api/credits/reveal', {}),
  pulse: () => req<PulseResponse>('GET', '/api/pulse'),
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
