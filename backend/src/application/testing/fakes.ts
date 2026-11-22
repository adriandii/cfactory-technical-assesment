import type { ImageJob } from '../../domain/job.js';
import type { JobQueue, JobRepository, NewJob, ObjectStorage, QueuedJobState } from '../ports.js';

/** In-memory JobRepository with the same transition rules as the Postgres table. */
export class InMemoryJobRepository implements JobRepository {
  readonly rows = new Map<string, ImageJob>();

  async create(job: NewJob): Promise<ImageJob> {
    const now = new Date();
    const row: ImageJob = { ...job, status: 'pending', outputKey: null, error: null, createdAt: now, updatedAt: now };
    this.rows.set(job.id, row);
    return { ...row };
  }

  async findById(id: string): Promise<ImageJob | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async markProcessing(id: string): Promise<ImageJob | null> {
    const row = this.unfinished(id);
    if (!row) return null;
    row.status = 'processing';
    row.updatedAt = new Date();
    return { ...row };
  }

  async markCompleted(id: string, outputKey: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (row?.status !== 'processing') return false;
    row.status = 'completed';
    row.outputKey = outputKey;
    row.updatedAt = new Date();
    return true;
  }

  async markFailed(id: string, error: string): Promise<boolean> {
    const row = this.unfinished(id);
    if (!row) return false;
    row.status = 'failed';
    row.error = error;
    row.updatedAt = new Date();
    return true;
  }

  async findStale(status: 'pending' | 'processing', olderThanMs: number, limit: number): Promise<string[]> {
    const cutoff = Date.now() - olderThanMs;
    return [...this.rows.values()]
      .filter((row) => row.status === status && row.updatedAt.getTime() <= cutoff)
      .slice(0, limit)
      .map((row) => row.id);
  }

  private unfinished(id: string): ImageJob | undefined {
    const row = this.rows.get(id);
    return row?.status === 'pending' || row?.status === 'processing' ? row : undefined;
  }
}

export class InMemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async get(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) throw new Error(`No object at ${key}`);
    return object.body;
  }
}

export class FakeQueue implements JobQueue {
  readonly states = new Map<string, QueuedJobState>();
  failWith: Error | null = null;

  async enqueue(jobId: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.states.set(jobId, 'queued');
  }

  async state(jobId: string): Promise<QueuedJobState> {
    return this.states.get(jobId) ?? 'missing';
  }
}

/** Smallest byte sequence that passes the PNG magic-byte check. */
export const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
