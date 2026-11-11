import http from 'node:http';
import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { assertEnv, env } from './config/env.js';
import { ensureSeedUsers } from './services/bootstrap.js';
import { startHealthMonitor, stopHealthMonitor } from './services/healthMonitor.js';
import { closeRealtime, initRealtime } from './services/realtime.js';
import { simulator } from './services/simulator/simulator.js';
import { logger } from './utils/logger.js';

async function main() {
  assertEnv();
  await connectDb(env.mongoUri);
  await ensureSeedUsers();

  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server, { corsOrigins: env.corsOrigins });
  await simulator.init();
  startHealthMonitor(env.sweepIntervalMs);

  server.listen(env.port, () => logger.info(`NanoPulse API listening on http://localhost:${env.port}`));

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    stopHealthMonitor();
    if (simulator.running) await simulator.stop().catch(() => {});
    closeRealtime();
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(`Failed to start: ${err.message}`);
  process.exit(1);
});
