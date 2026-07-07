import { Response } from 'express';
import {
  getScheduleList,
  getSchedule,
  generateSchedule,
  publishSchedule,
  updateScheduleSlot,
  deleteSchedule,
  exportScheduleExcel,
  getMyMonthlySummary,
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
  resolveMonthScheduleId: jest.fn(),
  // 중복 방지 헬퍼 — 기본은 입력 이름을 그대로 반환 (겹침 없음)
  uniqueScheduleName: jest.fn((_c: number, _y: number, _m: number, base: string) => Promise.resolve(base)),
  updateSlot: jest.fn().mockResolvedValue({ id: 1, driverId: 10 }),
  validateRestTime: jest.fn().mockResolvedValue({ valid: true, warnings: [] }),
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

  it('should return only driver\'s own PUBLISHED slots for DRIVER role', async () => {
    const req = createAuthReq({
      params: { year: '2026', month: '3' },
      user: { id: 10, companyId: 1, email: 'driver@test.busync.kr', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    const scheduleData = {
      id: 1, year: 2026, month: 3, status: 'PUBLISHED',
      slots: [{ id: 100, driverId: 10, date: new Date('2026-03-01') }],
    };
    mockPrisma.schedule.findFirst.mockResolvedValue(scheduleData);

    await getSchedule(req, res);

    // 기사에게는 발행본(PUBLISHED)만, 본인 슬롯만 노출
    expect(mockPrisma.schedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 1, year: 2026, month: 3, status: 'PUBLISHED' },
        include: expect.objectContaining({
          slots: expect.objectContaining({
            where: { driverId: 10 },
          }),
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: scheduleData });
  });

  it('should return null data when no published schedule exists (DRIVER)', async () => {
    const req = createAuthReq({
      params: { year: '2025', month: '1' },
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '이기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.schedule.findFirst.mockResolvedValue(null);

    await getSchedule(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: null });
  });

  it('should pass explicit scheduleId to getScheduleWithSlots for ADMIN', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' }, query: { scheduleId: '7' } });
    const res = createMockRes();

    const { getScheduleWithSlots } = require('../../services/scheduleService');

    await getSchedule(req, res);

    expect(getScheduleWithSlots).toHaveBeenCalledWith(1, 2026, 3, 7);
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

  it('should publish latest DRAFT (no scheduleId in body) and notify drivers', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findFirst
      // 1) 최근 DRAFT 초안 선택
      .mockResolvedValueOnce({ id: 1, year: 2026, month: 3, status: 'DRAFT', companyId: 1 })
      // 2) 같은 달에 이미 발행된 배차표 없음
      .mockResolvedValueOnce(null);
    mockPrisma.schedule.update.mockResolvedValue({
      id: 1, year: 2026, month: 3, status: 'PUBLISHED',
    });
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 10 }, { id: 11 }, { id: 12 },
    ]);

    await publishSchedule(req, res);

    // scheduleId 미지정 → 최근 DRAFT 를 updatedAt 내림차순으로 조회
    expect(mockPrisma.schedule.findFirst).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        where: { companyId: 1, year: 2026, month: 3, status: 'DRAFT' },
        orderBy: { updatedAt: 'desc' },
      }),
    );
    expect(mockPrisma.schedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
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

  it('should publish the draft specified by body.scheduleId', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' }, body: { scheduleId: 7 } });
    const res = createMockRes();

    mockPrisma.schedule.findFirst
      .mockResolvedValueOnce({ id: 7, year: 2026, month: 3, status: 'DRAFT', companyId: 1 })
      .mockResolvedValueOnce(null);
    mockPrisma.schedule.update.mockResolvedValue({
      id: 7, year: 2026, month: 3, status: 'PUBLISHED',
    });
    mockPrisma.user.findMany.mockResolvedValue([]);

    await publishSchedule(req, res);

    expect(mockPrisma.schedule.findFirst).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        where: { id: 7, companyId: 1, year: 2026, month: 3 },
      }),
    );
    expect(mockPrisma.schedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } }),
    );
  });

  it('should return 404 when no draft exists for the month', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findFirst.mockResolvedValue(null);

    await publishSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 400 when target schedule is already PUBLISHED', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' }, body: { scheduleId: 7 } });
    const res = createMockRes();

    mockPrisma.schedule.findFirst.mockResolvedValueOnce({
      id: 7, year: 2026, month: 3, status: 'PUBLISHED', companyId: 1,
    });

    await publishSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('이미 발행된') }),
    );
    expect(mockPrisma.schedule.update).not.toHaveBeenCalled();
  });

  it('should return 400 when another schedule is already PUBLISHED for the month', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findFirst
      .mockResolvedValueOnce({ id: 1, year: 2026, month: 3, status: 'DRAFT', companyId: 1 })
      // 다른 초안이 이미 발행되어 있음 → 월당 발행본 1개 제한
      .mockResolvedValueOnce({ id: 2, name: '기본 초안' });

    await publishSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('이미 발행된') }),
    );
    expect(mockPrisma.schedule.update).not.toHaveBeenCalled();
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findFirst
      .mockResolvedValueOnce({ id: 1, year: 2026, month: 3, status: 'DRAFT', companyId: 1 })
      .mockResolvedValueOnce(null);
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
  const { resolveMonthScheduleId } = jest.requireMock('../../services/scheduleService');

  beforeEach(() => jest.clearAllMocks());

  it('should delete resolved schedule (drops → slots → schedule in transaction)', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '4' } });
    const res = createMockRes();

    resolveMonthScheduleId.mockResolvedValue(5);
    mockPrisma.schedule.findFirst.mockResolvedValue({
      id: 5, companyId: 1, year: 2026, month: 4, status: 'DRAFT',
    });
    mockPrisma.emergencyDrop.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.scheduleSlot.deleteMany.mockResolvedValue({ count: 90 });
    mockPrisma.schedule.delete.mockResolvedValue({ id: 5 });

    await deleteSchedule(req, res);

    // 슬롯에 연결된 대타부터 정리 후 슬롯·배차표 삭제
    expect(mockPrisma.emergencyDrop.deleteMany).toHaveBeenCalledWith({
      where: { slot: { scheduleId: 5 } },
    });
    expect(mockPrisma.scheduleSlot.deleteMany).toHaveBeenCalledWith({ where: { scheduleId: 5 } });
    expect(mockPrisma.schedule.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('삭제') }),
    );
  });

  it('should pass explicit scheduleId query to resolveMonthScheduleId', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '4' }, query: { scheduleId: '7' } });
    const res = createMockRes();

    resolveMonthScheduleId.mockResolvedValue(7);
    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 7, companyId: 1, status: 'DRAFT' });
    mockPrisma.schedule.delete.mockResolvedValue({ id: 7 });

    await deleteSchedule(req, res);

    expect(resolveMonthScheduleId).toHaveBeenCalledWith(1, 2026, 4, 7);
    expect(mockPrisma.schedule.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it('should return 404 when schedule not found', async () => {
    const req = createAuthReq({ params: { year: '2025', month: '1' } });
    const res = createMockRes();

    resolveMonthScheduleId.mockResolvedValue(null);

    await deleteSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 400 when schedule is ARCHIVED', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    resolveMonthScheduleId.mockResolvedValue(1);
    mockPrisma.schedule.findFirst.mockResolvedValue({
      id: 1, companyId: 1, status: 'ARCHIVED',
    });

    await deleteSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('보관된') }),
    );
    expect(mockPrisma.schedule.delete).not.toHaveBeenCalled();
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    resolveMonthScheduleId.mockRejectedValue(new Error('DB error'));

    await deleteSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// listMonthSchedules (멀티 초안 프로필 목록)
// ─────────────────────────────────────────

describe('listMonthSchedules controller', () => {
  const { listMonthSchedules } = require('../../controllers/scheduleController');

  beforeEach(() => jest.clearAllMocks());

  it('should list drafts with published first', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    const base = { notes: null, createdAt: new Date(), updatedAt: new Date() };
    mockPrisma.schedule.findMany.mockResolvedValue([
      { id: 3, name: '초안 2', status: 'DRAFT', ...base, _count: { slots: 10 } },
      { id: 2, name: '기본 초안', status: 'PUBLISHED', ...base, _count: { slots: 90 } },
      { id: 1, name: '초안 1', status: 'DRAFT', ...base, _count: { slots: 5 } },
    ]);

    await listMonthSchedules(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.success).toBe(true);
    // 발행본 먼저, 이후 최근 수정순
    expect(payload.data.map((s: { id: number }) => s.id)).toEqual([2, 3, 1]);
    expect(payload.data[0]).toEqual(
      expect.objectContaining({ name: '기본 초안', status: 'PUBLISHED', slotCount: 90 }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ params: { year: '2026', month: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findMany.mockRejectedValue(new Error('DB error'));

    await listMonthSchedules(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// duplicateSchedule (초안 복제)
// ─────────────────────────────────────────

describe('duplicateSchedule controller', () => {
  const { duplicateSchedule } = require('../../controllers/scheduleController');

  beforeEach(() => jest.clearAllMocks());

  it('should duplicate schedule as a new DRAFT with reset slot status', async () => {
    const req = createAuthReq({ params: { id: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findFirst.mockResolvedValue({
      id: 3, companyId: 1, year: 2026, month: 3, name: '기본 초안', notes: null,
      slots: [
        {
          driverId: 10, routeId: 1, busId: null, date: new Date('2026-03-01'),
          shift: 'FULL_DAY', status: 'DROPPED', isRestDay: false,
          isManualOverride: false, overrideReason: null, overrideBy: null,
          fairnessNote: null, notes: null,
        },
      ],
    });
    mockPrisma.schedule.count.mockResolvedValue(1);
    // uniqueScheduleName 의 중복 검사 — 겹치는 이름 없음
    mockPrisma.schedule.findMany.mockResolvedValue([]);
    mockPrisma.schedule.create.mockResolvedValue({ id: 9, name: '기본 초안 (사본)' });
    mockPrisma.scheduleSlot.createMany.mockResolvedValue({ count: 1 });

    await duplicateSchedule(req, res);

    expect(mockPrisma.schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: '기본 초안 (사본)', status: 'DRAFT' }),
      }),
    );
    // 운영 상태(드랍 등)는 사본에서 SCHEDULED 로 초기화
    const createManyArg = mockPrisma.scheduleSlot.createMany.mock.calls[0][0];
    expect(createManyArg.data[0].status).toBe('SCHEDULED');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should return 400 when the month already has 5 drafts', async () => {
    const req = createAuthReq({ params: { id: '3' } });
    const res = createMockRes();

    mockPrisma.schedule.findFirst.mockResolvedValue({
      id: 3, companyId: 1, year: 2026, month: 3, name: '기본 초안', notes: null, slots: [],
    });
    mockPrisma.schedule.count.mockResolvedValue(5);

    await duplicateSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
  });

  it('should return 404 when source schedule not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.schedule.findFirst.mockResolvedValue(null);

    await duplicateSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
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

// ─────────────────────────────────────────
// getMyMonthlySummary
// ─────────────────────────────────────────

describe('getMyMonthlySummary controller', () => {
  beforeEach(() => jest.clearAllMocks());

  const driverReq = (year: string, month: string) =>
    createAuthReq({
      user: { id: 10, companyId: 1, email: 'd@test.busync.kr', role: 'DRIVER', name: '기사' },
      params: { year, month },
    });

  it('counts work/rest with DROPPED merged into rest, plus accepted substitutes', async () => {
    const req = driverReq('2026', '5');
    const res = createMockRes();

    mockPrisma.schedule.findFirst.mockResolvedValue({
      id: 1,
      year: 2026,
      month: 5,
      slots: [
        { isRestDay: false, status: 'SCHEDULED' }, // work
        { isRestDay: false, status: 'FILLED' },     // work
        { isRestDay: true, status: 'SCHEDULED' },   // rest
        { isRestDay: false, status: 'DROPPED' },     // rest (merged)
      ],
    });
    mockPrisma.emergencyDrop.count.mockResolvedValue(2);

    await getMyMonthlySummary(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { year: 2026, month: 5, workDays: 2, restDays: 2, acceptedSubstitutes: 2 },
    });
  });

  it('returns zeros when no schedule exists for the month', async () => {
    const req = driverReq('2026', '7');
    const res = createMockRes();

    mockPrisma.schedule.findFirst.mockResolvedValue(null);
    mockPrisma.emergencyDrop.count.mockResolvedValue(0);

    await getMyMonthlySummary(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { year: 2026, month: 7, workDays: 0, restDays: 0, acceptedSubstitutes: 0 },
    });
  });

  it('only counts substitutes the driver filled, in this month', async () => {
    const req = driverReq('2026', '5');
    const res = createMockRes();

    mockPrisma.schedule.findFirst.mockResolvedValue({ id: 1, year: 2026, month: 5, slots: [] });
    mockPrisma.emergencyDrop.count.mockResolvedValue(3);

    await getMyMonthlySummary(req, res);

    expect(mockPrisma.emergencyDrop.count).toHaveBeenCalledWith({
      where: {
        filledBy: 10,
        status: 'FILLED',
        slot: { date: { gte: new Date(Date.UTC(2026, 4, 1)), lt: new Date(Date.UTC(2026, 5, 1)) } },
      },
    });
  });

  it('returns 500 on DB error', async () => {
    const req = driverReq('2026', '5');
    const res = createMockRes();

    mockPrisma.schedule.findFirst.mockRejectedValue(new Error('DB error'));

    await getMyMonthlySummary(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
