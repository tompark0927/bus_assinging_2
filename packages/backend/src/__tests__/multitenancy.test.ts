import request from 'supertest';
import app from '../app';

/**
 * 멀티테넌시 격리 테스트
 * 회사 A의 토큰으로 회사 B의 데이터를 조회할 수 없음을 검증.
 */

async function registerCompany(suffix: string) {
  const email = `admin_${suffix}_${Date.now()}@test.com`;
  const code = `TN${suffix}${Date.now().toString().slice(-5)}`.slice(0, 10);
  const res = await request(app)
    .post('/api/v1/companies/register')
    .send({
      companyName: `테스트버스${suffix}`,
      companyCode: code,
      adminName: `관리자${suffix}`,
      adminEmail: email,
      adminPhone: '010-0000-0000',
      adminPassword: 'TestPass123!',
    });

  if (res.status !== 201) throw new Error(`Company registration failed: ${JSON.stringify(res.body)}`);
  const d = res.body.data;
  return { token: d.token || d.accessToken, companyId: d.user?.companyId || d.company?.id };
}

describe('Multitenancy Isolation', () => {
  let companyA: { token: string; companyId: number };
  let companyB: { token: string; companyId: number };

  beforeAll(async () => {
    [companyA, companyB] = await Promise.all([
      registerCompany('A'),
      registerCompany('B'),
    ]);
  });

  it('GET /users - Company A cannot see Company B users', async () => {
    const resA = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${companyA.token}`);

    const resB = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${companyB.token}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Company A users should not appear in Company B's response
    const aUserIds = (resA.body.data?.data || resA.body.data || []).map((u: { id: number }) => u.id);
    const bUserIds = (resB.body.data?.data || resB.body.data || []).map((u: { id: number }) => u.id);

    const overlap = aUserIds.filter((id: number) => bUserIds.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('GET /buses - Company A cannot see Company B buses', async () => {
    // Create a bus for company A
    const busRes = await request(app)
      .post('/api/v1/buses')
      .set('Authorization', `Bearer ${companyA.token}`)
      .send({
        busNumber: 'A-001',
        plateNumber: '서울 가 0001',
        capacity: 45,
        year: 2020,
      });

    // Company B should not see Company A's bus
    const res = await request(app)
      .get('/api/v1/buses')
      .set('Authorization', `Bearer ${companyB.token}`);

    expect(res.status).toBe(200);
    const buses = res.body.data || [];
    const busNumbers = buses.map((b: { busNumber: string }) => b.busNumber);
    expect(busNumbers).not.toContain('A-001');
  });

  it('GET /schedules - Company A cannot see Company B schedules', async () => {
    const resA = await request(app)
      .get('/api/v1/schedules')
      .set('Authorization', `Bearer ${companyA.token}`);

    const resB = await request(app)
      .get('/api/v1/schedules')
      .set('Authorization', `Bearer ${companyB.token}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const aScheduleIds = (resA.body.data || []).map((s: { id: number }) => s.id);
    const bScheduleIds = (resB.body.data || []).map((s: { id: number }) => s.id);

    const overlap = aScheduleIds.filter((id: number) => bScheduleIds.includes(id));
    expect(overlap).toHaveLength(0);
  });
});
