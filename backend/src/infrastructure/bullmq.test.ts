import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Queue, type Worker } from 'bullmq';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { GiveUpReason } from '../application/process-job.js';
import { BullJobQueue, redisConnection, startQueueWorker } from './bullmq.js';

const url = process.env.TEST_REDIS_URL;
const silent = { info() {}, warn() {}, error() {} };

// Integration test against a real Redis, on throwaway queue names.
describe.skipIf(!url)('BullMQ queue and worker (integration)', () => {
  const redisUrl = url ?? '';
  const names: string[] = [];
  const queues: BullJobQueue[] = [];
  let worker: Worker | undefined;

  const newQueue = (attempts: number) => {
    const queueName = `test-${randomUUID()}`;
    names.push(queueName);
    const queue = new BullJobQueue(redisUrl, { queueName, attempts, backoffMs: 10 });
    queues.push(queue);
    return { queue, queueName };
  };

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
  });

  afterAll(async () => {
    await Promise.all(queues.map((queue) => queue.close()));
    for (const name of names) {
      const raw = new Queue(name, { connection: redisConnection(redisUrl) });
      await raw.obliterate({ force: true });
      await raw.close();
    }
  });

  it('delivers a job id once even when it is enqueued twice', async () => {
    const { queue, queueName } = newQueue(1);
    const seen: string[] = [];
    const jobId = randomUUID();

    await queue.enqueue(jobId);
    await queue.enqueue(jobId);
    expect(await queue.state(jobId)).toBe('queued');

    const processed = new Promise<void>((resolve) => {
      worker = startQueueWorker(
        redisUrl,
        {
          process: async (id) => {
            seen.push(id);
            resolve();
          },
          giveUp: async () => {},
        },
        silent,
        { queueName, concurrency: 1 },
      );
    });
    await processed;
    await sleep(200);

    expect(seen).toEqual([jobId]);
    expect(await queue.state(jobId)).toBe('completed');
  });

  it('retries transient errors, then gives up exactly once', async () => {
    const { queue, queueName } = newQueue(3);
    let calls = 0;
    const reasons: GiveUpReason[] = [];

    const gaveUp = new Promise<void>((resolve) => {
      worker = startQueueWorker(
        redisUrl,
        {
          process: async () => {
            calls++;
            throw new Error('object storage unavailable');
          },
          giveUp: async (_id, reason) => {
            reasons.push(reason);
            resolve();
          },
        },
        silent,
        { queueName, concurrency: 1 },
      );
    });
    const jobId = randomUUID();
    await queue.enqueue(jobId);
    await gaveUp;
    await sleep(200);

    expect(calls).toBe(3);
    expect(reasons).toEqual(['retries_exhausted']);
    expect(await queue.state(jobId)).toBe('failed');
  });

  it('reports ids it has never seen as missing', async () => {
    const { queue } = newQueue(1);
    expect(await queue.state(randomUUID())).toBe('missing');
  });
});
