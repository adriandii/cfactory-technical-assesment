export const JOB_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * A processing job. The union keeps impossible states unrepresentable:
 * only a completed job has a download URL, only a failed job has an error.
 */
export type Job =
  | { id: string; status: 'pending' | 'processing' }
  | { id: string; status: 'completed'; downloadUrl: string }
  | { id: string; status: 'failed'; error: string };

export function isFinished(job: Job): boolean {
  return job.status === 'completed' || job.status === 'failed';
}
