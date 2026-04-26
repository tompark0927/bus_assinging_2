import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, requireRole, requireAdmin, requireOfficeStaff, AuthRequest } from '../../middleware/auth';
import { prisma } from '../../utils/prisma';

// Mock tenantContext so runWithCompany just invokes the callback
jest.mock('../../utils/tenantContext', () => ({
  runWithCompany: (_id: number, fn: () => unknown) => fn(),
  getCurrentCompanyId: () => undefined,
  TENANT_MODELS: new Set(),
}));

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

function createMockNext(): NextFunction {
  return jest.fn();
}

const JWT_SECRET = process.env.JWT_SECRET!;

describe('authenticate middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should reject request without Authorization header', async () => {
    const req = { headers: {} } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject request with malformed Authorization header', async () => {
    const req = { headers: { authorization: 'Token abc' } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject request with invalid JWT token', async () => {
    const req = { headers: { authorization: 'Bearer invalid.token.here' } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '유효하지 않은 토큰입니다.' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject request with expired JWT token', async () => {
    const token = jwt.sign(
      { id: 1, companyId: 1, email: 'a@b.com', role: 'ADMIN', name: 'Test' },
      JWT_SECRET,
      { expiresIn: '0s' },
    );
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    // Small delay to ensure token expires
    await new Promise(resolve => setTimeout(resolve, 50));
    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject when user is not found in DB', async () => {
    const token = jwt.sign(
      { id: 999, companyId: 1, email: 'a@b.com', role: 'ADMIN', name: 'Test' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    mockPrisma.user.findUnique.mockResolvedValue(null);

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '유효하지 않은 계정입니다.' }),
    );
  });

  it('should reject when user is inactive', async () => {
    const token = jwt.sign(
      { id: 1, companyId: 1, email: 'a@b.com', role: 'ADMIN', name: 'Test' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    mockPrisma.user.findUnique.mockResolvedValue({ id: 1, isActive: false });

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should set req.user and call next for valid token and active user', async () => {
    const payload = { id: 1, companyId: 1, email: 'a@b.com', role: 'ADMIN', name: 'Test' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    mockPrisma.user.findUnique.mockResolvedValue({ id: 1, isActive: true });

    await authenticate(req, res, next);

    expect(req.user).toBeDefined();
    expect(req.user!.id).toBe(1);
    expect(req.user!.role).toBe('ADMIN');
    expect(next).toHaveBeenCalled();
  });
});

describe('requireRole middleware', () => {
  it('should allow full-access roles (OWNER, DIRECTOR, ADMIN) regardless of allowed list', () => {
    const fullAccessRoles = ['OWNER', 'DIRECTOR', 'ADMIN'];

    for (const role of fullAccessRoles) {
      const req = { user: { role } } as AuthRequest;
      const res = createMockRes();
      const next = createMockNext();

      requireRole('DISPATCH')(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('should allow explicitly listed roles', () => {
    const req = { user: { role: 'DISPATCH' } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    requireRole('DISPATCH', 'HR')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should deny roles not in the allowed list (non-full-access)', () => {
    const req = { user: { role: 'DRIVER' } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    requireRole('DISPATCH', 'HR')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('should deny when user has no role', () => {
    const req = { user: {} } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    requireRole('DISPATCH')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireAdmin middleware', () => {
  it('should allow OWNER, DIRECTOR, ADMIN', () => {
    for (const role of ['OWNER', 'DIRECTOR', 'ADMIN']) {
      const req = { user: { role } } as AuthRequest;
      const res = createMockRes();
      const next = createMockNext();

      requireAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    }
  });

  it('should deny DRIVER', () => {
    const req = { user: { role: 'DRIVER' } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '관리자 권한이 필요합니다.' }),
    );
  });

  it('should deny DISPATCH (non-admin office staff)', () => {
    const req = { user: { role: 'DISPATCH' } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireOfficeStaff middleware', () => {
  it('should block DRIVER role', () => {
    const req = { user: { role: 'DRIVER' } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    requireOfficeStaff(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '사무직 직원만 접근 가능합니다.' }),
    );
  });

  it('should allow ADMIN', () => {
    const req = { user: { role: 'ADMIN' } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    requireOfficeStaff(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should allow DISPATCH', () => {
    const req = { user: { role: 'DISPATCH' } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    requireOfficeStaff(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should allow HR', () => {
    const req = { user: { role: 'HR' } } as AuthRequest;
    const res = createMockRes();
    const next = createMockNext();

    requireOfficeStaff(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
