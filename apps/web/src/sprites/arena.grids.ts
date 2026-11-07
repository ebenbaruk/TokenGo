// Arène (Docs/13 §4) : couronne du Champion, bouclier du Gardien (grilles texte, palette Sweetie 16, contour encre auto).
import type { SpriteDef } from './engine.ts';

const CROWN_GRIDS = [`
...................
..y......y......y..
.yWy....yWy....yWy.
..y......y......y..
..yy....yyy....yy..
..yyy..yyyyy..yyy..
..yyyyyyyyyyyyyyy..
..yyrryyysyyyrryy..
..yyyyyyyyyyyyyyy..
..ooooooooooooooo..
...................
`, `
...................
..y......W......y..
.yWy....yWy....yWy.
..y......y......y..
..yy....yyy....yy..
..yyy..yyyyy..yyy..
..yyyyyyyyyyyyyyy..
..yyrryyysyyyrryy..
..yyyyyyyyyyyyyyy..
..ooooooooooooooo..
...................
`];

const SHIELD_GRIDS = [`
...............
.bbbbbbbbbbbbb.
.bssssyyyssssb.
.bsWssyyyssssb.
.bsWssyyyssssb.
.byyyyyyyyyyyb.
.byyyyyyyyyyyb.
.bssssyyyssssb.
.bssssyyyssssb.
..bsssyyysssb..
...bssyyyssb...
....bsyyysb....
.....bsysb.....
......bbb......
...............
`];

export const CROWN: SpriteDef = { frames: CROWN_GRIDS, outline: true, fps: 2 };
export const SHIELD: SpriteDef = { frames: SHIELD_GRIDS, outline: true };
