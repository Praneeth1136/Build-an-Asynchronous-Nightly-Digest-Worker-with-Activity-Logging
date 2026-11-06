import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

export interface Job {
  id: string;
  name: string;
  payload: any;
  current_state?: string;
  created_at: Date;
}

export interface JobActivityLog {
  id: string;
  job_id: string;
  state: string;
  message?: string | null;
  created_at: Date;
}

const connectionString =
  process.env.DATABASE_URL ||
  `postgres://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'nightly_digest'}`;

export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[DB] Unexpected error on idle client:', err.message);
  }
});

export async function initDb(maxRetries = 10, delayMs = 2000): Promise<void> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      attempt++;
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS jobs (
            id UUID PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            payload JSONB,
            current_state VARCHAR(50),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS job_activity_logs (
            id UUID PRIMARY KEY,
            job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            state VARCHAR(50) NOT NULL,
            message TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_job_activity_logs_job_id ON job_activity_logs(job_id);
          CREATE INDEX IF NOT EXISTS idx_job_activity_logs_created_at ON job_activity_logs(created_at);
        `);
        console.log('[DB] Database schema initialized successfully');
        return;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.warn(`[DB] Connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt >= maxRetries) {
        throw new Error(`[DB] Failed to connect and initialize database after ${maxRetries} attempts: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function createJobRecord(name: string, payload: any, customId?: string): Promise<Job> {
  const id = customId || randomUUID();
  const query = `
    INSERT INTO jobs (id, name, payload, current_state, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING id, name, payload, current_state, created_at;
  `;
  const values = [id, name, JSON.stringify(payload), 'pending'];
  const res = await pool.query(query, values);
  return res.rows[0];
}

export async function appendActivityLog(
  jobId: string,
  state: string,
  message?: string | null
): Promise<JobActivityLog> {
  const logId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const logQuery = `
      INSERT INTO job_activity_logs (id, job_id, state, message, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, job_id, state, message, created_at;
    `;
    const logRes = await client.query(logQuery, [logId, jobId, state, message || null]);

    const updateJobQuery = `
      UPDATE jobs
      SET current_state = $1
      WHERE id = $2;
    `;
    await client.query(updateJobQuery, [state, jobId]);

    await client.query('COMMIT');
    return logRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getJobById(jobId: string): Promise<Job | null> {
  const query = `SELECT id, name, payload, current_state, created_at FROM jobs WHERE id = $1;`;
  const res = await pool.query(query, [jobId]);
  return res.rows[0] || null;
}

export async function getJobLogs(jobId: string): Promise<JobActivityLog[]> {
  const query = `
    SELECT id, job_id, state, message, created_at
    FROM job_activity_logs
    WHERE job_id = $1
    ORDER BY created_at ASC;
  `;
  const res = await pool.query(query, [jobId]);
  return res.rows;
}
