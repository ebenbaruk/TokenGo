// CLI du simulateur : npm run sim -- --days 7 --players 200 --scenario flood-deepseek --seed 42 [--json out.json] [--override '{"RELAY":{"fluxMax":6}}']
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FAMILIES } from '../types.ts';
import { FAMILY_INFO, formatUsd } from './index.ts';
import { SCENARIOS, simulate, type Scenario, type WorldLike } from './sim.ts';

const args = process.argv.slice(2);
const flag = (name: string, def?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const days = Number(flag('days', '7'));
const players = Number(flag('players', '200'));
const seed = Number(flag('seed', '42'));
const scenario = flag('scenario', 'baseline') as Scenario;
const jsonOut = flag('json');
const override = flag('override');
const botOverride = flag('bot');
if (!SCENARIOS.includes(scenario)) {
  console.error(`Unknown scenario "${scenario}". Use one of: ${SCENARIOS.join(', ')}`);
  process.exit(1);
}

const worldPath = fileURLToPath(new URL('../../../../data/world/paris.json', import.meta.url));
const world = JSON.parse(readFileSync(worldPath, 'utf8')) as WorldLike;

const t0 = performance.now();
const r = simulate({
  world, days, players, seed, scenario,
  ...(override ? { rulesOverride: JSON.parse(override) } : {}),
  ...(botOverride ? { bot: JSON.parse(botOverride) } : {}),
});
const ms = performance.now() - t0;

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
const last = r.series[r.series.length - 1]!;
const first = r.series[0]!;

console.log(`\nTokenGo economy sim — scenario ${scenario}, ${days} d × ${players} bots, seed ${seed}  (${(ms / 1000).toFixed(2)} s)`);
console.log(`Mix: ${Object.entries(r.mix).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${Math.round(v * 100)} %`).join(', ')} · ${r.merchants} merchants`);
if (override) console.log(`Rules override: ${override}`);

console.log('\nHealth checks (Docs/03 §8)');
for (const h of r.health) console.log(`  ${h.pass ? '✔' : '✖'} ${pad(h.name, 42)} ${pad(h.display, 34)} target ${h.target}`);

console.log('\nPrices         P0 start → end      avg mid end   median mid end');
for (const f of FAMILIES) {
  console.log(`  ${pad(FAMILY_INFO[f].name, 10)} ${lpad(first.p0[f].toFixed(1), 6)} → ${pad(last.p0[f].toFixed(1), 10)} ${lpad(last.avgMid[f].toFixed(1), 10)} ${lpad(last.medianMid[f].toFixed(1), 14)}`);
}

const t = r.totals;
const count = (k: string) => r.events.filter((e) => e.kind === k).length;
console.log('\nFlux');
console.log(`  players  ${first.fluxPlayers} → ${last.fluxPlayers}   (daily: ${r.fluxPlayersDaily.join(' · ')})`);
console.log(`  merchants ${first.fluxMerchants} → ${last.fluxMerchants}`);
console.log(`  sources: relays ${t.relayFlux} · sales to merchants ${t.fluxPaidByMerchants} · contracts ${t.contractRewards}`);
console.log(`  sinks:   forge fees ${t.feesBurned} · buys from merchants ${t.fluxPaidToMerchants} · rescues ${t.rescueFlux} · merchant imports ${t.importFlux} · rent ${t.rent}`);
console.log(`  shards:  caught ${t.catches} · sold ${t.shardsSold} · bought ${t.shardsBought} · burned ${t.shardsBurned} · exported ${t.exports} (+${t.exportFlux} ƒ to merchants)`);

console.log('\nMerchants');
console.log(`  end: ${last.open} open · ${last.closing} closing · ${last.closed} closed   seeded struggler: ${r.seededStruggler ?? '—'}`);
console.log(`  events: ${count('closing')} closing · ${count('closed')} closed · ${count('reopened')} reopened · ${count('rescued')} rescues · contracts delivered ${t.contractsDelivered}`);

console.log('\nReal credits (Main pool)');
console.log(`  compiles ${t.compiles} (paid ${t.compilesPaid}) · payouts ${formatUsd(t.payouts)} · pool ${formatUsd(first.mainPoolAvail)} → ${formatUsd(last.mainPoolAvail)} · health ${last.reserveHealth.toFixed(2)}`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(r));
  console.log(`\nJSON → ${jsonOut}`);
}
console.log('');
