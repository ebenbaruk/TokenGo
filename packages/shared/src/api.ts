// Contrat d'API HTTP partagé entre apps/server et apps/web. Toutes les routes sous /api (sauf /auth).
// Erreurs : HTTP 4xx avec { error: { code: ErrorCode, message: string, ...extra } }.
import type { Family, NodeKind } from './types.ts';
import type { PriceExplanation, MerchantState, MerchantStatus, Side } from './economy/pricing.ts';
import type { Tier, Variant } from './economy/rules.ts';
import type { ScoutRefusal } from './economy/scout.ts';
import type { Pools } from './economy/reserve.ts';
import type { HaggleCard, HaggleEvent, HaggleFace, HagglePhase, HaggleTrait } from './economy/haggle.ts';
import type { CityEvent } from './economy/events.ts';
import type { Bubble } from './living.ts';

export type ErrorCode =
  | 'UNAUTHENTICATED' | 'BAD_REQUEST' | 'NOT_FOUND' | 'FORBIDDEN_ORIGIN' | 'RATE_LIMITED'
  | 'NO_POSITION' | 'TOO_FAR' | 'IN_TRANSIT' | 'SUSPICIOUS_MOVE' | 'COOLDOWN' | 'LEVEL_LOCKED'
  | 'ALREADY_CAUGHT' | 'EXPIRED' | 'INSUFFICIENT' | 'PRICE_MOVED' | 'RESERVE_LOW' | 'FORGE_PAUSED'
  | 'CLOSED' | 'NOT_BUYING' | 'MERCHANT_NO_FLUX' | 'OUT_OF_STOCK' | 'CONTRACT_LOCK' | 'BAD_QTY' | 'STRIKE'
  | 'NO_CONTRACT' | 'NOT_STRUGGLING' | 'BAD_AMOUNT' | 'DEMO_CANNOT_SELL' | 'TUTORIAL_INCOMPLETE'
  | 'HANDLE_TAKEN' | 'BAD_HANDLE' | 'FORBIDDEN' | 'GRANT_PENDING' | 'HAGGLE_SOUR' | 'HAGGLE_NO_ROOM';
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
  /** Remote Scout (mode 'demo') : batterie et dernière position acceptée ; null en GPS. */
  scout: ScoutView | null;
}

/** Batterie du Scout à l'instant `at` (le client la fait progresser avec scoutCharge). */
export interface ScoutView {
  battery: number;          // 0..100 %
  at: number;
  grounded: boolean;
  resumeAt: number | null;  // au sol : quand il pourra repartir
  last: { lat: number; lng: number } | null;
}

export interface MoveRequest { lat: number; lng: number; acc: number; heading?: number }
export interface MoveResponse {
  ok: true; inTransit: boolean; ignored: boolean; suspicious: boolean; walkedM: number;
  /** Arrêt(s) de la Daily Route validé(s) par cette position (absent sinon). */
  route?: RouteCheckin;
  /** Scout : batterie après ce vol. */
  scout?: ScoutView;
  /** Scout : vol refusé (batterie, saut trop long) — la position serveur reste `at`. */
  refused?: ScoutRefusal;
  at?: { lat: number; lng: number } | null;
}

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
  merchant?: { id: string; name: string; archetype: string; status: MerchantStatus; hasContract: boolean; contractFamily?: Family; bubble?: Bubble };
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
  /** Daily Route du jour (absente s'il n'y a pas assez de lieux autour du joueur ou pas encore de position serveur). */
  route?: DailyRouteView | null;
  /** Événement de ville en cours (partagé par tous les joueurs), où qu'il soit dans Paris. */
  event: CityEventView | null;
  /** Couverture du monde à cette position : Paris, région générée (OSM ou procédurale), en cours de repérage, ou plafond atteint. */
  region?: RegionStatus;
}

export interface RegionStatus {
  status: 'ready' | 'scouting' | 'capped';
  source: 'paris' | 'osm' | 'procedural' | null;
  /** régions de ce secteur (cellules H3 r7) */
  ids: string[];
  /** quartier servi en procédural, la vraie carte OSM arrive peut-être encore (le client réinterroge /api/world) */
  upgrading?: boolean;
}

/** Événement de ville tel que le voit le client (titre et effet déjà rédigés). */
export interface CityEventView extends CityEvent { title: string; effect: string }

/**
 * GET /api/walkers?lat&lng : marcheurs autour du joueur (≤ 12). Runners-agents : trajet exact (from → to à 5 km/h,
 * interpolé côté client). Joueurs réels : position anonymisée (cellule H3 + décalage), immobile, sans nom.
 */
export interface WalkerView {
  id: string;
  kind: 'runner' | 'player';
  name: string | null;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  departAt: number;
  arriveAt: number;
  /** « just sold 3 Gemini at Café X » / « heading to Café X » (runners) */
  note: string | null;
  variant: number;
}
export interface WalkersResponse { now: number; walkers: WalkerView[] }

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
  /** Capture réussie : variante cosmétique tirée par le serveur + avancée du Codex. */
  codex?: CatchCodex;
}

export interface CatchCodex {
  variant: Variant;
  name: string;             // « Louvre Claude », « Shiny GPT »…
  place: string | null;     // monument pour la variante landmark
  isNew: boolean;           // première fois dans le Codex
  found: number;
  total: number;
  newTitle: string | null;  // titre débloqué par cette capture
  xp: number;               // XP de découverte (déjà incluse dans `xp`)
}

export interface CodexEntryView {
  family: Family;
  variant: Variant;
  found: boolean;
  name: string;             // nom (ou « ??? » si inconnue)
  hint: string;
  count: number;
  firstAt: number | null;
  place: string | null;
}
/** GET /api/codex */
export interface CodexView {
  entries: CodexEntryView[];  // FAMILIES × VARIANTS, dans l'ordre
  found: number;
  total: number;
  pct: number;
  byFamily: Record<Family, number>;
  titles: { id: string; name: string; need: number; unlocked: boolean }[];
  title: string | null;
  records: { bestCombo: number; catches: number; perfects: number; routesDone: number; routeStreak: number };
}

export interface RouteStopView { id: string; kind: NodeKind; name: string; lat: number; lng: number; done: boolean }
export interface DailyRouteView {
  day: string;
  stops: RouteStopView[];
  done: number;
  total: number;
  lengthM: number;
  completedAt: number | null;
  reward: { xp: number; flux: number; shard: Family };
  streak: number;            // jours consécutifs terminés (aujourd'hui compris s'il est fait)
}
export interface RouteCheckin {
  stopIds: string[];         // arrêts validés par cette position
  done: number;
  total: number;
  completed: boolean;        // la route vient d'être terminée (récompense créditée)
  reward: { xp: number; flux: number; shard: Family } | null;
  streak: number;
  levelUp: number | null;
  me: Me | null;             // profil à jour quand une récompense a été créditée
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
  /** Relation du joueur avec ce marchand (marchandage). */
  relation: { rep: number; trait: HaggleTrait; sourUntil: number | null; hagglesLeft: number };
}

export interface QuoteRequest { side: Side; family: Family; qty: number }
export interface QuoteResponse { quoteId: string; side: Side; family: Family; qty: number; unitPrices: number[]; total: number; expiresAt: number }
export interface TradeResponse { ok: true; side: Side; family: Family; qty: number; total: number; xp: number; levelUp: number | null; me: Me; merchant: MerchantView }

/** Séance de marchandage (le serveur décide de tout ; le client n'envoie que la carte choisie). */
export interface HaggleView {
  haggleId: string;
  merchantId: string;
  side: Side;
  family: Family;
  qty: number;
  baseTotal: number;          // devis normal
  total: number;              // devis marchandé actuel (borné)
  bestTotal: number;          // meilleur total possible (plafond de réputation + plancher de coût)
  offerBp: number;            // offre en points de base (100 = 1 %)
  maxBp: number;
  patience: number;
  patienceMax: number;
  round: number;
  rounds: number;
  phase: HagglePhase | 'done';
  hand: { card: HaggleCard; rival?: { merchant: string; place: string; price: number } }[];
  line: string;
  lineSource: 'lines' | 'llm';
  face: HaggleFace;
  event: HaggleEvent;
  /** dernière carte jouée et son effet réel (bp) */
  last: { card: HaggleCard; gainedBp: number; deltaPatience: number } | null;
  trait: HaggleTrait;
  rep: number;
  /** indices lisibles sur l'état du marchand (sur-stock, caisse basse…) */
  hints: string[];
  expiresAt: number;
}
export interface HaggleDealResponse extends TradeResponse { haggle: HaggleView; saved: number }

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
  /** chaîne active mais le lot du burn n'était pas encore final à la réponse : il se règle dans les secondes qui suivent (Profile › Proofs). */
  burnPending?: boolean;
  levelUp: number | null;
  me: Me;
  /** L'appel NEAR AI a échoué après le burn : octroi en attente (IOU), rejoué toutes les 2 min. UI : « Credit pending ». */
  pending?: boolean;
  pendingNusd?: number;
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
  /** pending = octroi pas encore appliqué à la clé (IOU) → afficher « Credit pending ». */
  grants: { at: number; amountNusd: number; forge: string; tier: string; pool: string; burnTx: string | null; pending: boolean }[];
  /** Somme des octrois en attente (nUSD). */
  pendingNusd: number;
}

export interface PulseEvent { id: number; at: number; kind: string; text: string; data?: Record<string, unknown> }
export interface PulseResponse {
  events: PulseEvent[];
  index: Record<Family, number[]>;   // P0 horaire (7 j max)
  reserve: ReserveView;
  merchants: { open: number; closing: number; closed: number };
  cityEvent: CityEventView | null;
  /** marcheurs sur la carte : runners-agents actifs + joueurs réels vus dans les 3 dernières minutes */
  walkers: { runners: number; players: number };
}

// ───────────── Config publique, profil, classements, Lab ─────────────

/** GET /api/config (public) : ce que l'UI doit savoir avant toute session. */
export interface PublicConfig {
  googleEnabled: boolean;      // afficher « Continue with Google » → navigation pleine page vers GET /auth/google
  simulatedCredits: boolean;
  chain: boolean;
  judgeOpen: boolean;          // fenêtre du Judge Pool ouverte
}
// Retour de Google : redirection vers PUBLIC_URL + '/?auth=google' (succès) ou '/?auth=error&reason=<code>'
// avec code ∈ 'state' | 'exchange' | 'unverified' | 'email_taken' | 'disabled'.

/** POST /api/me/handle — 3 à 20 caractères [A-Za-z0-9], unique (insensible à la casse), filtré. → Me. Erreurs BAD_HANDLE, HANDLE_TAKEN. */
export interface HandleRequest { handle: string }
/** POST /api/me/district — arrondissement 1..20. → Me. */
export interface DistrictRequest { district: number }
/** DELETE /api/me → { ok: true } (compte anonymisé, clé API révoquée, sessions supprimées, cookie effacé). */

export interface LeaderEntry {
  rank: number;
  id: string;
  handle: string;
  value: number;
  agent: boolean;              // runner-agent (badge « agent »)
  me: boolean;
}
/** GET /api/leaderboards (public ; `me` marqué si session). Semaine = depuis lundi 00:00 Europe/Paris. Top 20. */
export interface LeaderboardsResponse {
  weekStart: number;
  runners: LeaderEntry[];      // XP gagnée cette semaine
  traders: LeaderEntry[];      // profit des échanges cette semaine (Flux reçus en ventes − Flux payés en achats), > 0 seulement
  patrons: LeaderEntry[];      // Flux investis dans des sauvetages (total)
  districts: { district: number; points: number; agentPoints: number; players: number }[]; // capture 1, trade 1, contrat 5, compile 10
}

/**
 * GET /api/lab/snapshot (public, 60/min/IP) : Paris en direct pour l'Economy Lab.
 * `initialMerchants` est dans l'ordre des nœuds `market` de data/world/paris.json (l'ordre attendu par createSim).
 * Usage : createSim({ world, days, players, seed, initialMerchants: snap.initialMerchants, ... }).
 * `initialP0` / `initialPools` : prix de référence et poches de la Réserve actuels, à passer au simulateur s'il les accepte.
 */
export interface LabSnapshot {
  at: number;
  day: string;                 // jour de Paris (YYYY-MM-DD)
  initialMerchants: MerchantState[];
  initialP0: Record<Family, number>;
  initialPools: Pools;
  reserveHealth: number;
  merchants: { open: number; closing: number; closed: number };
  runners: number;             // runners-agents actifs
}
