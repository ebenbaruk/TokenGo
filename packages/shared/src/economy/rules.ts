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

// ───────────────────────────── Décodage « Next token » (Docs/13 §3) ─────────────────────────────
/**
 * 2ᵉ temps de capture : une phrase à compléter, 3 jetons, un seul bon.
 *  - Rare / Épique : obligatoire après un Lock-on réussi ; raté → l'éclat « hallucine » (fuite à CATCH.fleeAfterMiss, sinon on relance le Lock-on).
 *  - Commun / Peu commun : bonus facultatif après la capture : +XP, +maîtrise et chance de Shiny ×2 sur la capture SUIVANTE
 *    (aucun éclat en plus : l'offre ne bouge pas).
 * Le délai est mesuré côté serveur, à partir de l'envoi de la question.
 */
export const DECODE = {
  timeMs: { common: 4000, uncommon: 4000, rare: 4000, epic: 5000 } satisfies Record<Rarity, number>,
  networkGraceMs: 1000,          // tolérance réseau ajoutée au délai affiché
  required: { common: false, uncommon: false, rare: true, epic: true } satisfies Record<Rarity, boolean>,
  bonusXp: 5,
  masteryBonus: 5,               // maîtrise +5 si Décodage réussi (appliquée par le module Maîtrise, Docs/13 §2)
  luckyShinyMult: 2,             // bonus réussi : chance de Shiny ×2 sur la prochaine capture réussie (non cumulable)
  bonusOpenTtlMs: 60_000,        // le bonus s'ouvre au plus 60 s après la capture
  choices: 3,
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

// ───────────────────────────── Marchandage (mini-jeu de cartes, Docs/03 §5 bis) ─────────────────────────────
/**
 * Le marchandage ne déplace qu'une fraction bornée de la marge du marchand : jamais plus de 8 %, jamais au-delà de
 * son prix milieu ± 1 % (plancher de coût : acheter puis revendre perd toujours, voir haggle.ts), limité par jour.
 * Les points de base (bp) : 100 bp = 1 %.
 */
export const HAGGLE = {
  minQty: 3,                     // on ne marchande pas pour 1 ou 2 éclats
  maxPct: 0.08,                  // plafond absolu : −8 % à l'achat, +8 % à la vente
  basePct: 0.05,                 // plafond de départ d'un inconnu…
  pctPerRep: 0.003,              // … + 0,3 point par point de réputation (8 % à réputation 10)
  keepMargin: 0.01,              // le marchand garde toujours ≥ 1 % autour de son prix milieu (plancher de coût)
  rounds: 3,                     // 3 manches, 3 cartes par main
  handSize: 3,
  patienceBase: 3,               // patience de départ (+1 friendly, −1 proud, + réputation / 3)
  patienceMax: 5,
  sessionTtlMs: 90_000,          // une séance de marchandage expire après 90 s
  perMerchantDay: 2,             // séances par joueur, par marchand et par jour de Paris
  perPlayerDay: 6,               // séances par joueur et par jour de Paris (tous marchands)
  sourMs: 20 * 60_000,           // patience à zéro : le marchand boude 20 min…
  sourPct: 0.03,                 // … et ses devis pour ce joueur sont 3 % moins bons
  repMin: -5,
  repMax: 10,
  repPerRegularDay: 1,           // +1 la première fois qu'on commerce chez lui dans la journée (« habitué »)
  repPerDeal: 1,                 // +1 par marchandage conclu
  repPerSour: -2,                // −2 quand il perd patience
  llmLinesPerDay: 30,            // au plus 30 répliques LLM de marchandage par jour (dans le plafond NPC de 150)
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

// ───────────────────────────── Remote Scout (jouer depuis chez soi) ─────────────────────────────
/**
 * Le Scout est un pigeon-drone piloté à distance : vitesse plafonnée, batterie qui se recharge en temps réel.
 * Réglage : la boucle complète de démo (capture → relais → marchand → forge, ~2–3 km autour du Louvre) tient sur
 * une batterie pleine en 5–10 min ; voler en continu la vide en ~14 min ; un Dash de 1 km en coûte 45 %.
 * Récompenses inchangées : un Scout est un compte « démo » (pas de poche principale, Judge Pool via pass seulement).
 */
export const SCOUT = {
  batteryMax: 100,              // %
  cruiseKmh: 30,                // vitesse de vol du client (tap sur la carte, « Fly there »)
  maxKmh: 40,                   // au-delà, le déplacement est un « Dash » (saut) …
  dashMult: 1.5,                // … qui coûte 1,5 × la batterie d'un vol normal …
  dashMaxM: 1500,               // … et jamais plus de 1,5 km d'un coup (sinon refusé)
  drainPerKm: 30,               // % de batterie par km volé (≈ 3,3 km sur une batterie pleine)
  rechargePerMin: 8,            // % / min, en continu (pleine en 12,5 min)
  resumeAtPct: 10,              // batterie vide → au sol jusqu'à 10 % (≈ 75 s)
  relaunchAfterMs: 15 * 60_000, // sans position depuis 15 min : relance libre (nouvelle session, retour à la base)
  freeHopM: 3,                  // tremblote < 3 m : gratuit
} as const;

// ───────────────────────────── Monde « partout » (régions générées depuis OSM) ─────────────────────────────
export const WORLD_GEN = {
  regionRes: 7,                 // une région = une cellule H3 r7 (~5 km², ~1,2 km de rayon)
  ensureRadiusM: 600,           // on prépare les régions touchées par un disque de 600 m autour du joueur
  maxRegionsPerDay: 300,        // au global (jour de Paris)
  maxRegionsPerIpPerDay: 12,    // par réseau : IPv4, ou /64 en IPv6
  anchorMaxM: 1000,             // on ne génère qu'autour de la position serveur du joueur (/api/move) : ≤ 1 km…
  anchorFreshMs: 5 * 60_000,    // … et reçue il y a ≤ 5 min (jamais autour d'un lat/lng arbitraire de /api/world)
  maxRelays: 80,                // plafonds de nœuds par région
  maxMarkets: 8,
  maxForges: 2,
  forgeMinSpacingM: 1000,
  minOsmRelays: 8,              // en dessous → génération procédurale
  minOsmMarkets: 2,
  procedural: { relays: 36, markets: 5, forges: 1 },
  // Overpass public : 20–90 s mesurés. On n'attend que 8 s avant de jouer en procédural ; la requête continue en fond
  // (budget 120 s, miroirs essayés dans l'ordre) et remplace le quartier procédural s'il est encore « frais » (regionFresh).
  overpassQuickMs: 8_000,
  overpassBudgetMs: 120_000,
  overpassRetryMs: 30_000,      // miroirs qui échouent vite (429/504) : un seul nouvel essai 30 s plus tard
  upgradeWindowMs: 15 * 60_000, // remplacement procédural → OSM seulement dans les 15 min après la création…
  upgradePollMs: 10_000,        // … pendant lesquelles le client réinterroge /api/world toutes les 10 s
  overpassMaxElements: 900,
} as const;

// ───────────────────────────── Équivalences en tokens (affichage) ─────────────────────────────
/** Prix mixte (1 entrée : 3 sortie) en $ par million de tokens, vérifiés le 2026-11-06 sur /v1/model/list. */
export const MODEL_EQUIV = [
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', usdPerMTok: 0.98, tier: 'cheap' },
  { id: 'openai/gpt-5-nano', label: 'gpt-5-nano', usdPerMTok: 0.31, tier: 'cheap' },
  { id: 'anthropic/claude-sonnet-5-5', label: 'Claude Sonnet 5.5', usdPerMTok: 8, tier: 'premium' },
] as const;
export const TOKENS_PER_CHAT = 1500;

// ───────────────────────────── Codex (variantes d'éclats : purement cosmétiques) ─────────────────────────────
/**
 * Une capture tire une variante (serveur, graine HMAC). Les variantes ne changent NI l'inventaire NI les prix NI la Forge :
 * un « Shiny Claude » est un éclat `shard:claude` comme les autres. Elles remplissent seulement le Codex (collection).
 * Priorité : shiny > overclocked > landmark > night > classic.
 */
export const VARIANTS = ['classic', 'night', 'landmark', 'overclocked', 'shiny'] as const;
export type Variant = (typeof VARIANTS)[number];
export const CODEX = {
  shinyChance: 1 / 40,          // ≈ 1 capture sur 40, partout, à toute heure
  overclockCombo: 3,            // un PERFECT avec un combo ≥ 3 → « Overclocked »
  landmarkRadiusM: 300,         // à ≤ 300 m d'une Forge (monument) → « Louvre Claude »
  nightFromHour: 21,            // de 21 h à 6 h, heure solaire locale (longitude / 15) : marche dans n'importe quelle ville
  nightToHour: 6,
  xpNewEntry: 15,               // XP pour chaque case du Codex découverte (25 cases → 375 XP au total, une seule fois)
} as const;
/** Titres débloqués par le nombre de cases découvertes (sur FAMILIES × VARIANTS = 25). */
export const CODEX_TITLES = [
  { id: 'spotter', name: 'Shard Spotter', need: 3 },
  { id: 'hunter', name: 'Variant Hunter', need: 8 },
  { id: 'keeper', name: 'Codex Keeper', need: 15 },
  { id: 'archivist', name: 'City Archivist', need: 25 },
] as const;

// ───────────────────────────── Daily Route ─────────────────────────────
/**
 * Chaque jour, une boucle de 3 à 5 vrais lieux (relais, marchands, forge) autour du quartier du joueur.
 * Graine = (jour, cellule H3 r8 du quartier) : tous les joueurs d'un même quartier ont la même route ce jour-là.
 * Récompense bornée, une fois par jour : 200 XP + 60 ƒ (+10 ƒ par jour de série, max +30) + 1 Gemini (Uncommon garanti).
 */
export const DAILY_ROUTE = {
  stopsMin: 3,
  stopsMax: 5,
  anchorRes: 8,                 // cellule H3 r8 (≈ 0,7 km²) : le quartier
  radiusM: 500,                 // arrêts à ≤ 500 m du centre du quartier (boucle ≈ 1,5–2 km)
  minSpacingM: 120,             // deux arrêts sont à ≥ 120 m l'un de l'autre
  reanchorM: 2500,              // route pas commencée et joueur à > 2,5 km : nouvelle route autour de lui
  rewardXp: 200,
  rewardFlux: 60,
  streakFluxPerDay: 10,
  streakFluxMax: 30,
  rewardShard: 'gemini' as Family,
} as const;

// ───────────────────────────── Événements de ville (Docs/03 §9) ─────────────────────────────
/**
 * Un seul événement actif à la fois, partagé par tous les joueurs, dans une zone circulaire.
 * Effets BORNÉS (le serveur ne sort jamais de ces bornes, même déclenché par l'admin) :
 *  - priceMult : multiplie le prix de référence (P0) d'UNE famille chez les marchands de la zone (achat ET vente) ;
 *  - extraSpawnChance : vague bonus d'éclats d'UNE famille rare, par cellule de la zone et par fenêtre de 10 min ;
 *  - strike : les marchands de la zone ne vendent plus (ils achètent toujours, au prix normal).
 * Rien ne touche la Réserve : les crédits réels restent bornés par les plafonds de la Forge.
 */
export type CityEventKind = 'flash_crash' | 'hype' | 'gold_rush' | 'strike' | 'rogue'; // rogue : raid (section RAID)
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
  // Raid « Rogue Model » (Docs/13 §6) : poids 0 → jamais tiré par drawCityEvent ; le serveur le lance à part (RAID.autoMaxPerDay)
  rogue: { durationMs: 45 * 60_000, families: [], weight: 0 },
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
  eventFarM: 25_000,           // joueur à > 25 km de la zone (autre ville, monde « partout ») : ni bannière ni jingle
} as const;

// ═════════════════════════════ Arène des modèles & Maîtrise (Docs/13 §1, §2, §4) ═════════════════════════════
/**
 * Les éclats sont aussi des modèles d'IA avec un profil de combat. Les combats (3 contre 3, 5 épreuves) se jouent aux
 * Forges ; tout est serveur-autoritaire, déterministe (graine HMAC) et borné : les récompenses sont en Flux/XP seulement,
 * rien ne touche la Réserve ni les crédits réels. Formules : arena.ts (pures, testées).
 */
export const CATEGORIES = ['math', 'code', 'writing', 'vision', 'speed', 'lang'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_INFO: Record<Category, { name: string; icon: string }> = {
  math: { name: 'Math', icon: '🧮' },
  code: { name: 'Code', icon: '💻' },
  writing: { name: 'Writing', icon: '✍️' },
  vision: { name: 'Vision', icon: '👁' },
  speed: { name: 'Speed', icon: '⚡' },
  lang: { name: 'Languages', icon: '🌐' },
};

/** Profils ludiques (1–10), inspirés de la réputation publique des familles — PAS des benchmarks (« game stats » dans l'UI). */
export const MODEL_STATS: Record<Family, Record<Category, number>> = {
  claude: { math: 7, code: 9, writing: 10, vision: 7, speed: 5, lang: 8 },
  gpt: { math: 8, code: 8, writing: 8, vision: 9, speed: 6, lang: 8 },
  gemini: { math: 7, code: 7, writing: 7, vision: 10, speed: 7, lang: 9 },
  deepseek: { math: 9, code: 8, writing: 6, vision: 4, speed: 8, lang: 6 },
  qwen: { math: 7, code: 7, writing: 6, vision: 6, speed: 9, lang: 10 },
};
/** Style d'une famille (une ligne, affichée sur la carte de combat). */
export const MODEL_STYLE: Record<Family, string> = {
  claude: 'The writer-coder: slow, brilliant',
  gpt: 'The all-rounder',
  gemini: 'The eye, long context',
  deepseek: 'The cheap mathlete',
  qwen: 'The speedy polyglot',
};

export const TECHNIQUES = ['zero', 'cot', 'few', 'tool', 'hot'] as const;
export type Technique = (typeof TECHNIQUES)[number];
export interface TechniqueRule {
  name: string;
  cost: number;                            // tokens du budget de combat
  mult: Partial<Record<Category, number>>; // multiplicateur par catégorie…
  multElse: number;                        // … et ailleurs
  add: Partial<Record<Category, number>>;  // bonus fixe APRÈS multiplicateurs
  variance: number;                        // facteur sur la variance ±12 %
  halluc: number;                          // facteur sur le risque d'hallucination
  hint: string;
}
export const TECHNIQUE_RULES: Record<Technique, TechniqueRule> = {
  zero: { name: 'Zero-shot', cost: 0, mult: {}, multElse: 1, add: {}, variance: 1, halluc: 1, hint: '×1.0, free' },
  cot: { name: 'Chain-of-thought', cost: 3, mult: { math: 1.5, code: 1.5 }, multElse: 1.15, add: {}, variance: 1, halluc: 0.5, hint: '×1.5 math/code · ×1.15 else · halluc ÷2' },
  few: { name: 'Few-shot', cost: 2, mult: { writing: 1.3, lang: 1.3 }, multElse: 1, add: {}, variance: 0.5, halluc: 1, hint: '×1.3 writing/lang · steadier' },
  tool: { name: 'Tool use', cost: 2, mult: {}, multElse: 1, add: { math: 3, vision: 3, code: 3 }, variance: 1, halluc: 1, hint: '+3 math/vision/code' },
  hot: { name: 'High temp', cost: 1, mult: { writing: 1.4 }, multElse: 1, add: {}, variance: 2, halluc: 2, hint: '×1.4 writing · wild · halluc ×2' },
};

export const ARENA = {
  teamSize: 3,                    // 3 familles différentes (≥ 1 éclat de chacune ; rien n'est consommé)
  rounds: 5,                      // 5 épreuves tirées au début
  winsNeeded: 3,                  // premier à 3 manches
  tokenBudget: 10,                // tokens de techniques par combat (chaque camp)
  variance: 0.12,                 // ±12 % (graine)
  hallucBase: 0.08,               // 8 % de base…
  hallucPower: 0.3,               // … puissance × 0,3
  affinityBonus: 0.1,             // familles du thème de la Forge : +10 % des deux côtés
  guardianMasteryBase: 1,         // maîtrise du Gardien = 1 + (numéro de jour mod 2) : ~40–50 % de victoires pour un joueur neuf (simulé)
  guardianMasteryMod: 2,
  championExpiryMs: 48 * 3600_000, // Champion inactif 48 h → le Gardien reprend l'arène
  championFluxPer10Min: 4,        // +4 ƒ par tranche de 10 min tenue…
  championFluxMaxDay: 240,        // … max 240 ƒ / jour de Paris / joueur (versés à la consultation ou à la défaite)
  entryFee: 10,                   // frais d'entrée (puits de Flux)
  battlesPerDay: 12,              // combats / joueur / jour de Paris
  level: 2,                       // débloqué au niveau 2
  battleTtlMs: 15 * 60_000,       // un combat abandonné expire après 15 min (frais perdus, aucune récompense)
  rewards: {
    guardian: { xp: 60, flux: 20 },
    champion: { xp: 100, flux: 30 },
    loss: { xp: 15, flux: 0 },
  },
} as const;

/** Maîtrise : XP par famille et par joueur ; niveau 1–10 ; bonus de puissance en arène. */
export const MASTERY = {
  thresholds: [0, 30, 80, 150, 250, 400, 600, 850, 1150, 1500] as readonly number[], // XP pour atteindre le niveau i+1
  maxLevel: 10,
  powerPerLevel: 0.04,            // × (1 + 0.04 × (m − 1)) : +36 % au niveau 10
  xpCatch: 5,
  xpDecodeBonus: 5,
  xpRound: 10,                    // manche d'arène jouée avec la famille
  xpRoundWon: 10,                 // … et gagnée
} as const;

// ───────────────────────────── Missions du jour (Docs/13 §7) ─────────────────────────────
/**
 * 3 missions par joueur et par jour de Paris, tirées (graine jour + joueur) dans ce catalogue, dont au moins une du groupe
 * « arena » (Arène / Décodage). Chaque mission : +40 XP + 15 ƒ ; les 3 réclamées → coffre du jour : +60 ƒ + 1 Gemini
 * (une fois par jour, comme la Daily Route). La clé de la mission est aussi la clé de son compteur serveur.
 * `needs` : 'arena' = proposée seulement si l'Arène est débloquée (niveau) ; 'raid' = seulement pendant un raid Rogue.
 */
export type MissionKind =
  | 'decode' | 'arena_win' | 'arena_rounds' | 'catch_families' | 'haggle_deal' | 'relay_sync' | 'combo3' | 'shops' | 'raid_damage' | 'rare_variant';
export type MissionGroup = 'arena' | 'explore' | 'trade' | 'raid';
export interface MissionRule { title: string; hint: string; goal: number; group: MissionGroup; icon: string; needs?: 'arena' | 'raid' }
export const MISSION_CATALOG: Record<MissionKind, MissionRule> = {
  decode: { title: 'Decode 3 tokens', hint: 'Pick the right next token after a Lock-on', goal: 3, group: 'arena', icon: '🔤' },
  arena_win: { title: 'Win an arena battle', hint: 'Beat a Sentinel or a Champion at any Forge', goal: 1, group: 'arena', icon: '🏆', needs: 'arena' },
  arena_rounds: { title: 'Play 5 arena rounds', hint: 'Every round counts, won or lost', goal: 5, group: 'arena', icon: '⚔️', needs: 'arena' },
  catch_families: { title: 'Catch 3 different families', hint: 'Mix it up: DeepSeek, Qwen, Gemini…', goal: 3, group: 'explore', icon: '🧩' },
  relay_sync: { title: 'Sync 4 relays', hint: 'Tap Relays as you walk by', goal: 4, group: 'explore', icon: '📡' },
  combo3: { title: 'Hit a ×3 combo', hint: 'Chain 3 catches within 90 s each', goal: 1, group: 'explore', icon: '🔥' },
  rare_variant: { title: 'Catch a Night or Landmark variant', hint: 'Hunt after dark, or near a monument', goal: 1, group: 'explore', icon: '🌙' },
  haggle_deal: { title: 'Close a haggle deal', hint: 'Haggle with a merchant, then shake on it', goal: 1, group: 'trade', icon: '🤝' },
  shops: { title: 'Trade at 2 shops', hint: 'Buy or sell at two different merchants', goal: 2, group: 'trade', icon: '🏪' },
  raid_damage: { title: 'Deal 200 raid damage', hint: 'Join the Rogue Model raid at its Forge', goal: 200, group: 'raid', icon: '⚠️', needs: 'raid' },
};
export const MISSION_KINDS = Object.keys(MISSION_CATALOG) as MissionKind[];
export const MISSIONS = {
  perDay: 3,
  rewardXp: 40,
  rewardFlux: 15,
  chestFlux: 60,
  chestShard: 'gemini' as Family,
} as const;
// ───────────────────────────── fin Missions du jour ─────────────────────────────
// ═════════════════════════════ RAID « Rogue Model » (Docs/13 §6) ═════════════════════════════
/**
 * Boss coopératif de ville : un événement de ville `rogue` sur une Forge. Toute la ville tape sur une barre de PV commune.
 * Assaut = mini-combat de 3 manches avec le moteur de l'Arène (budget 6 tokens, rate limit) contre l'équipe du boss.
 * Récompenses en XP / Flux / maîtrise seulement (bornées ci-dessous) : aucun éclat créé, rien ne touche la Réserve.
 * Formules pures : raid.ts.
 */
export const RAID_BOSSES = [
  { id: 'glitch9', name: 'GL1TCH-9' },
  { id: 'overfit', name: 'Overfit Prime' },
  { id: 'hallucinator', name: 'The Hallucinator' },
  { id: 'loop', name: 'Loop.exe' },
  { id: 'hydra', name: 'Token Hydra' },
] as const;
export type RaidBossId = (typeof RAID_BOSSES)[number]['id'];

export const RAID = {
  durationMs: 45 * 60_000,
  hpBase: 800,                    // PV = 800 + 120 × joueurs actifs dans la dernière heure…
  hpPerPlayer: 120,
  hpMin: 800,                     // … borné 800–6 000
  hpMax: 6000,
  activeWindowMs: 3600_000,
  sliceMs: 10 * 60_000,           // faiblesse / résistance retirées toutes les 10 min (graine)
  weakMult: 1.5,
  resistMult: 0.6,
  wonRoundMult: 1.5,              // manche gagnée contre le boss : dégâts × 1,5
  damageScale: 5,                 // dégâts d'une manche = puissance × 5 × multiplicateurs (puissance ≈ 5–15 → 25–110 PV)
  rounds: 3,                      // un assaut = 3 manches, toutes jouées
  tokenBudget: 6,
  teamSize: 3,
  bossMastery: 3,
  assaultsPerRaid: 3,             // assauts max par joueur et par raid (gratuits)
  assaultTtlMs: 10 * 60_000,      // un assaut abandonné expire (les manches jouées ont déjà fait leurs dégâts)
  autoMaxPerDay: 2,               // raids automatiques max par jour de Paris (+ admin)
  autoChance: 0.35,               // chance qu'un événement automatique dû soit un raid (sous le plafond)
  autoFirstHour: 11,              // créneau des raids automatiques (heure de Paris)
  autoLastHour: 22,
  activityRadiusM: 2000,          // forge choisie près de l'activité récente (joueurs vus dans l'heure)
  zoneRadiusM: 300,               // zone affichée autour de la Forge du boss (bannière « you're in the zone »)
  // runners (bots) : un coup modeste de temps en temps
  botEveryMs: 60_000,             // au plus un coup de bot par minute…
  botChance: 0.5,                 // … tiré à chaque boucle des runners une fois la minute écoulée
  botDamageMin: 15,
  botDamageMax: 30,
  rewards: {
    win: { xp: 80, flux: 30, mastery: 20 }, // chaque participant ; maîtrise +20 par famille utilisée
    top3Flux: 40,                           // top 3 des dégâts (joueurs réels)
    fail: { xp: 20 },                       // consolation, temps écoulé
  },
  title: { id: 'rogue-slayer', name: 'Rogue Slayer' }, // titre Codex au premier raid gagné
} as const;
