import { createAuditLog } from '../../utils/auditLog';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/auth';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, jest.Mock>>;

function createMockReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { id: 1, companyId: 1, email: 'admin@test.busync.kr', role: 'ADMIN', name: '관리자' },
    ip: '192.168.1.100',
    headers: {
      'user-agent': 'Mozilla/5.0 TestBrowser',
      'x-forwarded-for': undefined,
    },
    ...overrides,
  } as unknown as AuthRequest;
}

describe('createAuditLog utility', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create audit log record with all fields', async () => {
    const req = createMockReq();
    mockPrisma.auditLog.create.mockResolvedValue({ id: 1 });

    await createAuditLog({
      req,
      action: 'CREATE',
      entityType: 'User',
      entityId: 10,
      changes: {
        name: { old: null, new: '김기사' },
        email: { old: null, new: 'kim@test.com' },
      },
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 1,
        userId: 1,
        action: 'CREATE',
        entityType: 'User',
        entityId: 10,
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 TestBrowser',
      }),
    });
  });

  it('should be a no-op when user is missing', async () => {
    const req = { user: undefined, ip: '127.0.0.1', headers: {} } as unknown as AuthRequest;

    await createAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'Schedule',
      entityId: 1,
    });

    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('should create audit log without changes object', async () => {
    const req = createMockReq();
    mockPrisma.auditLog.create.mockResolvedValue({ id: 2 });

    await createAuditLog({
      req,
      action: 'DELETE',
      entityType: 'Bus',
      entityId: 5,
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'DELETE',
        entityType: 'Bus',
        entityId: 5,
      }),
    });
  });

  it('should not throw when DB write fails', async () => {
    const req = createMockReq();
    mockPrisma.auditLog.create.mockRejectedValue(new Error('DB error'));

    // Should not throw
    await expect(
      createAuditLog({
        req,
        action: 'UPDATE',
        entityType: 'Route',
        entityId: 3,
        changes: { name: { old: '780번', new: '780번(수정)' } },
      }),
    ).resolves.toBeUndefined();
  });

  it('should use x-forwarded-for when ip is unavailable', async () => {
    const req = createMockReq({
      ip: undefined,
      headers: {
        'user-agent': 'MobileApp/1.0',
        'x-forwarded-for': '10.0.0.1',
      },
    } as any);
    mockPrisma.auditLog.create.mockResolvedValue({ id: 3 });

    await createAuditLog({
      req,
      action: 'CREATE',
      entityType: 'Approval',
      entityId: 7,
    });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ipAddress: '10.0.0.1',
        userAgent: 'MobileApp/1.0',
      }),
    });
  });
});
