import { OUTPUT } from '../domain/image.js';
import { UnprocessableImageError } from './errors.js';
import type { ImageProcessor, JobQueue, JobRepository, ObjectStorage } from './ports.js';

export type ProcessOutcome = 'completed' | 'failed' | 'skipped';

/**
 * Runs one job: processing, then completed or failed.
 * Safe to run again for the same id (queue redelivery): finished jobs are skipped and the output key is fixed.
 * Transient errors (storage, database) propagate so the queue retries; an undecodable image is a final outcome.
 */
export async function processJob(
  deps: { jobs: JobRepository; storage: ObjectStorage; images: ImageProcessor },
  jobId: string,
): Promise<ProcessOutcome> {
  const job = await deps.jobs.markProcessing(jobId);
  if (!job) return 'skipped';

  const original = await deps.storage.get(job.originalKey);
  let output: Uint8Array;
  try {
    output = await deps.images.toWebp(original);
  } catch (error) {
    if (!(error instanceof UnprocessableImageError)) throw error;
    await deps.jobs.markFailed(job.id, error.message);
    return 'failed';
  }

  const outputKey = `outputs/${job.id}.${OUTPUT.extension}`;
  await deps.storage.put(outputKey, output, OUTPUT.contentType);
  return (await deps.jobs.markCompleted(job.id, outputKey)) ? 'completed' : 'skipped';
}

/** Why the queue stopped retrying a job. */
export type GiveUpReason = 'retries_exhausted' | 'interrupted';

const GIVE_UP_MESSAGES: Record<GiveUpReason, string> = {
  retries_exhausted: 'Processing kept failing after several attempts. Upload the image again.',
  interrupted: 'Processing was interrupted repeatedly. Upload the image again.',
};

export function giveUpJob(jobs: JobRepository, jobId: string, reason: GiveUpReason): Promise<boolean> {
  return jobs.markFailed(jobId, GIVE_UP_MESSAGES[reason]);
}

export const RECONCILE = { pendingAfterMs: 60_000, processingAfterMs: 10 * 60_000, batchSize: 100 };

/**
 * Heals drift between Postgres (the truth) and the queue (delivery only). For unfinished jobs untouched for a while:
 * - no queue entry (the API died before enqueueing, or Redis lost data): queue it again;
 * - queue entry failed but the row was never updated (the worker died first): fail the row.
 */
export async function reconcile(deps: { jobs: JobRepository; queue: JobQueue }): Promise<{ requeued: number; failed: number }> {
  const stale = [
    ...(await deps.jobs.findStale('pending', RECONCILE.pendingAfterMs, RECONCILE.batchSize)),
    ...(await deps.jobs.findStale('processing', RECONCILE.processingAfterMs, RECONCILE.batchSize)),
  ];
  let requeued = 0;
  let failed = 0;
  for (const id of stale) {
    const state = await deps.queue.state(id);
    if (state === 'missing') {
      await deps.queue.enqueue(id);
      requeued++;
    } else if (state === 'failed' && (await giveUpJob(deps.jobs, id, 'retries_exhausted'))) {
      failed++;
    }
  }
  return { requeued, failed };
}
