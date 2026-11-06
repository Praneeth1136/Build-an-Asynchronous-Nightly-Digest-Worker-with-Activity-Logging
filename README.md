# Asynchronous Nightly Digest Worker with Activity Logging

An asynchronous background worker system for orchestrating a nightly data digest, tracking execution states via an immutable activity log, and handling injected failures with Dead Letter Queue (DLQ) routing.

---

## Architecture Overview

```
                      +-------------------+
                      |   Cron Scheduler  | (Fires nightly: 0 0 * * *)
                      +---------+---------+
                                |
                                v
+------------------+    +---------------+    +--------------------+
|  Client Trigger  |--->|  API Service  |--->|    Redis Queue     |
| (POST /trigger)  |    |  (Port 3000)  |    |  ('digest_queue')  |
+------------------+    +-------+-------+    +---------+----------+
                                |                      |
                                v                      v
                        +---------------+    +--------------------+
                        |  PostgreSQL   |<---| Background Worker  |
                        |   Database    |    |  ('processor.ts')  |
                        +---------------+    +---------+----------+
                                                       | (on error)
                                                       v
                                             +--------------------+
                                             | Dead Letter Queue  |
                                             |   ('digest_dlq')   |
                                             +--------------------+
```

### Decoupled Execution Model
- **Trigger Layer**: Accepts job requests via `POST /api/jobs/trigger` or automated `node-cron` schedule. Immediately records a `pending` state in `job_activity_logs`, enqueues the payload to Redis, and returns `202 Accepted` in < 500ms without blocking.
- **Orchestration Layer**: Redis queue backed by BullMQ (`digest_queue`) and a dedicated Dead Letter Queue (`digest_dlq`).
- **Execution Layer**: Independent background worker pulls jobs from the queue, logs state transitions (`started`, `success`, `failed`, `dead_letter`), and handles errors.
- **Audit & Observability**: Immutable log entries recorded in `job_activity_logs` with foreign key linkage to `jobs`.

---

## State Machine & Lifecycle Transitions

### 1. Successful Run (`simulate_failure: false` or omitted)
```
pending ──> started ──> success
```
1. **pending**: Recorded immediately by the API when the job is accepted.
2. **started**: Recorded when the background worker picks up the job.
3. **success**: Recorded after digest simulation (2-second workload) completes.

### 2. Injected Failure Run (`simulate_failure: true`)
```
pending ──> started ──> failed ──> dead_letter
```
1. **pending**: Recorded immediately by the API when the job is accepted.
2. **started**: Recorded when the background worker picks up the job.
3. **failed**: Recorded when worker catches the injected failure.
4. **dead_letter**: Recorded after routing the job payload and error to the Dead Letter Queue (`digest_dlq`).

---

## Database Schema

### `jobs`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY | Unique job identifier |
| `name` | VARCHAR(255) | NOT NULL | Job type identifier (`nightly_digest`) |
| `payload` | JSONB | NULLABLE | Input parameters |
| `current_state` | VARCHAR(50) | NULLABLE | Current state snapshot |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Creation timestamp |

### `job_activity_logs`
| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PRIMARY KEY | Unique log entry identifier |
| `job_id` | UUID | FOREIGN KEY (jobs.id) | Reference to parent job |
| `state` | VARCHAR(50) | NOT NULL | State name (`pending`, `started`, `success`, `failed`, `dead_letter`) |
| `message` | TEXT | NULLABLE | Contextual info or error stack trace |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Log entry timestamp |

---

## API Endpoints

### 1. Trigger Digest Job
- **URL**: `POST /api/jobs/trigger`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "type": "nightly_digest",
  "simulate_failure": false
}
```
- **Response**: `202 Accepted`
```json
{
  "job_id": "b182cb20-643c-41c3-8833-fd4fcfae94d8",
  "message": "Job accepted for processing"
}
```

### 2. Retrieve Job History & Activity Logs
- **URL**: `GET /api/jobs/{job_id}/logs`
- **Response**: `200 OK`
```json
{
  "job_id": "b182cb20-643c-41c3-8833-fd4fcfae94d8",
  "current_state": "success",
  "logs": [
    {
      "state": "pending",
      "message": "Job created via API trigger",
      "created_at": "2026-11-06T16:30:00.000Z"
    },
    {
      "state": "started",
      "message": "Worker picked up job",
      "created_at": "2026-11-06T16:30:01.000Z"
    },
    {
      "state": "success",
      "message": "Digest generated successfully",
      "created_at": "2026-11-06T16:30:03.000Z"
    }
  ]
}
```
- Returns `404 Not Found` if `job_id` does not exist.

### 3. Healthcheck
- **URL**: `GET /health`
- **Response**: `200 OK` `{ "status": "ok", "service": "nightly-digest-api" }`

---

## Project Structure

```
.
├── docker-compose.yml          # Container configuration (api, worker, db, redis)
├── Dockerfile                  # Multi-stage container build
├── init.sql                    # Automated database initialization script
├── .env.example                # Documented environment variables
├── submission.json             # Evaluation configuration
├── tsconfig.json               # TypeScript compiler configuration
├── package.json                # Project dependencies and scripts
├── src/
│   ├── api/
│   │   ├── controllers/
│   │   │   └── jobs.controller.ts  # Handlers for /api/jobs/trigger & logs
│   │   └── server.ts               # Express server initialization
│   ├── db/
│   │   └── index.ts                # PostgreSQL pool, queries & auto-migrations
│   ├── queue/
│   │   └── index.ts                # BullMQ Queue, Redis connection & DLQ
│   ├── worker/
│   │   ├── processor.ts            # Core digest execution & failure injection
│   │   └── index.ts                # BullMQ Worker polling engine
│   └── scheduler/
│       └── index.ts                # node-cron scheduled nightly digest trigger
└── tests/
    ├── api.test.ts             # API route tests, burst load decoupling test
    ├── worker.test.ts          # Worker processor success and failure flow tests
    ├── scheduler.test.ts       # Cron trigger and scheduling validation tests
    ├── schema.test.ts          # Database schema and constraint tests
    └── config.test.ts          # submission.json, .env.example, docker-compose tests
```

---

## Quickstart with Docker Compose

1. **Clone repository and copy environment**:
```bash
cp .env.example .env
```

2. **Start all services**:
```bash
docker-compose up -d --build
```

3. **Verify running containers**:
```bash
docker-compose ps
```

All 4 services will automatically initialize:
- `db` (PostgreSQL 16) with automated schema initialization from `init.sql`.
- `redis` (Redis 7) message broker.
- `api` (Express web server on port 3000).
- `worker` (Asynchronous BullMQ background worker).

4. **Trigger a successful job**:
```bash
curl -X POST http://localhost:3000/api/jobs/trigger \
  -H "Content-Type: application/json" \
  -d '{"simulate_failure": false}'
```

5. **Trigger a failure job with DLQ routing**:
```bash
curl -X POST http://localhost:3000/api/jobs/trigger \
  -H "Content-Type: application/json" \
  -d '{"simulate_failure": true}'
```

6. **View activity logs**:
```bash
curl http://localhost:3000/api/jobs/<job_id>/logs
```

---

## Local Development & Testing

1. **Install dependencies**:
```bash
npm install
```

2. **Build TypeScript**:
```bash
npm run build
```

3. **Run automated test suite**:
```bash
npm test
```

