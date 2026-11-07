import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { startJobs } from './jobs.ts';
import { createNpcBrain, npcKeyResolver } from './nearai/brain.ts';
import { nearAiPeriodic } from './nearai/jobs.ts';
import { nearAiCredits, type NearAiCredits } from './nearai/provider.ts';
import { PENDING_RETRY, retryPendingGrants } from './game/reserve.ts';
import { startRunners } from './game/runners.ts';

const cfg = loadConfig();
let real: NearAiCredits | undefined;
const { app, ctx, npc } = await buildApp(cfg, {
  ...(cfg.realCredits ? { credits: (db) => (real = nearAiCredits(cfg, db)) } : {}),
  // cerveau LLM : clé NPC fournie, ou créée une fois via la session NEAR AI ; sinon repli déterministe
  npc: (c) => (cfg.NEARAI_NPC_KEY || real ? createNpcBrain(c, { key: npcKeyResolver(c, real) }) : null),
});
const periodic = [
  // IOU (Docs/07 §2) : octrois « pending » rejoués toutes les 2 min
  { name: 'pending-grants', everyMs: PENDING_RETRY.everyMs, run: async () => { await retryPendingGrants(ctx); } },
  ...(real ? nearAiPeriodic(ctx, real) : []),
];
const stop = cfg.JOBS ? startJobs(ctx, npc?.brain, periodic) : () => {};
const stopRunners = startRunners(ctx, cfg.RUNNERS);
app.addHook('onClose', async () => { stop(); stopRunners(); });
await app.listen({ port: cfg.PORT, host: cfg.HOST });
app.log.info(`TokenGo server · credits ${ctx.credits.simulated ? 'SIMULATED' : 'REAL'} · merchant brain ${npc ? 'LLM' : 'fallback'} · chain ${cfg.chain ? 'on' : 'off'} · runners ${cfg.RUNNERS}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => void app.close().then(() => process.exit(0)));
