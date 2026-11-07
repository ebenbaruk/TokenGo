// Monde « partout » : à l'arrivée d'un joueur hors de Paris, on génère son quartier (cellule H3 r7) en tâche de fond —
// requête Overpass (miroirs, délai court, User-Agent poli), sélection déterministe (worldgen.ts), sinon repli procédural —
// puis on persiste (table regions), on ajoute les nœuds au monde en mémoire et on crée les marchands.
// La requête HTTP ne bloque jamais : /api/world répond « scouting » et le client réinterroge.
import { FAMILIES, WORLD_GEN, shardToken, type RegionStatus } from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { addRegion, removeRegion } from './world.ts';
import { generateRegion, overpassQuery, regionsAround, selectRegion, type GeneratedRegion, type OsmElement } from './worldgen.ts';
import { merchantByNode, seedMerchants } from './merchants.ts';
import { merchantLedger } from './players.ts';
import { parisDay, parisDayStart } from './reserve.ts';

export const OVERPASS_UA = 'TokenGo/1.0 (game; github.com/ebenbaruk/TokenGo)';
export type OverpassFetch = (query: string) => Promise<OsmElement[]>;

/** Client Overpass : essaie chaque miroir dans un budget total ; lève une erreur si aucun ne répond correctement. */
export function overpassFetcher(urls: string[], budgetMs: number = WORLD_GEN.overpassBudgetMs): OverpassFetch | null {
  if (!urls.length) return null;
  return async (query) => {
    let last: unknown = new Error('no overpass mirror');
    const deadline = Date.now() + budgetMs;
    for (const url of urls) {
      const timeoutMs = deadline - Date.now();
      if (timeoutMs < 1000) break;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': OVERPASS_UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`overpass ${url} → HTTP ${res.status}`);
        const j = (await res.json()) as { elements?: OsmElement[]; remark?: string };
        if (!Array.isArray(j.elements)) throw new Error(`overpass ${url} → no elements`);
        if (!j.elements.length && j.remark) throw new Error(`overpass ${url} → ${j.remark.slice(0, 120)}`);
        return j.elements;
      } catch (e) {
        last = e;
      }
    }
    throw last;
  };
}

export const parseOverpassUrls = (v: string): string[] =>
  v.trim() === 'off' ? [] : v.split(',').map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));

export interface Regions {
  /**
   * Statut de couverture autour d'une position ; lance (en fond) les régions manquantes dans la limite des plafonds,
   * seulement si `allowNew` (la position est celle du joueur pour le serveur, voir worldView).
   */
  ensure(lat: number, lng: number, ipHash: string | null, allowNew?: boolean): RegionStatus;
  /** Résolu quand la file de génération est vide (tests). */
  idle(): Promise<void>;
  /** Résolu quand les requêtes OSM de fond (remplacement procédural → OSM) sont terminées (tests). */
  upgradesIdle(): Promise<void>;
}

export interface RegionTimings {
  /** attente d'Overpass avant de servir un quartier procédural (défaut WORLD_GEN.overpassQuickMs) */
  quickMs?: number;
  /** après un échec rapide d'Overpass, délai avant l'unique nouvel essai en fond (défaut WORLD_GEN.overpassRetryMs) */
  retryMs?: number;
}

/** Ce qui s'est passé dans une région depuis sa création (tout ce qui lie un joueur à ses nœuds actuels). */
export interface RegionActivity { trades: number; haggles: number; rescues: number; contracts: number; compiles: number; routeStops: number }

/**
 * Règle de remplacement procédural → OSM (pure) : seulement un quartier procédural, créé il y a moins de
 * WORLD_GEN.upgradeWindowMs, où personne n'a encore commercé, marchandé, investi, livré un contrat, compilé à sa forge
 * ni validé un arrêt de Daily Route. Les captures et syncs de relais ne comptent pas : leurs gains sont déjà acquis et ne
 * dépendent d'aucun nœud. Sinon le quartier reste procédural (définitif) : on ne retire jamais un lieu où un joueur a un lien.
 */
export function regionFresh(r: { source: 'osm' | 'procedural'; createdAt: number }, a: RegionActivity, now: number): boolean {
  if (r.source !== 'procedural') return false;
  if (now - r.createdAt >= WORLD_GEN.upgradeWindowMs) return false;
  return a.trades + a.haggles + a.rescues + a.contracts + a.compiles + a.routeStops === 0;
}

interface Row { id: string; source: 'osm' | 'procedural'; nodes: string; created_at: number }

export function createRegions(ctx: Ctx, fetcher: OverpassFetch | null, log: (msg: string) => void = () => {}, timings: RegionTimings = {}): Regions {
  const quickMs = timings.quickMs ?? WORLD_GEN.overpassQuickMs;
  const retryMs = timings.retryMs ?? WORLD_GEN.overpassRetryMs;
  const rows = ctx.db.prepare('SELECT id, source, nodes, created_at FROM regions ORDER BY id').all() as Row[];
  for (const r of rows) {
    const nodes = JSON.parse(r.nodes) as GeneratedRegion['nodes'];
    addRegion(ctx.world, r.id, r.source, nodes);
    seedMerchants(ctx, nodes); // idempotent (crash entre la persistance et la création des marchands)
  }
  const pending = new Map<string, string | null>(); // région → ip_hash
  const upgrading = new Set<string>();             // régions procédurales dont la requête OSM tourne encore en fond
  let queue: Promise<void> = Promise.resolve();
  const inflight = new Set<Promise<void>>();

  const capReached = (ipHash: string | null): boolean => {
    const since = parisDayStart(ctx.now());
    const day = (ctx.db.prepare('SELECT COUNT(*) n FROM regions WHERE created_at >= ?').get(since) as { n: number }).n + pending.size;
    if (day >= WORLD_GEN.maxRegionsPerDay) return true;
    if (!ipHash) return false;
    const mine = (ctx.db.prepare('SELECT COUNT(*) n FROM regions WHERE ip_hash = ? AND created_at >= ?').get(ipHash, since) as { n: number }).n
      + [...pending.values()].filter((h) => h === ipHash).length;
    return mine >= WORLD_GEN.maxRegionsPerIpPerDay;
  };

  function activity(id: string): RegionActivity {
    const nodes = ctx.world.nodes.filter((n) => n.region === id);
    const marketIds = nodes.filter((n) => n.kind === 'market').map((n) => n.id);
    const merchantIds = marketIds.length
      ? (ctx.db.prepare(`SELECT id FROM merchants WHERE node_id IN (${marketIds.map(() => '?').join(',')})`).all(...marketIds) as { id: string }[]).map((r) => r.id)
      : [];
    const forgeIds = nodes.filter((n) => n.kind === 'forge').map((n) => n.id);
    const count = (table: string, col: string, ids: string[]) => (ids.length
      ? (ctx.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${col} IN (${ids.map(() => '?').join(',')})`).get(...ids) as { n: number }).n : 0);
    const mset = new Set(merchantIds);
    const contracts = (ctx.db.prepare("SELECT data FROM events WHERE kind = 'contract'").all() as { data: string | null }[])
      .filter((r) => mset.has((JSON.parse(r.data ?? '{}') as { merchantId?: string }).merchantId ?? '')).length;
    const nodeIds = new Set(nodes.map((n) => n.id));
    let routeStops = 0;
    for (const r of ctx.db.prepare("SELECT done FROM daily_routes WHERE done != '[]'").all() as { done: string }[]) {
      routeStops += (JSON.parse(r.done) as string[]).filter((x) => nodeIds.has(x)).length;
    }
    return {
      trades: count('trades', 'merchant_id', merchantIds), haggles: count('haggles', 'merchant_id', merchantIds),
      rescues: count('rescues', 'merchant_id', merchantIds), contracts, compiles: count('compiles', 'forge_id', forgeIds), routeStops,
    };
  }

  /**
   * Remplace un quartier procédural frais par la sélection OSM, dans une transaction : les anciens marchands rendent leur
   * stock et leur trésorerie (ops « burn » dans l'outbox, symétriques des « mint » de leur création : la chaîne reste
   * réconciliable), leurs lignes annexes sont effacées, puis le monde et les nouveaux marchands sont créés. Les routes du
   * jour non commencées qui passaient par ces nœuds sont effacées (le prochain /api/world en recalcule une).
   */
  function upgrade(id: string, elements: OsmElement[]): boolean {
    const row = ctx.db.prepare('SELECT source, created_at FROM regions WHERE id = ?').get(id) as { source: 'osm' | 'procedural'; created_at: number } | undefined;
    if (!row) return false;
    const g = selectRegion(id, elements);
    if (!g) { log(`region ${id}: background OSM too sparse → stays procedural`); return false; }
    return ctx.db.transaction(() => {
      if (!regionFresh({ source: row.source, createdAt: row.created_at }, activity(id), ctx.now())) {
        log(`region ${id}: OSM arrived but the procedural neighbourhood is already in use → stays procedural`);
        return false;
      }
      const oldIds = ctx.world.nodes.filter((n) => n.region === id).map((n) => n.id);
      const marketIds = ctx.world.nodes.filter((n) => n.region === id && n.kind === 'market').map((n) => n.id);
      for (const nodeId of marketIds) {
        const m = merchantByNode(ctx, nodeId);
        if (!m) continue;
        for (const f of FAMILIES) merchantLedger(ctx, m.id, 'burn', shardToken(f), m.stock[f], `region-upgrade:${id}`);
        merchantLedger(ctx, m.id, 'burn', 'flux', m.flux, `region-upgrade:${id}`);
        for (const t of ['price_ticks', 'merchant_thoughts', 'price_seen', 'merchant_relations']) ctx.db.prepare(`DELETE FROM ${t} WHERE merchant_id = ?`).run(m.id);
        ctx.db.prepare('DELETE FROM merchants WHERE id = ?').run(m.id);
      }
      const old = new Set(oldIds);
      const day = parisDay(ctx.now());
      for (const r of ctx.db.prepare("SELECT user_id, stops FROM daily_routes WHERE day = ? AND done = '[]' AND completed_at IS NULL").all(day) as { user_id: string; stops: string }[]) {
        if ((JSON.parse(r.stops) as { id: string }[]).some((x) => old.has(x.id))) ctx.db.prepare('DELETE FROM daily_routes WHERE user_id = ? AND day = ?').run(r.user_id, day);
      }
      ctx.db.prepare('UPDATE regions SET source = ?, osm_elements = ?, nodes = ? WHERE id = ?').run('osm', elements.length, JSON.stringify(g.nodes), id);
      removeRegion(ctx.world, id);
      addRegion(ctx.world, id, 'osm', g.nodes);
      seedMerchants(ctx, g.nodes);
      log(`region ${id}: upgraded procedural → osm, ${g.nodes.length} nodes`);
      return true;
    })();
  }

  /** Requête OSM de fond pour un quartier servi en procédural ; remplace s'il est encore frais à l'arrivée (indépendant des autres). */
  function upgradeLater(id: string, fetch: Promise<OsmElement[]>) {
    upgrading.add(id);
    const p = (async () => {
      try { upgrade(id, await fetch); } catch (e) { log(`region ${id}: background overpass failed (${(e as Error).message}) → stays procedural`); }
      finally { upgrading.delete(id); }
    })();
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  }

  async function generate(id: string, ipHash: string | null) {
    let elements: OsmElement[] | null = null;
    let fetch: Promise<OsmElement[]> | null = null;
    if (fetcher) {
      fetch = fetcher(overpassQuery(id));
      fetch.catch(() => {}); // l'erreur est traitée plus bas (ou par upgradeLater)
      let timer: ReturnType<typeof setTimeout> | undefined;
      const quick = new Promise<'slow'>((res) => { timer = setTimeout(() => res('slow'), quickMs); });
      try {
        const r = await Promise.race([fetch, quick]);
        if (r !== 'slow') { elements = r; fetch = null; }
      } catch (e) {
        // échec rapide (miroirs saturés : 429/504) : on joue en procédural et on retente une fois en fond
        log(`region ${id}: overpass failed (${(e as Error).message}) → procedural, one retry in the background`);
        const query = overpassQuery(id);
        fetch = new Promise<void>((res) => setTimeout(res, retryMs).unref?.()).then(() => fetcher(query));
      } finally { clearTimeout(timer); }
    }
    const g = generateRegion(id, elements);
    ctx.db.prepare('INSERT OR IGNORE INTO regions (id, source, created_at, ip_hash, osm_elements, nodes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, g.source, ctx.now(), ipHash, elements?.length ?? null, JSON.stringify(g.nodes));
    addRegion(ctx.world, id, g.source, g.nodes);
    seedMerchants(ctx, g.nodes);
    log(`region ${id}: ${g.source}, ${g.nodes.length} nodes${fetch && g.source === 'procedural' ? ' (OSM still loading in the background)' : ''}`);
    if (fetch && g.source === 'procedural') upgradeLater(id, fetch);
  }

  // redémarrage pendant qu'une requête de fond tournait : on la relance pour les quartiers procéduraux encore frais
  if (fetcher) {
    for (const r of rows) {
      if (r.source === 'procedural' && ctx.now() - r.created_at < WORLD_GEN.upgradeWindowMs && regionFresh({ source: r.source, createdAt: r.created_at }, activity(r.id), ctx.now())) {
        upgradeLater(r.id, fetcher(overpassQuery(r.id)));
      }
    }
  }

  const start = (id: string, ipHash: string | null) => {
    pending.set(id, ipHash);
    queue = queue
      .then(() => generate(id, ipHash))
      .catch((e: unknown) => log(`region ${id}: generation failed (${(e as Error).message})`))
      .finally(() => { pending.delete(id); });
  };

  const drain = async (get: () => Promise<void>) => {
    // la file peut s'allonger pendant l'attente
    for (let q = get(); ; q = get()) { await q; if (q === get()) return; }
  };

  return {
    ensure(lat, lng, ipHash, allowNew = true) {
      const w = ctx.world;
      const ids = regionsAround(lat, lng);
      const own = ids[0]!;
      let capped = false;
      for (const id of ids) {
        if (w.parisRegions.has(id) || w.regions.has(id) || pending.has(id) || !allowNew) continue;
        if (!ctx.cfg.WORLD_ANYWHERE || capReached(ipHash)) { if (id === own) capped = true; continue; }
        start(id, ipHash);
      }
      const source = w.parisRegions.has(own) ? 'paris' : w.regions.get(own) ?? null;
      const status = source ? 'ready' : pending.has(own) ? 'scouting' : capped ? 'capped' : 'scouting';
      return { status, source, ids, ...(ids.some((id) => upgrading.has(id)) ? { upgrading: true } : {}) };
    },
    idle: () => drain(() => queue),
    upgradesIdle: async () => { await drain(() => queue); while (inflight.size) await Promise.all([...inflight]); },
  };
}
