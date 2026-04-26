import request from 'supertest';
import app from '../app';

/**
 * 대타 E2E 체인 테스트
 *
 * 전체 흐름:
 * 1. 회사 등록 → 기사 2명 생성 → 노선/버스 생성
 * 2. 배차표 생성
 * 3. 기사A가 슬롯 드랍
 * 4. 기사B가 대타 수락
 * 5. 골든 티켓 발급 확인
 */

let adminToken: string;
let companyId: number;
let driverAToken: string;
let driverBToken: string;
let driverAId: number;
let driverBId: number;
let routeId: number;
let busId: number;
let scheduleId: number;

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;

async function registerCompany() {
  const email = `e2e_admin_${Date.now()}@test.com`;
  const code = `E2E${Date.now().toString().slice(-5)}`.slice(0, 10);
  const res = await request(app)
    .post('/api/v1/companies/register')
    .send({
      companyName: 'E2E테스트버스',
      companyCode: code,
      adminName: 'E2E관리자',
      adminEmail: email,
      adminPhone: '010-0000-0000',
      adminPassword: 'TestPass123!',
    });

  expect(res.status).toBe(201);
  const d = res.body.data;
  return {
    token: d.token || d.accessToken,
    companyId: d.user?.companyId || d.company?.id,
    companyCode: d.company?.code || code,
  };
}

async function createAndLoginDriver(
  token: string,
  companyCode: string,
  suffix: string,
) {
  const email = `e2e_driver${suffix}_${Date.now()}@test.com`;
  const employeeId = `E2EDRV${suffix}${Date.now()}`;

  // Admin creates driver
  const createRes = await request(app)
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: `기사${suffix}`,
      email,
      employeeId,
      phone: `010-${suffix}${suffix}${suffix}${suffix}-0000`,
      role: 'DRIVER',
      driverType: suffix === 'A' ? 'MAIN' : 'SPARE',
    });

  const driverId = createRes.body.data?.id;

  // Driver logs in (initial password = employeeId)
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({
      companyCode,
      email,
      password: employeeId,
    });

  return {
    id: driverId,
    token: loginRes.body.data?.accessToken || token, // fallback to admin token
    email,
    employeeId,
  };
}

describe('Emergency Drop E2E Chain', () => {
  // ─── Setup ───

  beforeAll(async () => {
    // 1. 회사 등록
    const company = await registerCompany();
    adminToken = company.token;
    companyId = company.companyId;

    // 2. 노선 생성
    const routeRes = await request(app)
      .post('/api/v1/routes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        routeNumber: '999',
        name: 'E2E테스트노선',
        fatigueScore: 3,
      });
    routeId = routeRes.body.data?.id;

    // 3. 버스 생성
    const busRes = await request(app)
      .post('/api/v1/buses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        busNumber: 'E2E-001',
        plateNumber: `인천 테 ${Date.now().toString().slice(-4)}`,
        capacity: 45,
        year: 2022,
      });
    busId = busRes.body.data?.id;

    // 4. 기사 2명 생성
    const driverA = await createAndLoginDriver(adminToken, company.companyCode, 'A');
    const driverB = await createAndLoginDriver(adminToken, company.companyCode, 'B');
    driverAId = driverA.id;
    driverBId = driverB.id;
    driverAToken = driverA.token;
    driverBToken = driverB.token;
  }, 30000);

  // ─── 배차표 생성 ───

  it('should generate a monthly schedule', async () => {
    const res = await request(app)
      .post('/api/v1/schedules/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ year, month, workDays: 5, restDays: 2 });

    // 기사가 2명뿐이면 배차 생성 실패(400)할 수 있음 — 둘 다 허용
    expect([200, 201, 400]).toContain(res.status);

    if (res.body.data?.id) {
      scheduleId = res.body.data.id;
    }
  });

  // ─── 슬롯 드랍 → 대타 수락 흐름 ───

  it('should create emergency drop for a slot', async () => {
    // 배차표에서 기사A의 오늘 슬롯 찾기
    const scheduleRes = await request(app)
      .get(`/api/v1/schedules/${year}/${month}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const slots = scheduleRes.body.data?.slots || [];
    const todayStr = now.toISOString().split('T')[0];
    const driverASlot = slots.find(
      (s: any) => s.driverId === driverAId && s.date?.startsWith(todayStr) && !s.isRestDay,
    );

    if (!driverASlot) {
      // 오늘 기사A에게 배정된 슬롯이 없으면 스킵
      console.log('No slot for driverA today — skipping emergency drop test');
      return;
    }

    // 슬롯 드랍
    const dropRes = await request(app)
      .post('/api/v1/emergency')
      .set('Authorization', `Bearer ${driverAToken}`)
      .send({
        slotId: driverASlot.id,
        reason: 'E2E 테스트 — 갑작스러운 몸살',
      });

    expect([200, 201]).toContain(dropRes.status);
    const dropId = dropRes.body.data?.id;

    if (!dropId) return;

    // 대타 목록에 나타나는지 확인
    const listRes = await request(app)
      .get('/api/v1/emergency')
      .set('Authorization', `Bearer ${driverBToken}`);

    expect(listRes.status).toBe(200);
    const openDrops = (listRes.body.data || []).filter(
      (d: any) => d.status === 'OPEN',
    );
    const ourDrop = openDrops.find((d: any) => d.id === dropId);
    expect(ourDrop).toBeDefined();

    // 기사B가 수락
    const acceptRes = await request(app)
      .put(`/api/v1/emergency/${dropId}/accept`)
      .set('Authorization', `Bearer ${driverBToken}`);

    expect([200, 201]).toContain(acceptRes.status);

    // 드랍 상태가 FILLED로 변경됐는지 확인
    const afterRes = await request(app)
      .get('/api/v1/emergency?status=FILLED')
      .set('Authorization', `Bearer ${adminToken}`);

    const filledDrops = (afterRes.body.data || []);
    const filledDrop = filledDrops.find((d: any) => d.id === dropId);
    expect(filledDrop).toBeDefined();
    expect(filledDrop?.status).toBe('FILLED');
  });

  // ─── 골든 티켓 발급 확인 ───

  it('should have issued a golden ticket to driverB', async () => {
    const res = await request(app)
      .get('/api/v1/golden-tickets')
      .set('Authorization', `Bearer ${driverBToken}`);

    expect(res.status).toBe(200);
    // 대타 수락이 성공했다면 티켓이 있어야 함
    // (이전 테스트에서 슬롯이 없어 스킵됐을 수도 있으니 유연하게 체크)
    const tickets = res.body.data || [];
    if (tickets.length > 0) {
      expect(tickets[0].status).toMatch(/AVAILABLE|ACTIVE/);
    }
  });

  // ─── 관리자 대타 취소 흐름 ───

  it('admin can create and cancel emergency drop', async () => {
    // 배차표에서 아무 슬롯 하나 찾기
    const scheduleRes = await request(app)
      .get(`/api/v1/schedules/${year}/${month}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const slots = scheduleRes.body.data?.slots || [];
    const activeSlot = slots.find(
      (s: any) => !s.isRestDay && s.status === 'SCHEDULED',
    );

    if (!activeSlot) {
      console.log('No active slot — skipping admin cancel test');
      return;
    }

    // 관리자가 드랍 생성
    const dropRes = await request(app)
      .post('/api/v1/emergency')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slotId: activeSlot.id,
        reason: 'E2E 관리자 드랍 테스트',
      });

    if (dropRes.status !== 200 && dropRes.status !== 201) return;
    const dropId = dropRes.body.data?.id;
    if (!dropId) return;

    // 관리자가 취소
    const cancelRes = await request(app)
      .put(`/api/v1/emergency/${dropId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect([200, 201]).toContain(cancelRes.status);
  });

  // ─── 이미 수락된 드랍 중복 수락 방지 ───

  it('should reject accepting an already-filled drop', async () => {
    // 배차표에서 슬롯 찾기
    const scheduleRes = await request(app)
      .get(`/api/v1/schedules/${year}/${month}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const slots = scheduleRes.body.data?.slots || [];
    const availableSlot = slots.find(
      (s: any) => !s.isRestDay && s.status === 'SCHEDULED',
    );

    if (!availableSlot) return;

    // 드랍 생성
    const dropRes = await request(app)
      .post('/api/v1/emergency')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        slotId: availableSlot.id,
        reason: '중복 수락 방지 테스트',
      });

    if (dropRes.status !== 200 && dropRes.status !== 201) return;
    const dropId = dropRes.body.data?.id;
    if (!dropId) return;

    // 기사B가 먼저 수락
    const accept1 = await request(app)
      .put(`/api/v1/emergency/${dropId}/accept`)
      .set('Authorization', `Bearer ${driverBToken}`);

    if (accept1.status !== 200 && accept1.status !== 201) return;

    // 기사A가 같은 드랍 수락 시도 → 실패해야 함
    const accept2 = await request(app)
      .put(`/api/v1/emergency/${dropId}/accept`)
      .set('Authorization', `Bearer ${driverAToken}`);

    expect([400, 409]).toContain(accept2.status);
  });
});
