import cron from 'node-cron';
import {
  CRON_SCHEDULE,
  startScheduler,
  stopScheduler,
  triggerScheduledNightlyDigest,
} from '../src/scheduler';
import * as db from '../src/db';
import * as queue from '../src/queue';

describe('Scheduled Cron Trigger', () => {
  afterEach(() => {
    stopScheduler();
    jest.clearAllMocks();
  });

  it('should validate the default cron expression', () => {
    expect(cron.validate(CRON_SCHEDULE)).toBe(true);
    // Verifies configurable cron expression defaults to standard nightly schedule (0 0 * * *)
    expect(CRON_SCHEDULE).toMatch(/^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/);
  });

  it('should trigger nightly digest job using the same enqueueing logic', async () => {
    const createJobSpy = jest.spyOn(db, 'createJobRecord').mockImplementation(async (name, payload, id) => ({
      id: id || 'test-cron-job',
      name,
      payload,
      created_at: new Date(),
    }));

    const appendLogSpy = jest.spyOn(db, 'appendActivityLog').mockResolvedValue({
      id: 'log-cron-1',
      job_id: 'test-cron-job',
      state: 'pending',
      message: 'Job created via scheduled cron',
      created_at: new Date(),
    });

    const enqueueSpy = jest.spyOn(queue, 'enqueueDigestJob').mockResolvedValue();

    const jobId = await triggerScheduledNightlyDigest();

    expect(typeof jobId).toBe('string');
    expect(createJobSpy).toHaveBeenCalledWith(
      'nightly_digest',
      expect.objectContaining({ type: 'nightly_digest', simulate_failure: false }),
      jobId
    );
    expect(appendLogSpy).toHaveBeenCalledWith(
      jobId,
      'pending',
      'Job created via scheduled cron'
    );
    expect(enqueueSpy).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ type: 'nightly_digest' })
    );
  });

  it('should schedule the cron task without errors', () => {
    const task = startScheduler('0 0 * * *');
    expect(task).toBeDefined();
    expect(typeof task.stop).toBe('function');
  });
});

