import fs from 'fs';
import path from 'path';

describe('Configuration Files Verification', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('should verify submission.json satisfies evaluation requirements', () => {
    const submissionPath = path.join(rootDir, 'submission.json');
    expect(fs.existsSync(submissionPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(submissionPath, 'utf8'));
    expect(content).toHaveProperty('evaluationConfig');
    expect(typeof content.evaluationConfig.apiPort).toBe('number');
    expect(content.evaluationConfig.apiPort).toBe(3000);
    expect(typeof content.evaluationConfig.queueImplementation).toBe('string');
    expect(content.evaluationConfig.queueImplementation).toBe('redis');
  });

  it('should verify .env.example contains all required environment variables', () => {
    const envExamplePath = path.join(rootDir, '.env.example');
    expect(fs.existsSync(envExamplePath)).toBe(true);

    const envContent = fs.readFileSync(envExamplePath, 'utf8');
    const requiredKeys = [
      'PORT',
      'API_PORT',
      'POSTGRES_HOST',
      'POSTGRES_PORT',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
      'DATABASE_URL',
      'REDIS_HOST',
      'REDIS_PORT',
      'REDIS_URL',
      'CRON_SCHEDULE',
    ];

    for (const key of requiredKeys) {
      expect(envContent).toContain(key);
    }
  });

  it('should verify docker-compose.yml defines all required services and healthchecks', () => {
    const dockerComposePath = path.join(rootDir, 'docker-compose.yml');
    expect(fs.existsSync(dockerComposePath)).toBe(true);

    const composeContent = fs.readFileSync(dockerComposePath, 'utf8');
    // Required services: api / app, worker, db, redis
    expect(composeContent).toMatch(/db:/);
    expect(composeContent).toMatch(/redis:/);
    expect(composeContent).toMatch(/api:/);
    expect(composeContent).toMatch(/worker:/);

    // Healthchecks
    expect(composeContent).toContain('healthcheck');
    expect(composeContent).toContain('init.sql');
  });
});

