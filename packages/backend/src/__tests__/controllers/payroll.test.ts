import { Response } from 'express';
import { calculatePayroll, confirmPayroll, getPayrollRecords } from '../../controllers/payrollController';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/auth';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../services/notificationService', () => ({
  sendBulkPushNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/auditLog', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
  }));
});

const mockPrisma = prisma as unknown as Record<string, Record<string, jest.Mock>>;

function createMockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function createAuthReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { id: 1, companyId: 1, email: 'admin@test.com', role: 'ADMIN', name: 'Admin' },
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as AuthRequest;
}

describe('calculatePayroll controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should calculate payroll for drivers with schedule slots', async () => {
    const req = createAuthReq({ body: { year: 2026, month: 3 } });
    const res = createMockRes();

    // No custom setting → use defaults
    mockPrisma.payrollSetting.findUnique.mockResolvedValue(null);

    // No hoboong table
    mockPrisma.hoboongTable.findMany.mockResolvedValue([]);

    // No union dues
    mockPrisma.unionDue.findMany.mockResolvedValue([]);

    // Schedule slots for one driver
    mockPrisma.scheduleSlot.findMany.mockResolvedValue([
      {
        driverId: 10,
        isRestDay: false,
        shift: 'FULL_DAY',
        driver: { id: 10, name: '김기사', employeeId: 'DRV010', hoboong: null },
      },
      {
        driverId: 10,
        isRestDay: false,
        shift: 'FULL_DAY',
        driver: { id: 10, name: '김기사', employeeId: 'DRV010', hoboong: null },
      },
      {
        driverId: 10,
        isRestDay: true, // Rest day — should be excluded
        shift: 'FULL_DAY',
        driver: { id: 10, name: '김기사', employeeId: 'DRV010', hoboong: null },
      },
    ]);

    const mockPayrollRecord = {
      id: 1,
      companyId: 1,
      driverId: 10,
      year: 2026,
      month: 3,
      baseSalary: 272727,
      workDays: 2,
      overtimePay: 0,
      nightShiftPay: 0,
      grossPay: 272727,
      deductions: 24382,
      unionDues: 0,
      netPay: 248345,
      isConfirmed: false,
      hoboong: null,
      driver: { id: 10, name: '김기사', employeeId: 'DRV010', hoboong: null },
    };

    // $transaction resolves with array of results
    (prisma.$transaction as jest.Mock).mockResolvedValue([mockPayrollRecord]);

    await calculatePayroll(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.any(Array),
        message: expect.stringContaining('1명'),
      }),
    );
  });

  it('should use hoboong-based salary when driver has a hoboong level', async () => {
    const req = createAuthReq({ body: { year: 2026, month: 3 } });
    const res = createMockRes();

    mockPrisma.payrollSetting.findUnique.mockResolvedValue(null);

    // Hoboong table: level 5 → 3,500,000
    mockPrisma.hoboongTable.findMany.mockResolvedValue([
      { level: 5, baseSalary: 3500000 },
    ]);

    mockPrisma.unionDue.findMany.mockResolvedValue([]);

    mockPrisma.scheduleSlot.findMany.mockResolvedValue([
      {
        driverId: 10,
        isRestDay: false,
        shift: 'FULL_DAY',
        driver: { id: 10, name: '박기사', employeeId: 'DRV010', hoboong: 5 },
      },
    ]);

    const mockResult = {
      id: 1,
      driverId: 10,
      hoboong: 5,
      baseSalary: 159091,
      netPay: 140000,
      grossPay: 159091,
      deductions: 14000,
      unionDues: 0,
      driver: { id: 10, name: '박기사', employeeId: 'DRV010', hoboong: 5 },
    };

    (prisma.$transaction as jest.Mock).mockResolvedValue([mockResult]);

    await calculatePayroll(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should include warnings for negative net pay', async () => {
    const req = createAuthReq({ body: { year: 2026, month: 3 } });
    const res = createMockRes();

    mockPrisma.payrollSetting.findUnique.mockResolvedValue(null);
    mockPrisma.hoboongTable.findMany.mockResolvedValue([]);
    mockPrisma.unionDue.findMany.mockResolvedValue([]);
    mockPrisma.scheduleSlot.findMany.mockResolvedValue([
      {
        driverId: 10,
        isRestDay: false,
        shift: 'FULL_DAY',
        driver: { id: 10, name: '최기사', employeeId: 'DRV010', hoboong: null },
      },
    ]);

    const mockResult = {
      id: 1,
      driverId: 10,
      netPay: -50000,
      grossPay: 100000,
      driver: { id: 10, name: '최기사' },
    };

    (prisma.$transaction as jest.Mock).mockResolvedValue([mockResult]);

    await calculatePayroll(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        warnings: expect.arrayContaining([
          expect.stringContaining('최기사'),
        ]),
      }),
    );
  });

  it('should return 500 on unexpected error', async () => {
    const req = createAuthReq({ body: { year: 2026, month: 3 } });
    const res = createMockRes();

    mockPrisma.payrollSetting.findUnique.mockRejectedValue(new Error('DB error'));

    await calculatePayroll(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should handle month with no schedule slots (empty driverMap)', async () => {
    const req = createAuthReq({ body: { year: 2026, month: 1 } });
    const res = createMockRes();

    mockPrisma.payrollSetting.findUnique.mockResolvedValue(null);
    mockPrisma.hoboongTable.findMany.mockResolvedValue([]);
    mockPrisma.unionDue.findMany.mockResolvedValue([]);
    mockPrisma.scheduleSlot.findMany.mockResolvedValue([]);

    (prisma.$transaction as jest.Mock).mockResolvedValue([]);

    await calculatePayroll(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: [],
        message: expect.stringContaining('0명'),
      }),
    );
  });
});

describe('confirmPayroll controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should confirm unconfirmed payroll records and send notifications', async () => {
    const req = createAuthReq({ body: { year: 2026, month: 3 } });
    const res = createMockRes();

    mockPrisma.payrollRecord.findMany
      .mockResolvedValueOnce([
        { id: 1, netPay: 2500000 },
        { id: 2, netPay: 2800000 },
      ]) // preConfirmRecords
      .mockResolvedValueOnce([
        { driverId: 10, netPay: 2500000 },
        { driverId: 11, netPay: 2800000 },
      ]); // for push notifications

    mockPrisma.payrollRecord.updateMany.mockResolvedValue({ count: 2 });

    await confirmPayroll(req, res);

    expect(mockPrisma.payrollRecord.updateMany).toHaveBeenCalledWith({
      where: { companyId: 1, year: 2026, month: 3, isConfirmed: false },
      data: expect.objectContaining({ isConfirmed: true }),
    });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining('2명'),
      }),
    );
  });

  it('should handle case with zero unconfirmed records', async () => {
    const req = createAuthReq({ body: { year: 2026, month: 3 } });
    const res = createMockRes();

    mockPrisma.payrollRecord.findMany
      .mockResolvedValueOnce([]) // no unconfirmed
      .mockResolvedValueOnce([]); // no records for push

    mockPrisma.payrollRecord.updateMany.mockResolvedValue({ count: 0 });

    await confirmPayroll(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining('0명'),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ body: { year: 2026, month: 3 } });
    const res = createMockRes();

    mockPrisma.payrollRecord.findMany.mockRejectedValue(new Error('DB error'));

    await confirmPayroll(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getPayrollRecords controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated payroll records with totals', async () => {
    const req = createAuthReq({
      query: { year: '2026', month: '3', page: '1', limit: '10' },
    });
    const res = createMockRes();

    const records = [
      {
        id: 1,
        driverId: 10,
        grossPay: 3000000,
        deductions: 250000,
        unionDues: 30000,
        netPay: 2720000,
        driver: { id: 10, name: '김기사', employeeId: 'DRV010', driverType: 'REGULAR', hoboong: 3 },
      },
      {
        id: 2,
        driverId: 11,
        grossPay: 2800000,
        deductions: 230000,
        unionDues: 30000,
        netPay: 2540000,
        driver: { id: 11, name: '이기사', employeeId: 'DRV011', driverType: 'REGULAR', hoboong: 2 },
      },
    ];

    mockPrisma.payrollRecord.findMany.mockResolvedValue(records);
    mockPrisma.payrollRecord.count.mockResolvedValue(2);

    await getPayrollRecords(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: records,
        pagination: expect.objectContaining({
          page: 1,
          limit: 10,
          total: 2,
        }),
        total: {
          grossPay: 5800000,
          deductions: 480000,
          unionDues: 60000,
          netPay: 5260000,
        },
      }),
    );
  });

  it('should apply pagination parameters correctly', async () => {
    const req = createAuthReq({
      query: { year: '2026', month: '3', page: '2', limit: '5' },
    });
    const res = createMockRes();

    mockPrisma.payrollRecord.findMany.mockResolvedValue([]);
    mockPrisma.payrollRecord.count.mockResolvedValue(10);

    await getPayrollRecords(req, res);

    expect(mockPrisma.payrollRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,  // (2-1) * 5
        take: 5,
      }),
    );
  });

  it('should return empty data when no records exist', async () => {
    const req = createAuthReq({
      query: { year: '2026', month: '1' },
    });
    const res = createMockRes();

    mockPrisma.payrollRecord.findMany.mockResolvedValue([]);
    mockPrisma.payrollRecord.count.mockResolvedValue(0);

    await getPayrollRecords(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: [],
        total: { grossPay: 0, deductions: 0, unionDues: 0, netPay: 0 },
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({
      query: { year: '2026', month: '3' },
    });
    const res = createMockRes();

    mockPrisma.payrollRecord.findMany.mockRejectedValue(new Error('DB error'));

    await getPayrollRecords(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
