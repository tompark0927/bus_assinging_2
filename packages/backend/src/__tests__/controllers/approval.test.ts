import { Response } from 'express';
import {
  getApprovals,
  getApproval,
  createApproval,
  processApproval,
  cancelApproval,
  getApprovalStats,
} from '../../controllers/approvalController';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/auth';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../services/notificationService', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/auditLog', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
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
// getApprovals
// ─────────────────────────────────────────

describe('getApprovals controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated approvals for ADMIN', async () => {
    const req = createAuthReq({ query: { page: '1' } });
    const res = createMockRes();

    const approvals = [
      { id: 1, type: 'LEAVE', title: '연차 신청', status: 'PENDING', requester: { id: 10, name: '김기사' }, steps: [] },
    ];

    mockPrisma.approval.findMany.mockResolvedValue(approvals);
    mockPrisma.approval.count.mockResolvedValue(1);

    await getApprovals(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: approvals }),
    );
  });

  it('should filter by status query param', async () => {
    const req = createAuthReq({ query: { status: 'PENDING' } });
    const res = createMockRes();

    mockPrisma.approval.findMany.mockResolvedValue([]);
    mockPrisma.approval.count.mockResolvedValue(0);

    await getApprovals(req, res);

    expect(mockPrisma.approval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
  });

  it('should filter by role=requester', async () => {
    const req = createAuthReq({ query: { role: 'requester' } });
    const res = createMockRes();

    mockPrisma.approval.findMany.mockResolvedValue([]);
    mockPrisma.approval.count.mockResolvedValue(0);

    await getApprovals(req, res);

    expect(mockPrisma.approval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ requesterId: 1 }),
      }),
    );
  });

  it('should filter by role=approver', async () => {
    const req = createAuthReq({ query: { role: 'approver' } });
    const res = createMockRes();

    mockPrisma.approvalStep.findMany.mockResolvedValue([{ approvalId: 1 }, { approvalId: 2 }]);
    mockPrisma.approval.findMany.mockResolvedValue([]);
    mockPrisma.approval.count.mockResolvedValue(0);

    await getApprovals(req, res);

    expect(mockPrisma.approval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [1, 2] } }),
      }),
    );
  });

  it('should restrict DRIVER to own requests', async () => {
    const req = createAuthReq({
      query: {},
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.approval.findMany.mockResolvedValue([]);
    mockPrisma.approval.count.mockResolvedValue(0);

    await getApprovals(req, res);

    expect(mockPrisma.approval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ requesterId: 10 }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.approval.findMany.mockRejectedValue(new Error('DB error'));

    await getApprovals(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// createApproval
// ─────────────────────────────────────────

describe('createApproval controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 400 when required fields missing', async () => {
    const req = createAuthReq({ body: { type: 'LEAVE' } });
    const res = createMockRes();

    await createApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should create approval with auto-assigned admin approvers', async () => {
    const req = createAuthReq({
      body: { type: 'LEAVE', title: '연차 신청', content: '3월 25일 연차 사용합니다.' },
      user: { id: 10, companyId: 1, email: 'driver@test.com', role: 'DRIVER', name: '김기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.user.findMany.mockResolvedValue([{ id: 1 }]);
    mockPrisma.approval.create.mockResolvedValue({
      id: 1, type: 'LEAVE', title: '연차 신청', status: 'PENDING',
      requester: { id: 10, name: '김기사' },
      steps: [{ step: 0, approverId: 1, status: 'PENDING' }],
    });

    await createApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 400 when no approvers available', async () => {
    const req = createAuthReq({
      body: { type: 'EXPENSE', title: '경비 청구', content: '유류비' },
    });
    const res = createMockRes();

    mockPrisma.user.findMany.mockResolvedValue([]);

    await createApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('결재자') }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({
      body: { type: 'LEAVE', title: '테스트', content: '내용' },
    });
    const res = createMockRes();

    mockPrisma.user.findMany.mockRejectedValue(new Error('DB error'));

    await createApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// processApproval
// ─────────────────────────────────────────

describe('processApproval controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 400 for invalid action', async () => {
    const req = createAuthReq({ params: { id: '1' }, body: { action: 'invalid' } });
    const res = createMockRes();

    await processApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 404 when approval not found', async () => {
    const req = createAuthReq({ params: { id: '999' }, body: { action: 'approve' } });
    const res = createMockRes();

    mockPrisma.approval.findFirst.mockResolvedValue(null);

    await processApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 400 when approval already processed', async () => {
    const req = createAuthReq({ params: { id: '1' }, body: { action: 'approve' } });
    const res = createMockRes();

    mockPrisma.approval.findFirst.mockResolvedValue({
      id: 1, status: 'APPROVED', steps: [],
    });

    await processApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 403 when user is not current step approver', async () => {
    const req = createAuthReq({ params: { id: '1' }, body: { action: 'approve' } });
    const res = createMockRes();

    mockPrisma.approval.findFirst.mockResolvedValue({
      id: 1, status: 'PENDING', currentStep: 0, totalSteps: 1, requesterId: 10,
      requester: { id: 10, name: '김기사' },
      steps: [{ id: 1, step: 0, approverId: 99 }],
    });

    await processApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should reject approval and notify requester', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      body: { action: 'reject', comment: '사유 불충분' },
    });
    const res = createMockRes();

    mockPrisma.approval.findFirst
      .mockResolvedValueOnce({
        id: 1, status: 'PENDING', currentStep: 0, totalSteps: 1, requesterId: 10,
        requester: { id: 10, name: '김기사' },
        steps: [{ id: 100, step: 0, approverId: 1 }],
      })
      .mockResolvedValueOnce({
        id: 1, status: 'REJECTED', currentStep: 0,
      });
    mockPrisma.approvalStep.update.mockResolvedValue({ id: 100 });
    mockPrisma.approval.update.mockResolvedValue({ id: 1, status: 'REJECTED' });

    await processApproval(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should approve final step and mark as APPROVED', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      body: { action: 'approve' },
    });
    const res = createMockRes();

    mockPrisma.approval.findFirst
      .mockResolvedValueOnce({
        id: 1, status: 'PENDING', currentStep: 0, totalSteps: 1, requesterId: 10,
        requester: { id: 10, name: '김기사' },
        steps: [{ id: 100, step: 0, approverId: 1 }],
      })
      .mockResolvedValueOnce({
        id: 1, status: 'APPROVED', currentStep: 0,
      });
    mockPrisma.approvalStep.update.mockResolvedValue({ id: 100 });
    mockPrisma.approval.update.mockResolvedValue({ id: 1, status: 'APPROVED' });

    await processApproval(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 400 for invalid id param', async () => {
    const req = createAuthReq({ params: { id: 'abc' }, body: { action: 'approve' } });
    const res = createMockRes();

    await processApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─────────────────────────────────────────
// cancelApproval
// ─────────────────────────────────────────

describe('cancelApproval controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should cancel pending approval', async () => {
    const req = createAuthReq({ params: { id: '1' } });
    const res = createMockRes();

    mockPrisma.approval.findFirst.mockResolvedValue({
      id: 1, status: 'PENDING', requesterId: 1,
    });
    mockPrisma.approval.update.mockResolvedValue({ id: 1, status: 'CANCELLED' });

    await cancelApproval(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('취소') }),
    );
  });

  it('should return 404 when approval not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.approval.findFirst.mockResolvedValue(null);

    await cancelApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 403 when DRIVER cancels another user\'s approval', async () => {
    const req = createAuthReq({
      params: { id: '1' },
      user: { id: 20, companyId: 1, email: 'other@test.com', role: 'DRIVER', name: '다른기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.approval.findFirst.mockResolvedValue({
      id: 1, status: 'PENDING', requesterId: 10,
    });

    await cancelApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should return 400 when approval is not PENDING', async () => {
    const req = createAuthReq({ params: { id: '1' } });
    const res = createMockRes();

    mockPrisma.approval.findFirst.mockResolvedValue({
      id: 1, status: 'APPROVED', requesterId: 1,
    });

    await cancelApproval(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─────────────────────────────────────────
// getApprovalStats
// ─────────────────────────────────────────

describe('getApprovalStats controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return approval statistics', async () => {
    const req = createAuthReq();
    const res = createMockRes();

    mockPrisma.approval.count
      .mockResolvedValueOnce(5)   // pending
      .mockResolvedValueOnce(20)  // approved
      .mockResolvedValueOnce(3)   // rejected
      .mockResolvedValueOnce(28); // total
    mockPrisma.approvalStep.count.mockResolvedValue(2);

    await getApprovalStats(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { pending: 5, approved: 20, rejected: 3, total: 28, myPending: 2 },
    });
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq();
    const res = createMockRes();

    mockPrisma.approval.count.mockRejectedValue(new Error('DB error'));

    await getApprovalStats(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
