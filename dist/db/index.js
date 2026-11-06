"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.initDb = initDb;
exports.createJobRecord = createJobRecord;
exports.appendActivityLog = appendActivityLog;
exports.getJobById = getJobById;
exports.getJobLogs = getJobLogs;
const pg_1 = require("pg");
const crypto_1 = require("crypto");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const connectionString = process.env.DATABASE_URL ||
    `postgres://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'nightly_digest'}`;
exports.pool = new pg_1.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
exports.pool.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test') {
        console.error('[DB] Unexpected error on idle client:', err.message);
    }
});
async function initDb(maxRetries = 10, delayMs = 2000) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            attempt++;
            const client = await exports.pool.connect();
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
            }
            finally {
                client.release();
            }
        }
        catch (err) {
            console.warn(`[DB] Connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
            if (attempt >= maxRetries) {
                throw new Error(`[DB] Failed to connect and initialize database after ${maxRetries} attempts: ${err.message}`);
            }
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
}
async function createJobRecord(name, payload, customId) {
    const id = customId || (0, crypto_1.randomUUID)();
    const query = `
    INSERT INTO jobs (id, name, payload, current_state, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING id, name, payload, current_state, created_at;
  `;
    const values = [id, name, JSON.stringify(payload), 'pending'];
    const res = await exports.pool.query(query, values);
    return res.rows[0];
}
async function appendActivityLog(jobId, state, message) {
    const logId = (0, crypto_1.randomUUID)();
    const client = await exports.pool.connect();
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
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
async function getJobById(jobId) {
    const query = `SELECT id, name, payload, current_state, created_at FROM jobs WHERE id = $1;`;
    const res = await exports.pool.query(query, [jobId]);
    return res.rows[0] || null;
}
async function getJobLogs(jobId) {
    const query = `
    SELECT id, job_id, state, message, created_at
    FROM job_activity_logs
    WHERE job_id = $1
    ORDER BY created_at ASC;
  `;
    const res = await exports.pool.query(query, [jobId]);
    return res.rows;
}
