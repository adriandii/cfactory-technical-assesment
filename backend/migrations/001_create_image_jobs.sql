-- One row per uploaded image and its processing job.
-- Postgres is the source of truth for job state; the BullMQ queue only carries job ids to workers.
CREATE TABLE image_jobs (
  id            uuid PRIMARY KEY,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
  original_key  text NOT NULL UNIQUE,
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  output_key    text UNIQUE,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT image_jobs_output_iff_completed CHECK ((status = 'completed') = (output_key IS NOT NULL)),
  CONSTRAINT image_jobs_error_iff_failed CHECK ((status = 'failed') = (error IS NOT NULL))
);

-- The reconciler scans unfinished jobs by age.
CREATE INDEX image_jobs_unfinished_idx ON image_jobs (status, updated_at)
  WHERE status IN ('pending', 'processing');

-- The lifecycle only moves forward: pending -> processing -> completed | failed.
-- pending -> failed covers jobs that could not be queued. Re-marking processing (a retry) is allowed.
CREATE FUNCTION image_jobs_enforce_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('processing', 'failed'))
    OR (OLD.status = 'processing' AND NEW.status IN ('completed', 'failed'))
  ) THEN
    RAISE EXCEPTION 'illegal job status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER image_jobs_lifecycle
BEFORE UPDATE ON image_jobs
FOR EACH ROW EXECUTE FUNCTION image_jobs_enforce_lifecycle();
