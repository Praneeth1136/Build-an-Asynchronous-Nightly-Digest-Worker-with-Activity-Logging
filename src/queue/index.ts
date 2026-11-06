import { Queue } from 'bullmq';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL;

export const redisClient = redisUrl
  ? new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  })
  : new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  });

// Handle connection errors gracefully without crashing or emitting unhandled exceptions
redisClient.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.warn(`[Redis] Connection warning: ${err.message}`);
  }
});

// Main digest queue
export const DIGEST_QUEUE_NAME = 'digest_queue';
export const digestQueue = new Queue(DIGEST_QUEUE_NAME, {
  connection: redisClient,
});

digestQueue.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.warn(`[BullMQ Queue] Warning: ${err.message}`);
  }
});

// Dead letter queue
export const DLQ_QUEUE_NAME = 'digest_dlq';
export const dlqQueue = new Queue(DLQ_QUEUE_NAME, {
  connection: redisClient,
});

dlqQueue.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.warn(`[BullMQ DLQ] Warning: ${err.message}`);
  }
});

export async function enqueueDigestJob(jobId: string, payload: any): Promise<void> {
  await digestQueue.add(
    'nightly_digest',
    {
      jobId,
      payload,
    },
    {
      attempts: 1, // Injected failure routes to DLQ immediately without automatic retries
      removeOnComplete: false,
      removeOnFail: false,
    }
  );
}

export async function routeToDeadLetter(
  jobId: string,
  payload: any,
  errorMessage: string
): Promise<void> {
  await dlqQueue.add('dead_letter_item', {
    jobId,
    payload,
    error: errorMessage,
    movedAt: new Date().toISOString(),
  });
}
