import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageJob } from '../domain/job.js';
import { createJob } from './create-job.js';
import { UnprocessableImageError } from './errors.js';
import { giveUpJob, processJob, RECONCILE, reconcile } from './process-job.js';
import type { ImageProcessor } from './ports.js';
import { FakeQueue, InMemoryJobRepository, InMemoryStorage, PNG_HEADER } from './testing/fakes.js';

const WEBP = new TextEncoder().encode('RIFF....WEBP');

let jobs: InMemoryJobRepository;
let storage: InMemoryStorage;
let queue: FakeQueue;
let images: ImageProcessor;
let job: ImageJob;

beforeEach(async () => {
  jobs = new InMemoryJobRepository();
  storage = new InMemoryStorage();
  queue = new FakeQueue();
  images = { toWebp: vi.fn(async () => WEBP) };
  job = await createJob({ jobs, storage, queue }, { fileName: 'cat.png', bytes: PNG_HEADER });
});

const run = () => processJob({ jobs, storage, images }, job.id);
const row = () => jobs.rows.get(job.id);

describe('processJob', () => {
  it('converts the original and completes the job', async () => {
    await expect(run()).resolves.toBe('completed');

    expect(row()).toMatchObject({ status: 'completed', outputKey: `outputs/${job.id}.webp`, error: null });
    expect(storage.objects.get(`outputs/${job.id}.webp`)).toEqual({ body: WEBP, contentType: 'image/webp' });
  });

  it('records an undecodable image as a final failure instead of throwing', async () => {
    images.toWebp = async () => {
      throw new UnprocessableImageError('The file could not be decoded as an image.');
    };

    await expect(run()).resolves.toBe('failed');
    expect(row()).toMatchObject({ status: 'failed', error: 'The file could not be decoded as an image.' });
  });

  it('lets transient errors propagate so the queue retries, leaving the job processing', async () => {
    storage.get = async () => {
      throw new Error('S3 timeout');
    };

    await expect(run()).rejects.toThrow('S3 timeout');
    expect(row()?.status).toBe('processing');
  });

  it('skips a redelivered job that already finished', async () => {
    await run();

    await expect(run()).resolves.toBe('skipped');
    expect(images.toWebp).toHaveBeenCalledTimes(1);
  });
});

describe('giveUpJob', () => {
  it('fails an unfinished job with a reason the user can act on', async () => {
    await jobs.markProcessing(job.id);

    await expect(giveUpJob(jobs, job.id, 'interrupted')).resolves.toBe(true);
    expect(row()).toMatchObject({ status: 'failed', error: expect.stringMatching(/interrupted/) });
  });

  it('never overwrites a finished job', async () => {
    await run();

    await expect(giveUpJob(jobs, job.id, 'retries_exhausted')).resolves.toBe(false);
    expect(row()?.status).toBe('completed');
  });
});

describe('reconcile', () => {
  const age = (ms: number) => {
    const target = jobs.rows.get(job.id)!;
    target.updatedAt = new Date(Date.now() - ms);
  };

  it('requeues a stale pending job the queue lost', async () => {
    queue.states.clear();
    age(RECONCILE.pendingAfterMs + 1000);

    await expect(reconcile({ jobs, queue })).resolves.toEqual({ requeued: 1, failed: 0 });
    expect(await queue.state(job.id)).toBe('queued');
  });

  it('fails a stale processing job whose queue entry already failed', async () => {
    await jobs.markProcessing(job.id);
    queue.states.set(job.id, 'failed');
    age(RECONCILE.processingAfterMs + 1000);

    await expect(reconcile({ jobs, queue })).resolves.toEqual({ requeued: 0, failed: 1 });
    expect(row()?.status).toBe('failed');
  });

  it('leaves fresh jobs and jobs the queue is still working on alone', async () => {
    queue.states.clear(); // missing, but too fresh to be stale
    await expect(reconcile({ jobs, queue })).resolves.toEqual({ requeued: 0, failed: 0 });

    await jobs.markProcessing(job.id);
    queue.states.set(job.id, 'active');
    age(RECONCILE.processingAfterMs + 1000);
    await expect(reconcile({ jobs, queue })).resolves.toEqual({ requeued: 0, failed: 0 });
  });
});
