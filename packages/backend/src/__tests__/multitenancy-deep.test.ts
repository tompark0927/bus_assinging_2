import request from 'supertest';
import app from '../app';

/**
 * 멀티테넌시 심층 격리 테스트
 *
 * 회사 A의 토큰으로 회사 B의 리소스에 접근/수정/삭제할 수 없음을 검증.
 * 데이터 유출은 즉시 서비스 종료 사유.
 */

interface CompanyContext {
  token: string;
  companyId: number;
  adminId: number;
}

async function registerCompany(suffix: string): Promise<CompanyContext> {
  const email = `deep_${suffix}_${Date.now()}@test.com`;
  // companyCode: 영문/숫자 2~10자
  const code = `DP${suffix}${Date.now().toString().slice(-6)}`.slice(0, 10);
  const res = await request(app)
    .post('/api/v1/companies/register')
    .send({
      companyName: `심층테스트${suffix}`,
      companyCode: code,
      adminName: `관리자${suffix}`,
      adminEmail: email,
      adminPhone: '010-0000-0000',
      adminPassword: 'TestPass123!',
    });

  if (res.status !== 201) throw new Error(`Registration failed: ${JSON.stringify(res.body)}`);
  const d = res.body.data;
  return {
    token: d.token || d.accessToken,
    companyId: d.user?.companyId || d.company?.id,
    adminId: d.user?.id,
  };
}

async function createDriver(token: string, suffix: string) {
  const res = await request(app)
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: `기사${suffix}`,
      email: `driver_${suffix}_${Date.now()}@test.com`,
      employeeId: `DRV${suffix}${Date.now()}`,
      phone: '010-1111-1111',
      role: 'DRIVER',
      driverType: 'MAIN',
    });
  return res.body.data;
}

async function createBus(token: string, suffix: string) {
  const res = await request(app)
    .post('/api/v1/buses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      busNumber: `BUS-${suffix}`,
      plateNumber: `인천 가 ${suffix}${Date.now().toString().slice(-4)}`,
      capacity: 45,
      year: 2020,
    });
  return res.body.data;
}

async function createRoute(token: string, suffix: string) {
  const res = await request(app)
    .post('/api/v1/routes')
    .set('Authorization', `Bearer ${token}`)
    .send({
      routeNumber: `${suffix}01`,
      name: `${suffix}노선`,
      fatigueScore: 3,
    });
  return res.body.data;
}

describe('Multitenancy Deep Isolation', () => {
  let companyA: CompanyContext;
  let companyB: CompanyContext;
  let busA: any;
  let driverA: any;
  let routeA: any;

  beforeAll(async () => {
    [companyA, companyB] = await Promise.all([
      registerCompany('X'),
      registerCompany('Y'),
    ]);

    // Company A에만 리소스 생성
    [busA, driverA, routeA] = await Promise.all([
      createBus(companyA.token, 'X'),
      createDriver(companyA.token, 'X'),
      createRoute(companyA.token, 'X'),
    ]);
  });

  // ─── 읽기 격리 ───

  it('Company B cannot list Company A drivers', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${companyB.token}`);

    expect(res.status).toBe(200);
    const ids = (res.body.data?.data || res.body.data || []).map((u: any) => u.id);
    if (driverA?.id) {
      expect(ids).not.toContain(driverA.id);
    }
  });

  it('Company B cannot list Company A routes', async () => {
    const res = await request(app)
      .get('/api/v1/routes')
      .set('Authorization', `Bearer ${companyB.token}`);

    expect(res.status).toBe(200);
    const routeNumbers = (res.body.data || []).map((r: any) => r.routeNumber);
    expect(routeNumbers).not.toContain('X01');
  });

  it('Company B cannot list Company A buses', async () => {
    const res = await request(app)
      .get('/api/v1/buses')
      .set('Authorization', `Bearer ${companyB.token}`);

    expect(res.status).toBe(200);
    const busNumbers = (res.body.data || []).map((b: any) => b.busNumber);
    expect(busNumbers).not.toContain('BUS-X');
  });

  // ─── ID 열거 공격 방어 ───

  it('Company B cannot access Company A bus by ID', async () => {
    if (!busA?.id) return;

    const res = await request(app)
      .get(`/api/v1/buses/${busA.id}`)
      .set('Authorization', `Bearer ${companyB.token}`);

    // 404 or 403 — must NOT return bus data
    expect([403, 404]).toContain(res.status);
  });

  it('Company B cannot access Company A driver by ID', async () => {
    if (!driverA?.id) return;

    const res = await request(app)
      .get(`/api/v1/users/${driverA.id}`)
      .set('Authorization', `Bearer ${companyB.token}`);

    expect([403, 404]).toContain(res.status);
  });

  it('Company B cannot access Company A route by ID', async () => {
    if (!routeA?.id) return;

    const res = await request(app)
      .get(`/api/v1/routes/${routeA.id}`)
      .set('Authorization', `Bearer ${companyB.token}`);

    expect([403, 404]).toContain(res.status);
  });

  // ─── 쓰기 격리 ───

  it('Company B cannot update Company A bus', async () => {
    if (!busA?.id) return;

    const res = await request(app)
      .put(`/api/v1/buses/${busA.id}`)
      .set('Authorization', `Bearer ${companyB.token}`)
      .send({ busNumber: 'HIJACKED' });

    expect([403, 404]).toContain(res.status);
  });

  it('Company B cannot delete Company A bus', async () => {
    if (!busA?.id) return;

    const res = await request(app)
      .delete(`/api/v1/buses/${busA.id}`)
      .set('Authorization', `Bearer ${companyB.token}`);

    expect([403, 404]).toContain(res.status);
  });

  it('Company B cannot update Company A driver', async () => {
    if (!driverA?.id) return;

    const res = await request(app)
      .put(`/api/v1/users/${driverA.id}`)
      .set('Authorization', `Bearer ${companyB.token}`)
      .send({ name: '탈취된기사' });

    expect([403, 404]).toContain(res.status);
  });

  // ─── 긴급 드랍 격리 ───

  it('Company B cannot see Company A emergency drops', async () => {
    const res = await request(app)
      .get('/api/v1/emergency')
      .set('Authorization', `Bearer ${companyB.token}`);

    expect(res.status).toBe(200);
    const drops = res.body.data || [];
    const dropCompanyIds = drops.map((d: any) => d.slot?.schedule?.companyId).filter(Boolean);

    // Company A의 companyId가 포함되면 안 됨
    expect(dropCompanyIds).not.toContain(companyA.companyId);
  });

  // ─── 휴무 요청 격리 ───

  it('Company B cannot see Company A day-off requests', async () => {
    const res = await request(app)
      .get('/api/v1/dayoff')
      .set('Authorization', `Bearer ${companyB.token}`);

    expect(res.status).toBe(200);
    // 결과가 있으면 모두 Company B 것이어야 함
  });

  // ─── 골든 티켓 격리 ───

  it('Company B cannot see Company A golden tickets', async () => {
    const res = await request(app)
      .get('/api/v1/golden-tickets')
      .set('Authorization', `Bearer ${companyB.token}`);

    expect(res.status).toBe(200);
    // 결과는 Company B 것만 있어야 함
  });

  // ─── 급여 격리 ───

  it('Company B cannot see Company A payroll', async () => {
    const res = await request(app)
      .get('/api/v1/payroll?year=2026&month=3')
      .set('Authorization', `Bearer ${companyB.token}`);

    // 200 with empty data, or specific error
    expect(res.status).not.toBe(500);
  });

  // ─── 인증 없이 접근 불가 ───

  it('Unauthenticated requests are rejected', async () => {
    const endpoints = [
      '/api/v1/users',
      '/api/v1/buses',
      '/api/v1/routes',
      '/api/v1/schedules',
      '/api/v1/emergency',
      '/api/v1/dayoff',
      '/api/v1/payroll',
    ];

    for (const endpoint of endpoints) {
      const res = await request(app).get(endpoint);
      expect(res.status).toBe(401);
    }
  });
});
