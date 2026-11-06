import { processDigestJob } from '../src/worker/processor';
import * as db from '../src/db';
import * as queue from '../src/queue';

describe('Worker Processor', () => {
  const jobId = 'test-worker-job-1234';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process job successfully when simulate_failure is false (started -> success)', async () => {
    const appendedStates: string[] = [];

    jest.spyOn(db, 'appendActivityLog').mockImplementation(async (jid, state, msg) => {
      appendedStates.push(state);
      return {
        id: `log-${Date.now()}`,
        job_id: jid,
        state,
        message: msg || null,
        created_at: new Date(),
      };
    });

    const routeToDlqSpy = jest.spyOn(queue, 'routeToDeadLetter').mockResolvedValue();

    // Fast-forward or execute with real delay (2 seconds)
    const startTime = Date.now();
    await processDigestJob({
      jobId,
      payload: { type: 'nightly_digest', simulate_failure: false },
    });
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeGreaterThanOrEqual(1900); // Simulated delay of 2 seconds
    expect(appendedStates).toEqual(['started', 'success']);
    expect(routeToDlqSpy).not.toHaveBeenCalled();
  });

  it('should handle injected failure when simulate_failure is true (started -> failed -> dead_letter)', async () => {
    const appendedStates: string[] = [];
    const logMessages: string[] = [];

    jest.spyOn(db, 'appendActivityLog').mockImplementation(async (jid, state, msg) => {
      appendedStates.push(state);
      if (msg) logMessages.push(msg);
      return {
        id: `log-${Date.now()}`,
        job_id: jid,
        state,
        message: msg || null,
        created_at: new Date(),
      };
    });

    const routeToDlqSpy = jest.spyOn(queue, 'routeToDeadLetter').mockResolvedValue();

    await processDigestJob({
      jobId,
      payload: { type: 'nightly_digest', simulate_failure: true },
    });

    // Verify exact states in order: started -> failed -> dead_letter
    expect(appendedStates).toEqual(['started', 'failed', 'dead_letter']);
    expect(routeToDlqSpy).toHaveBeenCalledTimes(1);
    expect(routeToDlqSpy).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ simulate_failure: true }),
      expect.stringContaining('Injected failure')
    );
  });
});

