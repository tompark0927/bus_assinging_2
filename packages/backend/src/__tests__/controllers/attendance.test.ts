import { Response } from 'express';
import {
  getAttendance,
  upsertAttendance,
  gpsCheckIn,
  gpsCheckOut,
  getMyTodayStatus,
} from '../../controllers/attendanceController';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/auth';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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
// getAttendance
// ─────────────────────────────────────────

describe('getAttendance controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated attendance records', async () => {
    const req = createAuthReq({ query: { year: '2026', month: '3', page: '1' } });
    const res = createMockRes();

    const records = [
      { id: 1, driverId: 10, date: new Date('2026-03-01'), status: 'PRESENT', driver: { name: '김기사' } },
      { id: 2, driverId: 10, date: new Date('2026-03-02'), status: 'PRESENT', driver: { name: '김기사' } },
    ];

    mockPrisma.attendanceRecord.findMany.mockResolvedValue(records);
    mockPrisma.attendanceRecord.count.mockResolvedValue(2);

    await getAttendance(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: records,
        pagination: expect.objectContaining({ total: 2 }),
      }),
    );
  });

  it('should filter by driverId', async () => {
    const req = createAuthReq({ query: { year: '2026', month: '3', driverId: '10' } });
    const res = createMockRes();

    // 멀티테넌시 검증을 위한 기사 조회 모킹
    mockPrisma.user.findFirst.mockResolvedValue({ id: 10, companyId: 1 });
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([]);
    mockPrisma.attendanceRecord.count.mockResolvedValue(0);

    await getAttendance(req, res);

    expect(mockPrisma.attendanceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ driverId: 10 }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ query: { year: '2026', month: '3' } });
    const res = createMockRes();

    mockPrisma.attendanceRecord.findMany.mockRejectedValue(new Error('DB error'));

    await getAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// upsertAttendance
// ─────────────────────────────────────────

describe('upsertAttendance controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should upsert attendance record', async () => {
    const req = createAuthReq({
      body: {
        driverId: 10,
        date: '2026-03-14',
        checkIn: '2026-03-14T07:00:00',
        checkOut: '2026-03-14T16:00:00',
        status: 'PRESENT',
        notes: '정상 출근',
      },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue({ id: 10, name: '김기사' });
    mockPrisma.attendanceRecord.upsert.mockResolvedValue({
      id: 1, driverId: 10, status: 'PRESENT',
      driver: { id: 10, name: '김기사', employeeId: 'DRV010' },
    });

    await upsertAttendance(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 404 when driver not found', async () => {
    const req = createAuthReq({
      body: { driverId: 999, date: '2026-03-14' },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue(null);

    await upsertAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({
      body: { driverId: 10, date: '2026-03-14' },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockRejectedValue(new Error('DB error'));

    await upsertAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// gpsCheckIn
// ─────────────────────────────────────────

describe('gpsCheckIn controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should check in with GPS coordinates', async () => {
    const req = createAuthReq({
      body: { latitude: 37.4563, longitude: 126.7052 },
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.attendanceRecord.findFirst.mockResolvedValue(null);
    mockPrisma.attendanceRecord.upsert.mockResolvedValue({
      id: 1, driverId: 10, checkIn: new Date(), checkInMethod: 'GPS',
    });

    await gpsCheckIn(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 400 if already checked in', async () => {
    const req = createAuthReq({
      body: { latitude: 37.4563, longitude: 126.7052 },
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 1, checkIn: new Date('2026-03-14T07:00:00'),
    });

    await gpsCheckIn(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('이미 출근') }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({
      body: { latitude: 37.4563, longitude: 126.7052 },
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.attendanceRecord.findFirst.mockRejectedValue(new Error('DB error'));

    await gpsCheckIn(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// gpsCheckOut
// ─────────────────────────────────────────

describe('gpsCheckOut controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should check out with GPS coordinates', async () => {
    const req = createAuthReq({
      body: { latitude: 37.4563, longitude: 126.7052 },
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 1, checkIn: new Date('2026-03-14T07:00:00'), checkOut: null,
    });
    mockPrisma.attendanceRecord.update.mockResolvedValue({
      id: 1, checkOut: new Date(), checkOutMethod: 'GPS',
    });

    await gpsCheckOut(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 400 if not checked in yet', async () => {
    const req = createAuthReq({
      body: { latitude: 37.4563, longitude: 126.7052 },
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.attendanceRecord.findFirst.mockResolvedValue(null);

    await gpsCheckOut(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('출근 기록이 없습니다') }),
    );
  });

  it('should return 400 if already checked out', async () => {
    const req = createAuthReq({
      body: { latitude: 37.4563, longitude: 126.7052 },
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 1, checkIn: new Date(), checkOut: new Date(),
    });

    await gpsCheckOut(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('이미 퇴근') }),
    );
  });
});

// ─────────────────────────────────────────
// getMyTodayStatus
// ─────────────────────────────────────────

describe('getMyTodayStatus controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return today attendance record', async () => {
    const req = createAuthReq({
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    const record = {
      id: 1, checkIn: new Date('2026-03-14T07:00:00'), checkOut: null, status: 'PRESENT',
    };
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue(record);

    await getMyTodayStatus(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: record,
    });
  });

  it('should return default data when no record exists', async () => {
    const req = createAuthReq({
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.attendanceRecord.findFirst.mockResolvedValue(null);

    await getMyTodayStatus(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { checkIn: null, checkOut: null, status: null },
    });
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.attendanceRecord.findFirst.mockRejectedValue(new Error('DB error'));

    await getMyTodayStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
