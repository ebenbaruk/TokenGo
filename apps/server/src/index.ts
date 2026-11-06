import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';
import { startJobs } from './jobs.ts';

const cfg = loadConfig();
const { app, ctx } = await buildApp(cfg);
const stop = cfg.JOBS ? startJobs(ctx) : () => {};
app.addHook('onClose', async () => stop());
await app.listen({ port: cfg.PORT, host: cfg.HOST });
app.log.info(`TokenGo server · credits ${ctx.credits.simulated ? 'SIMULATED' : 'REAL'} · chain ${cfg.chain ? 'on' : 'off'}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => void app.close().then(() => process.exit(0)));
