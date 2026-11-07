// `npm run shots` : lance tous les parcours e2e (qui capturent l'écran à chaque étape clé) puis copie
// une sélection dans docs-assets/shots/ (README, vidéo, post X).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
const PICK = [
  '01-splash', '02-map', 'catch-01-lock-on', '03-catch-result', '04-relay', '05-merchant-why', 'market-02-quote',
  'market-04-closing', 'forge-02-ready', '07-credit-ticket', '08-playground', 'lab-01-flood', 'pulse-02-ticker',
  'scout-01-splash', 'scout-02-hud', 'scout-03-grounded', 'anywhere-01-scouting', 'anywhere-02-lisbon-live',
];
mkdirSync('docs-assets/shots', { recursive: true });
let n = 0;
for (const name of PICK) {
  const src = `e2e/__shots__/${name}.png`;
  if (existsSync(src)) { copyFileSync(src, `docs-assets/shots/${name}.png`); n++; }
  else console.warn(`missing ${src}`);
}
console.log(`✔ ${n} screenshots → docs-assets/shots/`);
