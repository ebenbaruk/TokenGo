// Décodage « Next token » (Docs/13 §3) : intégrité de la banque, déterminisme, délai, ids opaques.
import { describe, expect, it } from 'vitest';
import { FAMILIES } from '../types.ts';
import { rngFrom } from '../rng.ts';
import { DECODE_BANK } from '../decode-bank.ts';
import { DECODE } from './rules.ts';
import { decodePublic, decodeRequired, decodeTimeMs, judgeDecode, pickDecode } from './decode.ts';

describe('decode bank', () => {
  it('has ≥ 15 questions per family, each with a blank, 1 answer and 2 distinct wrong tokens', () => {
    for (const f of FAMILIES) {
      const bank = DECODE_BANK[f];
      expect(bank.length, f).toBeGreaterThanOrEqual(15);
      for (const q of bank) {
        expect(q.prompt, q.prompt).toContain('___');
        const all = [q.answer, ...q.wrong].map((t) => t.trim().toLowerCase());
        expect(new Set(all).size, q.prompt).toBe(3);
        expect(all.every((t) => t.length > 0 && t.length <= 14), q.prompt).toBe(true); // tient dans un gros bouton
        expect(q.prompt.length, q.prompt).toBeLessThanOrEqual(60);                     // lisible en 1 s
      }
      expect(new Set(bank.map((q) => q.prompt)).size, `${f}: duplicate prompts`).toBe(bank.length);
    }
  });
  it('no prompt is shared between families', () => {
    const all = FAMILIES.flatMap((f) => DECODE_BANK[f].map((q) => q.prompt));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('pickDecode', () => {
  it('is deterministic for a seed and the correct choice is present', () => {
    for (const f of FAMILIES) {
      for (let i = 0; i < 40; i++) {
        const a = pickDecode(f, rngFrom('s', 'decode', f, i));
        const b = pickDecode(f, rngFrom('s', 'decode', f, i));
        expect(a).toEqual(b);
        expect(a.choices).toHaveLength(DECODE.choices);
        expect(new Set(a.choices.map((c) => c.id)).size).toBe(3);
        const q = DECODE_BANK[f].find((x) => x.prompt === a.prompt)!;
        expect(a.choices.find((c) => c.id === a.correctId)!.text).toBe(q.answer);
        expect(a.timeMs).toBe(decodeTimeMs(f));
      }
    }
  });
  it('varies with the seed (question and order)', () => {
    const prompts = new Set<string>();
    const firstIsAnswer: boolean[] = [];
    for (let i = 0; i < 200; i++) {
      const ch = pickDecode('gpt', rngFrom('s', i));
      prompts.add(ch.prompt);
      firstIsAnswer.push(ch.choices[0]!.id === ch.correctId);
    }
    expect(prompts.size).toBeGreaterThan(10);
    const share = firstIsAnswer.filter(Boolean).length / firstIsAnswer.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.5);
  });
  it('opaque ids do not leak the answer: no ordering, no pattern, public view has no answer', () => {
    let correctIsSmallest = 0;
    for (let i = 0; i < 300; i++) {
      const ch = pickDecode('claude', rngFrom('k', i));
      for (const c of ch.choices) expect(c.id).toMatch(/^[0-9a-z]{8}$/);
      if ([...ch.choices].sort((x, y) => x.id.localeCompare(y.id))[0]!.id === ch.correctId) correctIsSmallest++;
      const pub = decodePublic(ch);
      expect(JSON.stringify(pub)).not.toMatch(/correct|answer/i);
      expect(Object.keys(pub).sort()).toEqual(['choices', 'deadlineMs', 'prompt']);
      expect(pub.choices.every((c) => Object.keys(c).sort().join() === 'id,text')).toBe(true);
    }
    // l'ordre alphabétique des ids ne dit rien (≈ 1/3)
    expect(correctIsSmallest / 300).toBeGreaterThan(0.22);
    expect(correctIsSmallest / 300).toBeLessThan(0.45);
  });
});

describe('judgeDecode', () => {
  const ch = pickDecode('gpt', rngFrom('s', 'judge'));
  const wrong = ch.choices.find((c) => c.id !== ch.correctId)!.id;
  it('right token in time → correct; wrong token → wrong', () => {
    expect(judgeDecode(ch, ch.correctId, 1200)).toBe('correct');
    expect(judgeDecode(ch, wrong, 1200)).toBe('wrong');
  });
  it('network grace: up to time + 1 s is accepted, beyond is late (even the right token)', () => {
    expect(judgeDecode(ch, ch.correctId, ch.timeMs + DECODE.networkGraceMs)).toBe('correct');
    expect(judgeDecode(ch, ch.correctId, ch.timeMs + DECODE.networkGraceMs + 1)).toBe('late');
    expect(judgeDecode(ch, wrong, ch.timeMs + 5000)).toBe('late');
  });
  it('null choice (client timer ran out) or a broken clock is late', () => {
    expect(judgeDecode(ch, null, 100)).toBe('late');
    expect(judgeDecode(ch, ch.correctId, Number.NaN)).toBe('late');
  });
  it('rules: rare/epic are required, epic gets 5 s', () => {
    expect(decodeRequired('gpt')).toBe(true);
    expect(decodeRequired('claude')).toBe(true);
    expect(decodeRequired('deepseek')).toBe(false);
    expect(decodeRequired('gemini')).toBe(false);
    expect(decodeTimeMs('claude')).toBe(5000);
    expect(decodeTimeMs('gpt')).toBe(4000);
  });
});
