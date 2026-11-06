import express, { Application, Request, Response } from 'express';
import { triggerJob, getJobLogsHandler } from './controllers/jobs.controller';
import { initDb } from '../db';
import { startScheduler } from '../scheduler';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config();

export const app: Application = express();

app.use(express.json());

// Health check endpoint for Docker Compose and monitoring
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'nightly-digest-api' });
});

// Root ping
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({ name: 'Nightly Digest API', version: '1.0.0' });
});

// Jobs API Routes
app.post('/api/jobs/trigger', triggerJob);
app.get('/api/jobs/:job_id/logs', getJobLogsHandler);

let serverInstance: http.Server | null = null;

export async function startServer(port?: number): Promise<http.Server> {
  const chosenPort = port || parseInt(process.env.API_PORT || process.env.PORT || '3000', 10);

  // Initialize DB tables automatically on startup
  try {
    await initDb();
  } catch (err: any) {
    console.error('[API] Warning: Database auto-init failed during startup:', err.message);
  }

  // Activate cron scheduler if configured
  if (process.env.ENABLE_SCHEDULER === 'true') {
    try {
      startScheduler();
    } catch (err: any) {
      console.warn('[API] Warning: Scheduler initialization failed:', err.message);
    }
  }

  return new Promise((resolve) => {
    serverInstance = app.listen(chosenPort, '0.0.0.0', () => {
      console.log(`[API] Server listening on port ${chosenPort}`);
      resolve(serverInstance!);
    });
  });
}

export async function stopServer(): Promise<void> {
  if (serverInstance) {
    return new Promise((resolve, reject) => {
      serverInstance!.close((err) => {
        if (err) return reject(err);
        serverInstance = null;
        resolve();
      });
    });
  }
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[API] Fatal error starting server:', err);
    process.exit(1);
  });
}

