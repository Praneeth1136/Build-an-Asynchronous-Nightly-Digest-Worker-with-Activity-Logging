import fs from 'fs';
import path from 'path';

describe('Database Schema & Migrations Verification', () => {
  const initSqlPath = path.resolve(__dirname, '../init.sql');

  it('should have init.sql file at repository root', () => {
    expect(fs.existsSync(initSqlPath)).toBe(true);
  });

  it('should define the jobs table with required columns and constraints', () => {
    const sql = fs.readFileSync(initSqlPath, 'utf8').toLowerCase();

    // Check jobs table exists
    expect(sql).toContain('create table if not exists jobs');

    // Check required columns: id, name, payload, created_at
    expect(sql).toMatch(/id\s+uuid\s+primary\s+key/i);
    expect(sql).toMatch(/name\s+varchar/i);
    expect(sql).toMatch(/payload\s+jsonb?/i);
    expect(sql).toMatch(/created_at\s+timestamp/i);
  });

  it('should define the job_activity_logs table with required columns and foreign key constraint', () => {
    const sql = fs.readFileSync(initSqlPath, 'utf8').toLowerCase();

    // Check job_activity_logs table exists
    expect(sql).toContain('create table if not exists job_activity_logs');

    // Check required columns: id, job_id, state, message, created_at
    expect(sql).toMatch(/id\s+uuid\s+primary\s+key/i);
    expect(sql).toMatch(/job_id\s+uuid/i);
    expect(sql).toMatch(/references\s+jobs\s*\(\s*id\s*\)/i);
    expect(sql).toMatch(/state\s+varchar/i);
    expect(sql).toMatch(/message\s+text/i);
    expect(sql).toMatch(/created_at\s+timestamp/i);
  });
});

