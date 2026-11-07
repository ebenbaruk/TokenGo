// Carte vivante : trajets, vie privée (snapping H3 + décalage), bulles des marchands (déterministes, max 3).
import { describe, expect, it } from 'vitest';
import { cellToLatLng, latLngToCell } from 'h3-js';
import {
  H3_RES, LIVING, anonymisedPosition, createMerchant, haversineM, legPosition, makeCityEvent, merchantBubble, offsetM, pickBubbles,
  type BubbleCandidate, type MerchantState,
} from './index.ts';

const SECRET = 'test-secret';
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const LOUVRE = { lat: 48.8611, lng: 2.3358 };

describe('legPosition', () => {
  const leg = { from: LOUVRE, to: offsetM(LOUVRE, 300, 0), departAt: T0, arriveAt: T0 + 216_000 }; // 300 m à 5 km/h
  it('interpolates linearly and clamps at both ends', () => {
    expect(haversineM(legPosition(leg, T0 - 5000), LOUVRE)).toBeLessThan(0.01);
    expect(haversineM(legPosition(leg, T0 + 108_000), LOUVRE)).toBeCloseTo(150, 0);
    expect(legPosition(leg, T0 + 108_000).moving).toBe(true);
    const end = legPosition(leg, T0 + 999_999);
    expect(end.moving).toBe(false);
    expect(haversineM(end, leg.to)).toBeLessThan(0.01);
    expect(legPosition(leg, T0).heading).toBeCloseTo(90, 0); // vers l'est
  });
});

describe('anonymisedPosition (privacy)', () => {
  it('depends only on the H3 cell: two exact positions in the same cell publish the same point', () => {
    const a = offsetM(LOUVRE, 10, 5);
    const cell = latLngToCell(a.lat, a.lng, H3_RES);
    const [clat, clng] = cellToLatLng(cell);
    const b = offsetM({ lat: clat, lng: clng }, -20, 15);
    expect(latLngToCell(b.lat, b.lng, H3_RES)).toBe(cell);
    const pa = anonymisedPosition(SECRET, 'u1', latLngToCell(a.lat, a.lng, H3_RES), T0);
    const pb = anonymisedPosition(SECRET, 'u1', latLngToCell(b.lat, b.lng, H3_RES), T0);
    expect(pa).toEqual(pb);
  });

  it('stays within the jitter radius of the cell centre, stable for 10 min, then moves', () => {
    const cell = latLngToCell(LOUVRE.lat, LOUVRE.lng, H3_RES);
    const [lat, lng] = cellToLatLng(cell);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const p = anonymisedPosition(SECRET, `u${i}`, cell, T0);
      expect(haversineM(p, { lat, lng })).toBeLessThanOrEqual(LIVING.playerJitterM + 2);
      seen.add(`${p.lat},${p.lng}`);
    }
    expect(seen.size).toBeGreaterThan(10); // deux joueurs dans la même cellule ne s'empilent pas
    expect(anonymisedPosition(SECRET, 'u1', cell, T0)).toEqual(anonymisedPosition(SECRET, 'u1', cell, T0 + 60_000));
    const later = Math.ceil((T0 + 1) / LIVING.privacyWindowMs) * LIVING.privacyWindowMs + 1;
    expect(anonymisedPosition(SECRET, 'u1', cell, later)).not.toEqual(anonymisedPosition(SECRET, 'u1', cell, T0));
    // pas plus de 5 décimales (≈ 1 m) : rien qui ressemble à une position GPS brute
    const p = anonymisedPosition(SECRET, 'u1', cell, T0);
    expect(Math.round(p.lat * 1e5) / 1e5).toBe(p.lat);
  });
});

describe('merchantBubble', () => {
  const base = (patch: Partial<MerchantState> = {}): MerchantState => ({ ...createMerchant(SECRET, 'osm:node/1', ['gpt']), contract: null, ...patch });
  const pos = LOUVRE;

  it('closing / closed merchants call for help', () => {
    expect(merchantBubble(base({ status: 'closing' }), T0, { pos })).toMatchObject({ tone: 'help', prio: 5 });
    expect(merchantBubble(base({ status: 'closed' }), T0, { pos })!.text).toMatch(/investor|empty|Rescue/);
  });

  it('a recently reopened merchant thanks its patrons (3 h)', () => {
    expect(merchantBubble(base(), T0, { pos, reopenedAt: T0 - 3600_000 })).toMatchObject({ tone: 'thanks' });
    expect(merchantBubble(base(), T0, { pos, reopenedAt: T0 - 4 * 3600_000 })?.tone).not.toBe('thanks');
  });

  it('over-stocked → selling cheap; under-stocked → buying at top price; balanced → silent', () => {
    const m = base();
    const flat = { ...m, stock: Object.fromEntries(Object.entries(m.baseTarget).map(([f, t]) => [f, Math.round(t * m.targetMult[f as keyof typeof m.targetMult])])) as MerchantState['stock'] };
    expect(merchantBubble(flat, T0, { pos })).toBeNull();
    const cheap = merchantBubble({ ...flat, stock: { ...flat.stock, qwen: flat.stock.qwen * 4 } }, T0, { pos })!;
    expect(cheap).toMatchObject({ tone: 'deal', family: 'qwen' });
    expect(cheap.text).toContain('Qwen');
    const dear = merchantBubble({ ...flat, stock: { ...flat.stock, gemini: 0 } }, T0, { pos })!;
    expect(dear).toMatchObject({ tone: 'buy', family: 'gemini' });
  });

  it('contracts and city events speak first, with the real numbers', () => {
    const c = merchantBubble(base({ contract: { id: 'c', family: 'gpt', qty: 3, reward: 160, expiresAt: T0 + 3600_000 } }), T0, { pos })!;
    expect(c.tone).toBe('contract');
    expect(c.text).toMatch(/3 GPT/);
    const crash = makeCityEvent(1, { kind: 'flash_crash', family: 'deepseek', zone: 'louvre', startsAt: T0 });
    const e = merchantBubble(base(), T0 + 1000, { pos, event: crash })!;
    expect(e).toMatchObject({ tone: 'event', family: 'deepseek' });
    expect(e.text).toMatch(/DeepSeek/);
    // hors zone : l'événement ne le concerne pas
    expect(merchantBubble(base(), T0 + 1000, { pos: offsetM(pos, 3000, 0), event: crash })?.tone).not.toBe('event');
    const strike = makeCityEvent(2, { kind: 'strike', zone: 'louvre', startsAt: T0 });
    expect(merchantBubble(base(), T0 + 1000, { pos, event: strike })!.text).toMatch(/strike|sales|buy/i);
  });

  it('wording is deterministic within 10 min and varies across merchants', () => {
    const m = base({ status: 'closing' });
    expect(merchantBubble(m, T0, { pos })).toEqual(merchantBubble(m, T0 + 60_000, { pos }));
    const texts = new Set(Array.from({ length: 12 }, (_, i) => merchantBubble({ ...m, id: `m-${i}` }, T0, { pos })!.text));
    expect(texts.size).toBeGreaterThan(1);
  });
});

describe('pickBubbles', () => {
  const cand = (id: string, dx: number, prio: number): BubbleCandidate => ({ id, ...offsetM(LOUVRE, dx, 0), bubble: { text: id, tone: 'deal', prio } });

  it('never more than 3, only within 400 m, urgent ones always shown', () => {
    const cs = [cand('a', 50, 2), cand('b', 100, 2), cand('c', 150, 2), cand('d', 200, 2), cand('e', 250, 2), cand('help', 380, 5), cand('far', 900, 5)];
    for (let t = 0; t < 10; t++) {
      const out = pickBubbles(cs, LOUVRE, T0 + t * LIVING.bubbleSlotMs);
      expect(out.length).toBe(3);
      expect(out.map((x) => x.id)).toContain('help');
      expect(out.map((x) => x.id)).not.toContain('far');
    }
  });

  it('rotates the others over time so each merchant gets a turn', () => {
    const cs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => cand(id, 40 * (i + 1), 2));
    const seen = new Set<string>();
    for (let t = 0; t < 6; t++) for (const x of pickBubbles(cs, LOUVRE, T0 + t * LIVING.bubbleSlotMs)) seen.add(x.id);
    expect(seen.size).toBe(6);
    expect(pickBubbles(cs, LOUVRE, T0)).toEqual(pickBubbles(cs, LOUVRE, T0 + 1)); // stable dans un créneau
  });
});
