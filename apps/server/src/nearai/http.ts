// Appels HTTP vers NEAR AI Cloud : timeout, User-Agent constant, erreurs lisibles.
export const USER_AGENT = 'TokenGo/0.1 (+hackathon)'; // constant : cloud-api lie la session (refresh) au User-Agent
export type Fetch = typeof fetch;

export class NearAiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'NearAiError';
    this.status = status;
    this.code = code;
  }
}

/** Erreur cloud-api : `{error: {message, type}}` (ErrorResponse) ou `{error, error_description}` (auth). */
export async function errorFrom(res: Response, what: string): Promise<NearAiError> {
  let code = `http_${res.status}`;
  let msg = '';
  try {
    const j = (await res.json()) as { error?: unknown; error_description?: string; message?: string };
    if (j.error && typeof j.error === 'object') {
      const e = j.error as { message?: string; type?: string; code?: string };
      code = e.type ?? e.code ?? code;
      msg = e.message ?? '';
    } else if (typeof j.error === 'string') {
      code = j.error;
      msg = j.error_description ?? '';
    } else msg = j.message ?? '';
  } catch { /* corps non JSON */ }
  return new NearAiError(res.status, code, `NEAR AI ${what} failed (${res.status} ${code})${msg ? `: ${msg.slice(0, 200)}` : ''}`);
}

export interface CallOpts { fetch?: Fetch; timeoutMs?: number; bearer?: string; signal?: AbortSignal }

/** Requête JSON. 204 → null. Lève NearAiError (HTTP) ou Error (réseau / timeout). */
export async function callJson<T>(base: string, method: string, path: string, body: unknown, o: CallOpts = {}): Promise<T> {
  const f = o.fetch ?? fetch;
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.bearer) headers.Authorization = `Bearer ${o.bearer}`;
  let res: Response;
  try {
    res = await f(`${base}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: o.signal ?? AbortSignal.timeout(o.timeoutMs ?? 15_000),
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new Error(`NEAR AI ${method} ${path}: ${name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : (e as Error).message}`);
  }
  if (!res.ok) throw await errorFrom(res, `${method} ${path}`);
  if (res.status === 204) return null as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
