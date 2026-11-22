# Image Processing dengan Async Worker

Aplikasi web untuk upload gambar (JPG, PNG, WebP, maks. 20 MB). API langsung membalas dengan `job_id`, lalu worker di background memproses gambar: resize maks. 1280 px di sisi terpanjang, kompresi kualitas 80%, dan konversi ke WebP. Frontend melakukan polling status dan menampilkan link download saat selesai.

**Stack:** React + Vite · Express 5 (TypeScript strict) · BullMQ + Redis · PostgreSQL · SILO (object storage S3-compatible) · sharp

## Cara Menjalankan

Butuh Docker dengan Compose v2.

```bash
docker compose up --build
```

Buka http://localhost:8080. Build pertama butuh beberapa menit.

- Tambah worker: `docker compose up -d --scale worker=3`
- Stop: `docker compose down` (tambahkan `-v` untuk menghapus data)
- Console SILO: http://127.0.0.1:59001 (user `silo-admin`, password `silo-dev-password`)

## Alur Kerja

1. Browser mengirim gambar ke `POST /api/jobs`.
2. API mengecek ukuran dan tipe file, menyimpan file asli ke SILO, mencatat job (`pending`) di PostgreSQL, memasukkan `job_id` ke antrean BullMQ, lalu langsung membalas `202`.
3. Worker mengambil job dari antrean, mengubah status menjadi `processing`, memproses gambar dengan sharp, menyimpan hasil WebP ke SILO, lalu mengubah status menjadi `completed` (atau `failed` beserta alasannya).
4. Browser melakukan polling ke `GET /api/jobs/:id`, lalu mengunduh hasil dari `GET /api/jobs/:id/download`.

Urutan status: `pending → processing → completed / failed`, dijaga oleh trigger di PostgreSQL.

## API

| Endpoint | Respons |
|---|---|
| `POST /api/jobs` (multipart, field `file`) | `202 {"job_id","status":"pending"}`. Error: `400`, `413` (> 20 MB), `415` (bukan JPG/PNG/WebP), `503` |
| `GET /api/jobs/:id` | `200 {"job_id","status","error"?}`, atau `404` jika job tidak ada |
| `GET /api/jobs/:id/download` | File WebP, atau `409` jika job belum selesai |
| `GET /api/health` | `200` jika database dan Redis siap |

Format error: `{"error": "pesan"}`.

## Keputusan Arsitektur

- **API dan worker dipisah.** Keduanya memakai image yang sama, tetapi berjalan sebagai container terpisah. API hanya menerima, menyimpan, dan mengantre job; proses gambar yang berat hanya ada di worker. Jadi API tetap cepat, dan jumlah worker bisa ditambah sendiri.
- **PostgreSQL untuk status, BullMQ + Redis untuk antrean.** BullMQ sudah menyediakan retry, backoff, dan deteksi job yang macet karena worker crash. Karena data ada di dua tempat, ada dua pengaman:
  - Jika job gagal masuk antrean, API menandainya `failed` dan membalas `503`.
  - Reconciler di worker (tiap 60 detik) mengantre ulang job `pending` yang hilang dari antrean.
- **File disimpan di object storage, bukan disk bersama.** API dan worker tidak berbagi filesystem. Kode memakai AWS S3 SDK, jadi SILO bisa diganti AWS S3 atau Cloudflare R2 cukup lewat konfigurasi.
- **Penanganan error di worker:**
  - Gambar rusak: langsung `failed` dengan pesan yang jelas, tanpa retry.
  - Error sementara (storage/database): retry 3 kali dengan jeda 2 dan 4 detik.
  - Worker crash di tengah proses: job diambil ulang oleh worker lain atau oleh worker yang restart, dalam sekitar 15–30 detik.
  - Job yang selalu membuat worker crash: dihentikan sebagai `failed` setelah 3 kali dicoba.
  - `docker compose stop`: worker menyelesaikan job yang sedang berjalan sebelum berhenti.
- **Polling dengan exponential backoff.** Jeda polling mulai dari 500 ms, dikali 1,5 setiap kali, maksimal 5 detik, dan kembali ke 500 ms setiap status berubah.
- **Validasi di browser dan server.** Browser mengecek tipe dan ukuran agar pengguna langsung mendapat respons. Server tetap menjadi penentu: batas 20 MB, dan tipe file dicek dari isi file (magic bytes), bukan dari ekstensinya.
- **Clean architecture.** Kode dibagi menjadi layer domain, application (use case dan interface), infrastructure (Postgres, S3, sharp, BullMQ), dan presentation/HTTP. Arah dependensi antar-layer dicek oleh lint (`oxlint`).

## Environment Variables

Dipakai oleh backend (api, worker, setup). Docker Compose sudah mengisi semuanya.

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `DATABASE_URL` | ya | | Koneksi PostgreSQL |
| `REDIS_URL` | ya | | Koneksi Redis untuk BullMQ |
| `S3_BUCKET` | ya | | Bucket untuk file asli dan hasil |
| `S3_ACCESS_KEY_ID` | ya | | Kredensial object storage |
| `S3_SECRET_ACCESS_KEY` | ya | | Kredensial object storage |
| `S3_ENDPOINT` | tidak | AWS S3 | Isi untuk SILO atau MinIO |
| `S3_REGION` | tidak | `us-east-1` | |
| `PORT` | tidak | `3000` | Port API |
| `WORKER_CONCURRENCY` | tidak | `1` | Jumlah job yang diproses bersamaan per worker |

Opsional untuk Docker Compose: `WEB_PORT` (default `8080`), `POSTGRES_PASSWORD`, `SILO_ROOT_USER`, `SILO_ROOT_PASSWORD`. Kredensial default hanya untuk development.

## Development Lokal

Butuh Node.js 22.12 atau lebih baru.

```bash
docker compose up -d postgres redis silo
cd backend && cp .env.example .env && npm ci && npm run setup
npm run dev:api                      # terminal 1
npm run dev:worker                   # terminal 2
cd ../web && npm ci && npm run dev   # http://localhost:5173
```

Jangan jalankan worker lokal bersamaan dengan service `worker` di Docker, karena keduanya memakai antrean yang sama.

## Testing

```bash
cd web && npm test
cd ../backend && npm test
```

Integration test (dengan PostgreSQL dan Redis asli) ikut berjalan jika `TEST_DATABASE_URL` dan `TEST_REDIS_URL` diisi. Contohnya ada di `backend/.env.example`.

## Batasan

- Belum ada autentikasi dan rate limiting. `job_id` (UUID acak) menjadi satu-satunya kunci untuk mengakses job.
- File upload disimpan sementara di memori (maks. 20 MB per file).
- Job dan file lama belum dihapus otomatis.
