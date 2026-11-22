import { isFinished, type Job } from '../domain/job';
import { GatewayError, type JobGateway } from './job-gateway';

export interface PollPolicy {
  initialDelayMs: number;
  factor: number;
  maxDelayMs: number;
  /** Consecutive transient failures tolerated before giving up. */
  maxRetries: number;
}

export const DEFAULT_POLL_POLICY: PollPolicy = {
  initialDelayMs: 500,
  factor: 1.5,
  maxDelayMs: 5000,
  maxRetries: 8,
};

export function backoffDelay(attempt: number, policy: PollPolicy): number {
  return Math.min(policy.maxDelayMs, policy.initialDelayMs * policy.factor ** attempt);
}

export interface TrackJobOptions {
  onUpdate: (job: Job) => void;
  signal?: AbortSignal;
  policy?: PollPolicy;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Polls a job until it completes or fails, backing off exponentially between polls.
 * The delay resets on every status change, so a job that just started processing is
 * checked again soon. Transient errors are retried; other errors reject at once.
 */
export async function trackJob(gateway: JobGateway, job: Job, options: TrackJobOptions): Promise<Job> {
  const { onUpdate, signal, policy = DEFAULT_POLL_POLICY, sleep = abortableSleep } = options;
  let current = job;
  let attempt = 0;
  let failures = 0;

  while (!isFinished(current)) {
    await sleep(backoffDelay(attempt++, policy), signal);
    try {
      const next = await gateway.get(current.id, signal);
      failures = 0;
      if (next.status !== current.status) {
        attempt = 0;
        onUpdate(next);
      }
      current = next;
    } catch (error) {
      const retryable = error instanceof GatewayError && error.retryable;
      if (signal?.aborted || !retryable || ++failures > policy.maxRetries) throw error;
    }
  }
  return current;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
