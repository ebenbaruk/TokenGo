// Missions du jour (Docs/13 §7) : coffre du jour fermé / ouvert (grilles texte, palette Sweetie 16, contour encre auto).
// Ouvert : le couvercle est basculé derrière, un tas de pièces d'or dépasse, étincelles au-dessus.
import type { SpriteDef } from './engine.ts';

const CLOSED = `
................
................
..rrrrrrrrrrrr..
.roooooooooooor.
.roooooooooooor.
.yyyyyyyyyyyyyy.
.rooooyNNyoooor.
.rooooyyyyoooor.
.roooooooooooor.
.ryooooooooooyr.
.rrrrrrrrrrrrrr.
................
`;
const OPEN = `
................
..+....*....+...
....y..W..y.....
...yyWyyyyyWy...
..yyyyyyyyyyyy..
.rrrrrrrrrrrrrr.
.roooooooooooor.
.yyyyyyyyyyyyyy.
.rooooyNNyoooor.
.rooooyyyyoooor.
.ryooooooooooyr.
.rrrrrrrrrrrrrr.
................
`;
const OPEN_2 = OPEN.replace('..+....*....+...', '.*....+....*....');

export const CHEST: SpriteDef = { frames: [CLOSED], outline: true };
export const CHEST_OPEN: SpriteDef = { frames: [OPEN, OPEN_2], outline: true, fps: 3 };
