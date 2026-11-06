// Géométrie simple (pas de dépendance) + aides H3.
const R_EARTH = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export interface LatLng { lat: number; lng: number }

/** Distance en mètres (haversine). */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Point décalé de (dx est, dy nord) mètres — valable pour de petites distances. */
export function offsetM(p: LatLng, dxM: number, dyM: number): LatLng {
  return {
    lat: p.lat + dyM / 110_540,
    lng: p.lng + dxM / (111_320 * Math.cos(rad(p.lat))),
  };
}

/** Cap (0 = nord, sens horaire) de a vers b, en degrés. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
