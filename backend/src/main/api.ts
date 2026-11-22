// Composition root of the API process: accepts uploads and queues jobs. It never processes images.
import { Pool } from 'pg';
import { createApp } from '../http/app.js';
import { BullJobQueue } from '../infrastructure/bullmq.js';
import { loadConfig } from '../infrastructure/config.js';
import { createLogger } from '../infrastructure/logger.js';
import { PostgresJobRepository } from '../infrastructure/postgres-job-repository.js';
import { S3ObjectStorage } from '../infrastructure/s3-object-storage.js';
import { onShutdown } from './shutdown.js';

const config = loadConfig();
const log = createLogger({ service: 'api' });

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on('error', (error) => log.error('idle database client failed', { error }));
const storage = new S3ObjectStorage(config.s3);
const queue = new BullJobQueue(config.redisUrl);

const app = createApp({
  jobs: new PostgresJobRepository(pool),
  storage,
  queue,
  log,
  checkHealth: async () => {
    await pool.query('SELECT 1');
    await queue.ping();
  },
});

const server = app.listen(config.port, () => log.info('api listening', { port: config.port }));

onShutdown(log, async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await queue.close();
  await pool.end();
  storage.close();
});
