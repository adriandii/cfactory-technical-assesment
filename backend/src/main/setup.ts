// One-shot setup: apply database migrations and create the bucket. Safe to run on every deploy.
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadConfig } from '../infrastructure/config.js';
import { createLogger } from '../infrastructure/logger.js';
import { migrate } from '../infrastructure/migrate.js';
import { S3ObjectStorage } from '../infrastructure/s3-object-storage.js';

const config = loadConfig();
const log = createLogger({ service: 'setup' });
const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
const storage = new S3ObjectStorage(config.s3);

/** Services may still be starting (fresh containers), so retry for about a minute. */
async function withRetry(what: string, action: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= 30) throw error;
      log.warn(`${what} not ready, retrying`, { attempt, error: error instanceof Error ? error.message : String(error) });
      await sleep(2000);
    }
  }
}

try {
  const migrations = fileURLToPath(new URL('../../migrations', import.meta.url));
  await withRetry('database', () => migrate(pool, migrations, log));
  await withRetry('object storage', () => storage.ensureBucket());
  log.info('setup complete', { bucket: config.s3.bucket });
} catch (error) {
  log.error('setup failed', { error });
  process.exitCode = 1;
} finally {
  await pool.end();
  storage.close();
}
