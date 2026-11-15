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

## Features
- **Immutable Activity Logging:** Every job state transition (`QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`) is recorded in PostgreSQL.
- **Dead Letter Queue (DLQ):** Failed jobs after maximum retries are safely preserved in `digest_dlq` for post-mortem analysis.
- **Graceful Shutdown:** Worker finishes active jobs before terminating on `SIGTERM` / `SIGINT`.

## Local Setup
```bash
# 1. Start Postgres & Redis
docker-compose up -d

# 2. Run migrations and start worker
npm install
npm run build
npm start
```
