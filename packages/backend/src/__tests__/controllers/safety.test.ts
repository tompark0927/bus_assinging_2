import { Response } from 'express';
import {
  getIncidents,
  createIncident,
  resolveIncident,
  deleteIncident,
  getTrainings,
  createTraining,
  getLicenseExpiryAlerts,
} from '../../controllers/safetyController';
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
// getIncidents
// ─────────────────────────────────────────

describe('getIncidents controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated incidents', async () => {
    const req = createAuthReq({ query: { page: '1' } });
    const res = createMockRes();

    const incidents = [
      { id: 1, driverId: 10, type: 'ACCIDENT', description: '접촉사고', driver: { name: '김기사' } },
    ];

    mockPrisma.incidentRecord.findMany.mockResolvedValue(incidents);
    mockPrisma.incidentRecord.count.mockResolvedValue(1);

    await getIncidents(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: incidents }),
    );
  });

  it('should filter by driverId and type', async () => {
    const req = createAuthReq({ query: { driverId: '10', type: 'VIOLATION' } });
    const res = createMockRes();

    mockPrisma.incidentRecord.findMany.mockResolvedValue([]);
    mockPrisma.incidentRecord.count.mockResolvedValue(0);

    await getIncidents(req, res);

    expect(mockPrisma.incidentRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ driverId: 10, type: 'VIOLATION' }),
      }),
    );
  });

  it('should filter by resolved status', async () => {
    const req = createAuthReq({ query: { resolved: 'false' } });
    const res = createMockRes();

    mockPrisma.incidentRecord.findMany.mockResolvedValue([]);
    mockPrisma.incidentRecord.count.mockResolvedValue(0);

    await getIncidents(req, res);

    expect(mockPrisma.incidentRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isResolved: false }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.incidentRecord.findMany.mockRejectedValue(new Error('DB error'));

    await getIncidents(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// createIncident
// ─────────────────────────────────────────

describe('createIncident controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create incident record', async () => {
    const req = createAuthReq({
      body: {
        driverId: 10,
        date: '2026-03-10',
        type: 'ACCIDENT',
        description: '교차로 접촉사고',
        penalty: 50000,
        notes: '보험 처리 완료',
      },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue({ id: 10, name: '김기사' });
    mockPrisma.incidentRecord.create.mockResolvedValue({
      id: 1, driverId: 10, type: 'ACCIDENT',
      driver: { id: 10, name: '김기사', employeeId: 'DRV010' },
    });

    await createIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should return 404 when driver not found', async () => {
    const req = createAuthReq({
      body: { driverId: 999, date: '2026-03-10', type: 'ACCIDENT', description: '사고' },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue(null);

    await createIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({
      body: { driverId: 10, date: '2026-03-10', type: 'ACCIDENT' },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockRejectedValue(new Error('DB error'));

    await createIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// resolveIncident
// ─────────────────────────────────────────

describe('resolveIncident controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should resolve incident', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      body: { notes: '보험 처리 완료' },
    });
    const res = createMockRes();

    mockPrisma.incidentRecord.findFirst.mockResolvedValue({
      id: 1, isResolved: false, notes: '처리 중',
    });
    mockPrisma.incidentRecord.update.mockResolvedValue({
      id: 1, isResolved: true, resolvedAt: new Date(),
    });

    await resolveIncident(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 404 when incident not found', async () => {
    const req = createAuthReq({ params: { id: '999' }, body: {} });
    const res = createMockRes();

    mockPrisma.incidentRecord.findFirst.mockResolvedValue(null);

    await resolveIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// deleteIncident
// ─────────────────────────────────────────

describe('deleteIncident controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should delete incident', async () => {
    const req = createAuthReq({ params: { id: '1' } });
    const res = createMockRes();

    mockPrisma.incidentRecord.findFirst.mockResolvedValue({ id: 1 });
    mockPrisma.incidentRecord.delete.mockResolvedValue({ id: 1 });

    await deleteIncident(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 404 when incident not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.incidentRecord.findFirst.mockResolvedValue(null);

    await deleteIncident(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// getTrainings
// ─────────────────────────────────────────

describe('getTrainings controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated training records', async () => {
    const req = createAuthReq({ query: { page: '1' } });
    const res = createMockRes();

    const records = [
      { id: 1, driverId: 10, type: 'SAFETY', completedAt: new Date(), driver: { name: '김기사' } },
    ];

    mockPrisma.trainingRecord.findMany.mockResolvedValue(records);
    mockPrisma.trainingRecord.count.mockResolvedValue(1);

    await getTrainings(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: records }),
    );
  });

  it('should filter by driverId', async () => {
    const req = createAuthReq({ query: { driverId: '10' } });
    const res = createMockRes();

    mockPrisma.trainingRecord.findMany.mockResolvedValue([]);
    mockPrisma.trainingRecord.count.mockResolvedValue(0);

    await getTrainings(req, res);

    expect(mockPrisma.trainingRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ driverId: 10 }),
      }),
    );
  });
});

// ─────────────────────────────────────────
// createTraining
// ─────────────────────────────────────────

describe('createTraining controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create training record', async () => {
    const req = createAuthReq({
      body: {
        driverId: 10,
        type: 'SAFETY',
        completedAt: '2026-03-01',
        expiresAt: '2027-03-01',
        institution: '인천교통안전교육원',
        notes: '안전운전교육 이수',
      },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue({ id: 10 });
    mockPrisma.trainingRecord.create.mockResolvedValue({
      id: 1, driverId: 10, type: 'SAFETY',
      driver: { id: 10, name: '김기사', employeeId: 'DRV010' },
    });

    await createTraining(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should return 404 when driver not found', async () => {
    const req = createAuthReq({
      body: { driverId: 999, type: 'SAFETY', completedAt: '2026-03-01' },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue(null);

    await createTraining(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// getLicenseExpiryAlerts
// ─────────────────────────────────────────

describe('getLicenseExpiryAlerts controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return license and training expiry alerts', async () => {
    const req = createAuthReq();
    const res = createMockRes();

    const now = new Date();
    const in30days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expired = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: 10, name: '김기사', employeeId: 'DRV010', phone: '010-1111-1111',
        licenseExpiresAt: in30days, qualificationExpiresAt: null,
      },
      {
        id: 11, name: '이기사', employeeId: 'DRV011', phone: '010-2222-2222',
        licenseExpiresAt: expired, qualificationExpiresAt: null,
      },
    ]);
    mockPrisma.trainingRecord.findMany.mockResolvedValue([]);

    await getLicenseExpiryAlerts(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          licenseAlerts: expect.any(Array),
          trainingAlerts: expect.any(Array),
          urgentCount: expect.any(Number),
          warningCount: expect.any(Number),
        }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq();
    const res = createMockRes();

    mockPrisma.user.findMany.mockRejectedValue(new Error('DB error'));

    await getLicenseExpiryAlerts(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
