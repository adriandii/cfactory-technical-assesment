import type { ImageType } from './image.js';

/** pending -> processing -> completed | failed. Postgres enforces the transitions (see migrations). */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ImageJob {
  id: string;
  status: JobStatus;
  originalName: string;
  originalKey: string;
  contentType: ImageType;
  sizeBytes: number;
  /** Set exactly when status is completed. */
  outputKey: string | null;
  /** User-facing reason, set exactly when status is failed. */
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJobId(value: string): boolean {
  return UUID.test(value);
}
