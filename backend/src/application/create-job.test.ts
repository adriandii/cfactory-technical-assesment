import { beforeEach, describe, expect, it } from 'vitest';
import { createJob } from './create-job.js';
import { InvalidUploadError, QueueUnavailableError } from './errors.js';
import { FakeQueue, InMemoryJobRepository, InMemoryStorage, PNG_HEADER } from './testing/fakes.js';

let deps: { jobs: InMemoryJobRepository; storage: InMemoryStorage; queue: FakeQueue };

beforeEach(() => {
  deps = { jobs: new InMemoryJobRepository(), storage: new InMemoryStorage(), queue: new FakeQueue() };
});

describe('createJob', () => {
  it('stores the original, records a pending job and queues it', async () => {
    const job = await createJob(deps, { fileName: 'holiday.png', bytes: PNG_HEADER });

    expect(job).toMatchObject({ status: 'pending', originalName: 'holiday.png', contentType: 'image/png', sizeBytes: 12 });
    expect(deps.storage.objects.get(job.originalKey)).toEqual({ body: PNG_HEADER, contentType: 'image/png' });
    expect(await deps.queue.state(job.id)).toBe('queued');
  });

  it('trusts the bytes, not the file name', async () => {
    const gif = new TextEncoder().encode('GIF89a-not-a-png');

    await expect(createJob(deps, { fileName: 'fake.png', bytes: gif })).rejects.toMatchObject({
      name: 'InvalidUploadError',
      problem: 'unsupported_type',
    });
    expect(deps.storage.objects.size).toBe(0);
    expect(deps.jobs.rows.size).toBe(0);
  });

  it('rejects empty files', async () => {
    await expect(createJob(deps, { fileName: 'x.png', bytes: new Uint8Array() })).rejects.toBeInstanceOf(
      InvalidUploadError,
    );
  });

  it('keeps only the base name of the uploaded file', async () => {
    const job = await createJob(deps, { fileName: 'C:\\Users\\me\\photo.png', bytes: PNG_HEADER });
    const unnamed = await createJob(deps, { fileName: '  ', bytes: PNG_HEADER });

    expect(job.originalName).toBe('photo.png');
    expect(unnamed.originalName).toBe('image');
  });

  it('fails the job instead of leaving it pending when the queue is down', async () => {
    deps.queue.failWith = new Error('connection refused');

    await expect(createJob(deps, { fileName: 'a.png', bytes: PNG_HEADER })).rejects.toBeInstanceOf(
      QueueUnavailableError,
    );
    const [row] = deps.jobs.rows.values();
    expect(row).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not be queued/) });
  });
});
