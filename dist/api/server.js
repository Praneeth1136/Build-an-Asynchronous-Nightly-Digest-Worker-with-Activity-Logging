"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
exports.startServer = startServer;
exports.stopServer = stopServer;
const express_1 = __importDefault(require("express"));
const jobs_controller_1 = require("./controllers/jobs.controller");
const db_1 = require("../db");
const scheduler_1 = require("../scheduler");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.app = (0, express_1.default)();
exports.app.use(express_1.default.json());
// Health check endpoint for Docker Compose and monitoring
exports.app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'nightly-digest-api' });
});
// Root ping
exports.app.get('/', (_req, res) => {
    res.status(200).json({ name: 'Nightly Digest API', version: '1.0.0' });
});
// Jobs API Routes
exports.app.post('/api/jobs/trigger', jobs_controller_1.triggerJob);
exports.app.get('/api/jobs/:job_id/logs', jobs_controller_1.getJobLogsHandler);
let serverInstance = null;
async function startServer(port) {
    const chosenPort = port || parseInt(process.env.API_PORT || process.env.PORT || '3000', 10);
    // Initialize DB tables automatically on startup
    try {
        await (0, db_1.initDb)();
    }
    catch (err) {
        console.error('[API] Warning: Database auto-init failed during startup:', err.message);
    }
    // Activate cron scheduler if configured
    if (process.env.ENABLE_SCHEDULER === 'true') {
        try {
            (0, scheduler_1.startScheduler)();
        }
        catch (err) {
            console.warn('[API] Warning: Scheduler initialization failed:', err.message);
        }
    }
    return new Promise((resolve) => {
        serverInstance = exports.app.listen(chosenPort, '0.0.0.0', () => {
            console.log(`[API] Server listening on port ${chosenPort}`);
            resolve(serverInstance);
        });
    });
}
async function stopServer() {
    if (serverInstance) {
        return new Promise((resolve, reject) => {
            serverInstance.close((err) => {
                if (err)
                    return reject(err);
                serverInstance = null;
                resolve();
            });
        });
    }
}
if (require.main === module) {
    startServer().catch((err) => {
        console.error('[API] Fatal error starting server:', err);
        process.exit(1);
    });
}
