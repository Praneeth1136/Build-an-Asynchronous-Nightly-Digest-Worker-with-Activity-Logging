"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRON_SCHEDULE = void 0;
exports.triggerScheduledNightlyDigest = triggerScheduledNightlyDigest;
exports.startScheduler = startScheduler;
exports.stopScheduler = stopScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const crypto_1 = require("crypto");
const db_1 = require("../db");
const queue_1 = require("../queue");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Default: every night at midnight (0 0 * * *), configurable via CRON_SCHEDULE env var
exports.CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 0 * * *';
async function triggerScheduledNightlyDigest() {
    const jobId = (0, crypto_1.randomUUID)();
    const payload = {
        type: 'nightly_digest',
        simulate_failure: false,
        triggered_by: 'cron_scheduler',
    };
    console.log(`[Scheduler] Cron triggered nightly_digest job (ID: ${jobId})`);
    // 1. Create job record in DB
    await (0, db_1.createJobRecord)('nightly_digest', payload, jobId);
    // 2. Write initial pending log
    await (0, db_1.appendActivityLog)(jobId, 'pending', 'Job created via scheduled cron');
    // 3. Push to queue
    await (0, queue_1.enqueueDigestJob)(jobId, payload);
    console.log(`[Scheduler] Successfully enqueued nightly_digest job (ID: ${jobId})`);
    return jobId;
}
let scheduledTask = null;
function startScheduler(schedulePattern = exports.CRON_SCHEDULE) {
    console.log(`[Scheduler] Initializing cron scheduler with pattern: "${schedulePattern}"`);
    if (!node_cron_1.default.validate(schedulePattern)) {
        throw new Error(`[Scheduler] Invalid cron expression pattern: "${schedulePattern}"`);
    }
    scheduledTask = node_cron_1.default.schedule(schedulePattern, async () => {
        try {
            await triggerScheduledNightlyDigest();
        }
        catch (err) {
            console.error('[Scheduler] Error executing scheduled nightly digest job:', err);
        }
    });
    console.log(`[Scheduler] Scheduled task active with schedule: ${schedulePattern}`);
    return scheduledTask;
}
function stopScheduler() {
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
            await (0, db_1.initDb)();
            startScheduler();
            console.log('[Scheduler] Scheduler daemon running. Press Ctrl+C to exit.');
        }
        catch (err) {
            console.error('[Scheduler] Fatal error during scheduler startup:', err);
            process.exit(1);
        }
    })();
}
