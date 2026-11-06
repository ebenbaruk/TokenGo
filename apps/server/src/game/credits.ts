// Crédits réels : interface commune, implémentation simulée (mode sans secrets). L'implémentation NEAR AI réelle est dans nearai/.
import { randomBytes } from 'node:crypto';

export interface KeyInfo { keyId: string; key: string; prefix: string; limitNusd: number }
export interface CreditsProvider {
  readonly simulated: boolean;
  /** Solde réel de l'organisation (nUSD). */
  orgRemaining(): Promise<number>;
  createKey(name: string, limitNusd: number): Promise<KeyInfo>;
  setLimit(keyId: string, limitNusd: number): Promise<void>;
  usage(keyIds: string[]): Promise<Record<string, number>>;
  /** Révoque une clé (suppression de compte). */
  revoke?(keyId: string): Promise<void>;
  /** Relais de chat (streaming) avec la clé du joueur. */
  chat(key: string, model: string, prompt: string, maxTokens: number): AsyncIterable<string>;
}

export function simulatedCredits(totalNusd: number): CreditsProvider {
  const keys = new Map<string, { limit: number; usage: number }>();
  let spent = 0;
  return {
    simulated: true,
    async orgRemaining() { return totalNusd - spent; },
    async createKey(_name, limitNusd) {
      const key = `sk-sim-${randomBytes(18).toString('hex')}`;
      const keyId = `sim_${randomBytes(6).toString('hex')}`;
      keys.set(keyId, { limit: limitNusd, usage: 0 });
      return { keyId, key, prefix: key.slice(0, 12), limitNusd };
    },
    async setLimit(keyId, limitNusd) {
      const k = keys.get(keyId);
      if (k) k.limit = limitNusd;
      else keys.set(keyId, { limit: limitNusd, usage: 0 });
    },
    async revoke(keyId) { keys.delete(keyId); },
    async usage(ids) { return Object.fromEntries(ids.map((id) => [id, keys.get(id)?.usage ?? 0])); },
    async *chat(_key, model, prompt) {
      const text = `(Simulated credits — this server runs without a NEAR AI account.) You asked ${model}: "${prompt.slice(0, 80)}". ` +
        'With real credits, this answer would stream from NEAR AI Cloud, inside a TEE, billed to your own API key.';
      for (const word of text.split(' ')) {
        await new Promise((r) => setTimeout(r, 25));
        yield `${word} `;
      }
      spent += 1000; // coût symbolique
    },
  };
}
