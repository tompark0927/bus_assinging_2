import { Response } from 'express';
import {
  getRoutes,
  getRouteById,
  createRoute,
  updateRoute,
  deleteRoute,
  assignDriverToRoute,
  removeDriverFromRoute,
} from '../../controllers/routeController';
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
// getRoutes
// ─────────────────────────────────────────

describe('getRoutes controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated route list', async () => {
    const req = createAuthReq({ query: { page: '1', limit: '10' } });
    const res = createMockRes();

    const routes = [
      { id: 1, routeNumber: '780', name: '인천-서울', buses: [], routeAssignments: [] },
      { id: 2, routeNumber: '790', name: '인천-부평', buses: [], routeAssignments: [] },
    ];

    mockPrisma.route.findMany.mockResolvedValue(routes);
    mockPrisma.route.count.mockResolvedValue(2);

    await getRoutes(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: routes,
        pagination: expect.objectContaining({ total: 2 }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.route.findMany.mockRejectedValue(new Error('DB error'));

    await getRoutes(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// getRouteById
// ─────────────────────────────────────────

describe('getRouteById controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return route by id', async () => {
    const req = createAuthReq({ params: { id: '1' } });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue({
      id: 1, routeNumber: '780', name: '인천-서울',
    });

    await getRouteById(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ routeNumber: '780' }) }),
    );
  });

  it('should return 404 when route not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue(null);

    await getRouteById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// createRoute
// ─────────────────────────────────────────

describe('createRoute controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create route successfully', async () => {
    const req = createAuthReq({
      body: {
        routeNumber: '800',
        name: '인천-강남',
        startPoint: '인천터미널',
        endPoint: '강남역',
      },
    });
    const res = createMockRes();

    mockPrisma.route.create.mockResolvedValue({
      id: 3, routeNumber: '800', name: '인천-강남',
    });

    await createRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ body: { routeNumber: '800' } });
    const res = createMockRes();

    mockPrisma.route.create.mockRejectedValue(new Error('DB error'));

    await createRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// updateRoute
// ─────────────────────────────────────────

describe('updateRoute controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should update route', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      body: { name: '인천-서울(수정)' },
    });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue({ id: 1 });
    mockPrisma.route.update.mockResolvedValue({ id: 1, name: '인천-서울(수정)' });

    await updateRoute(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 404 when route not found', async () => {
    const req = createAuthReq({ params: { id: '999' }, body: {} });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue(null);

    await updateRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// deleteRoute (hard delete — 종속 데이터 정리 후 노선 완전 삭제)
// ─────────────────────────────────────────

describe('deleteRoute controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should hard-delete route with dependent records cleaned up', async () => {
    const req = createAuthReq({ params: { id: '1' } });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue({ id: 1 });
    mockPrisma.scheduleSlot.findMany.mockResolvedValue([{ id: 100 }, { id: 101 }]);
    mockPrisma.emergencyDrop.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.scheduleSlot.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.routeAssignment.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.driverPreference.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.bus.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.post.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.route.delete.mockResolvedValue({ id: 1 });

    await deleteRoute(req, res);

    // 슬롯에 걸린 대타 → 슬롯 → 배정/선호 정리, 버스·게시글은 노선 연결만 해제
    expect(mockPrisma.emergencyDrop.deleteMany).toHaveBeenCalledWith({
      where: { slotId: { in: [100, 101] } },
    });
    expect(mockPrisma.scheduleSlot.deleteMany).toHaveBeenCalledWith({ where: { routeId: 1 } });
    expect(mockPrisma.bus.updateMany).toHaveBeenCalledWith({
      where: { routeId: 1 },
      data: { routeId: null },
    });
    expect(mockPrisma.route.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('삭제') }),
    );
  });

  it('should return 404 when route not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue(null);

    await deleteRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// assignDriverToRoute
// ─────────────────────────────────────────

describe('assignDriverToRoute controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should assign driver to route', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      body: { driverId: 10, startDate: '2026-04-01' },
    });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue({ id: 1 });
    mockPrisma.user.findFirst.mockResolvedValue({ id: 10, name: '김기사' });
    mockPrisma.routeAssignment.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.routeAssignment.create.mockResolvedValue({
      id: 1, driverId: 10, routeId: 1,
      driver: { id: 10, name: '김기사' },
      route: { id: 1, routeNumber: '780' },
    });

    await assignDriverToRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should return 404 when route not found', async () => {
    const req = createAuthReq({
      params: { id: '999' },
      body: { driverId: 10, startDate: '2026-04-01' },
    });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue(null);

    await assignDriverToRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 404 when driver not found', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      body: { driverId: 999, startDate: '2026-04-01' },
    });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue({ id: 1 });
    mockPrisma.user.findFirst.mockResolvedValue(null);

    await assignDriverToRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// removeDriverFromRoute
// ─────────────────────────────────────────

describe('removeDriverFromRoute controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should remove driver from route', async () => {
    const req = createAuthReq({ params: { id: '1', driverId: '10' } });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue({ id: 1 });
    mockPrisma.user.findFirst.mockResolvedValue({ id: 10 });
    mockPrisma.routeAssignment.updateMany.mockResolvedValue({ count: 1 });

    await removeDriverFromRoute(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('해제') }),
    );
  });

  it('should return 404 when driver not found', async () => {
    const req = createAuthReq({ params: { id: '1', driverId: '999' } });
    const res = createMockRes();

    mockPrisma.route.findFirst.mockResolvedValue({ id: 1 });
    mockPrisma.user.findFirst.mockResolvedValue(null);

    await removeDriverFromRoute(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
