import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeQueue, InMemoryJobRepository, InMemoryStorage, PNG_HEADER } from '../application/testing/fakes.js';
import { MAX_UPLOAD_BYTES } from '../domain/image.js';
import { createApp } from './app.js';

const silent = { info() {}, warn() {}, error() {} };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let jobs: InMemoryJobRepository;
let storage: InMemoryStorage;
let queue: FakeQueue;
let healthy: boolean;
let server: Server;
let base: string;

beforeAll(async () => {
  // The app holds these instances; beforeEach resets their contents.
  jobs = new InMemoryJobRepository();
  storage = new InMemoryStorage();
  queue = new FakeQueue();
  const app = createApp({
    jobs,
    storage,
    queue,
    log: silent,
    checkHealth: async () => {
      if (!healthy) throw new Error('database down');
    },
  });
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  jobs.rows.clear();
  storage.objects.clear();
  queue.states.clear();
  queue.failWith = null;
  healthy = true;
});

interface Body {
  job_id: string;
  status: string;
  error?: string;
}

function upload(bytes: Uint8Array<ArrayBuffer>, fileName = 'sunset.png') {
  const form = new FormData();
  form.append('file', new Blob([bytes]), fileName);
  return fetch(`${base}/api/jobs`, { method: 'POST', body: form });
}

const bodyOf = async (res: Response) => (await res.json()) as Body;

describe('POST /api/jobs', () => {
  it('answers 202 with a job id as soon as the job is queued', async () => {
    const res = await upload(PNG_HEADER);
    const body = await bodyOf(res);

    expect(res.status).toBe(202);
    expect(body).toEqual({ job_id: expect.stringMatching(UUID), status: 'pending' });
    expect(res.headers.get('location')).toBe(`/api/jobs/${body.job_id}`);
    expect(await queue.state(body.job_id)).toBe('queued');
  });

  it('rejects files that are not JPG, PNG or WebP with 415', async () => {
    const res = await upload(new TextEncoder().encode('GIF89a...'), 'cat.gif');

    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Unsupported file type. Upload a JPG, PNG or WebP image.' });
  });

  it('rejects files over 20 MB with 413', async () => {
    const tooBig = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    tooBig.set(PNG_HEADER);
    const res = await upload(tooBig);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'The file exceeds the 20 MB limit.' });
    expect(jobs.rows.size).toBe(0);
  });

  it('requires a file', async () => {
    const res = await fetch(`${base}/api/jobs`, { method: 'POST', body: new FormData() });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Attach an image in the "file" form field.' });
  });

  it('answers 503 when the queue is down', async () => {
    queue.failWith = new Error('ECONNREFUSED');
    const res = await upload(PNG_HEADER);

    expect(res.status).toBe(503);
    expect((await bodyOf(res)).error).toMatch(/Try again shortly/);
  });
});

describe('GET /api/jobs/:id', () => {
  it('reports the status, with the reason when the job failed', async () => {
    const { job_id } = await bodyOf(await upload(PNG_HEADER));
    await jobs.markFailed(job_id, 'The file could not be decoded as an image.');

    const res = await fetch(`${base}/api/jobs/${job_id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      job_id,
      status: 'failed',
      error: 'The file could not be decoded as an image.',
    });
  });

  it.each(['3f6c2a9e-8d1b-4c57-9a0e-2b7d4f1e6c83', 'not-a-uuid'])('answers 404 for unknown id %s', async (id) => {
    const res = await fetch(`${base}/api/jobs/${id}`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Job not found.' });
  });
});

describe('GET /api/jobs/:id/download', () => {
  it('answers 409 until the job completes, then sends the WebP as an attachment', async () => {
    const { job_id } = await bodyOf(await upload(PNG_HEADER, 'sunset.final.png'));
    expect((await fetch(`${base}/api/jobs/${job_id}/download`)).status).toBe(409);

    const webp = new TextEncoder().encode('RIFF....WEBPVP8 ');
    await storage.put(`outputs/${job_id}.webp`, webp, 'image/webp');
    await jobs.markProcessing(job_id);
    await jobs.markCompleted(job_id, `outputs/${job_id}.webp`);
    const res = await fetch(`${base}/api/jobs/${job_id}/download`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename=sunset.final.webp');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(webp);
  });
});

describe('operations', () => {
  it('reports health as 200 or 503', async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    healthy = false;
    expect((await fetch(`${base}/api/health`)).status).toBe(503);
  });

  it('answers unknown routes with JSON 404 and tags every response with a request id', async () => {
    const res = await fetch(`${base}/nope`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found.' });
    expect(res.headers.get('x-request-id')).toMatch(UUID);
  });
});
