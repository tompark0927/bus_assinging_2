import { Response } from 'express';
import {
  getDayOffRequests,
  createDayOffRequest,
  reviewDayOffRequest,
  cancelDayOffRequest,
} from '../../controllers/dayoffController';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/auth';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../services/notificationService', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  notifyAdminsNewDayoffRequest: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/emergencyAgentRunner', () => ({
  dispatchImmediateEmergency: jest.fn(),
  isEmergencyAgentEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock('../../services/socketService', () => ({
  emitToUser: jest.fn(),
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
    user: { id: 1, companyId: 1, email: 'admin@test.busync.kr', role: 'ADMIN', name: '관리자' },
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as AuthRequest;
}

// ─────────────────────────────────────────
// getDayOffRequests
// ─────────────────────────────────────────

describe('getDayOffRequests controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated requests for ADMIN', async () => {
    const req = createAuthReq({ query: { page: '1' } });
    const res = createMockRes();

    const requests = [
      { id: 1, driverId: 10, date: new Date('2026-03-20'), status: 'PENDING', driver: { id: 10, name: '김기사' } },
    ];

    mockPrisma.dayOffRequest.findMany.mockResolvedValue(requests);
    mockPrisma.dayOffRequest.count.mockResolvedValue(1);

    await getDayOffRequests(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: requests }),
    );
  });

  it('should filter by driver for DRIVER role', async () => {
    const req = createAuthReq({
      query: {},
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.dayOffRequest.findMany.mockResolvedValue([]);
    mockPrisma.dayOffRequest.count.mockResolvedValue(0);

    await getDayOffRequests(req, res);

    expect(mockPrisma.dayOffRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ driverId: 10 }),
      }),
    );
  });

  it('should filter by status', async () => {
    const req = createAuthReq({ query: { status: 'PENDING' } });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findMany.mockResolvedValue([]);
    mockPrisma.dayOffRequest.count.mockResolvedValue(0);

    await getDayOffRequests(req, res);

    expect(mockPrisma.dayOffRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findMany.mockRejectedValue(new Error('DB error'));

    await getDayOffRequests(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// createDayOffRequest
// ─────────────────────────────────────────

describe('createDayOffRequest controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 400 if date is missing', async () => {
    const req = createAuthReq({ body: { reason: '개인 사정' } });
    const res = createMockRes();

    await createDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 409 if duplicate request exists', async () => {
    // 미래 날짜 사용 (과거 날짜 검증 통과)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const req = createAuthReq({ body: { date: futureDateStr, reason: '가족 행사' } });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockResolvedValue({ id: 1 });

    await createDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('이미') }),
    );
  });

  it('should create request and notify admins', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const req = createAuthReq({
      body: { date: futureDateStr, reason: '병원 진료' },
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockResolvedValue(null);
    mockPrisma.dayOffRequest.create.mockResolvedValue({
      id: 5, driverId: 10, date: new Date(futureDateStr), status: 'PENDING',
      driver: { id: 10, name: '김기사', employeeId: 'DRV010' },
    });
    mockPrisma.user.findMany.mockResolvedValue([{ id: 1 }]);

    await createDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 500 on error', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const futureDateStr = futureDate.toISOString().split('T')[0];

    const req = createAuthReq({ body: { date: futureDateStr } });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockRejectedValue(new Error('DB error'));

    await createDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// reviewDayOffRequest
// ─────────────────────────────────────────

describe('reviewDayOffRequest controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 400 for invalid status', async () => {
    const req = createAuthReq({ params: { id: '1' }, body: { status: 'INVALID' } });
    const res = createMockRes();

    await reviewDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 404 when request not found', async () => {
    const req = createAuthReq({ params: { id: '999' }, body: { status: 'APPROVED' } });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockResolvedValue(null);

    await reviewDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 400 when request is already processed', async () => {
    const req = createAuthReq({ params: { id: '1' }, body: { status: 'APPROVED' } });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockResolvedValue({ id: 1, status: 'APPROVED' });

    await reviewDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('이미 처리된') }),
    );
  });

  it('should approve request and notify driver', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      body: { status: 'APPROVED' },
    });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockResolvedValue({
      id: 1, status: 'PENDING', driverId: 10, date: new Date('2026-03-25'),
    });
    mockPrisma.dayOffRequest.update.mockResolvedValue({
      id: 1, status: 'APPROVED', driverId: 10, date: new Date('2026-03-25'),
      driver: { id: 10, name: '김기사' },
    });
    // 드랍/대타는 발행된(PUBLISHED) 배차표에만 생성 — 발행본 없음 → 슬롯 드랍 없이 승인만
    mockPrisma.schedule.findFirst.mockResolvedValue(null);

    await reviewDayOffRequest(req, res);

    expect(mockPrisma.schedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, slotNotified: false }),
    );
  });

  it('should reject request with reviewNote', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      body: { status: 'REJECTED', reviewNote: '인력 부족으로 불가' },
    });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockResolvedValue({
      id: 1, status: 'PENDING', driverId: 10,
    });
    mockPrisma.dayOffRequest.update.mockResolvedValue({
      id: 1, status: 'REJECTED', driverId: 10, date: new Date('2026-03-25'),
      driver: { id: 10, name: '김기사' },
    });

    await reviewDayOffRequest(req, res);

    expect(mockPrisma.dayOffRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED', reviewNote: '인력 부족으로 불가' }),
      }),
    );
  });

  it('should return 400 for invalid id param', async () => {
    const req = createAuthReq({ params: { id: 'abc' }, body: { status: 'APPROVED' } });
    const res = createMockRes();

    await reviewDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─────────────────────────────────────────
// cancelDayOffRequest
// ─────────────────────────────────────────

describe('cancelDayOffRequest controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should cancel pending request', async () => {
    const req = createAuthReq({ params: { id: '1' } });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockResolvedValue({
      id: 1, status: 'PENDING', driverId: 1,
    });
    mockPrisma.dayOffRequest.delete.mockResolvedValue({ id: 1 });

    await cancelDayOffRequest(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('취소') }),
    );
  });

  it('should return 404 when request not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockResolvedValue(null);

    await cancelDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 403 when DRIVER cancels another driver\'s request', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      user: { id: 20, companyId: 1, email: 'other@test.com', role: 'DRIVER', name: '다른기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockResolvedValue({
      id: 1, status: 'PENDING', driverId: 10,
    });

    await cancelDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should return 400 when trying to cancel approved request', async () => {
    const req = createAuthReq({ params: { id: '1' } });
    const res = createMockRes();

    mockPrisma.dayOffRequest.findFirst.mockResolvedValue({
      id: 1, status: 'APPROVED', driverId: 1,
    });

    await cancelDayOffRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
