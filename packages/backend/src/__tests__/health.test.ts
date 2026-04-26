import request from 'supertest';
import app from '../app';

describe('Health Check', () => {
  it('GET /health should return 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /api/v1/health should return detailed health', async () => {
    const res = await request(app).get('/api/v1/health');
    // Either 200 (healthy) or 503 (unhealthy but endpoint exists)
    expect([200, 503]).toContain(res.status);
  });
});
