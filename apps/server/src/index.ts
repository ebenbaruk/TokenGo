import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { startJobs } from './jobs.ts';
import { createNpcBrain, npcKeyResolver } from './nearai/brain.ts';
import { nearAiPeriodic } from './nearai/jobs.ts';
import { nearAiCredits, type NearAiCredits } from './nearai/provider.ts';

const cfg = loadConfig();
let real: NearAiCredits | undefined;
const { app, ctx, npc } = await buildApp(cfg, {
  ...(cfg.realCredits ? { credits: (db) => (real = nearAiCredits(cfg, db)) } : {}),
  // cerveau LLM : clé NPC fournie, ou créée une fois via la session NEAR AI ; sinon repli déterministe
  npc: (c) => (cfg.NEARAI_NPC_KEY || real ? createNpcBrain(c, { key: npcKeyResolver(c, real) }) : null),
});
const stop = cfg.JOBS ? startJobs(ctx, npc?.brain, real ? nearAiPeriodic(ctx, real) : []) : () => {};
app.addHook('onClose', async () => stop());
await app.listen({ port: cfg.PORT, host: cfg.HOST });
app.log.info(`TokenGo server · credits ${ctx.credits.simulated ? 'SIMULATED' : 'REAL'} · merchant brain ${npc ? 'LLM' : 'fallback'} · chain ${cfg.chain ? 'on' : 'off'}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => void app.close().then(() => process.exit(0)));
