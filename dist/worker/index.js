"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorker = startWorker;
exports.stopWorker = stopWorker;
const bullmq_1 = require("bullmq");
const queue_1 = require("../queue");
const processor_1 = require("./processor");
const db_1 = require("../db");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
let worker = null;
async function startWorker() {
    console.log('[Worker] Initializing database connection...');
    await (0, db_1.initDb)();
    console.log(`[Worker] Starting worker on queue: ${queue_1.DIGEST_QUEUE_NAME}...`);
    const workerRedis = queue_1.redisClient.duplicate();
    worker = new bullmq_1.Worker(queue_1.DIGEST_QUEUE_NAME, async (job) => {
        console.log(`[Worker] Processing job ${job.id} (jobId: ${job.data.jobId})`);
        await (0, processor_1.processDigestJob)(job.data);
    }, {
        connection: workerRedis,
        concurrency: 5,
    });
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
async function stopWorker() {
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
    const handleShutdown = async (signal) => {
        console.log(`[Worker] Received ${signal}, shutting down gracefully...`);
        await stopWorker();
        process.exit(0);
    };
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}
