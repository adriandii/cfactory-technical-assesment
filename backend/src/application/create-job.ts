import { randomUUID } from 'node:crypto';
import { detectImageType, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, type ImageType } from '../domain/image.js';
import type { ImageJob } from '../domain/job.js';
import { InvalidUploadError, QueueUnavailableError } from './errors.js';
import type { JobQueue, JobRepository, ObjectStorage } from './ports.js';

export interface Upload {
  fileName: string;
  bytes: Uint8Array;
}

/**
 * Accepts an upload: validate it, store the original, record a pending job and queue its id.
 * Returns as soon as the job is queued; the worker does the processing.
 */
export async function createJob(
  deps: { jobs: JobRepository; storage: ObjectStorage; queue: JobQueue },
  upload: Upload,
): Promise<ImageJob> {
  const contentType = validate(upload.bytes);
  // A random v4 UUID: without accounts, the id is the only key to the job and its download.
  const id = randomUUID();
  const originalKey = `originals/${id}`;

  await deps.storage.put(originalKey, upload.bytes, contentType);
  const job = await deps.jobs.create({
    id,
    originalName: cleanFileName(upload.fileName),
    originalKey,
    contentType,
    sizeBytes: upload.bytes.length,
  });

  try {
    await deps.queue.enqueue(id);
  } catch (error) {
    // No worker will ever see this row, so fail it now rather than leave it pending.
    await deps.jobs.markFailed(id, 'The job could not be queued. Upload the image again.');
    throw new QueueUnavailableError({ cause: error });
  }
  return job;
}

function validate(bytes: Uint8Array): ImageType {
  if (bytes.length === 0) {
    throw new InvalidUploadError('empty', 'The file is empty.');
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new InvalidUploadError('too_large', `The file exceeds the ${MAX_UPLOAD_MB} MB limit.`);
  }
  const type = detectImageType(bytes);
  if (!type) {
    throw new InvalidUploadError('unsupported_type', 'Unsupported file type. Upload a JPG, PNG or WebP image.');
  }
  return type;
}

/** Keeps the client's file name for the download, without any path, within the column limit. */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() ?? '';
  return (base || 'image').slice(0, 255);
}
