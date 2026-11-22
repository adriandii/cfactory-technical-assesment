import type { Job } from '../domain/job';

/** Port to the job API. The application depends on this; infrastructure implements it. */
export interface JobGateway {
  submit(file: File, signal?: AbortSignal): Promise<Job>;
  get(jobId: string, signal?: AbortSignal): Promise<Job>;
}

/** A failed call to the job API. `retryable` marks transient failures (network, 5xx). */
export class GatewayError extends Error {
  override name = 'GatewayError';
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}
