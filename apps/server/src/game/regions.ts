// Monde « partout » : à l'arrivée d'un joueur hors de Paris, on génère son quartier (cellule H3 r7) en tâche de fond —
// requête Overpass (miroirs, délai court, User-Agent poli), sélection déterministe (worldgen.ts), sinon repli procédural —
// puis on persiste (table regions), on ajoute les nœuds au monde en mémoire et on crée les marchands.
// La requête HTTP ne bloque jamais : /api/world répond « scouting » et le client réinterroge.
import { WORLD_GEN, type RegionStatus } from '@tokengo/shared';
import type { Ctx } from './context.ts';
import { addRegion } from './world.ts';
import { generateRegion, overpassQuery, regionsAround, type GeneratedRegion, type OsmElement } from './worldgen.ts';
import { seedMerchants } from './merchants.ts';
import { parisDayStart } from './reserve.ts';

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
  /** Statut de couverture autour d'une position ; lance (en fond) les régions manquantes dans la limite des plafonds. */
  ensure(lat: number, lng: number, ipHash: string | null): RegionStatus;
  /** Résolu quand la file de génération est vide (tests). */
  idle(): Promise<void>;
}

interface Row { id: string; source: 'osm' | 'procedural'; nodes: string }

export function createRegions(ctx: Ctx, fetcher: OverpassFetch | null, log: (msg: string) => void = () => {}): Regions {
  for (const r of ctx.db.prepare('SELECT id, source, nodes FROM regions ORDER BY id').all() as Row[]) {
    const nodes = JSON.parse(r.nodes) as GeneratedRegion['nodes'];
    addRegion(ctx.world, r.id, r.source, nodes);
    seedMerchants(ctx, nodes); // idempotent (crash entre la persistance et la création des marchands)
  }
  const pending = new Map<string, string | null>(); // région → ip_hash
  let queue: Promise<void> = Promise.resolve();

  const capReached = (ipHash: string | null): boolean => {
    const since = parisDayStart(ctx.now());
    const day = (ctx.db.prepare('SELECT COUNT(*) n FROM regions WHERE created_at >= ?').get(since) as { n: number }).n + pending.size;
    if (day >= WORLD_GEN.maxRegionsPerDay) return true;
    if (!ipHash) return false;
    const mine = (ctx.db.prepare('SELECT COUNT(*) n FROM regions WHERE ip_hash = ? AND created_at >= ?').get(ipHash, since) as { n: number }).n
      + [...pending.values()].filter((h) => h === ipHash).length;
    return mine >= WORLD_GEN.maxRegionsPerIpPerDay;
  };

  async function generate(id: string, ipHash: string | null) {
    let elements: OsmElement[] | null = null;
    if (fetcher) {
      try { elements = await fetcher(overpassQuery(id)); } catch (e) { log(`region ${id}: overpass failed (${(e as Error).message}) → procedural`); }
    }
    const g = generateRegion(id, elements);
    ctx.db.prepare('INSERT OR IGNORE INTO regions (id, source, created_at, ip_hash, osm_elements, nodes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, g.source, ctx.now(), ipHash, elements?.length ?? null, JSON.stringify(g.nodes));
    addRegion(ctx.world, id, g.source, g.nodes);
    seedMerchants(ctx, g.nodes);
    log(`region ${id}: ${g.source}, ${g.nodes.length} nodes`);
  }

  const start = (id: string, ipHash: string | null) => {
    pending.set(id, ipHash);
    queue = queue
      .then(() => generate(id, ipHash))
      .catch((e: unknown) => log(`region ${id}: generation failed (${(e as Error).message})`))
      .finally(() => { pending.delete(id); });
  };

  return {
    ensure(lat, lng, ipHash) {
      const w = ctx.world;
      const ids = regionsAround(lat, lng);
      const own = ids[0]!;
      let capped = false;
      for (const id of ids) {
        if (w.parisRegions.has(id) || w.regions.has(id) || pending.has(id)) continue;
        if (!ctx.cfg.WORLD_ANYWHERE || capReached(ipHash)) { if (id === own) capped = true; continue; }
        start(id, ipHash);
      }
      const source = w.parisRegions.has(own) ? 'paris' : w.regions.get(own) ?? null;
      const status = source ? 'ready' : pending.has(own) ? 'scouting' : capped ? 'capped' : 'scouting';
      return { status, source, ids };
    },
    idle: async () => {
      // la file peut s'allonger pendant l'attente
      for (let q = queue; ; q = queue) { await q; if (q === queue) return; }
    },
  };
}
