import request from 'supertest';
import { app } from '../src/api/server';
import * as db from '../src/db';
import * as queue from '../src/queue';

describe('API Endpoints - /api/jobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/jobs/trigger', () => {
    it('should return 202 Accepted and enqueue job with default type and simulate_failure false', async () => {
      const mockJob: db.Job = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'nightly_digest',
        payload: { type: 'nightly_digest', simulate_failure: false },
        current_state: 'pending',
        created_at: new Date(),
      };

      const createJobSpy = jest.spyOn(db, 'createJobRecord').mockResolvedValue(mockJob);
      const appendLogSpy = jest.spyOn(db, 'appendActivityLog').mockResolvedValue({
        id: 'log-1',
        job_id: mockJob.id,
        state: 'pending',
        message: 'Job created via API trigger',
        created_at: new Date(),
      });
      const enqueueSpy = jest.spyOn(queue, 'enqueueDigestJob').mockResolvedValue();

      const startTime = Date.now();
      const response = await request(app)
        .post('/api/jobs/trigger')
        .send({ simulate_failure: false });
      const duration = Date.now() - startTime;

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('job_id');
      expect(response.body).toHaveProperty('message', 'Job accepted for processing');
      expect(typeof response.body.job_id).toBe('string');
      expect(duration).toBeLessThan(500); // Must be non-blocking (< 500ms)

      expect(createJobSpy).toHaveBeenCalledTimes(1);
      expect(appendLogSpy).toHaveBeenCalledWith(
        expect.any(String),
        'pending',
        'Job created via API trigger'
      );
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
    });

    it('should return 202 Accepted when simulate_failure is true', async () => {
      jest.spyOn(db, 'createJobRecord').mockImplementation(async (name, payload, id) => ({
        id: id || 'test-job-id',
        name,
        payload,
        created_at: new Date(),
      }));
      jest.spyOn(db, 'appendActivityLog').mockResolvedValue({
        id: 'log-1',
        job_id: 'test-job-id',
        state: 'pending',
        message: 'Job created via API trigger',
        created_at: new Date(),
      });
      jest.spyOn(queue, 'enqueueDigestJob').mockResolvedValue();

      const response = await request(app)
        .post('/api/jobs/trigger')
        .send({ type: 'nightly_digest', simulate_failure: true });

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('job_id');
      expect(response.body.message).toBe('Job accepted for processing');
    });

    it('should handle burst of 10 concurrent requests in under 1.5 seconds total (decoupling)', async () => {
      jest.spyOn(db, 'createJobRecord').mockImplementation(async (name, payload, id) => ({
        id: id || 'test-job-id',
        name,
        payload,
        created_at: new Date(),
      }));
      jest.spyOn(db, 'appendActivityLog').mockResolvedValue({
        id: 'log-1',
        job_id: 'test-job-id',
        state: 'pending',
        message: 'Job created via API trigger',
        created_at: new Date(),
      });
      jest.spyOn(queue, 'enqueueDigestJob').mockResolvedValue();

      const burstCount = 10;
      const startTime = Date.now();

      const requests = Array.from({ length: burstCount }, () =>
        request(app).post('/api/jobs/trigger').send({ simulate_failure: false })
      );

      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;

      expect(responses).toHaveLength(10);
      responses.forEach((res) => {
        expect(res.status).toBe(202);
        expect(res.body).toHaveProperty('job_id');
        expect(res.body.message).toBe('Job accepted for processing');
      });

      expect(totalTime).toBeLessThan(1500); // Burst under 1.5 seconds total
    });
  });

  describe('GET /api/jobs/:job_id/logs', () => {
    it('should return 404 if the job does not exist', async () => {
      jest.spyOn(db, 'getJobById').mockResolvedValue(null);

      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/jobs/${nonExistentId}/logs`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 200 with chronological logs and derived current_state for existing job', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';
      const date1 = new Date('2026-11-06T10:00:00.000Z');
      const date2 = new Date('2026-11-06T10:00:01.000Z');
      const date3 = new Date('2026-11-06T10:00:03.000Z');

      const mockJob: db.Job = {
        id: jobId,
        name: 'nightly_digest',
        payload: { simulate_failure: false },
        current_state: 'success',
        created_at: date1,
      };

      const mockLogs: db.JobActivityLog[] = [
        {
          id: 'log-1',
          job_id: jobId,
          state: 'pending',
          message: 'Job created via API trigger',
          created_at: date1,
        },
        {
          id: 'log-2',
          job_id: jobId,
          state: 'started',
          message: 'Worker picked up job',
          created_at: date2,
        },
        {
          id: 'log-3',
          job_id: jobId,
          state: 'success',
          message: 'Digest generated successfully',
          created_at: date3,
        },
      ];

      jest.spyOn(db, 'getJobById').mockResolvedValue(mockJob);
      jest.spyOn(db, 'getJobLogs').mockResolvedValue(mockLogs);

      const response = await request(app).get(`/api/jobs/${jobId}/logs`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('job_id', jobId);
      expect(response.body).toHaveProperty('current_state', 'success');
      expect(response.body).toHaveProperty('logs');
      expect(Array.isArray(response.body.logs)).toBe(true);
      expect(response.body.logs).toHaveLength(3);

      expect(response.body.logs[0].state).toBe('pending');
      expect(response.body.logs[0].created_at).toBe(date1.toISOString());

      expect(response.body.logs[1].state).toBe('started');
      expect(response.body.logs[1].created_at).toBe(date2.toISOString());

      expect(response.body.logs[2].state).toBe('success');
      expect(response.body.logs[2].created_at).toBe(date3.toISOString());
    });
  });
});

