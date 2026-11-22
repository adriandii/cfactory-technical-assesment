# Async image processing

Upload a JPG, PNG or WebP image (up to 20 MB). The API answers immediately with a `job_id`. A separate worker process resizes the image to at most 1280 px on its longest side, compresses it at 80% quality and converts it to WebP. The browser polls the job status and offers the WebP for download when it is ready.

- **Frontend:** React 19 + Vite, TypeScript
- **API:** Express 5, TypeScript (strict)
- **Worker:** BullMQ consumer, sharp (libvips)
- **Data:** PostgreSQL (job state), Redis (queue), SILO (S3-compatible object storage)

## Quick start

Requirements: Docker with Compose v2.

```bash
docker compose up --build
```

Open **http://localhost:8080**. The first run builds the images, which takes a few minutes. After that the stack starts in about 15 seconds.

| What | Where |
|---|---|
| App (nginx: static files + `/api` proxy) | http://localhost:8080 (change with `WEB_PORT`) |
| SILO console (browse stored images) | http://127.0.0.1:59001, user `silo-admin`, password `silo-dev-password` |

- **More workers:** `docker compose up -d --scale worker=3`
- **Stop:** `docker compose down`. Add `-v` to also delete the database, queue and stored images.

## How it works

```mermaid
flowchart LR
  Browser -->|"static files, /api"| nginx
  nginx -->|/api| API
  API --> Postgres[(PostgreSQL<br/>job state)]
  API --> SILO[(SILO / S3<br/>originals, outputs)]
  API -->|job id| Redis[(Redis<br/>BullMQ queue)]
  Redis --> Worker
  Worker --> Postgres
  Worker --> SILO
```

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant W as Worker
  B->>A: POST /api/jobs (multipart "file")
  A->>A: check size and magic bytes
  A->>A: store original in SILO, insert job (pending), enqueue id
  A-->>B: 202 { job_id, status: "pending" }
  W->>W: take id from queue, mark processing
  W->>W: rotate (EXIF), fit inside 1280x1280, WebP q80
  W->>W: store outputs/{id}.webp, mark completed
  loop exponential backoff
    B->>A: GET /api/jobs/{id}
  end
  B->>A: GET /api/jobs/{id}/download
```

Job lifecycle: `pending → processing → completed | failed`. PostgreSQL enforces it: a trigger rejects any other transition, and CHECK constraints require an output key on every completed job and an error message on every failed one.

`docker-compose.yml` runs six long-running services plus a one-shot `setup`:

- `web`: nginx serving the built UI and proxying `/api`.
- `api` and `worker`: the same backend image with different commands.
- `postgres`, `redis` and `silo`.
- `setup`: a one-shot container that applies the SQL migrations and creates the bucket. `api` and `worker` start only after it succeeds.

## API

| Method and path | Success | Errors |
|---|---|---|
| `POST /api/jobs` (multipart, field `file`) | `202 {"job_id","status":"pending"}` plus a `Location` header | `400` no or malformed file, `413` over 20 MB, `415` not JPG/PNG/WebP, `503` queue unavailable |
| `GET /api/jobs/:id` | `200 {"job_id","status","error"?}` | `404` unknown id |
| `GET /api/jobs/:id/download` | `200 image/webp`, sent as an attachment | `404` unknown id, `409` not completed |
| `GET /api/health` | `200 {"status":"ok"}` (database and Redis reachable) | `503` |

Errors are JSON: `{"error": "<message safe to show the user>"}`. Every response carries an `X-Request-Id`, which also appears in the logs. 20 MB means 20 × 1024 × 1024 bytes.

## Architecture decisions

**The server delegates and the worker executes.** The API only validates, stores the original, records the job and queues it. Image processing happens only in the worker, a separate process and container. CPU-heavy work therefore never slows down uploads or status checks, and workers scale on their own (`--scale worker=N`). A lint rule rejects any import of the image processor in the API's entry point.

**PostgreSQL holds the job state; BullMQ and Redis only deliver it.** The `image_jobs` table is the record the API reads, with constraints that keep it consistent. The queue carries nothing but job ids. BullMQ provides retries with backoff, detection of jobs abandoned by crashed workers, and concurrency control. Keeping state in two stores creates a gap where a job can be recorded but never queued. Three things close it:

- If queuing fails, the API marks the job failed and answers 503, so no job is left `pending` forever.
- The job id is also the BullMQ job id, so queuing the same job twice is a no-op.
- Every 60 s, a reconciler in the worker re-queues `pending` jobs that the queue has lost (for example after an API crash or Redis data loss). It also fails jobs whose queue entry failed while the worker could not record it.

A Postgres-only queue (`SELECT … FOR UPDATE SKIP LOCKED`) would avoid the second store, at the cost of hand-writing BullMQ's retry and crash handling.

**Object storage instead of a shared disk.** The API and the worker share no filesystem, so they can run on different hosts. Locally, storage is SILO, a community fork of MinIO, with its image pinned because the project is young. The code uses the standard AWS S3 SDK, so AWS S3, Cloudflare R2 or similar work by changing configuration. Storage keys come from the job id (`originals/{id}`, `outputs/{id}.webp`), never from the uploaded file name.

**Failures are part of the design.**

| Situation | What happens |
|---|---|
| Corrupt or undecodable image | Job fails at once with a readable reason; no retries. |
| Storage or database error during processing | Up to 3 attempts, with 2 s and 4 s backoff; then failed with a clear message. |
| Worker crashes mid-job | The job's lock expires (15 s). Another worker, or the restarted one, picks it up within about 15–30 s. Re-running a job is safe: finished jobs are skipped, the output key is fixed, and status updates are conditional. |
| A job that crashes the worker every time | It is failed after 3 starts ("interrupted repeatedly") instead of crash-looping. |
| `docker compose stop` | The worker finishes the job in progress before exiting; it gets 30 s. |
| Huge image dimensions (decompression bomb) | Rejected above 100 megapixels, before decoding. |

**One encode for the image.** Rotate according to EXIF, fit inside 1280×1280 without enlarging smaller images, then encode WebP at quality 80. "Compress to 80%" and "convert to WebP" are a single lossy encode; doing two would only lose more detail. EXIF rotation runs first, so "longest side" refers to the image as people see it.

**Polling with exponential backoff.** The first status check comes after 500 ms. The delay grows ×1.5 per check, up to 5 s, and resets to 500 ms whenever the status changes. A job that just started processing is therefore checked again soon, while a long queue costs few requests. Up to 8 network or server errors in a row are retried silently; a client error such as 404 stops polling. Uploading another image, or leaving the page, cancels polling. Server-Sent Events would push updates instead, but polling is stateless and works through any proxy.

**Validation at every boundary.** The browser checks type and size for instant feedback only. The server is authoritative: it enforces the size limit while receiving the upload, and identifies JPG, PNG and WebP by their magic bytes (the client's `Content-Type` and file extension are ignored). The database also checks type and size.

**Clean architecture in both apps.**

- **Layers:** domain rules, then application use cases with ports (interfaces), then infrastructure adapters (HTTP client in the UI; Postgres, S3, sharp and BullMQ in the backend), then delivery (React, Express).
- **Wiring:** each process has one composition root that connects adapters to use cases.
- **Enforcement:** `oxlint` `no-restricted-imports` rules fail the lint when a layer imports outward.
- **Testing:** use cases are tested with in-memory fakes; adapters are tested against real services.

**Job ids are random UUIDv4s.** The brief has no user accounts, so the id is the only key to a job's status and download. 122 random bits make ids impossible to enumerate.

## Configuration

The backend (`api`, `worker`, `setup`) is configured through environment variables. Startup fails with the variable's name if a required one is missing.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | | PostgreSQL connection string |
| `REDIS_URL` | yes | | Redis for BullMQ (`redis://` or `rediss://`) |
| `S3_BUCKET` | yes | | Bucket for originals and outputs (created by `setup`) |
| `S3_ACCESS_KEY_ID` | yes | | Object storage credentials |
| `S3_SECRET_ACCESS_KEY` | yes | | Object storage credentials |
| `S3_ENDPOINT` | no | AWS S3 | Set for S3-compatible servers such as SILO (enables path-style URLs) |
| `S3_REGION` | no | `us-east-1` | |
| `PORT` | no | `3000` | API port |
| `WORKER_CONCURRENCY` | no | `1` | Jobs processed at once per worker process |

`docker-compose.yml` sets all of these for the containers and needs no `.env` file. To override its defaults, export these variables or put them in a `.env` file next to `docker-compose.yml`:

| Variable | Default | Purpose |
|---|---|---|
| `WEB_PORT` | `8080` | Host port of the app |
| `POSTGRES_PASSWORD` | `app` | Database password |
| `SILO_ROOT_USER`, `SILO_ROOT_PASSWORD` | `silo-admin`, `silo-dev-password` | SILO credentials, also used by the backend |
| `WORKER_CONCURRENCY` | `1` | See above |
| `POSTGRES_PORT`, `REDIS_PORT`, `SILO_API_PORT`, `SILO_CONSOLE_PORT` | `55432`, `56379`, `59000`, `59001` | Host ports, bound to 127.0.0.1 only |

The default credentials are for local development only. A real deployment needs real secrets and a storage key limited to the one bucket. The frontend needs no configuration: it calls the relative path `/api`.

## Local development

Run the app code on your machine and only the infrastructure in Docker. You need Node.js 22.12 or newer.

```bash
docker compose up -d postgres redis silo

cd backend
cp .env.example .env
npm ci
npm run setup          # migrations + bucket; safe to re-run
npm run dev:api        # terminal 1, http://localhost:3000
npm run dev:worker     # terminal 2

cd ../web
npm ci
npm run dev            # http://localhost:5173, proxies /api to :3000
```

Don't run a local worker while the Docker `worker` service is up: both consume the same queue.

## Tests

```bash
cd web && npm test && npm run lint && npm run build
cd backend && npm test && npm run lint && npm run typecheck
```

- **Web:** file validation; the polling policy (backoff, reset on status change, retry, give-up, cancel); the HTTP gateway's response mapping and error handling.
- **Backend:**
  - magic-byte detection;
  - the use cases with in-memory fakes (upload, processing, permanent and transient failures, reconciliation);
  - the HTTP API (status codes, limits, download headers);
  - the sharp pipeline on real images (resize, no enlargement, EXIF rotation, corrupt files, decompression bombs).
- **Backend integration tests** run when these variables are set, using a throwaway schema and queue:

  ```bash
  docker compose up -d postgres redis
  TEST_DATABASE_URL=postgres://app:app@127.0.0.1:55432/images \
  TEST_REDIS_URL=redis://127.0.0.1:56379/15 npm test
  ```

  They cover the Postgres repository (lifecycle trigger, constraints, conditional updates) and BullMQ (de-duplication, retries, then giving up).

## Project structure

```
web/                React UI
  src/domain/         upload rules, job model
  src/application/    use cases: submit image, track job (polling policy); JobGateway port
  src/infrastructure/ HTTP adapter for the API
  src/presentation/   React components and hook
  nginx.conf          production web server config
backend/            API, worker and setup (one image)
  src/domain/         image rules, job model
  src/application/    use cases and ports (repository, storage, queue, image processor)
  src/infrastructure/ Postgres, S3, sharp, BullMQ, config, logging, migration runner
  src/http/           Express app
  src/main/           entry points: api.ts, worker.ts, setup.ts
  migrations/         plain SQL
docker-compose.yml
```

## Limitations and next steps

- Uploads are buffered in memory, up to 20 MB each. At high concurrency, stream them to S3 with a multipart upload.
- There is no authentication or rate limiting. A real service would tie jobs to users and rate-limit uploads.
- Downloads stream through the API. At scale, redirect to short-lived presigned S3 URLs.
- Old jobs and objects are never deleted. An S3 lifecycle rule plus a cleanup job for old rows would fix that.
- Observability is structured JSON logs with request and job ids. Next would be metrics: request rate, errors and duration; queue depth; retries.
