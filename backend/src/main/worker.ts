// Composition root of the worker process: takes job ids off the queue and does the CPU-heavy work.
import { Pool } from 'pg';
import { giveUpJob, processJob, reconcile } from '../application/process-job.js';
import { BullJobQueue, startQueueWorker } from '../infrastructure/bullmq.js';
import { loadConfig } from '../infrastructure/config.js';
import { createLogger } from '../infrastructure/logger.js';
import { PostgresJobRepository } from '../infrastructure/postgres-job-repository.js';
import { S3ObjectStorage } from '../infrastructure/s3-object-storage.js';
import { SharpImageProcessor } from '../infrastructure/sharp-image-processor.js';
import { onShutdown } from './shutdown.js';

const RECONCILE_EVERY_MS = 60_000;

const config = loadConfig();
const log = createLogger({ service: 'worker' });

const pool = new Pool({ connectionString: config.databaseUrl, max: config.workerConcurrency + 2 });
pool.on('error', (error) => log.error('idle database client failed', { error }));
const jobs = new PostgresJobRepository(pool);
const storage = new S3ObjectStorage(config.s3);
const images = new SharpImageProcessor();
const queue = new BullJobQueue(config.redisUrl);

const worker = startQueueWorker(
  config.redisUrl,
  {
    async process(jobId) {
      const started = performance.now();
      const outcome = await processJob({ jobs, storage, images }, jobId);
      log.info('job processed', { jobId, outcome, durationMs: Math.round(performance.now() - started) });
    },
    async giveUp(jobId, reason) {
      if (await giveUpJob(jobs, jobId, reason)) log.warn('job failed for good', { jobId, reason });
    },
  },
  log,
  { concurrency: config.workerConcurrency },
);
log.info('worker started', { concurrency: config.workerConcurrency });

const reconciler = setInterval(() => {
  reconcile({ jobs, queue }).then(
    (result) => {
      if (result.requeued || result.failed) log.warn('reconciled unfinished jobs', result);
    },
    (error: unknown) => log.error('reconcile failed', { error }),
  );
}, RECONCILE_EVERY_MS);

onShutdown(log, async () => {
  clearInterval(reconciler);
  await worker.close(); // lets the job in progress finish; an unfinished one is redelivered after a crash
  await queue.close();
  await pool.end();
  storage.close();
});
