import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import multer from 'multer';
import { createJob } from '../application/create-job.js';
import {
  InvalidUploadError,
  JobNotFoundError,
  JobNotReadyError,
  QueueUnavailableError,
  type UploadProblem,
} from '../application/errors.js';
import { getDownload, getJob } from '../application/get-job.js';
import type { JobQueue, JobRepository, Logger, ObjectStorage } from '../application/ports.js';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '../domain/image.js';
import type { ImageJob } from '../domain/job.js';

export interface AppDeps {
  jobs: JobRepository;
  storage: ObjectStorage;
  queue: JobQueue;
  log: Logger;
  /** Rejects when a dependency the API needs is down. */
  checkHealth: () => Promise<void>;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext(deps.log));

  app.post('/api/jobs', receiveFile, async (req, res) => {
    if (!req.file) throw new InvalidUploadError('missing', 'Attach an image in the "file" form field.');
    const job = await createJob(deps, { fileName: req.file.originalname, bytes: req.file.buffer });
    res.status(202).location(`/api/jobs/${job.id}`).json(toJobDto(job));
  });

  app.get('/api/jobs/:id', async (req, res) => {
    res.json(toJobDto(await getJob(deps.jobs, req.params.id)));
  });

  app.get('/api/jobs/:id/download', async (req, res) => {
    const file = await getDownload(deps, req.params.id);
    res
      .attachment(file.fileName)
      .type(file.contentType)
      .set('Cache-Control', 'private, max-age=31536000, immutable') // a job's output never changes
      .send(Buffer.from(file.bytes));
  });

  app.get('/api/health', async (_req, res) => {
    try {
      await deps.checkHealth();
      res.json({ status: 'ok' });
    } catch (error) {
      deps.log.warn('health check failed', { error });
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });
  app.use(errorHandler(deps.log));
  return app;
}

/** Wire format, as the frontend expects it. */
function toJobDto(job: ImageJob) {
  return job.error === null
    ? { job_id: job.id, status: job.status }
    : { job_id: job.id, status: job.status, error: job.error };
}

// shortcut: buffers each upload (up to 20 MB) in memory; stream to S3 with @aws-sdk/lib-storage if concurrency grows.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
  defParamCharset: 'utf8', // decode non-ASCII file names correctly
}).single('file');

/** Runs multer and turns its errors into upload errors with a clear message. */
const receiveFile: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(new InvalidUploadError('too_large', `The file exceeds the ${MAX_UPLOAD_MB} MB limit.`));
    }
    if (error instanceof multer.MulterError) {
      return next(new InvalidUploadError('malformed', 'Send exactly one image in the "file" form field.'));
    }
    next(new InvalidUploadError('malformed', 'The upload was malformed or interrupted. Try again.'));
  });
};

const UPLOAD_STATUS: Record<UploadProblem, number> = {
  missing: 400,
  malformed: 400,
  empty: 400,
  too_large: 413,
  unsupported_type: 415,
};

function errorHandler(log: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
    const [status, message] = describeError(error);
    if (status >= 500) log.error('request failed', { requestId: res.locals.requestId, error });
    res.status(status).json({ error: message });
  };
}

function describeError(error: unknown): [status: number, message: string] {
  if (error instanceof InvalidUploadError) return [UPLOAD_STATUS[error.problem], error.message];
  if (error instanceof JobNotFoundError) return [404, error.message];
  if (error instanceof JobNotReadyError) return [409, error.message];
  if (error instanceof QueueUnavailableError) return [503, error.message];
  return [500, 'Something went wrong on our side. Try again.'];
}

/** Tags each request with an id (echoed in X-Request-Id) and logs one line when it finishes. */
function requestContext(log: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const requestId = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    const started = performance.now();
    res.locals.requestId = requestId;
    res.set('X-Request-Id', requestId);
    res.set('X-Content-Type-Options', 'nosniff');
    res.on('finish', () => {
      log.info('request', {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      });
    });
    next();
  };
}
