// NEP-413 : signature de message hors chaîne (pas une transaction, aucune dépense) pour POST /v1/auth/near.
// borsh({tag u32 LE = 2^31+413}) ‖ borsh({message, nonce[32], recipient, callbackUrl: Option<String>}) → sha256 → ed25519.
import { createHash, randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';

export const NEP413_TAG = 2 ** 31 + 413; // 2147484061
export const NEARAI_RECIPIENT = 'cloud.near.ai';
export const NEARAI_SIGN_MESSAGE = 'Sign in to NEAR AI Cloud'; // valeur exacte attendue par cloud-api (EXPECTED_MESSAGE)

// ── base58 (alphabet Bitcoin, utilisé par NEAR pour les clés) ──
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error('invalid base58');
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c !== '1') break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}
export function base58Encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) + BigInt(x);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const x of b) { if (x !== 0) break; out = `1${out}`; }
  return out;
}

/** Clé NEAR `ed25519:<base58>` (64 octets seed‖pub, ou 32 octets seed) → seed + clé publique. */
export function parseNearSecretKey(key: string): { seed: Uint8Array; publicKey: Uint8Array; publicKeyStr: string } {
  const m = /^ed25519:([1-9A-HJ-NP-Za-km-z]+)$/.exec(key.trim());
  if (!m) throw new Error('NEARAI_AUTH_KEY must look like ed25519:<base58>');
  const raw = base58Decode(m[1]!);
  if (raw.length !== 64 && raw.length !== 32) throw new Error('NEARAI_AUTH_KEY: unexpected length');
  const seed = raw.slice(0, 32);
  const publicKey = ed25519.getPublicKey(seed);
  if (raw.length === 64 && !raw.slice(32).every((x, i) => x === publicKey[i])) throw new Error('NEARAI_AUTH_KEY: public half mismatch');
  return { seed, publicKey, publicKeyStr: `ed25519:${base58Encode(publicKey)}` };
}

export interface Nep413Params { message: string; nonce: Uint8Array; recipient: string; callbackUrl?: string | null }

const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const borshString = (s: string) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u32le(b.length), b]); };

/** Octets borsh signés (tag + payload). */
export function nep413Bytes(p: Nep413Params): Uint8Array {
  if (p.nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  return Buffer.concat([
    u32le(NEP413_TAG),
    borshString(p.message),
    Buffer.from(p.nonce),
    borshString(p.recipient),
    p.callbackUrl == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), borshString(p.callbackUrl)]),
  ]);
}
export const nep413Hash = (p: Nep413Params): Uint8Array => createHash('sha256').update(nep413Bytes(p)).digest();

/** Nonce : 8 octets = Date.now() big-endian (cloud-api refuse > 5 min ou dans le futur), 24 octets aléatoires. */
export function makeNonce(now = Date.now(), rand: Uint8Array = randomBytes(24)): Uint8Array {
  const n = Buffer.alloc(32);
  n.writeBigUInt64BE(BigInt(now), 0);
  Buffer.from(rand).copy(n, 8, 0, 24);
  return n;
}

export function signNep413(secretKey: string, p: Nep413Params): { publicKey: string; signature: string } {
  const k = parseNearSecretKey(secretKey);
  const sig = ed25519.sign(nep413Hash(p), k.seed);
  return { publicKey: k.publicKeyStr, signature: Buffer.from(sig).toString('base64') };
}

/** Corps exact de POST /v1/auth/near (cloud-api routes/auth.rs : NearAuthRequest, camelCase, nonce = tableau de 32 entiers). */
export function nearAuthBody(accountId: string, secretKey: string, now = Date.now(), rand?: Uint8Array) {
  const nonce = makeNonce(now, rand);
  const payload = { message: NEARAI_SIGN_MESSAGE, nonce, recipient: NEARAI_RECIPIENT };
  const s = signNep413(secretKey, payload);
  return {
    signed_message: { accountId, publicKey: s.publicKey, signature: s.signature },
    payload: { message: payload.message, nonce: Array.from(nonce), recipient: payload.recipient },
  };
}
