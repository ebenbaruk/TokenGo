// Configuration validée au démarrage. Zéro secret requis : tout a un repli « mode dégradé ».
import { z } from 'zod';

try { process.loadEnvFile?.(new URL('../../../.env', import.meta.url).pathname); } catch { /* pas de .env : mode sans secrets */ }

const bool = z.enum(['0', '1', 'true', 'false']).transform((v) => v === '1' || v === 'true');
const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_URL: z.string().default(process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:5173'),
  DB_PATH: z.string().default('./var/tokengo.db'),
  SESSION_SECRET: z.string().default('dev-session-secret-change-me'),
  SPAWN_SECRET: z.string().default('dev-spawn-secret'),
  MASTER_KEY: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  /** Nombre de proxys de confiance devant le serveur (X-Forwarded-For) ; défaut 1 en production, 0 (ignoré) sinon. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).optional(),
  DEMO_TOKEN: z.string().optional(),
  JUDGE_POOL_FROM: z.string().default('2026-11-16T00:00:00Z'),
  JUDGE_POOL_TO: z.string().default('2026-11-19T00:00:00Z'),
  FEATURE_REAL_CREDITS: bool.optional(),
  NEARAI_BASE: z.string().default('https://cloud-api.near.ai'),
  NEARAI_AUTH_ACCOUNT: z.string().optional(),
  NEARAI_AUTH_KEY: z.string().optional(),
  NEARAI_ORG_ID: z.string().optional(),
  NEARAI_WORKSPACE_ID: z.string().optional(),
  NEARAI_NPC_KEY: z.string().optional(),
  NPC_MODEL: z.string().default('z-ai/glm-5.3-flash'),
  NPC_MODEL_FALLBACK: z.string().default('openai/gpt-5-nano'),
  NEAR_NETWORK: z.string().default('testnet'),
  NEAR_RPC_URL: z.string().default('https://test.rpc.fastnear.com'),
  NEAR_CONTRACT_ID: z.string().optional(),
  NEAR_OPERATOR_ID: z.string().optional(),
  NEAR_OPERATOR_KEY: z.string().optional(),
  NEAR_ACCOUNT_PREFIX: z.string().regex(/^([a-z0-9]+-)?$/).optional(), // défaut : '' en prod, 'dev-' sinon (chain/accounts.ts)
  FEATURE_CHAIN: bool.optional(),
  JOBS: bool.default(true),
  /** Runners-agents ; défaut : 24 si JOBS, sinon 0 (les tests e2e les activent explicitement). */
  RUNNERS: z.coerce.number().int().min(0).max(24).optional(),
  /** 0 : les runners marchent, synchronisent et capturent, mais ne commercent pas (e2e : prix stables). */
  RUNNER_TRADES: bool.default(true),
  /** Monde « partout » : génère un quartier jouable autour d'un joueur hors de Paris (OSM, sinon procédural). */
  WORLD_ANYWHERE: bool.default(true),
  /** Miroirs Overpass essayés dans l'ordre, séparés par des virgules ; 'off' = procédural seulement (hors ligne, tests). */
  OVERPASS_URLS: z.string().default('https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type Config = Omit<z.infer<typeof Env>, 'RUNNERS'> & {
  RUNNERS: number;
  realCredits: boolean; chain: boolean; prod: boolean; allowedOrigins: string[]; googleEnabled: boolean; trustProxy: number | false;
};

export function loadConfig(overrides: Record<string, string | undefined> = {}): Config {
  const env = Env.parse({ ...process.env, ...overrides });
  const prod = env.NODE_ENV === 'production';
  if (prod && (env.SESSION_SECRET.startsWith('dev-') || env.SPAWN_SECRET.startsWith('dev-'))) {
    throw new Error('SESSION_SECRET et SPAWN_SECRET sont obligatoires en production');
  }
  const hasNearAi = !!(env.NEARAI_AUTH_ACCOUNT && env.NEARAI_AUTH_KEY);
  const hasChain = !!(env.NEAR_CONTRACT_ID && env.NEAR_OPERATOR_KEY && env.NEAR_OPERATOR_ID);
  const originOf = (u: string) => { try { return new URL(u).origin; } catch { return u.replace(/\/+$/, ''); } };
  // Railway injecte RAILWAY_PUBLIC_DOMAIN : le domaine public est accepté même si PUBLIC_URL est mal saisi.
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '';
  const allowedOrigins = [...new Set([env.PUBLIC_URL, railway].filter(Boolean).map(originOf))];
  if (!prod) allowedOrigins.push('http://localhost:5173', 'http://surface:5173', 'http://localhost:8787', 'http://127.0.0.1:5173', 'http://localhost:4173');
  return {
    ...env,
    RUNNERS: env.RUNNERS ?? (env.JOBS ? 24 : 0),
    prod,
    realCredits: env.FEATURE_REAL_CREDITS ?? hasNearAi,
    chain: env.FEATURE_CHAIN ?? (hasChain && env.NODE_ENV !== 'test'),
    allowedOrigins,
    googleEnabled: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    trustProxy: (env.TRUST_PROXY ?? (prod ? 1 : 0)) || false,
  };
}
