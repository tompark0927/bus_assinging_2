import { Response } from 'express';
import {
  getEmergencyDrops,
  createEmergencyDrop,
  acceptEmergencySlot,
  cancelEmergencyDrop,
} from '../../controllers/emergencyController';
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
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
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
