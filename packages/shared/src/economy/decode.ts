// Décodage « Next token » (Docs/13 §3) : tirage de la question, mélange des choix avec ids opaques, verdict.
// Fonctions pures. Importé par le serveur via '@tokengo/shared/economy/decode.ts' (pas par l'index du paquet :
// la banque et la bonne réponse ne doivent pas partir dans le bundle du jeu).
import type { Family } from '../types.ts';
import type { Rng } from '../rng.ts';
import { DECODE_BANK } from '../decode-bank.ts';
import { DECODE, FAMILY_INFO } from './rules.ts';

export interface DecodeChoice { id: string; text: string }
/** Question tirée, côté serveur : `correctId` ne quitte jamais le serveur avant la réponse. */
export interface DecodeChallenge {
  family: Family;
  prompt: string;
  choices: DecodeChoice[];
  correctId: string;
  timeMs: number;
}
export type DecodeVerdict = 'correct' | 'wrong' | 'late';

export const decodeTimeMs = (f: Family): number => DECODE.timeMs[FAMILY_INFO[f].rarity];
export const decodeRequired = (f: Family): boolean => DECODE.required[FAMILY_INFO[f].rarity];

/** Id opaque de 8 caractères base 36 tiré du rng (graine HMAC secrète : imprévisible côté client). */
function opaqueId(rng: Rng): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(rng() * 36).toString(36);
  return s;
}

/**
 * Tire une question de la banque de la famille, mélange les 3 jetons (Fisher–Yates) et leur donne des ids opaques.
 * Déterministe pour un rng donné (graine = HMAC(spawn, joueur, essai) côté serveur).
 */
export function pickDecode(f: Family, rng: Rng): DecodeChallenge {
  const bank = DECODE_BANK[f];
  const qn = bank[Math.floor(rng() * bank.length)]!;
  const texts = [qn.answer, ...qn.wrong];
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [texts[i], texts[j]] = [texts[j]!, texts[i]!];
  }
  const ids = new Set<string>();
  const choices = texts.map((text) => {
    let id = opaqueId(rng);
    while (ids.has(id)) id = opaqueId(rng);
    ids.add(id);
    return { id, text };
  });
  return { family: f, prompt: qn.prompt, choices, correctId: choices.find((c) => c.text === qn.answer)!.id, timeMs: decodeTimeMs(f) };
}

/** Verdict : bon jeton dans le délai (+ tolérance réseau). `choiceId` null = temps écoulé côté client. */
export function judgeDecode(ch: DecodeChallenge, choiceId: string | null, elapsedMs: number): DecodeVerdict {
  if (choiceId === null || !Number.isFinite(elapsedMs) || elapsedMs > ch.timeMs + DECODE.networkGraceMs) return 'late';
  return choiceId === ch.correctId ? 'correct' : 'wrong';
}

/** Ce que voit le client : texte + choix mélangés, sans la réponse. */
export const decodePublic = (ch: DecodeChallenge) => ({
  prompt: ch.prompt, choices: ch.choices.map((c) => ({ id: c.id, text: c.text })), deadlineMs: ch.timeMs,
});
