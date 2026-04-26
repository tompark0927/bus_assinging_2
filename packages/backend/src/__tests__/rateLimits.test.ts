import request from 'supertest';
import app from '../app';

describe('Rate Limiting', () => {
  it('should block after too many login attempts', async () => {
    const promises = Array.from({ length: 12 }, () =>
      request(app)
        .post('/api/v1/auth/login')
        .send({ companyCode: 'FAKE', email: 'fake@test.com', password: 'wrong' })
    );

    const results = await Promise.all(promises);
    const statuses = results.map(r => r.status);

    // At least one should be rate limited (429) after 10 attempts
    const rateLimited = statuses.filter(s => s === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  }, 20000);
});
