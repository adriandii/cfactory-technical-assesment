import { validateImageFile } from '../domain/image-file';
import type { Job } from '../domain/job';
import type { JobGateway } from './job-gateway';

export class InvalidFileError extends Error {
  override name = 'InvalidFileError';
}

/** Validates the file locally, then hands it to the API, which answers at once with a pending job. */
export async function submitImage(gateway: JobGateway, file: File, signal?: AbortSignal): Promise<Job> {
  const problem = validateImageFile(file);
  if (problem) throw new InvalidFileError(problem);
  return gateway.submit(file, signal);
}
