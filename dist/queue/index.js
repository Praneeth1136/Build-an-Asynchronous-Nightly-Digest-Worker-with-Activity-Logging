"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dlqQueue = exports.DLQ_QUEUE_NAME = exports.digestQueue = exports.DIGEST_QUEUE_NAME = exports.redisClient = void 0;
exports.enqueueDigestJob = enqueueDigestJob;
exports.routeToDeadLetter = routeToDeadLetter;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const redisUrl = process.env.REDIS_URL;
exports.redisClient = redisUrl
    ? new ioredis_1.default(redisUrl, {
        maxRetriesPerRequest: null,
        enableOfflineQueue: true,
        retryStrategy(times) {
            return Math.min(times * 100, 3000);
        },
    })
    : new ioredis_1.default({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        maxRetriesPerRequest: null,
        enableOfflineQueue: true,
        retryStrategy(times) {
            return Math.min(times * 100, 3000);
        },
    });
// Handle connection errors gracefully without crashing or emitting unhandled exceptions
exports.redisClient.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test') {
        console.warn(`[Redis] Connection warning: ${err.message}`);
    }
});
// Main digest queue
exports.DIGEST_QUEUE_NAME = 'digest_queue';
exports.digestQueue = new bullmq_1.Queue(exports.DIGEST_QUEUE_NAME, {
    connection: exports.redisClient,
});
exports.digestQueue.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test') {
        console.warn(`[BullMQ Queue] Warning: ${err.message}`);
    }
});
// Dead letter queue
exports.DLQ_QUEUE_NAME = 'digest_dlq';
exports.dlqQueue = new bullmq_1.Queue(exports.DLQ_QUEUE_NAME, {
    connection: exports.redisClient,
});
exports.dlqQueue.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test') {
        console.warn(`[BullMQ DLQ] Warning: ${err.message}`);
    }
});
async function enqueueDigestJob(jobId, payload) {
    await exports.digestQueue.add('nightly_digest', {
        jobId,
        payload,
    }, {
        attempts: 1, // Injected failure routes to DLQ immediately without automatic retries
        removeOnComplete: false,
        removeOnFail: false,
    });
}
async function routeToDeadLetter(jobId, payload, errorMessage) {
    await exports.dlqQueue.add('dead_letter_item', {
        jobId,
        payload,
        error: errorMessage,
        movedAt: new Date().toISOString(),
    });
}
