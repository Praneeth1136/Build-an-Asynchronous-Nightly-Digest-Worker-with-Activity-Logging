import { appendActivityLog } from '../db';
import { routeToDeadLetter } from '../queue';

export interface DigestJobData {
  jobId: string;
  payload: {
    type?: string;
    simulate_failure?: boolean;
    [key: string]: any;
  };
}

export async function processDigestJob(jobData: DigestJobData): Promise<void> {
  const { jobId, payload } = jobData;

  try {
    // 1. Log Start
    await appendActivityLog(jobId, 'started', 'Worker picked up job');

    // 2. Check for Failure Injection
    if (payload && payload.simulate_failure === true) {
      throw new Error('Injected failure encountered during digest generation');
    }

    // 3. Simulate processing work (2 seconds)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 4. Log Success
    await appendActivityLog(jobId, 'success', 'Digest generated successfully');
  } catch (error: any) {
    // 5. Handle Failure
    const errorMessage = error?.message || 'Unknown processing error';
    await appendActivityLog(jobId, 'failed', errorMessage);

    // 6. Route to DLQ (Dead Letter Queue)
    await routeToDeadLetter(jobId, payload, errorMessage);
    await appendActivityLog(jobId, 'dead_letter', 'Moved to DLQ due to fatal error');
  }
}

