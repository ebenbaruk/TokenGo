import { FAMILY_INFO, NUSD_PER_USD, type Family } from '@tokengo/shared';

export const famName = (f: Family) => FAMILY_INFO[f].name;
export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
export const fmtFlux = (n: number) => `${fmtInt(n)} ƒ`;
/** Dollars depuis nano-USD, avec assez de chiffres pour les petits montants. */
export function fmtUsd(nusd: number, digits?: number): string {
  const usd = nusd / NUSD_PER_USD;
  const d = digits ?? (Math.abs(usd) < 1 ? 3 : 2);
  return `$${usd.toFixed(d)}`;
}
export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
export const fmtClock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const RARITY_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic' } as const;
/** Lien de preuve : URL telle quelle, sinon hash de tx testnet. */
export const txUrl = (tx: string) => (tx.startsWith('http') ? tx : `https://testnet.nearblocks.io/txns/${tx}`);
/** Durée courte « 2d 4h », « 3h 12m », « 8m » (missions, contrôle de la ville — Docs/13 §7–8). */
export function fmtSpan(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(mm).padStart(2, '0')}m` : `${Math.max(1, mm)}m`;
}
