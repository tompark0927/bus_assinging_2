import { Response } from 'express';
import {
  getEmergencyDrops,
  createEmergencyDrop,
  acceptEmergencySlot,
  cancelEmergencyDrop,
  getManualFillCandidates,
  manualFillEmergency,
} from '../../controllers/emergencyController';
import {
  wouldExceedWeeklyWork,
  filterEligibleDropsForDriver,
} from '../../services/weeklyRestEligibility';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/auth';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../services/notificationService', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  sendBulkPushNotifications: jest.fn().mockResolvedValue(undefined),
  notifyAvailableDriversForEmergency: jest.fn().mockResolvedValue(undefined),
  notifyAdminsUrgentEmergency: jest.fn().mockResolvedValue(undefined),
  notifyAdminsNewDrop: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/emergencyAgentRunner', () => ({
  dispatchImmediateEmergency: jest.fn(),
  isEmergencyAgentEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock('../../services/socketService', () => ({
  emitToCompany: jest.fn(),
}));

// 주휴일 자격 검사는 별도 단위 테스트(weeklyRestEligibility.unit)에서 검증한다.
// 컨트롤러 테스트에서는 "적격(통과)" 로 스텁해 컨트롤러 로직에 집중한다.
jest.mock('../../services/weeklyRestEligibility', () => ({
  wouldExceedWeeklyWork: jest
    .fn()
    .mockResolvedValue({ eligible: true, weeklyWorkDays: 0, maxDays: 6, ruleEnabled: true }),
  filterEligibleDropsForDriver: jest.fn((_driverId: number, drops: unknown[]) =>
    Promise.resolve(drops),
  ),
}));

jest.mock('../../services/solverDispatchService', () => ({
  loadCompanyPolicy: jest.fn().mockResolvedValue({}),
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, jest.Mock>>;

function createMockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function createAuthReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { id: 10, companyId: 1, email: 'driver@test.busync.kr', role: 'DRIVER', name: '김기사' },
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as AuthRequest;
}

// ─────────────────────────────────────────
// getEmergencyDrops
// ─────────────────────────────────────────

describe('getEmergencyDrops controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated emergency drops (defaults to OPEN status)', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    const drops = [
      { id: 1, status: 'OPEN', slot: { route: { routeNumber: '780' } }, driver: { name: '김기사' } },
    ];

    mockPrisma.emergencyDrop.findMany.mockResolvedValue(drops);
    mockPrisma.emergencyDrop.count.mockResolvedValue(1);

    await getEmergencyDrops(req, res);

    // agentEnabled: AI 충원 에이전트 활성 여부가 응답에 포함됨
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: drops, agentEnabled: false }),
    );
  });

  it('should filter by status query param', async () => {
    const req = createAuthReq({ query: { status: 'FILLED' } });
    const res = createMockRes();

    mockPrisma.emergencyDrop.findMany.mockResolvedValue([]);
    mockPrisma.emergencyDrop.count.mockResolvedValue(0);

    await getEmergencyDrops(req, res);

    expect(mockPrisma.emergencyDrop.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'FILLED' }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.emergencyDrop.findMany.mockRejectedValue(new Error('DB error'));

    await getEmergencyDrops(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// createEmergencyDrop
// ─────────────────────────────────────────

describe('createEmergencyDrop controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 400 if slotId or reason is missing', async () => {
    const req = createAuthReq({ body: { slotId: 100 } });
    const res = createMockRes();

    await createEmergencyDrop(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 404 if slot not found', async () => {
    const req = createAuthReq({ body: { slotId: 999, reason: '몸이 안 좋아서' } });
    const res = createMockRes();

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue(null);

    await createEmergencyDrop(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 404 if slot belongs to different company', async () => {
    const req = createAuthReq({ body: { slotId: 100, reason: '긴급' } });
    const res = createMockRes();

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue({
      id: 100, driverId: 10, isRestDay: false,
      route: { routeNumber: '780' },
      schedule: { companyId: 999 },
    });

    await createEmergencyDrop(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 403 when DRIVER drops slot belonging to another driver', async () => {
    const req = createAuthReq({ body: { slotId: 100, reason: '긴급' } });
    const res = createMockRes();

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue({
      id: 100, driverId: 20, isRestDay: false,
      route: { routeNumber: '780' },
      schedule: { companyId: 1 },
    });

    await createEmergencyDrop(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should return 400 when slot is a rest day', async () => {
    const req = createAuthReq({ body: { slotId: 100, reason: '긴급' } });
    const res = createMockRes();

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue({
      id: 100, driverId: 10, isRestDay: true,
      route: { routeNumber: '780' },
      schedule: { companyId: 1 },
    });

    await createEmergencyDrop(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('휴무일') }),
    );
  });

  it('should return 400 when slot date is in the past', async () => {
    const req = createAuthReq({ body: { slotId: 100, reason: '긴급' } });
    const res = createMockRes();

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue({
      id: 100, driverId: 10, isRestDay: false,
      date: pastDate,
      route: { routeNumber: '780' },
      schedule: { companyId: 1 },
    });

    await createEmergencyDrop(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('지난 날짜') }),
    );
  });

  it('should return 409 when slot already dropped', async () => {
    const req = createAuthReq({ body: { slotId: 100, reason: '긴급' } });
    const res = createMockRes();

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue({
      id: 100, driverId: 10, isRestDay: false,
      date: futureDate,
      route: { routeNumber: '780' },
      schedule: { companyId: 1 },
    });
    mockPrisma.emergencyDrop.findUnique.mockResolvedValue({ id: 1 });

    await createEmergencyDrop(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('should create drop, update slot, and notify resting drivers + admins', async () => {
    const req = createAuthReq({ body: { slotId: 100, reason: '가족 긴급 상황' } });
    const res = createMockRes();

    // D-2 보다 여유 있는 미래 날짜 → 비긴급 경로 (notifyAdminsNewDrop)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue({
      id: 100, driverId: 10, isRestDay: false,
      date: futureDate,
      shift: 'FULL_DAY',
      routeId: 1,
      route: { routeNumber: '780' },
      driver: { name: '김기사' },
      schedule: { companyId: 1 },
    });
    mockPrisma.emergencyDrop.findUnique.mockResolvedValue(null);
    mockPrisma.emergencyDrop.create.mockResolvedValue({
      id: 5, slotId: 100, driverId: 10, status: 'OPEN',
    });
    mockPrisma.scheduleSlot.update.mockResolvedValue({ id: 100, status: 'DROPPED' });

    await createEmergencyDrop(req, res);

    const { notifyAvailableDriversForEmergency, notifyAdminsNewDrop } =
      require('../../services/notificationService');
    expect(notifyAvailableDriversForEmergency).toHaveBeenCalledWith(
      5, futureDate, 1, 1, false,
    );
    expect(notifyAdminsNewDrop).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 1, dropId: 5, routeNumber: '780' }),
    );
    // 드랍 기사 = 슬롯 주인 (본인 드랍이므로 req.user.id 와 동일한 10)
    expect(mockPrisma.emergencyDrop.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slotId: 100, driverId: 10, status: 'OPEN' }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('관리자가 다른 기사 슬롯을 드랍하면 드랍 기사=슬롯 주인(요청자 아님)', async () => {
    // 관리자(id 99)가 기사(id 10)의 슬롯을 대신 드랍
    const req = createAuthReq({
      user: { id: 99, companyId: 1, email: 'admin@test', role: 'ADMIN', name: '관리자' },
      body: { slotId: 100, reason: '관리자 대행 드랍' },
    } as never);
    const res = createMockRes();

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue({
      id: 100, driverId: 10, isRestDay: false,
      date: futureDate, shift: 'FULL_DAY', routeId: 1,
      route: { routeNumber: '780' },
      driver: { name: '김기사' },
      schedule: { companyId: 1 },
    });
    mockPrisma.emergencyDrop.findUnique.mockResolvedValue(null);
    mockPrisma.emergencyDrop.create.mockResolvedValue({ id: 6, slotId: 100, driverId: 10, status: 'OPEN' });
    mockPrisma.scheduleSlot.update.mockResolvedValue({ id: 100, status: 'DROPPED' });

    await createEmergencyDrop(req, res);

    // 핵심: driverId 가 요청 관리자(99)가 아니라 슬롯 주인(10) 이어야 한다
    expect(mockPrisma.emergencyDrop.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slotId: 100, driverId: 10 }),
      }),
    );
    const createArg = mockPrisma.emergencyDrop.create.mock.calls[0][0];
    expect(createArg.data.driverId).not.toBe(99);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ body: { slotId: 100, reason: '긴급' } });
    const res = createMockRes();

    mockPrisma.scheduleSlot.findUnique.mockRejectedValue(new Error('DB error'));

    await createEmergencyDrop(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// acceptEmergencySlot
// ─────────────────────────────────────────

describe('acceptEmergencySlot controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should accept open emergency drop', async () => {
    const req = createAuthReq({
      params: { id: '5' },
      user: { id: 20, companyId: 1, email: 'sub@test.com', role: 'DRIVER', name: '이기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.emergencyDrop.findUnique.mockResolvedValue({
      id: 5, status: 'OPEN', slotId: 100, driverId: 10,
      slot: { date: new Date('2026-03-20'), route: { routeNumber: '780' } },
      driver: { id: 10, name: '김기사', companyId: 1 },
    });
    // Functional transaction mock: execute the callback with mock tx
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => {
      if (typeof fn === 'function') {
        return fn({
          emergencyDrop: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          scheduleSlot: { update: jest.fn().mockResolvedValue({ id: 100 }) },
        });
      }
      return [{ id: 5, status: 'FILLED' }, { id: 100 }];
    });
    mockPrisma.user.findMany.mockResolvedValue([{ id: 1 }]);

    await acceptEmergencySlot(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('수락') }),
    );
  });

  it('should return 404 when drop not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.emergencyDrop.findUnique.mockResolvedValue(null);

    await acceptEmergencySlot(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 400 when drop is not OPEN', async () => {
    const req = createAuthReq({ params: { id: '5' } });
    const res = createMockRes();

    mockPrisma.emergencyDrop.findUnique.mockResolvedValue({
      id: 5, status: 'FILLED',
      driver: { id: 10, companyId: 1 },
    });

    await acceptEmergencySlot(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 for invalid id param', async () => {
    const req = createAuthReq({ params: { id: 'abc' } });
    const res = createMockRes();

    await acceptEmergencySlot(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  // ── 자가 수락 동일일자 가드 — 이중 배정의 최단 경로 차단 ──

  it('같은 날 이미 근무가 있으면 409로 거부하고 슬롯을 건드리지 않는다', async () => {
    const req = createAuthReq({
      params: { id: '5' },
      user: { id: 20, companyId: 1, email: 'sub@test.com', role: 'DRIVER', name: '이기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.emergencyDrop.findUnique.mockResolvedValue({
      id: 5, status: 'OPEN', slotId: 100, driverId: 10,
      slot: { date: new Date('2026-03-20'), route: { routeNumber: '780' } },
      driver: { id: 10, name: '김기사', companyId: 1 },
    });
    // 수락하려는 기사(20)가 같은 날 다른 슬롯에 이미 배정됨
    mockPrisma.scheduleSlot.findFirst.mockResolvedValue({ id: 777 });

    await acceptEmergencySlot(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('이미 배정된 근무') }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('충돌 검사는 관리자 경로와 같은 술어를 쓴다 (휴무·드랍 제외, 본인 슬롯 제외)', async () => {
    const req = createAuthReq({
      params: { id: '5' },
      user: { id: 20, companyId: 1, email: 'sub@test.com', role: 'DRIVER', name: '이기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.emergencyDrop.findUnique.mockResolvedValue({
      id: 5, status: 'OPEN', slotId: 100, driverId: 10,
      slot: { date: new Date('2026-03-20'), route: { routeNumber: '780' } },
      driver: { id: 10, name: '김기사', companyId: 1 },
    });
    mockPrisma.scheduleSlot.findFirst.mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: (tx: unknown) => unknown) =>
      fn({
        emergencyDrop: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        scheduleSlot: { update: jest.fn().mockResolvedValue({ id: 100 }) },
      }),
    );
    mockPrisma.user.findMany.mockResolvedValue([{ id: 1 }]);

    await acceptEmergencySlot(req, res);

    expect(mockPrisma.scheduleSlot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          driverId: 20,
          isRestDay: false,
          id: { not: 100 },
          status: { in: ['SCHEDULED', 'FILLED'] },
          schedule: { companyId: 1 },
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// ─────────────────────────────────────────
// cancelEmergencyDrop
// ─────────────────────────────────────────

describe('cancelEmergencyDrop controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should cancel drop and restore slot status', async () => {
    const req = createAuthReq({
      params: { id: '5' },
      user: { id: 1, companyId: 1, email: 'admin@test.com', role: 'ADMIN', name: '관리자' },
    } as any);
    const res = createMockRes();

    mockPrisma.emergencyDrop.findUnique.mockResolvedValue({
      id: 5, slotId: 100, driver: { companyId: 1 },
    });
    mockPrisma.emergencyDrop.update.mockResolvedValue({ id: 5, status: 'CANCELLED' });
    mockPrisma.scheduleSlot.update.mockResolvedValue({ id: 100, status: 'SCHEDULED' });

    await cancelEmergencyDrop(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('취소') }),
    );
  });

  it('should return 404 when drop not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.emergencyDrop.findUnique.mockResolvedValue(null);

    await cancelEmergencyDrop(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ params: { id: '5' } });
    const res = createMockRes();

    mockPrisma.emergencyDrop.findUnique.mockRejectedValue(new Error('DB error'));

    await cancelEmergencyDrop(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// 주휴일(근로기준법 제55조) 가드
//
// 이 가드는 2026-07 에 넣었다가 머지에서 통째로 유실된 적이 있다(6b2f8ea →
// aff1296). 그때 살아남은 건 테스트 한 건뿐이었고, 서비스 코드와 화면 배지는
// 남아 있는데 컨트롤러만 검사를 안 하는 상태로 몇 주를 갔다.
// 그래서 "컨트롤러가 검사를 부르는가" 자체를 경로별로 못 박아 둔다.
// ─────────────────────────────────────────

const mockRestCheck = wouldExceedWeeklyWork as unknown as jest.Mock;
const mockDropFilter = filterEligibleDropsForDriver as unknown as jest.Mock;

/** 그 주 상한(6일)에 도달한 기사 */
const AT_LIMIT = { eligible: false, weeklyWorkDays: 6, maxDays: 6, ruleEnabled: true };
/** 아직 여유가 있는 기사 */
const OK = { eligible: true, weeklyWorkDays: 3, maxDays: 6, ruleEnabled: true };

describe('주휴일 가드 — 기사 앱 대타 목록', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDropFilter.mockImplementation((_d: number, drops: unknown[]) => Promise.resolve(drops));
  });

  it('기사에게는 주휴일 위반이 되는 대타를 목록에서 뺀다', async () => {
    const req = createAuthReq({ query: {} }); // role: DRIVER, status 기본 OPEN
    const res = createMockRes();
    const drops = [
      { id: 1, driverId: 99, slot: { date: new Date('2026-03-21') } },
      { id: 2, driverId: 98, slot: { date: new Date('2026-03-28') } },
    ];
    mockPrisma.emergencyDrop.findMany.mockResolvedValue(drops);
    mockPrisma.emergencyDrop.count.mockResolvedValue(2);
    // 첫 건은 그 주 상한이라 걸러진다
    mockDropFilter.mockResolvedValue([drops[1]]);

    await getEmergencyDrops(req, res);

    expect(mockDropFilter).toHaveBeenCalledWith(10, drops, 1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: [drops[1]] }));
  });

  it('관리자에게는 전체 현황을 그대로 보여준다 (필터하지 않는다)', async () => {
    const req = createAuthReq({
      query: {},
      user: { id: 1, companyId: 1, email: 'a@t.com', role: 'ADMIN', name: '관리자' },
    } as never);
    const res = createMockRes();
    const drops = [{ id: 1, driverId: 99, slot: { date: new Date('2026-03-21') } }];
    mockPrisma.emergencyDrop.findMany.mockResolvedValue(drops);
    mockPrisma.emergencyDrop.count.mockResolvedValue(1);

    await getEmergencyDrops(req, res);

    expect(mockDropFilter).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: drops }));
  });
});

describe('주휴일 가드 — 기사 자가 수락', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.scheduleSlot.findFirst.mockResolvedValue(null); // 같은 날 중복 없음
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        emergencyDrop: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        scheduleSlot: { update: jest.fn().mockResolvedValue({ id: 100 }) },
      }),
    );
    mockPrisma.user.findMany.mockResolvedValue([]);
  });

  const openDrop = () =>
    mockPrisma.emergencyDrop.findUnique.mockResolvedValue({
      id: 5, status: 'OPEN', slotId: 100, driverId: 99,
      slot: { date: new Date('2026-03-20'), route: { routeNumber: '780' } },
      driver: { id: 99, name: '김기사', companyId: 1 },
    });

  it('그 주 상한에 도달한 기사의 수락을 409 로 막는다', async () => {
    openDrop();
    mockRestCheck.mockResolvedValue(AT_LIMIT);
    const res = createMockRes();

    await acceptEmergencySlot(createAuthReq({ params: { id: '5' } }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'WEEKLY_REST_VIOLATION' }),
    );
  });

  it('검사는 트랜잭션 안에서 돈다 — 동시 수락 경쟁을 막기 위함', async () => {
    openDrop();
    mockRestCheck.mockResolvedValue(OK);
    const res = createMockRes();

    await acceptEmergencySlot(createAuthReq({ params: { id: '5' } }), res);

    // 첫 인자가 prisma 본체가 아니라 트랜잭션 클라이언트(tx)여야 한다
    const [db] = mockRestCheck.mock.calls[0];
    expect(db).not.toBe(prisma);
    expect(db).toHaveProperty('emergencyDrop');
  });

  it('여유가 있으면 정상 수락된다', async () => {
    openDrop();
    mockRestCheck.mockResolvedValue(OK);
    const res = createMockRes();

    await acceptEmergencySlot(createAuthReq({ params: { id: '5' } }), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('주휴일 가드 — 관리자 수동 배정', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.scheduleSlot.findFirst.mockResolvedValue(null);
    mockPrisma.emergencyDrop.findUnique.mockResolvedValue({
      id: 5, status: 'OPEN', slotId: 100, driverId: 99,
      slot: { id: 100, date: new Date('2026-03-20'), route: { routeNumber: '780' } },
      driver: { id: 99, name: '김기사', companyId: 1 },
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 20, name: '이기사', companyId: 1, role: 'DRIVER', isActive: true,
    });
  });

  const adminReq = (body: Record<string, unknown>) =>
    createAuthReq({
      params: { id: '5' },
      body,
      user: { id: 1, companyId: 1, email: 'a@t.com', role: 'ADMIN', name: '관리자' },
    } as never);

  it('후보 목록에 위반 여부를 표시한다 — 후보에서 빼지는 않는다', async () => {
    const res = createMockRes();
    mockPrisma.scheduleSlot.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 20, name: '이기사', employeeId: 'DRV020', driverType: 'MAIN', isActive: true },
    ]);
    mockRestCheck.mockResolvedValue(AT_LIMIT);

    await getManualFillCandidates(adminReq({}), res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({
          id: 20,
          weeklyRestViolation: true,
          weeklyWorkDays: 6,
          maxWeeklyWorkDays: 6,
        }),
      ],
    });
  });

  it('사유 없이 위반 기사를 배정하면 409 로 사유를 요구한다', async () => {
    const res = createMockRes();
    mockRestCheck.mockResolvedValue(AT_LIMIT);

    await manualFillEmergency(adminReq({ driverId: 20 }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'WEEKLY_REST_OVERRIDE_REQUIRED',
        requiresOverride: true,
        weeklyWorkDays: 6,
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('사유를 입력하면 강제 배정하되 슬롯에 사유를 남긴다', async () => {
    const res = createMockRes();
    mockRestCheck.mockResolvedValue(AT_LIMIT);
    const slotUpdate = jest.fn().mockResolvedValue({ id: 100 });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        emergencyDrop: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        scheduleSlot: { update: slotUpdate },
      }),
    );

    await manualFillEmergency(
      adminReq({ driverId: 20, override: true, overrideReason: '대체 인력 없음' }),
      res,
    );

    expect(slotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          driverId: 20,
          isManualOverride: true,
          overrideReason: expect.stringContaining('대체 인력 없음'),
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('위반이 아니면 오버라이드 기록을 남기지 않는다', async () => {
    const res = createMockRes();
    mockRestCheck.mockResolvedValue(OK);
    const slotUpdate = jest.fn().mockResolvedValue({ id: 100 });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        emergencyDrop: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        scheduleSlot: { update: slotUpdate },
      }),
    );

    await manualFillEmergency(adminReq({ driverId: 20 }), res);

    expect(slotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { driverId: 20, status: 'FILLED' } }),
    );
  });
});
