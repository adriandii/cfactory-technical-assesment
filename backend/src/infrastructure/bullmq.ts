import { Queue, UnrecoverableError, Worker, type ConnectionOptions, type JobState } from 'bullmq';
import type { JobQueue, Logger, QueuedJobState } from '../application/ports.js';
import type { GiveUpReason } from '../application/process-job.js';

export const QUEUE_NAME = 'image-jobs';

/** The queue carries only the id; Postgres holds everything else. */
interface Payload {
  jobId: string;
}

/** ioredis options from a redis:// or rediss:// URL. */
export function redisConnection(url: string): ConnectionOptions {
  const { protocol, hostname, port, username, password, pathname } = new URL(url);
  return {
    host: hostname,
    port: port ? Number(port) : 6379,
    username: username ? decodeURIComponent(username) : undefined,
    password: password ? decodeURIComponent(password) : undefined,
    db: pathname.length > 1 ? Number(pathname.slice(1)) : 0,
    ...(protocol === 'rediss:' && { tls: {} }),
    maxRetriesPerRequest: null, // BullMQ requires this for its blocking worker connections
  };
}

export interface QueueOptions {
  queueName?: string;
  /** Tries per job for transient errors (storage or database down). */
  attempts?: number;
  /** Delay before the first retry; doubles each time. */
  backoffMs?: number;
}

export class BullJobQueue implements JobQueue {
  private readonly queue: Queue<Payload>;
  private readonly attempts: number;
  private readonly backoffMs: number;

  constructor(redisUrl: string, options: QueueOptions = {}) {
    this.queue = new Queue<Payload>(options.queueName ?? QUEUE_NAME, {
      // Fail fast while Redis is down so the API answers 503 instead of hanging.
      connection: { ...redisConnection(redisUrl), enableOfflineQueue: false },
    });
    this.attempts = options.attempts ?? 3;
    this.backoffMs = options.backoffMs ?? 2000;
  }

  async enqueue(jobId: string): Promise<void> {
    await this.queue.add(
      'process-image',
      { jobId },
      {
        jobId, // our id is the queue id, so adding a job the queue already holds is a no-op
        attempts: this.attempts,
        backoff: { type: 'exponential', delay: this.backoffMs },
        removeOnComplete: { age: 24 * 3600 }, // Postgres keeps the history; Redis only needs recent entries
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
  }

  async state(jobId: string): Promise<QueuedJobState> {
    return toQueuedState(await this.queue.getJobState(jobId));
  }

  /** One round trip to Redis, for health checks. */
  async ping(): Promise<void> {
    await this.queue.getJobCounts('waiting');
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}

function toQueuedState(state: JobState | 'unknown'): QueuedJobState {
  switch (state) {
    case 'active':
    case 'completed':
    case 'failed':
      return state;
    case 'unknown':
      return 'missing';
    default:
      return 'queued'; // waiting, delayed (retry backoff), prioritized, waiting-children
  }
}

export interface WorkerHandlers {
  process(jobId: string): Promise<void>;
  /** Called once BullMQ stops retrying a job. */
  giveUp(jobId: string, reason: GiveUpReason): Promise<void>;
}

export interface QueueWorkerOptions {
  queueName?: string;
  concurrency: number;
}

export function startQueueWorker(
  redisUrl: string,
  handlers: WorkerHandlers,
  log: Logger,
  options: QueueWorkerOptions,
): Worker<Payload> {
  const worker = new Worker<Payload>(options.queueName ?? QUEUE_NAME, (job) => handlers.process(job.data.jobId), {
    connection: redisConnection(redisUrl),
    concurrency: options.concurrency,
    // A crashed worker stops renewing its lock; within ~2 x 15 s another worker picks the job up again.
    lockDuration: 15_000,
    stalledInterval: 15_000,
    // A job that keeps killing its worker gives up on its 4th start. maxStalledCount must not be lower:
    // otherwise BullMQ fails the job inside its stall check, where no 'failed' event reaches this handler.
    maxStartedAttempts: 3,
    maxStalledCount: 3,
  });

  worker.on('failed', (job, error) => {
    if (!job) return;
    const { jobId } = job.data;
    const final = job.finishedOn !== undefined; // set only when BullMQ moves the job to its failed set
    log.warn('job attempt failed', { jobId, attemptsMade: job.attemptsMade, final, error });
    if (!final) return;
    // We never throw UnrecoverableError ourselves; BullMQ uses it when maxStartedAttempts is exceeded.
    const reason: GiveUpReason = error instanceof UnrecoverableError ? 'interrupted' : 'retries_exhausted';
    handlers.giveUp(jobId, reason).catch((giveUpError: unknown) =>
      log.error('could not record the failed job; the reconciler will retry', {
        jobId,
        error: giveUpError,
      }),
    );
  });
  worker.on('stalled', (jobId) => log.warn('job stalled, redelivering', { jobId }));
  worker.on('error', (error) => log.error('queue worker error', { error }));
  return worker;
}
