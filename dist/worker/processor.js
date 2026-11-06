"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processDigestJob = processDigestJob;
const db_1 = require("../db");
const queue_1 = require("../queue");
async function processDigestJob(jobData) {
    const { jobId, payload } = jobData;
    try {
        // 1. Log Start
        await (0, db_1.appendActivityLog)(jobId, 'started', 'Worker picked up job');
        // 2. Check for Failure Injection
        if (payload && payload.simulate_failure === true) {
            throw new Error('Injected failure encountered during digest generation');
        }
        // 3. Simulate processing work (2 seconds)
        await new Promise((resolve) => setTimeout(resolve, 2000));
        // 4. Log Success
        await (0, db_1.appendActivityLog)(jobId, 'success', 'Digest generated successfully');
    }
    catch (error) {
        // 5. Handle Failure
        const errorMessage = error?.message || 'Unknown processing error';
        await (0, db_1.appendActivityLog)(jobId, 'failed', errorMessage);
        // 6. Route to DLQ (Dead Letter Queue)
        await (0, queue_1.routeToDeadLetter)(jobId, payload, errorMessage);
        await (0, db_1.appendActivityLog)(jobId, 'dead_letter', 'Moved to DLQ due to fatal error');
    }
}
