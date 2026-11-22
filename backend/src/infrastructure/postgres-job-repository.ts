import type { Pool } from 'pg';
import type { JobRepository, NewJob } from '../application/ports.js';
import type { ImageType } from '../domain/image.js';
import type { ImageJob, JobStatus } from '../domain/job.js';

interface JobRow {
  id: string;
  status: JobStatus;
  original_name: string;
  original_key: string;
  content_type: ImageType;
  size_bytes: number;
  output_key: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, status, original_name, original_key, content_type, size_bytes, output_key, error, created_at, updated_at';

/**
 * Status changes are conditional UPDATEs, so duplicate or late calls are no-ops rather than regressions;
 * the trigger in migrations/001 rejects any illegal transition that slips past them.
 */
export class PostgresJobRepository implements JobRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(job: NewJob): Promise<ImageJob> {
    const { rows } = await this.pool.query<JobRow>(
      `INSERT INTO image_jobs (id, original_name, original_key, content_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [job.id, job.originalName, job.originalKey, job.contentType, job.sizeBytes],
    );
    return toJob(rows[0]);
  }

  async findById(id: string): Promise<ImageJob | null> {
    const { rows } = await this.pool.query<JobRow>(`SELECT ${COLUMNS} FROM image_jobs WHERE id = $1`, [id]);
    return rows[0] ? toJob(rows[0]) : null;
  }

  async markProcessing(id: string): Promise<ImageJob | null> {
    const { rows } = await this.pool.query<JobRow>(
      `UPDATE image_jobs SET status = 'processing'
       WHERE id = $1 AND status IN ('pending', 'processing')
       RETURNING ${COLUMNS}`,
      [id],
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async markCompleted(id: string, outputKey: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE image_jobs SET status = 'completed', output_key = $2 WHERE id = $1 AND status = 'processing'`,
      [id, outputKey],
    );
    return rowCount === 1;
  }

  async markFailed(id: string, error: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE image_jobs SET status = 'failed', error = $2 WHERE id = $1 AND status IN ('pending', 'processing')`,
      [id, error],
    );
    return rowCount === 1;
  }

  async findStale(status: 'pending' | 'processing', olderThanMs: number, limit: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM image_jobs
       WHERE status = $1 AND updated_at < now() - $2 * interval '1 millisecond'
       ORDER BY updated_at
       LIMIT $3`,
      [status, olderThanMs, limit],
    );
    return rows.map((row) => row.id);
  }
}

function toJob(row: JobRow | undefined): ImageJob {
  if (!row) throw new Error('Expected a row from a RETURNING query');
  return {
    id: row.id,
    status: row.status,
    originalName: row.original_name,
    originalKey: row.original_key,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    outputKey: row.output_key,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
