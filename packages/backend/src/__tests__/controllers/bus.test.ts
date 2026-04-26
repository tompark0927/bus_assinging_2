import { Response } from 'express';
import {
  getBuses,
  getBusById,
  createBus,
  updateBus,
  deleteBus,
} from '../../controllers/busController';
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
// getBuses
// ─────────────────────────────────────────

describe('getBuses controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated bus list', async () => {
    const req = createAuthReq({ query: { page: '1', limit: '5' } });
    const res = createMockRes();

    const buses = [
      { id: 1, busNumber: '780-01', plateNumber: '인천70가1234', model: '현대 유니버스', route: null },
      { id: 2, busNumber: '780-02', plateNumber: '인천70가5678', model: '현대 유니버스', route: null },
    ];

    mockPrisma.bus.findMany.mockResolvedValue(buses);
    mockPrisma.bus.count.mockResolvedValue(2);

    await getBuses(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: buses,
        pagination: expect.objectContaining({ total: 2 }),
      }),
    );
  });

  it('should return empty list', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.bus.findMany.mockResolvedValue([]);
    mockPrisma.bus.count.mockResolvedValue(0);

    await getBuses(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: [] }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.bus.findMany.mockRejectedValue(new Error('DB error'));

    await getBuses(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// getBusById
// ─────────────────────────────────────────

describe('getBusById controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return bus by id', async () => {
    const req = createAuthReq({ params: { id: '1' } });
    const res = createMockRes();

    mockPrisma.bus.findFirst.mockResolvedValue({
      id: 1, busNumber: '780-01', plateNumber: '인천70가1234',
    });

    await getBusById(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ id: 1 }) }),
    );
  });

  it('should return 404 when bus not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.bus.findFirst.mockResolvedValue(null);

    await getBusById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// createBus
// ─────────────────────────────────────────

describe('createBus controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create bus successfully', async () => {
    const req = createAuthReq({
      body: {
        busNumber: '780-03',
        plateNumber: '인천70가9012',
        model: '대우 BS110',
        year: 2024,
        capacity: 45,
      },
    });
    const res = createMockRes();

    mockPrisma.bus.create.mockResolvedValue({
      id: 3, busNumber: '780-03', plateNumber: '인천70가9012', model: '대우 BS110',
    });

    await createBus(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ body: { busNumber: '780-03' } });
    const res = createMockRes();

    mockPrisma.bus.create.mockRejectedValue(new Error('Unique constraint'));

    await createBus(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// updateBus
// ─────────────────────────────────────────

describe('updateBus controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should update bus successfully', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      body: { model: '현대 일렉시티', year: 2025 },
    });
    const res = createMockRes();

    mockPrisma.bus.findFirst.mockResolvedValue({ id: 1, companyId: 1 });
    mockPrisma.bus.update.mockResolvedValue({
      id: 1, model: '현대 일렉시티', year: 2025,
    });

    await updateBus(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 404 when bus not found or wrong company', async () => {
    const req = createAuthReq({ params: { id: '999' }, body: {} });
    const res = createMockRes();

    mockPrisma.bus.findFirst.mockResolvedValue(null);

    await updateBus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// deleteBus (soft delete)
// ─────────────────────────────────────────

describe('deleteBus controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should soft-delete bus', async () => {
    const req = createAuthReq({ params: { id: '1' } });
    const res = createMockRes();

    mockPrisma.bus.findFirst.mockResolvedValue({ id: 1, companyId: 1 });
    mockPrisma.bus.update.mockResolvedValue({ id: 1, isActive: false });

    await deleteBus(req, res);

    expect(mockPrisma.bus.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isActive: false },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('비활성화') }),
    );
  });

  it('should return 404 when bus not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.bus.findFirst.mockResolvedValue(null);

    await deleteBus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
