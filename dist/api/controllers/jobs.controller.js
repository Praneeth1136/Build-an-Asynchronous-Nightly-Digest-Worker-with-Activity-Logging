"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerJob = triggerJob;
exports.getJobLogsHandler = getJobLogsHandler;
const crypto_1 = require("crypto");
const db_1 = require("../../db");
const queue_1 = require("../../queue");
async function triggerJob(req, res) {
    try {
        const payload = req.body || {};
        const type = payload.type || 'nightly_digest';
        const simulateFailure = Boolean(payload.simulate_failure);
        const jobPayload = {
            type,
            simulate_failure: simulateFailure,
            ...payload,
        };
        const jobId = (0, crypto_1.randomUUID)();
        // 1. Create job record in DB
        await (0, db_1.createJobRecord)(type, jobPayload, jobId);
        // 2. Write initial pending log
        await (0, db_1.appendActivityLog)(jobId, 'pending', 'Job created via API trigger');
        // 3. Push to queue asynchronously
        await (0, queue_1.enqueueDigestJob)(jobId, jobPayload);
        // 4. Return immediately with 202 Accepted
        res.status(202).json({
            job_id: jobId,
            message: 'Job accepted for processing',
        });
    }
    catch (error) {
        console.error('[API] Error in triggerJob:', error);
        res.status(500).json({
            error: 'Failed to enqueue job',
            details: error.message,
        });
    }
}
async function getJobLogsHandler(req, res) {
    try {
        const rawJobId = req.params.job_id;
        const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;
        if (!jobId) {
            res.status(400).json({ error: 'job_id is required' });
            return;
        }
        // Check if job exists in database
        const job = await (0, db_1.getJobById)(jobId);
        if (!job) {
            res.status(404).json({ error: `Job with ID '${jobId}' not found` });
            return;
        }
        // Retrieve logs ordered chronologically (oldest to newest)
        const logs = await (0, db_1.getJobLogs)(jobId);
        // Derive current_state from the latest log
        const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
        const currentState = latestLog ? latestLog.state : job.current_state || 'pending';
        const formattedLogs = logs.map((log) => ({
            state: log.state,
            message: log.message || '',
            created_at: new Date(log.created_at).toISOString(),
        }));
        res.status(200).json({
            job_id: jobId,
            current_state: currentState,
            logs: formattedLogs,
        });
    }
    catch (error) {
        console.error('[API] Error in getJobLogsHandler:', error);
        res.status(500).json({
            error: 'Failed to fetch job logs',
            details: error.message,
        });
    }
}
