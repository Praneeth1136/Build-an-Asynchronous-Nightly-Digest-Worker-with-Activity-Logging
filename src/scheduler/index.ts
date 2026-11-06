import cron, { ScheduledTask } from 'node-cron';
import { randomUUID } from 'crypto';
import { createJobRecord, appendActivityLog, initDb } from '../db';
import { enqueueDigestJob } from '../queue';
import dotenv from 'dotenv';

dotenv.config();

// Default: every night at midnight (0 0 * * *), configurable via CRON_SCHEDULE env var
export const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 0 * * *';

export async function triggerScheduledNightlyDigest(): Promise<string> {
  const jobId = randomUUID();
  const payload = {
    type: 'nightly_digest',
    simulate_failure: false,
    triggered_by: 'cron_scheduler',
  };

  console.log(`[Scheduler] Cron triggered nightly_digest job (ID: ${jobId})`);

  // 1. Create job record in DB
  await createJobRecord('nightly_digest', payload, jobId);

  // 2. Write initial pending log
  await appendActivityLog(jobId, 'pending', 'Job created via scheduled cron');

  // 3. Push to queue
  await enqueueDigestJob(jobId, payload);

  console.log(`[Scheduler] Successfully enqueued nightly_digest job (ID: ${jobId})`);
  return jobId;
}

let scheduledTask: ScheduledTask | null = null;

export function startScheduler(schedulePattern: string = CRON_SCHEDULE): ScheduledTask {
  console.log(`[Scheduler] Initializing cron scheduler with pattern: "${schedulePattern}"`);

  if (!cron.validate(schedulePattern)) {
    throw new Error(`[Scheduler] Invalid cron expression pattern: "${schedulePattern}"`);
  }

  scheduledTask = cron.schedule(schedulePattern, async () => {
    try {
      await triggerScheduledNightlyDigest();
    } catch (err: any) {
      console.error('[Scheduler] Error executing scheduled nightly digest job:', err);
    }
  });

  console.log(`[Scheduler] Scheduled task active with schedule: ${schedulePattern}`);
  return scheduledTask;
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Scheduler] Scheduler stopped');
  }
}

// Standalone scheduler process runner
if (require.main === module) {
  (async () => {
    try {
      console.log('[Scheduler] Initializing database...');
      await initDb();
      startScheduler();
      console.log('[Scheduler] Scheduler daemon running. Press Ctrl+C to exit.');
    } catch (err) {
      console.error('[Scheduler] Fatal error during scheduler startup:', err);
      process.exit(1);
    }
  })();
}
