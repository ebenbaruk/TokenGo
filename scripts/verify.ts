// `npm run verify` — what an AI judge runs: unit tests, typecheck, production build, headless e2e smoke. No secrets needed.
import { spawnSync } from 'node:child_process';

const steps: [string, string][] = [
  ['Unit tests (economy, anti-cheat, API, chain, NEAR AI)', 'npx vitest run'],
  ['Typecheck', 'npm run -s typecheck'],
  ['Production build', 'npm run -s build'],
  ['E2E smoke (Playwright, headless, mobile viewport)', 'npx playwright test --project=smoke'],
];
const env = { ...process.env, FEATURE_CHAIN: '0', FEATURE_REAL_CREDITS: '0' };
let unit = '?';
let e2e = '?';
for (const [label, cmd] of steps) {
  console.log(`\n▶ ${label}\n  $ ${cmd}`);
  const r = spawnSync(cmd, { shell: true, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const out = `${r.stdout}${r.stderr}`;
  process.stdout.write(out.split('\n').slice(-12).join('\n'));
  if (r.status !== 0) {
    console.error(`\n✖ ${label} failed`);
    process.exit(1);
  }
  unit = /Tests\s+(\d+) passed/.exec(out)?.[1] ?? unit;
  if (cmd.includes('playwright')) e2e = /(\d+) passed/.exec(out)?.[1] ?? e2e;
}
console.log(`\n✔ TokenGo verified: ${unit} unit tests, ${e2e} e2e flows, typecheck + build OK`);
