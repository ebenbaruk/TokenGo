// Contrat d'API HTTP partagé entre apps/server et apps/web. Toutes les routes sous /api (sauf /auth).
// Erreurs : HTTP 4xx avec { error: { code: ErrorCode, message: string, ...extra } }.
import type { Family, NodeKind } from './types.ts';
import type { PriceExplanation, MerchantStatus, Side } from './economy/pricing.ts';
import type { Tier } from './economy/rules.ts';

export type ErrorCode =
  | 'UNAUTHENTICATED' | 'BAD_REQUEST' | 'NOT_FOUND' | 'FORBIDDEN_ORIGIN' | 'RATE_LIMITED'
  | 'NO_POSITION' | 'TOO_FAR' | 'IN_TRANSIT' | 'SUSPICIOUS_MOVE' | 'COOLDOWN' | 'LEVEL_LOCKED'
  | 'ALREADY_CAUGHT' | 'EXPIRED' | 'INSUFFICIENT' | 'PRICE_MOVED' | 'RESERVE_LOW' | 'FORGE_PAUSED'
  | 'CLOSED' | 'NOT_BUYING' | 'MERCHANT_NO_FLUX' | 'OUT_OF_STOCK' | 'CONTRACT_LOCK' | 'BAD_QTY'
  | 'NO_CONTRACT' | 'NOT_STRUGGLING' | 'BAD_AMOUNT' | 'DEMO_CANNOT_SELL' | 'TUTORIAL_INCOMPLETE';
export interface ApiError { error: { code: ErrorCode; message: string; [k: string]: unknown } }

export type Inventory = Record<Family, number>;

export interface TutorialState { caught: boolean; synced: boolean; traded: boolean; firstCompile: boolean; playground: boolean }

export interface Me {
  id: string;
  handle: string;
  kind: 'guest' | 'google';
  mode: 'gps' | 'demo';
  level: number;
  xp: number;
  xpInto: number;          // XP dans le niveau courant
  xpNeed: number;          // XP pour le niveau suivant
  flux: number;
  shards: Inventory;
  combo: number;
  comboExpiresAt: number | null;
  credits: { limitNusd: number; usageNusd: number; simulated: boolean; hasKey: boolean };
  walkedM: number;
  district: number | null;
  tutorial: TutorialState;
}

export interface MoveRequest { lat: number; lng: number; acc: number; heading?: number }
export interface MoveResponse { ok: true; inTransit: boolean; ignored: boolean; suspicious: boolean; walkedM: number }

export interface NodeView {
  id: string;
  kind: NodeKind;
  name: string;
  lat: number;
  lng: number;
  category: string;
  affinities: Family[];
  /** relay : fin de recharge pour ce joueur (ms epoch) ; null si prête */
  cooldownUntil?: number | null;
  /** market */
  merchant?: { id: string; name: string; archetype: string; status: MerchantStatus; hasContract: boolean; contractFamily?: Family };
  /** forge : thème */
  theme?: Family[];
}

export interface SpawnView { id: string; family: Family; lat: number; lng: number; expiresAt: number }

export interface ReserveView {
  mainAvailNusd: number;
  mainInitialNusd: number;
  health: number;           // 0.3..1
  simulated: boolean;
  forgePaused: boolean;
}

export interface Objective {
  text: string;             // « Spark @ Louvre 4/6 — need 2 Gemini · park 280 m »
  target?: { lat: number; lng: number; name: string };
}

export interface WorldResponse {
  now: number;
  nodes: NodeView[];        // nœuds dans ~1,2 km (forges dans 3 km)
  spawns: SpawnView[];      // éclats visibles (≤ 250 m), non encore capturés par le joueur
  reserve: ReserveView;
  objective: Objective | null;
}

export interface CatchStartResponse {
  attemptId: string;
  family: Family;
  ringMs: number;
  perfectPct: number;
  goodPct: number;
  tries: number;
}
/** offsets : pour chaque tap, écart relatif entre l'anneau et la cible (0 = parfait, 1 = complètement à côté). */
export interface CatchResolveRequest { attemptId: string; offsets: number[] }
export interface CatchResolveResponse {
  result: 'perfect' | 'good' | 'miss' | 'fled';
  family: Family;
  qty: number;              // éclats gagnés (0, 1 ou 2)
  xp: number;
  combo: number;
  levelUp: number | null;
  me: Me;
}

export interface SyncResponse {
  flux: number;
  shard: Family | null;
  xp: number;
  firstVisit: boolean;
  cooldownUntil: number;
  levelUp: number | null;
  me: Me;
}

export interface MerchantView {
  id: string;
  nodeId: string;
  name: string;
  archetype: string;
  specialty: Family[];
  status: MerchantStatus;
  flux: number;
  lat: number;
  lng: number;
  place: string;
  mood: string;
  greeting: string;
  prices: PriceExplanation[];             // 1 par famille
  trend24h: Partial<Record<Family, number[]>>; // prix milieu horaires (24 points max)
  contract: { id: string; family: Family; qty: number; reward: number; expiresAt: number } | null;
  rescue: { needed: number; raised: number; patron: string | null; contributors: number } | null;
  lastThought: { at: number; text: string; source: 'llm' | 'fallback' } | null;
  bestKnown: Partial<Record<Family, { buy?: { price: number; merchant: string; distanceM: number }; sell?: { price: number; merchant: string; distanceM: number } }>>;
  isPatron: boolean;
  walletUrl: string | null;
}

export interface QuoteRequest { side: Side; family: Family; qty: number }
export interface QuoteResponse { quoteId: string; side: Side; family: Family; qty: number; unitPrices: number[]; total: number; expiresAt: number }
export interface TradeResponse { ok: true; side: Side; family: Family; qty: number; total: number; xp: number; levelUp: number | null; me: Me; merchant: MerchantView }

export interface RecipeView {
  tier: Tier | 'first';
  label: string;
  needs: Partial<Record<Family, number>>;
  missing: Partial<Record<Family, number>>;
  fee: number;
  level: number;
  locked: string | null;   // raison si indisponible (niveau, tutoriel…)
  payoutNusd: number;      // estimation actuelle (0 = XP seulement)
  payoutNote: string | null;
}
export interface ForgeView {
  id: string;
  name: string;
  lat: number;
  lng: number;
  theme: Family[];
  day: string;
  recipes: RecipeView[];
  reserve: ReserveView;
}
export interface CompileRequest { tier: Tier | 'first' }
export interface CompileResponse {
  compileId: string;
  tier: Tier | 'first';
  payoutNusd: number;
  simulated: boolean;
  pool: string | null;
  xp: number;
  note: string | null;      // ex. « XP only — daily cap reached »
  equiv: { chats: number; tokens: { model: string; label: string; tokens: number }[] };
  burnTx: string | null;
  levelUp: number | null;
  me: Me;
}

export interface CreditsView {
  hasKey: boolean;
  keyPrefix: string | null;
  limitNusd: number;
  usageNusd: number;
  remainingNusd: number;
  simulated: boolean;
  expiresAt: string;
  baseUrl: string;
  models: { id: string; label: string; tier: 'cheap' | 'mid' | 'premium' }[];
  grants: { at: number; amountNusd: number; forge: string; tier: string; pool: string; burnTx: string | null }[];
}

export interface PulseEvent { id: number; at: number; kind: string; text: string; data?: Record<string, unknown> }
export interface PulseResponse {
  events: PulseEvent[];
  index: Record<Family, number[]>;   // P0 horaire (7 j max)
  reserve: ReserveView;
  merchants: { open: number; closing: number; closed: number };
}
