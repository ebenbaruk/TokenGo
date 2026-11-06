// Chiffrement AES-256-GCM des secrets stockés (clés API joueurs, clés NEAR). Hachage des ids de session.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomId = (bytes = 16) => randomBytes(bytes).toString('base64url');

export function makeCipher(masterKeyB64: string | undefined, fallbackSecret: string) {
  const key = masterKeyB64 ? Buffer.from(masterKeyB64, 'base64') : createHash('sha256').update(`mk:${fallbackSecret}`).digest();
  if (key.length !== 32) throw new Error('MASTER_KEY doit faire 32 octets (base64)');
  return {
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
    },
    decrypt(enc: string): string {
      const [iv, tag, data] = enc.split('.').map((s) => Buffer.from(s, 'base64url'));
      const d = createDecipheriv('aes-256-gcm', key, iv!);
      d.setAuthTag(tag!);
      return Buffer.concat([d.update(data!), d.final()]).toString('utf8');
    },
  };
}
