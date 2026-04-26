import { Response } from 'express';
import {
  getScheduleList,
  getSchedule,
  generateSchedule,
  publishSchedule,
  updateScheduleSlot,
  deleteSchedule,
  exportScheduleExcel,
} from '../../controllers/scheduleController';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/auth';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../services/notificationService', () => ({
  sendBulkPushNotifications: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/auditLog', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/scheduleService', () => ({
  generateMonthlySchedule: jest.fn().mockResolvedValue({ scheduleId: 1, slotsCreated: 90, warnings: [], fairnessReport: null }),
  getScheduleWithSlots: jest.fn().mockResolvedValue({
    id: 1, year: 2026, month: 3, status: 'DRAFT', slots: [],
  }),
  updateSlot: jest.fn().mockResolvedValue({ id: 1, driverId: 10 }),
}));

jest.mock('../../services/excelService', () => ({
  generateScheduleExcel: jest.fn().mockResolvedValue(Buffer.from('xlsx-data')),
}));

jest.mock('../../services/aiService', () => ({
  generateScheduleWithAI: jest.fn(),
}));

jest.mock('../../services/socketService', () => ({
  emitToCompany: jest.fn(),
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, jest.Mock>>;

function createMockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
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
// getScheduleList
// ─────────────────────────────────────────

describe('getScheduleList controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated schedule list', async () => {
    const req = createAuthReq({ query: { page: '1', limit: '10' } });
    const res = createMockRes();

    const schedules = [
      { id: 1, year: 2026, month: 3, status: 'DRAFT', createdAt: new Date(), _count: { slots: 90 } },
      { id: 2, year: 2026, month: 2, status: 'PUBLISHED', createdAt: new Date(), _count: { slots: 84 } },
    ];

    mockPrisma.schedule.findMany.mockResolvedValue(schedules);
    mockPrisma.schedule.count.mockResolvedValue(2);

    await getScheduleList(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: schedules,
        pagination: expect.objectContaining({ page: 1, total: 2 }),
      }),
    );
  });

  it('should return empty list when no schedules exist', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.schedule.findMany.mockResolvedValue([]);
    mockPrisma.schedule.count.mockResolvedValue(0);

    await getScheduleList(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: [] }),
    );
  });

  it('should return 500 on DB error', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.schedule.findMany.mockRejectedValue(new Error('DB error'));

    await getScheduleList(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// getSchedule
// ─────────────────────────────────────────

describe('getSchedule controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return schedule with slots for ADMIN', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    await getSchedule(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.any(Object) }),
    );
  });

  it('should return only driver\'s own slots for DRIVER role', async () => {
    const req = createAuthReq({
      params: { year: '2026', month: '3' },
      user: { id: 10, companyId: 1, email: 'driver@test.busync.kr', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    const scheduleData = {
      id: 1, year: 2026, month: 3, status: 'PUBLISHED',
      slots: [{ id: 100, driverId: 10, date: new Date('2026-03-01') }],
    };
    mockPrisma.schedule.findUnique.mockResolvedValue(scheduleData);

    await getSchedule(req, res);

    expect(mockPrisma.schedule.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          slots: expect.objectContaining({
            where: { driverId: 10 },
          }),
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: scheduleData });
  });

  it('should return null data when schedule does not exist (DRIVER)', async () => {
    const req = createAuthReq({
      params: { year: '2025', month: '1' },
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '이기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockResolvedValue(null);

    await getSchedule(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: null });
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    const { getScheduleWithSlots } = require('../../services/scheduleService');
    getScheduleWithSlots.mockRejectedValue(new Error('DB error'));

    await getSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// generateSchedule
// ─────────────────────────────────────────

describe('generateSchedule controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // generateSchedule 컨트롤러가 companyRule을 DB에서 조회하므로 기본 mock 필요
    (prisma.companyRule as any).findMany.mockResolvedValue([]);
  });

  it('should return 400 if year is missing', async () => {
    const req = createAuthReq({ body: { month: 3 } });
    const res = createMockRes();

    await generateSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '연도와 월을 입력해주세요.' }),
    );
  });

  it('should return 400 if month is missing', async () => {
    const req = createAuthReq({ body: { year: 2026 } });
    const res = createMockRes();

    await generateSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should generate schedule with default 5/2 cycle', async () => {
    const req = createAuthReq({ body: { year: 2026, month: 4 } });
    const res = createMockRes();

    await generateSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ slotsCreated: 90 }),
        message: expect.stringContaining('2026년 4월'),
      }),
    );
  });

  it('should use custom workDays/restDays when provided', async () => {
    const { generateMonthlySchedule } = require('../../services/scheduleService');
    const req = createAuthReq({ body: { year: 2026, month: 4, workDays: 4, restDays: 1 } });
    const res = createMockRes();

    await generateSchedule(req, res);

    expect(generateMonthlySchedule).toHaveBeenCalledWith(1, 2026, 4, 1, { workDays: 4, restDays: 1 });
  });

  it('should return 400 when service throws known error', async () => {
    const { generateMonthlySchedule } = require('../../services/scheduleService');
    generateMonthlySchedule.mockRejectedValue(new Error('이미 해당 월의 배차표가 존재합니다.'));

    const req = createAuthReq({ body: { year: 2026, month: 3 } });
    const res = createMockRes();

    await generateSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '이미 해당 월의 배차표가 존재합니다.' }),
    );
  });
});

// ─────────────────────────────────────────
// publishSchedule
// ─────────────────────────────────────────

describe('publishSchedule controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should publish schedule and notify drivers', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockResolvedValue({
      id: 1, year: 2026, month: 3, status: 'DRAFT', companyId: 1,
    });
    mockPrisma.schedule.update.mockResolvedValue({
      id: 1, year: 2026, month: 3, status: 'PUBLISHED',
    });
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 10 }, { id: 11 }, { id: 12 },
    ]);

    await publishSchedule(req, res);

    expect(mockPrisma.schedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'PUBLISHED' },
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining('2026년 3월'),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockResolvedValue({ id: 1, status: 'DRAFT', companyId: 1 });
    mockPrisma.schedule.update.mockRejectedValue(new Error('DB error'));

    await publishSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// updateScheduleSlot
// ─────────────────────────────────────────

describe('updateScheduleSlot controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should update slot successfully', async () => {
    const req = createAuthReq({
      params: { slotId: '100' },
      body: { driverId: 11, shift: 'MORNING' },
    });
    const res = createMockRes();

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue({
      id: 100, driverId: 10, shift: 'FULL_DAY',
      schedule: { companyId: 1, status: 'DRAFT' },
    });

    await updateScheduleSlot(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.any(Object) }),
    );
  });

  it('should return 404 when slot not found', async () => {
    const req = createAuthReq({ params: { slotId: '999' }, body: {} });
    const res = createMockRes();

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue(null);

    await updateScheduleSlot(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 404 when slot belongs to different company', async () => {
    const req = createAuthReq({ params: { slotId: '100' }, body: {} });
    const res = createMockRes();

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue({
      id: 100, schedule: { companyId: 999, status: 'DRAFT' },
    });

    await updateScheduleSlot(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 400 when schedule is PUBLISHED', async () => {
    const req = createAuthReq({ params: { slotId: '100' }, body: {} });
    const res = createMockRes();

    mockPrisma.scheduleSlot.findUnique.mockResolvedValue({
      id: 100, schedule: { companyId: 1, status: 'PUBLISHED' },
    });

    await updateScheduleSlot(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('발행된') }),
    );
  });

  it('should return 400 for invalid slotId', async () => {
    const req = createAuthReq({ params: { slotId: 'abc' }, body: {} });
    const res = createMockRes();

    await updateScheduleSlot(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 500 on unexpected error', async () => {
    const req = createAuthReq({ params: { slotId: '100' }, body: {} });
    const res = createMockRes();

    mockPrisma.scheduleSlot.findUnique.mockRejectedValue(new Error('DB error'));

    await updateScheduleSlot(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// deleteSchedule
// ─────────────────────────────────────────

describe('deleteSchedule controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should delete DRAFT schedule successfully', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '4' } });
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockResolvedValue({
      id: 5, companyId: 1, year: 2026, month: 4, status: 'DRAFT',
    });
    mockPrisma.scheduleSlot.deleteMany.mockResolvedValue({ count: 90 });
    mockPrisma.schedule.delete.mockResolvedValue({ id: 5 });

    await deleteSchedule(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('삭제') }),
    );
  });

  it('should return 404 when schedule not found', async () => {
    const req = createAuthReq({ params: { year: '2025', month: '1' } });
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockResolvedValue(null);

    await deleteSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 400 when schedule is PUBLISHED', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockResolvedValue({
      id: 1, status: 'PUBLISHED',
    });

    await deleteSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('발행된') }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findUnique.mockRejectedValue(new Error('DB error'));

    await deleteSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// exportScheduleExcel
// ─────────────────────────────────────────

describe('exportScheduleExcel controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should send excel file buffer', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    await exportScheduleExcel(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.send).toHaveBeenCalled();
  });

  it('should return 400 when service throws known error', async () => {
    const { generateScheduleExcel } = require('../../services/excelService');
    generateScheduleExcel.mockRejectedValue(new Error('배차표가 존재하지 않습니다.'));

    const req = createAuthReq({ params: { year: '2025', month: '1' } });
    const res = createMockRes();

    await exportScheduleExcel(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
