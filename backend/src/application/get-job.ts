import { OUTPUT } from '../domain/image.js';
import { isJobId, type ImageJob } from '../domain/job.js';
import { JobNotFoundError, JobNotReadyError } from './errors.js';
import type { JobRepository, ObjectStorage } from './ports.js';

export async function getJob(jobs: JobRepository, id: string): Promise<ImageJob> {
  const job = isJobId(id) ? await jobs.findById(id) : null;
  if (!job) throw new JobNotFoundError();
  return job;
}

export interface Download {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export async function getDownload(deps: { jobs: JobRepository; storage: ObjectStorage }, id: string): Promise<Download> {
  const job = await getJob(deps.jobs, id);
  if (job.status !== 'completed' || job.outputKey === null) throw new JobNotReadyError(job.status);
  const baseName = job.originalName.replace(/\.[^.]*$/, '') || 'image';
  return {
    fileName: `${baseName}.${OUTPUT.extension}`,
    contentType: OUTPUT.contentType,
    bytes: await deps.storage.get(job.outputKey),
  };
}
