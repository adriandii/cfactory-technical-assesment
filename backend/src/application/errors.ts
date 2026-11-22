import type { JobStatus } from '../domain/job.js';

export type UploadProblem = 'missing' | 'malformed' | 'empty' | 'too_large' | 'unsupported_type';

/** The upload is unacceptable. The message is safe to show the user. */
export class InvalidUploadError extends Error {
  override name = 'InvalidUploadError';
  readonly problem: UploadProblem;

  constructor(problem: UploadProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

export class JobNotFoundError extends Error {
  override name = 'JobNotFoundError';

  constructor() {
    super('Job not found.');
  }
}

export class JobNotReadyError extends Error {
  override name = 'JobNotReadyError';
  readonly status: JobStatus;

  constructor(status: JobStatus) {
    super(status === 'failed' ? 'This job failed, so there is no image to download.' : 'The image is not ready yet.');
    this.status = status;
  }
}

export class QueueUnavailableError extends Error {
  override name = 'QueueUnavailableError';

  constructor(options?: ErrorOptions) {
    super('The service could not accept the image right now. Try again shortly.', options);
  }
}

/** The input cannot become an image (corrupt, unsupported, too many pixels). Permanent: retrying cannot help. */
export class UnprocessableImageError extends Error {
  override name = 'UnprocessableImageError';
}
