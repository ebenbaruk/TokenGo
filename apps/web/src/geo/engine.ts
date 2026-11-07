// Boucle de position : GPS (watchPosition filtré + lissé) ou Remote Scout (pigeon-drone piloté au tap : vol à 30 km/h,
// Dash 3 s, batterie vérifiée par le serveur), envoi throttlé à POST /api/move, rafraîchissement du monde et des marcheurs.
import { haversineM, scoutCharge, scoutCost, LIVING, MOVE, SCOUT, WORLD_GEN, type LatLng, type ScoutState, type RouteCheckin, type WorldResponse } from '@tokengo/shared';
import { api, ApiFail } from '../lib/api.ts';
import { useGame, setMe, toast, celebrate, rebaseScout, type Pos } from '../lib/store.ts';
import { buzz, feedback, play } from '../lib/sound.ts';

export const LOUVRE: LatLng = { lat: 48.8611, lng: 2.3358 };
const SEND_EVERY_MS = 3000;
const SEND_MIN_M = 5;
const SEND_IDLE_MS = 15_000;
const WORLD_EVERY_MS = 12_000;
const WORLD_MOVE_M = 40;

let lastSent: { p: Pos; at: number } | null = null;
let lastWorld: { p: LatLng; at: number } | null = null;
let scoutingTimer = 0;
let upgradeTimer = 0;
let worldInflight = false;
let gpsWatch: number | null = null;
let timers: number[] = [];
const recentFixes: Pos[] = [];

// ───────── Monde ─────────
export async function refreshWorld(force = false): Promise<void> {
  const { pos } = useGame.getState();
  if (!pos || worldInflight) return;
  if (!force && lastWorld && Date.now() - lastWorld.at < WORLD_EVERY_MS && haversineM(lastWorld.p, pos) < WORLD_MOVE_M) return;
  worldInflight = true;
  try {
    const world = await api.world(pos.lat, pos.lng);
    lastWorld = { p: { lat: pos.lat, lng: pos.lng }, at: Date.now() };
    const visible = new Set(world.spawns.map((s) => s.id));
    const prev = useGame.getState().world?.region;
    const before = prev?.status;
    useGame.setState({ world, serverDown: false, hiddenSpawns: useGame.getState().hiddenSpawns.filter((id) => visible.has(id)) });
    // monde « partout » : quartier en cours de repérage → on réinterroge vite ; annonce quand il est prêt
    if (world.region?.status === 'scouting') { clearTimeout(scoutingTimer); scoutingTimer = window.setTimeout(() => void refreshWorld(true), 1500); }
    const n = (k: string) => world.nodes.filter((x) => x.kind === k).length;
    if (before === 'scouting' && world.region?.status === 'ready') {
      toast(`Your neighbourhood is live · ${n('relay')} relays · ${n('market')} merchants${n('forge') ? ' · a Forge' : ''}`, 'good', 'xp', 4000);
    }
    // quartier procédural en attente de la vraie carte : on réinterroge plus lentement ; annonce quand OSM l'a remplacé
    if (world.region?.upgrading) { clearTimeout(upgradeTimer); upgradeTimer = window.setTimeout(() => void refreshWorld(true), WORLD_GEN.upgradePollMs); }
    if (prev?.source === 'procedural' && world.region?.source === 'osm' && prev.ids[0] === world.region.ids[0]) {
      toast(`Real map loaded · ${n('relay')} relays · ${n('market')} merchants from OpenStreetMap`, 'good', 'xp', 4000);
    }
    announceEvent(world);
  } catch (e) {
    if (e instanceof ApiFail && e.code === 'NETWORK') useGame.setState({ serverDown: true });
  } finally {
    worldInflight = false;
  }
}

/** Annonce sonore une seule fois par événement de ville. */
let announcedEvent = 0;
function announceEvent(world: WorldResponse): void {
  const e = world.event;
  if (!e || e.id === announcedEvent) return;
  const pos = useGame.getState().pos;
  if (pos && haversineM(pos, e) > LIVING.eventFarM) return; // autre ville : pas de jingle
  announcedEvent = e.id;
  // pas de toast : la bannière du HUD (qui tombe avec un rebond) porte l'annonce ; juste un jingle et une vibration
  play('event');
  buzz([40, 60, 40]);
}

// ───────── Marcheurs (carte vivante) ─────────
let walkersInflight = false;
export async function refreshWalkers(): Promise<void> {
  const { pos, phase } = useGame.getState();
  if (!pos || phase !== 'play' || walkersInflight || document.visibilityState === 'hidden') return;
  walkersInflight = true;
  try {
    const r = await api.walkers(pos.lat, pos.lng);
    useGame.setState({ walkers: r.walkers, skewMs: r.now - Date.now() });
  } catch { /* la carte garde les marcheurs précédents */ } finally {
    walkersInflight = false;
  }
}

export async function refreshMe(): Promise<void> {
  try { setMe(await api.me()); } catch { /* ignoré */ }
}

// ───────── Envoi de position ─────────
async function maybeSend(p: Pos, force = false): Promise<void> {
  const now = Date.now();
  if (!force && lastSent) {
    if (now - lastSent.at < SEND_EVERY_MS) return;
    if (haversineM(lastSent.p, p) < SEND_MIN_M && now - lastSent.at < SEND_IDLE_MS) return;
  }
  lastSent = { p, at: now };
  try {
    const r = await api.move({ lat: p.lat, lng: p.lng, acc: Math.round(p.acc), heading: p.heading });
    if (r.scout) useGame.setState({ scout: rebaseScout(r.scout) });
    if (r.refused) {
      // le serveur a refusé ce vol : le Scout reste à sa dernière position acceptée
      stopWalk();
      if (r.at) { const back = { ...r.at, acc: 5, t: Date.now() }; lastSent = { p: back, at: now }; useGame.setState({ pos: back }); }
      if (Date.now() - lastRefusalToast > 4000) {
        lastRefusalToast = Date.now();
        toast(r.refused === 'BATTERY_EMPTY' ? 'Battery empty — your scout is recharging.' : 'Too far for one dash — fly there instead.', 'bad');
      }
      return;
    }
    const was = useGame.getState().inTransit;
    if (r.inTransit !== was) useGame.setState({ inTransit: r.inTransit });
    if (r.suspicious) toast('Re-syncing your position…', 'info');
    const me = useGame.getState().me;
    if (me && me.walkedM !== r.walkedM) useGame.setState({ me: { ...me, walkedM: r.walkedM } });
    if (r.route) onRouteCheckin(r.route);
  } catch (e) {
    if (e instanceof ApiFail && e.code === 'NETWORK') useGame.setState({ serverDown: true });
  }
  void refreshWorld();
}

/** Arrêt(s) de la Daily Route validé(s) par le serveur : coche locale immédiate, son, puis fête si la route est finie. */
function onRouteCheckin(c: RouteCheckin): void {
  const { world } = useGame.getState();
  if (world?.route) {
    const done = new Set([...world.route.stops.filter((s) => s.done).map((s) => s.id), ...c.stopIds]);
    useGame.setState({ world: { ...world, route: { ...world.route, stops: world.route.stops.map((s) => ({ ...s, done: done.has(s.id) })), done: c.done, completedAt: c.completed ? Date.now() : null, streak: c.streak } } });
  }
  if (c.completed) {
    if (c.me) setMe(c.me, c.levelUp);
    feedback('route', 'route');
    celebrate({ kind: 'route', checkin: c });
  } else {
    const name = world?.route?.stops.find((s) => s.id === c.stopIds[0])?.name ?? 'Stop';
    feedback('stop', 'stop');
    toast(`Daily Route ${c.done}/${c.total} · ${name} ✓`, 'good', 'xp');
  }
}

let lastRefusalToast = 0;

/** Batterie du Scout à cet instant (prédiction locale ; le serveur reste autoritaire). */
export function scoutNow(): ScoutState | null {
  const s = useGame.getState().scout;
  return s ? scoutCharge(s, Date.now()) : null;
}

/** Coût d'un Dash vers `target` (null si pas de Scout) et s'il est possible maintenant. */
export function dashCost(target: LatLng): { cost: number; ok: boolean; tooFar: boolean } | null {
  const { pos } = useGame.getState();
  const sc = scoutNow();
  if (!pos || !sc) return null;
  const d = haversineM(pos, target);
  const cost = scoutCost(d, true);
  const tooFar = d > SCOUT.dashMaxM;
  return { cost, ok: !tooFar && !sc.grounded && cost <= sc.battery, tooFar };
}

function setPos(p: Pos, force = false): void {
  useGame.setState({ pos: p });
  void maybeSend(p, force);
}

// ───────── GPS ─────────
/** Moyenne pondérée par la précision des 3 derniers fixes (Docs/04 §7). */
function smooth(fix: Pos): Pos {
  recentFixes.push(fix);
  if (recentFixes.length > 3) recentFixes.shift();
  let w = 0; let lat = 0; let lng = 0;
  for (const f of recentFixes) { const k = 1 / Math.max(1, f.acc) ** 2; w += k; lat += f.lat * k; lng += f.lng * k; }
  return { ...fix, lat: lat / w, lng: lng / w };
}

export function startGps(): void {
  if (gpsWatch !== null || !navigator.geolocation) return;
  gpsWatch = navigator.geolocation.watchPosition(
    (g) => {
      const acc = g.coords.accuracy;
      if (acc > MOVE.ignoreAccuracyAboveM) { useGame.setState({ gps: 'weak' }); return; }
      useGame.setState({ gps: 'ok' });
      const heading = g.coords.heading !== null && !Number.isNaN(g.coords.heading) ? g.coords.heading : undefined;
      setPos(smooth({ lat: g.coords.latitude, lng: g.coords.longitude, acc, heading, t: Date.now() }), !lastSent);
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) { stopGps(); switchToDemo('Location is off — switched to Remote Scout.'); }
      else useGame.setState({ gps: 'weak' });
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
  );
}
function stopGps(): void {
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
}

/** Demande la position une fois (dans le geste utilisateur) ; null si refus/indisponible. */
export function probeGps(timeoutMs = 7000): Promise<LatLng | null> {
  if (!navigator.geolocation || !window.isSecureContext) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (g) => { clearTimeout(t); resolve({ lat: g.coords.latitude, lng: g.coords.longitude }); },
      () => { clearTimeout(t); resolve(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10_000 },
    );
  });
}

// ───────── Remote Scout ─────────
let walkRaf = 0;
export function switchToDemo(msg?: string): void {
  useGame.setState({ demo: true, gps: 'demo' });
  // le Scout repart d'où il s'était posé (sinon de la base : la Pyramide du Louvre)
  const last = useGame.getState().me?.scout?.last;
  if (!useGame.getState().pos) setPos({ ...(last ?? LOUVRE), acc: 5, t: Date.now() }, true);
  if (msg) toast(msg, 'info');
}

/** Vol (30 km/h) ou Dash animé (durationMs fixé) vers une cible ; positions envoyées comme du GPS. */
export function walkTo(target: LatLng, durationMs?: number): void {
  const start = useGame.getState().pos;
  if (!start) return;
  if (useGame.getState().demo && scoutNow()?.grounded) {
    if (Date.now() - lastRefusalToast > 2500) { lastRefusalToast = Date.now(); toast('Battery empty — your scout is recharging.', 'bad'); }
    return;
  }
  cancelAnimationFrame(walkRaf);
  const dist = haversineM(start, target);
  const dur = durationMs ?? (dist / ((SCOUT.cruiseKmh * 1000) / 3600)) * 1000;
  const heading = bearing(start, target);
  const t0 = performance.now();
  useGame.setState({ walkTarget: target });
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / Math.max(1, dur));
    const e = durationMs ? easeInOut(k) : k;
    const p: Pos = { lat: start.lat + (target.lat - start.lat) * e, lng: start.lng + (target.lng - start.lng) * e, acc: 5, heading, t: Date.now() };
    useGame.setState({ pos: p });
    void maybeSend(p, k >= 1);
    if (k < 1) walkRaf = requestAnimationFrame(step);
    else useGame.setState({ walkTarget: null });
  };
  walkRaf = requestAnimationFrame(step);
}
export function stopWalk(): void { cancelAnimationFrame(walkRaf); useGame.setState({ walkTarget: null }); }

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
function bearing(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

// ───────── Démarrage ─────────
export function startPlay(opts: { demo: boolean; start?: LatLng | null }): void {
  timers.forEach((t) => clearInterval(t));
  timers = [];
  if (opts.demo) switchToDemo();
  else {
    useGame.setState({ demo: false, gps: 'pending' });
    if (opts.start) setPos({ ...opts.start, acc: 30, t: Date.now() }, true);
    startGps();
  }
  timers.push(window.setInterval(() => void refreshWorld(), 4000));
  timers.push(window.setInterval(() => void refreshWalkers(), 6000));
  window.setTimeout(() => void refreshWalkers(), 800);
  timers.push(window.setInterval(() => {
    // re-sync idle : le serveur veut une position récente (< 30 s)
    const p = useGame.getState().pos;
    if (p) void maybeSend({ ...p, t: Date.now() });
  }, SEND_IDLE_MS));
  startUserStream();
  // Wake Lock pendant le jeu
  const wl = async () => { try { await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* */ } };
  void wl();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void wl(); });
}

// ───────── Flux temps réel du joueur (SSE /api/stream) ─────────
let userStream: EventSource | null = null;
function startUserStream(): void {
  if (userStream || typeof EventSource === 'undefined') return;
  userStream = new EventSource('/api/stream');
  userStream.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data as string) as { kind: string; text: string };
      if (e.kind === 'grant.done') { toast(e.text, 'good', 'xp', 4000); void refreshMe(); }
      // événement de ville (partagé) : nouveau monde tout de suite (zone, prix, éclats bonus, bannière)
      if (e.kind === 'city.event' || e.kind === 'city.event.end') void refreshWorld(true);
    } catch { /* ping */ }
  };
}
