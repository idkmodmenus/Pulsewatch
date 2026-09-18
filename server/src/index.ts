import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { log } from './lib/logger.js';
import { buildApp } from './http/app.js';
import { startCheckWorker } from './engine/worker.js';
import { startScheduler } from './engine/scheduler.js';
import { destroyAgents } from './checks/http.js';

async function main() {
  const shutdownTasks: (() => Promise<void> | void)[] = [];

  if (config.ROLE === 'api' || config.ROLE === 'all') {
    if (process.env.RUN_MIGRATIONS !== 'false') await migrate();
    const app = await buildApp();
    await app.listen({ port: config.PORT, host: config.HOST });
    log.info('api listening', { port: config.PORT });
    shutdownTasks.push(() => app.close());
  }

  if (config.ROLE === 'worker' || config.ROLE === 'all') {
    const worker = startCheckWorker();
    shutdownTasks.push(async () => {
      await worker.close();
      destroyAgents();
    });
    if (config.ROLE === 'worker') {
      // Workers still expose /health and /metrics for scraping.
      const app = await buildApp();
      await app.listen({ port: config.PORT, host: config.HOST });
      shutdownTasks.push(() => app.close());
    }
  }

  if (config.ROLE === 'scheduler' || config.ROLE === 'all') {
    const stop = startScheduler();
    shutdownTasks.push(() => stop());
    if (config.ROLE === 'scheduler') {
      const app = await buildApp();
      await app.listen({ port: config.PORT, host: config.HOST });
      shutdownTasks.push(() => app.close());
    }
  }

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    for (const task of shutdownTasks) {
      try {
        await task();
      } catch (err) {
        log.warn('shutdown task failed', { err: String(err) });
      }
    }
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error('startup failed', { err: String(err), stack: (err as Error).stack });
  process.exit(1);
});
