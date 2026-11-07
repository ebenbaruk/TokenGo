/**
 * TokenGo — règles du jeu et de l'économie (source unique).
 *
 * Ce fichier est volontairement lisible : uniquement des constantes nommées et commentées.
 * Les formules qui les utilisent sont dans les fichiers voisins (pricing.ts, forge.ts, reserve.ts, spawns.ts…),
 * toutes pures et testées. Serveur, simulateur (Economy Lab) et UI importent ces mêmes valeurs.
 * Référence humaine : Docs/02-game-design.md et Docs/03-economy.md.
 *
 * Unités : Flux (ƒ) et éclats = entiers. Argent réel = nano-USD entiers ($1 = 1_000_000_000 nUSD).
 */
import type { Family, Rarity } from '../types.ts';

export const NUSD_PER_USD = 1_000_000_000;
export const usd = (dollars: number): number => Math.round(dollars * NUSD_PER_USD);

// ───────────────────────────── Éclats ─────────────────────────────
export interface FamilyInfo {
  name: string;          // nom affiché
  rarity: Rarity;
  spawnWeight: number;   // poids de base au tirage
  p0: number;            // prix de référence initial en Flux
}
export const FAMILY_INFO: Record<Family, FamilyInfo> = {
  deepseek: { name: 'DeepSeek', rarity: 'common', spawnWeight: 41, p0: 10 },
  qwen: { name: 'Qwen', rarity: 'common', spawnWeight: 27, p0: 14 },
  gemini: { name: 'Gemini', rarity: 'uncommon', spawnWeight: 19, p0: 26 },
  gpt: { name: 'GPT', rarity: 'rare', spawnWeight: 9, p0: 48 },
  claude: { name: 'Claude', rarity: 'epic', spawnWeight: 4, p0: 95 },
};
export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic'];
/** Familles dont le poids de spawn suit la santé de la Réserve. */
export const RESERVE_SENSITIVE: Family[] = ['gpt', 'claude'];

// ───────────────────────────── Monde & spawns ─────────────────────────────
export const SPAWN_WINDOW_MS = 10 * 60_000;     // nouvelle « vague » d'éclats toutes les 10 min
export const SPAWN_BASE_LAMBDA = 0.8;           // λ = 0.8 + 0.25 × richesse (0..6)
export const SPAWN_LAMBDA_PER_RICHNESS = 0.25;
export const SPAWN_MAX_PER_CELL = 3;
export const SPAWN_AFFINITY_MULT = 3;           // famille favorisée par le lieu : poids ×3
export const SPAWN_RADIUS_IN_CELL_M = 75;       // les éclats tombent à ≤ 75 m du centre de la cellule
export const VISIBILITY_RADIUS_M = 250;         // le joueur voit les éclats à ≤ 250 m
export const H3_RES = 9;

// ───────────────────────────── Distances d'action ─────────────────────────────
export const ACTION_RADIUS_M = { spawn: 40, relay: 40, market: 40, forge: 60 } as const;
export const ACTION_ACC_BONUS_MAX_M = 20;       // + min(précision GPS, 20 m)
export const POSITION_MAX_AGE_MS = 30_000;      // position trop vieille → « re-sync »

// ───────────────────────────── Capture (mini-jeu Lock-on) ─────────────────────────────
export const CATCH = {
  ringMs: { common: 1400, uncommon: 1200, rare: 1000, epic: 800 } satisfies Record<Rarity, number>,
  perfectWindow: { common: 0.07, uncommon: 0.065, rare: 0.06, epic: 0.05 } satisfies Record<Rarity, number>,
  goodWindow: { common: 0.2, uncommon: 0.18, rare: 0.16, epic: 0.14 } satisfies Record<Rarity, number>,
  fleeAfterMiss: { common: 0, uncommon: 0.1, rare: 0.2, epic: 0.3 } satisfies Record<Rarity, number>,
  maxTries: 3,
  perfectBonusChance: 0.25,      // perfect : 25 % de chance d'un éclat bonus
  attemptTtlMs: 30_000,
  minResolveMs: 300,
  perfectCapRatio: 0.4,          // au-delà de 40 % de perfect sur les 30 dernières captures → compté « good »
  perfectCapWindow: 30,
  comboWindowMs: 90_000,
  comboMax: 5,
} as const;

// ───────────────────────────── Relays ─────────────────────────────
export const RELAY = {
  cooldownMs: 5 * 60_000,
  fluxMin: 3,
  fluxMax: 7,
  shardChance: 0.5,
} as const;

// ───────────────────────────── XP & niveaux ─────────────────────────────
export const XP = {
  catch: 10, perfectBonus: 5, perComboLevel: 2,
  sync: 25, firstVisit: 20,
  tradePerShard: 2, contract: 100,
  compile: { first: 150, spark: 150, prism: 300, aura: 600 },
  rescuePer2Flux: 1, rescueMax: 300,
} as const;
/** XP pour passer du niveau L à L+1. */
export const xpToNext = (level: number): number => Math.round(100 * level ** 1.5);
export const MAX_LEVEL = 20;
export const UNLOCKS = {
  trade: 2, spark: 3, contracts: 4, prism: 5, rescue: 6, aura: 7,
} as const;

// ───────────────────────────── Marchands : prix ─────────────────────────────
export const PRICING = {
  alpha: 1.1,                    // élasticité : scarcity = (target / stock) ^ alpha (> 1 : assez d'écart entre voisins pour l'arbitrage)
  scarcityMin: 0.35,
  scarcityMax: 3.0,
  stockFloor: 0.5,               // évite la division par zéro quand le stock est vide
  spreadMin: 0.03,
  spreadMax: 0.12,
  spreadDefault: 0.06,
  specialtySpreadDiscount: 0.02, // la spécialité est vendue/achetée avec 2 points de marge en moins
  specialtyTargetMult: 1.5,
  closingSellDiscount: 0.1,      // un marchand en fermeture solde à −10 % (et n'achète plus)
} as const;
/** Stock visé par défaut (avant spécialité et biais d'archétype). */
export const BASE_TARGET: Record<Family, number> = { deepseek: 24, qwen: 18, gemini: 10, gpt: 6, claude: 3 };
export const INITIAL_STOCK_RATIO = [0.8, 1.25] as const; // centré sur la cible : prix de départ ≈ P0
export const INITIAL_TREASURY = [900, 2400] as const;

// ───────────────────────────── Marchands : vie économique ─────────────────────────────
export const MERCHANT = {
  importBelowRatio: 0.5,         // stock < 50 % de la cible → importe 1 unité / heure
  importPriceMult: 1.3,          // … payée P0 × 1.3 (puits de Flux)
  exportAboveRatio: 1.5,         // « demande de la ville » : au-delà de 1,5 × BASE_TARGET (même seuil pour tous), le surplus est revendu…
  exportShare: 0.5,              // … la moitié du surplus par heure…
  exportPriceMult: 0.75,         // … à P0 × 0.75 : un marchand sur-stocké a acheté moins cher → il gagne sur le surplus (source de Flux)
  rentPerHour: 4,                // loyer, seulement si boutique active
  activeWindowMs: 24 * 3600_000, // « active » = ≥ 1 trade dans les 24 h
  closingBelow: 150,             // caisse < 150 ƒ → closing
  closingGraceMs: 2 * 3600_000,  // … puis closed après 2 h
  reopenAt: 600,                 // caisse ≥ 600 ƒ → rouvre
  rescueMin: 50,                 // contribution minimale de sauvetage
  patronPerkMs: 7 * 24 * 3600_000,
  patronSpreadMult: 0.5,         // spread personnel des sauveteurs divisé par 2
  reflectEveryMs: 3 * 3600_000,  // « réflexion » de l'agent
  seededStrugglerFlux: 120,      // un marchand proche du Louvre démarre en difficulté (démo)
} as const;

export const CONTRACT = {
  qtyMin: 1, qtyMax: 5,
  rewardMultMin: 1.05, rewardMultMax: 1.15,
  durationMinMs: 2 * 3600_000, durationMaxMs: 12 * 3600_000,
} as const;

/** Bornes de ce que l'IA d'un marchand peut décider (le LLM ne déplace jamais de valeur). */
export const AGENT_BOUNDS = {
  spreadMin: PRICING.spreadMin, spreadMax: PRICING.spreadMax,
  targetMultMin: 0.5, targetMultMax: 2.0,
  maxChangePerReflection: 0.3,   // ±30 % par réflexion
  moodMaxChars: 90, reasoningMaxChars: 280,
  llmCallsPerDay: 150,
} as const;

/** Biais initial par archétype (spread et multiplicateur de cibles). */
export const ARCHETYPE_BIAS = {
  gambler: { spread: 0.1, targetMult: 0.8 },
  hoarder: { spread: 0.07, targetMult: 1.4 },
  scholar: { spread: 0.05, targetMult: 1.0 },
  hustler: { spread: 0.04, targetMult: 0.9 },
  grandma: { spread: 0.06, targetMult: 1.1 },
  purist: { spread: 0.08, targetMult: 1.0 },
  trendchaser: { spread: 0.09, targetMult: 1.0 },
  nightowl: { spread: 0.06, targetMult: 1.0 },
} as const;

// ───────────────────────────── Prix de référence (Paris Shard Index) ─────────────────────────────
/** P0 ← keep × P0 + follow × P0_initial × rareté médiane (ancré : pas d'emballement), borné à [min, max] × P0_initial. */
export const P0_DRIFT = { keep: 0.95, follow: 0.05, minMult: 0.6, maxMult: 1.4 } as const;

// ───────────────────────────── Forge & crédits réels ─────────────────────────────
export type Tier = 'spark' | 'prism' | 'aura';
export interface TierRule {
  level: number;
  /** nombre d'éclats exigés par rareté */
  byRarity: Partial<Record<Rarity, number>>;
  fee: number;       // frais en Flux
  weight: number;    // poids dans le rendement
}
export const TIERS: Record<Tier, TierRule> = {
  spark: { level: 3, byRarity: { common: 4, uncommon: 2 }, fee: 60, weight: 1 },
  prism: { level: 5, byRarity: { common: 3, uncommon: 3, rare: 2 }, fee: 160, weight: 3 },
  aura: { level: 7, byRarity: { common: 2, uncommon: 3, rare: 2, epic: 2 }, fee: 300, weight: 8 },
};
export const FIRST_COMPILE = {
  needs: { deepseek: 2, qwen: 1 } as Partial<Record<Family, number>>,
  payout: usd(0.03),
} as const;
export const FORGE = {
  yieldPerWeight: 0.004,          // 0.4 % de la poche par unité de poids
  capPlayerDay: usd(0.25),        // glissant 24 h
  capGlobalDayRatio: 0.055,       // 5,5 % de la poche par jour (≈ 33 % par semaine au maximum)
  minPayout: usd(0.002),          // en dessous : XP seulement
  themeSwapChance: 0.5,           // une recette sur deux remplace un Common par la famille du thème
} as const;

// ───────────────────────────── Réserve ─────────────────────────────
export type Pool = 'main' | 'welcome' | 'judge' | 'npc' | 'safety';
/** Partition initiale de la Réserve (10 € ≈ $11.5). */
export const RESERVE_PARTITION: Record<Pool, number> = {
  main: usd(4.5), welcome: usd(2.0), judge: usd(1.5), npc: usd(1.0), safety: usd(2.5),
};
export const RESERVE = {
  overshootPerKey: usd(0.05),     // dépassement possible d'une requête en vol par clé
  healthMin: 0.3,                 // h = clamp(avail / initial, 0.3, 1)
  welcomeGrantsPerHour: 4,        // octrois First Compile au global
  judgeCapPerAccount: usd(0.2),
  revokeOverLimitBy: usd(0.1),
  balanceMaxAgeMs: 5 * 60_000,
} as const;

// ───────────────────────────── Anti-triche (mouvement) ─────────────────────────────
export const MOVE = {
  ignoreAccuracyAboveM: 60,
  transitKmh: 25,                 // moyenne glissante 60 s
  transitWindowMs: 60_000,
  suspiciousKmh: 200,
  suspiciousMinDistM: 1000,
  plausibleReturnKmh: 50,         // un « retour » après arrière-plan reste plausible jusqu'à 50 km/h
  suspiciousCooldownMs: 10 * 60_000,
  flagAfterJumpsPerDay: 3,
  walkMaxKmh: 8,                  // proof of walk : segments ≤ 8 km/h …
  walkMaxAccM: 30,                // … et précision ≤ 30 m
  proofOfWalkM: 1500,
  demoWalkKmh: 30,
} as const;

// ───────────────────────────── Équivalences en tokens (affichage) ─────────────────────────────
/** Prix mixte (1 entrée : 3 sortie) en $ par million de tokens, vérifiés le 2026-11-06 sur /v1/model/list. */
export const MODEL_EQUIV = [
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', usdPerMTok: 0.98, tier: 'cheap' },
  { id: 'openai/gpt-5-nano', label: 'gpt-5-nano', usdPerMTok: 0.31, tier: 'cheap' },
  { id: 'anthropic/claude-sonnet-5-5', label: 'Claude Sonnet 5.5', usdPerMTok: 8, tier: 'premium' },
] as const;
export const TOKENS_PER_CHAT = 1500;

// ───────────────────────────── Événements de ville (Docs/03 §9) ─────────────────────────────
/**
 * Un seul événement actif à la fois, partagé par tous les joueurs, dans une zone circulaire.
 * Effets BORNÉS (le serveur ne sort jamais de ces bornes, même déclenché par l'admin) :
 *  - priceMult : multiplie le prix de référence (P0) d'UNE famille chez les marchands de la zone (achat ET vente) ;
 *  - extraSpawnChance : vague bonus d'éclats d'UNE famille rare, par cellule de la zone et par fenêtre de 10 min ;
 *  - strike : les marchands de la zone ne vendent plus (ils achètent toujours, au prix normal).
 * Rien ne touche la Réserve : les crédits réels restent bornés par les plafonds de la Forge.
 */
export type CityEventKind = 'flash_crash' | 'hype' | 'gold_rush' | 'strike';
export interface CityEventRule {
  durationMs: number;
  families: Family[];        // familles tirées au sort (vide : sans famille)
  priceMult?: number;
  extraSpawnChance?: number;
  strike?: true;
  weight: number;            // poids au tirage automatique
}
export const CITY_EVENTS: Record<CityEventKind, CityEventRule> = {
  flash_crash: { durationMs: 20 * 60_000, families: ['deepseek', 'qwen', 'gemini'], priceMult: 0.6, weight: 3 },
  hype: { durationMs: 20 * 60_000, families: ['gemini', 'gpt'], priceMult: 1.25, weight: 2 },
  gold_rush: { durationMs: 20 * 60_000, families: ['gpt', 'claude'], extraSpawnChance: 0.3, weight: 2 },
  strike: { durationMs: 15 * 60_000, families: [], strike: true, weight: 1 },
};
export const CITY_EVENT_KINDS = Object.keys(CITY_EVENTS) as CityEventKind[];
export const CITY_EVENT = {
  radiusM: 650,                // rayon de la zone
  gapMinMs: 2 * 3600_000,      // pause entre deux événements automatiques : 2 à 4 h…
  gapMaxMs: 4 * 3600_000,
  maxPerDay: 6,                // … et jamais plus de 6 par jour de Paris
  firstHour: 8, lastHour: 23,  // créneau des événements automatiques (heure de Paris)
  priceMultMin: 0.6,           // bornes dures de priceMult
  priceMultMax: 1.3,
  extraSpawnMax: 0.5,          // borne dure de extraSpawnChance
  durationMaxMs: 45 * 60_000,
} as const;
/** Zones nommées (centres de quartiers animés de Paris). */
export const EVENT_ZONES = [
  { id: 'chatelet', name: 'Châtelet', lat: 48.8586, lng: 2.347 },
  { id: 'montmartre', name: 'Montmartre', lat: 48.8865, lng: 2.341 },
  { id: 'bastille', name: 'Bastille', lat: 48.8533, lng: 2.3692 },
  { id: 'republique', name: 'République', lat: 48.8674, lng: 2.3636 },
  { id: 'louvre', name: 'the Louvre', lat: 48.8611, lng: 2.3358 },
  { id: 'saint-germain', name: 'Saint-Germain', lat: 48.854, lng: 2.3335 },
  { id: 'marais', name: 'the Marais', lat: 48.859, lng: 2.36 },
  { id: 'opera', name: 'Opéra', lat: 48.871, lng: 2.332 },
  { id: 'latin', name: 'the Latin Quarter', lat: 48.8496, lng: 2.347 },
  { id: 'canal', name: 'Canal Saint-Martin', lat: 48.871, lng: 2.366 },
] as const;
export type EventZoneId = (typeof EVENT_ZONES)[number]['id'];

// ───────────────────────────── Carte vivante ─────────────────────────────
export const LIVING = {
  walkersMax: 12,              // marcheurs renvoyés au plus (runners + joueurs)
  playersMax: 5,               // dont joueurs réels anonymisés
  walkersRadiusM: 900,
  playerSeenMs: 3 * 60_000,    // un joueur réel apparaît s'il a bougé dans les 3 dernières minutes
  playerJitterM: 60,           // position publiée = centre de sa cellule H3 r9 (~175 m) ± 60 m, stable 10 min
  privacyWindowMs: 10 * 60_000,
  bubbleRadiusM: 400,          // les marchands à ≤ 400 m peuvent parler
  bubblesMax: 3,
  bubbleSlotMs: 7000,          // rotation des bulles
  reopenedBubbleMs: 3 * 3600_000, // « Back in business » pendant 3 h après une réouverture
} as const;
