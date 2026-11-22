import { GatewayError, type JobGateway } from '../application/job-gateway';
import { JOB_STATUSES, type Job, type JobStatus } from '../domain/job';

/** Job as the API sends it. */
interface JobDto {
  job_id: string;
  status: JobStatus;
  error?: string;
}

/**
 * JobGateway over the REST API:
 *   POST /jobs                 multipart field "file"  -> 202 JobDto
 *   GET  /jobs/:id                                     -> 200 JobDto
 *   GET  /jobs/:id/download                            -> the WebP file
 * Errors come back as { "error": "<message>" }.
 */
export class HttpJobGateway implements JobGateway {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async submit(file: File, signal?: AbortSignal): Promise<Job> {
    const body = new FormData();
    body.append('file', file);
    return this.toJob(await this.request('/jobs', { method: 'POST', body, signal }));
  }

  async get(jobId: string, signal?: AbortSignal): Promise<Job> {
    return this.toJob(await this.request(`/jobs/${encodeURIComponent(jobId)}`, { signal }));
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new GatewayError('Cannot reach the server. Check your connection and try again.', true);
    }
    // Error bodies may not be JSON (e.g. a proxy's HTML 502 page).
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new GatewayError(serverMessage(payload) ?? fallbackMessage(response.status), isRetryable(response.status));
    }
    return payload;
  }

  private toJob(payload: unknown): Job {
    if (!isJobDto(payload)) throw new GatewayError('The server sent an unexpected response.', false);
    const id = payload.job_id;
    switch (payload.status) {
      case 'completed':
        return { id, status: 'completed', downloadUrl: `${this.baseUrl}/jobs/${encodeURIComponent(id)}/download` };
      case 'failed':
        return { id, status: 'failed', error: payload.error ?? 'Processing failed for an unknown reason.' };
      default:
        return { id, status: payload.status };
    }
  }
}

function isJobDto(value: unknown): value is JobDto {
  if (typeof value !== 'object' || value === null) return false;
  const dto = value as Record<string, unknown>;
  return (
    typeof dto.job_id === 'string' &&
    (JOB_STATUSES as readonly unknown[]).includes(dto.status) &&
    (dto.error === undefined || typeof dto.error === 'string')
  );
}

function serverMessage(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { error } = payload as { error?: unknown };
  return typeof error === 'string' ? error : undefined;
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

function fallbackMessage(status: number): string {
  if (status === 404) return 'Job not found. It may have expired.';
  if (status === 413) return 'The file is too large.';
  if (status === 415) return 'Unsupported file type. Choose a JPG, PNG or WebP image.';
  if (status >= 500) return 'The server ran into a problem. Try again in a moment.';
  return `The request failed (HTTP ${status}).`;
}
