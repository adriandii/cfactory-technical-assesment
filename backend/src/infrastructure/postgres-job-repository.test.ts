import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewJob } from '../application/ports.js';
import { migrate } from './migrate.js';
import { PostgresJobRepository } from './postgres-job-repository.js';

const url = process.env.TEST_DATABASE_URL;
const silent = { info() {}, warn() {}, error() {} };

// Integration test against a real Postgres: runs the actual migrations in a throwaway schema.
describe.skipIf(!url)('PostgresJobRepository (integration)', () => {
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool;
  let jobs: PostgresJobRepository;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await migrate(pool, fileURLToPath(new URL('../../migrations', import.meta.url)), silent);
    jobs = new PostgresJobRepository(pool);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  const newJob = (): NewJob => ({
    id: randomUUID(),
    originalName: 'sunset.png',
    originalKey: `originals/${randomUUID()}`,
    contentType: 'image/png',
    sizeBytes: 1024,
  });

  it('walks a job through pending, processing and completed', async () => {
    const job = await jobs.create(newJob());
    expect(job).toMatchObject({ status: 'pending', outputKey: null, error: null });

    expect(await jobs.markProcessing(job.id)).toMatchObject({ status: 'processing' });
    expect(await jobs.markProcessing(job.id)).toMatchObject({ status: 'processing' }); // queue redelivery
    expect(await jobs.markCompleted(job.id, `outputs/${job.id}.webp`)).toBe(true);
    expect(await jobs.findById(job.id)).toMatchObject({ status: 'completed', outputKey: `outputs/${job.id}.webp` });
  });

  it('ignores late or duplicate transitions on finished jobs', async () => {
    const job = await jobs.create(newJob());
    await jobs.markProcessing(job.id);
    await jobs.markFailed(job.id, 'Bad image.');

    expect(await jobs.markProcessing(job.id)).toBeNull();
    expect(await jobs.markCompleted(job.id, 'outputs/x.webp')).toBe(false);
    expect(await jobs.markFailed(job.id, 'Other reason.')).toBe(false);
    expect(await jobs.findById(job.id)).toMatchObject({ status: 'failed', error: 'Bad image.' });
  });

  it('lets the database reject illegal transitions and broken invariants', async () => {
    const job = await jobs.create(newJob());
    const update = (set: string) => pool.query(`UPDATE image_jobs SET ${set} WHERE id = $1`, [job.id]);

    await expect(update(`status = 'completed', output_key = 'x'`)).rejects.toThrow(/pending -> completed/);
    await jobs.markProcessing(job.id);
    await expect(update(`status = 'pending'`)).rejects.toThrow(/processing -> pending/);
    await expect(update(`status = 'completed'`)).rejects.toThrow(/image_jobs_output_iff_completed/);
    await expect(update(`status = 'failed'`)).rejects.toThrow(/image_jobs_error_iff_failed/);
  });

  it('finds unfinished jobs that have not changed for a while', async () => {
    const job = await jobs.create(newJob());

    expect(await jobs.findStale('pending', 0, 100)).toContain(job.id);
    expect(await jobs.findStale('pending', 60_000, 100)).not.toContain(job.id);
    expect(await jobs.findStale('processing', 0, 100)).not.toContain(job.id);
  });

  it('applies each migration only once', async () => {
    await migrate(pool, fileURLToPath(new URL('../../migrations', import.meta.url)), silent);
    const { rows } = await pool.query('SELECT name FROM schema_migrations');
    expect(rows).toEqual([{ name: '001_create_image_jobs.sql' }]);
  });
});
