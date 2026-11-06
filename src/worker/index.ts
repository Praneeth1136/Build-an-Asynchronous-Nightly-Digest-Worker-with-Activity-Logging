import { Worker, Job } from 'bullmq';
import { DIGEST_QUEUE_NAME, redisClient } from '../queue';
import { processDigestJob, DigestJobData } from './processor';
import { initDb } from '../db';
import dotenv from 'dotenv';

dotenv.config();

let worker: Worker | null = null;

export async function startWorker(): Promise<Worker> {
  console.log('[Worker] Initializing database connection...');
  await initDb();

  console.log(`[Worker] Starting worker on queue: ${DIGEST_QUEUE_NAME}...`);
  const workerRedis = redisClient.duplicate();

  worker = new Worker(
    DIGEST_QUEUE_NAME,
    async (job: Job<DigestJobData>) => {
      console.log(`[Worker] Processing job ${job.id} (jobId: ${job.data.jobId})`);
      await processDigestJob(job.data);
    },
    {
      connection: workerRedis,
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.warn(`[Worker] Job ${job?.id} failed with error: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error(`[Worker] Internal worker error: ${err.message}`);
  });

  console.log('[Worker] Worker started and ready to process jobs');
  return worker;
}

export async function stopWorker(): Promise<void> {
  if (worker) {
    console.log('[Worker] Closing worker...');
    await worker.close();
    worker = null;
    console.log('[Worker] Worker closed');
  }
}

// Start worker directly when run as main script
if (require.main === module) {
  startWorker().catch((err) => {
    console.error('[Worker] Fatal error starting worker:', err);
    process.exit(1);
  });

  const handleShutdown = async (signal: string) => {
    console.log(`[Worker] Received ${signal}, shutting down gracefully...`);
    await stopWorker();
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}
