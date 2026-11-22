import type { ImageType } from '../domain/image.js';
import type { ImageJob } from '../domain/job.js';

export interface NewJob {
  id: string;
  originalName: string;
  originalKey: string;
  contentType: ImageType;
  sizeBytes: number;
}

/** Job rows. Every status change is conditional, so a late or duplicate call cannot move a job backwards. */
export interface JobRepository {
  create(job: NewJob): Promise<ImageJob>;
  findById(id: string): Promise<ImageJob | null>;
  /** pending|processing -> processing. Null when the job is missing or already finished. */
  markProcessing(id: string): Promise<ImageJob | null>;
  /** processing -> completed. False when the job was not processing. */
  markCompleted(id: string, outputKey: string): Promise<boolean>;
  /** pending|processing -> failed. False when the job is missing or already finished. */
  markFailed(id: string, error: string): Promise<boolean>;
  /** Ids of jobs in `status` unchanged for at least `olderThanMs`, oldest first. */
  findStale(status: 'pending' | 'processing', olderThanMs: number, limit: number): Promise<string[]>;
}

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export type QueuedJobState = 'queued' | 'active' | 'completed' | 'failed' | 'missing';

/** Carries job ids to workers. Enqueueing an id the queue already holds is a no-op. */
export interface JobQueue {
  enqueue(jobId: string): Promise<void>;
  state(jobId: string): Promise<QueuedJobState>;
}

export interface ImageProcessor {
  /** Applies the OUTPUT spec. Throws UnprocessableImageError when the input cannot be decoded. */
  toWebp(input: Uint8Array): Promise<Uint8Array>;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
