import { Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
  exportMyData,
  deleteMyData,
} from '../../controllers/userController';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/auth';
import { generateInitialPassword } from '../../utils/initialPassword';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../utils/auditLog', () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
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
// getUsers
// ─────────────────────────────────────────

describe('getUsers controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated users list', async () => {
    const req = createAuthReq({ query: { page: '1', limit: '10' } });
    const res = createMockRes();

    const users = [
      { id: 10, name: '김기사', email: 'kim@test.busync.kr', role: 'DRIVER', employeeId: 'DRV010' },
      { id: 11, name: '이기사', email: 'lee@test.busync.kr', role: 'DRIVER', employeeId: 'DRV011' },
    ];

    mockPrisma.user.findMany.mockResolvedValue(users);
    mockPrisma.user.count.mockResolvedValue(2);
    // 기사별 올해 사용 휴가 수 집계 (잔여 휴가 계산용)
    mockPrisma.dayOffRequest.groupBy.mockResolvedValue([
      { driverId: 10, _count: { _all: 3 } },
    ]);

    await getUsers(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        // 각 유저에 vacationUsed(올해 비반려 휴무요청 수)가 병합되어 반환
        data: [
          { ...users[0], vacationUsed: 3 },
          { ...users[1], vacationUsed: 0 },
        ],
        pagination: expect.objectContaining({ total: 2 }),
      }),
    );
  });

  it('should filter by role', async () => {
    const req = createAuthReq({ query: { role: 'DRIVER' } });
    const res = createMockRes();

    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);

    await getUsers(req, res);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'DRIVER' }),
      }),
    );
  });

  it('should filter by isActive', async () => {
    const req = createAuthReq({ query: { isActive: 'true' } });
    const res = createMockRes();

    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);

    await getUsers(req, res);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });

  it('should search by name/email/employeeId', async () => {
    const req = createAuthReq({ query: { search: '김기사' } });
    const res = createMockRes();

    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);

    await getUsers(req, res);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ name: { contains: '김기사', mode: 'insensitive' } }),
          ]),
        }),
      }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ query: {} });
    const res = createMockRes();

    mockPrisma.user.findMany.mockRejectedValue(new Error('DB error'));

    await getUsers(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// createUser
// ─────────────────────────────────────────

describe('createUser controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create user and hash password', async () => {
    const req = createAuthReq({
      body: {
        name: '박기사',
        email: 'park@test.busync.kr',
        phone: '010-9876-5432',
        employeeId: 'DRV020',
        password: 'SecurePass1!',
      },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 20, name: '박기사', email: 'park@test.busync.kr', role: 'DRIVER',
    });

    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '박기사',
          email: 'park@test.busync.kr',
          password: expect.any(String),
        }),
      }),
    );
  });

  it('should return 400 when DRIVER has no phone (초기 비밀번호 생성에 필요)', async () => {
    const req = createAuthReq({
      body: { name: '최기사', email: 'choi@test.com', employeeId: 'DRV030' },
    });
    const res = createMockRes();

    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('전화번호가 필수') }),
    );
  });

  it('should use "이름(영타)+전화번호 뒤4자리" as default password and force change', async () => {
    const req = createAuthReq({
      body: { name: '최기사', email: 'choi@test.com', phone: '010-1234-5678', employeeId: 'DRV030' },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 30, name: '최기사' });

    await createUser(req, res);

    // 초기 비밀번호 = generateInitialPassword(이름, 전화번호)
    const createdData = mockPrisma.user.create.mock.calls[0][0].data;
    const isMatch = await bcrypt.compare(generateInitialPassword('최기사', '010-1234-5678'), createdData.password);
    expect(isMatch).toBe(true);
    // 자동 생성 비밀번호 → 첫 로그인 시 변경 강제
    expect(createdData.mustChangePassword).toBe(true);
  });

  it('should return 409 for duplicate email', async () => {
    const req = createAuthReq({
      body: { name: '김기사', email: 'kim@test.busync.kr', phone: '010-1111-2222', employeeId: 'DRV010' },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue({ id: 10 });

    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('이미 사용 중') }),
    );
  });

  it('should return 409 for duplicate employeeId', async () => {
    const req = createAuthReq({
      body: { name: '김기사', phone: '010-1111-2222', employeeId: 'DRV010' },
    });
    const res = createMockRes();

    // 전화번호 중복 없음 → 사번 중복 검출
    mockPrisma.user.findFirst
      .mockResolvedValueOnce(null) // phone dup check
      .mockResolvedValueOnce({ id: 10 }); // employeeId dup check

    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('이미 존재하는 사번') }),
    );
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({
      body: { name: '실패', email: 'fail@test.com', phone: '010-9999-8888', employeeId: 'X001' },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockRejectedValue(new Error('DB error'));

    await createUser(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// updateUser
// ─────────────────────────────────────────

describe('updateUser controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should update user as ADMIN', async () => {
    const req = createAuthReq({
      params: { id: '10' },
      body: { name: '김기사(수정)', phone: '010-0000-0000', driverType: 'REGULAR', isActive: false },
    });
    const res = createMockRes();

    mockPrisma.user.findFirst
      .mockResolvedValueOnce({
        id: 10, name: '김기사', phone: '010-1111-1111', driverType: null, isActive: true,
      })
      // 전화번호 변경 시 회사 내 중복 검사 (본인 제외) → 중복 없음
      .mockResolvedValueOnce(null);
    mockPrisma.user.update.mockResolvedValue({
      id: 10, name: '김기사(수정)', phone: '010-0000-0000',
    });

    await updateUser(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 404 when user not found', async () => {
    const req = createAuthReq({ params: { id: '999' }, body: { name: 'test' } });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue(null);

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 403 when DRIVER updates another user', async () => {
    const req = createAuthReq({
      params: { id: '10' },
      body: { name: '해킹' },
      user: { id: 20, companyId: 1, email: 'other@test.com', role: 'DRIVER', name: '다른기사' },
    } as any);
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue({ id: 10, name: '김기사' });

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ params: { id: '10' }, body: {} });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockRejectedValue(new Error('DB error'));

    await updateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// deleteUser (soft delete)
// ─────────────────────────────────────────

describe('deleteUser controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should soft-delete user by setting isActive to false', async () => {
    const req = createAuthReq({ params: { id: '10' } });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue({ id: 10, name: '김기사', isActive: true });
    mockPrisma.user.update.mockResolvedValue({ id: 10, isActive: false });

    await deleteUser(req, res);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { isActive: false },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('비활성화') }),
    );
  });

  it('should return 404 when user not found', async () => {
    const req = createAuthReq({ params: { id: '999' } });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue(null);

    await deleteUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// resetPassword
// ─────────────────────────────────────────

describe('resetPassword controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should reset password to newPassword', async () => {
    const req = createAuthReq({ params: { id: '10' }, body: { newPassword: 'NewPass123!' } });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue({ id: 10, employeeId: 'DRV010' });
    mockPrisma.user.update.mockResolvedValue({ id: 10 });

    await resetPassword(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('초기화') }),
    );
    // Verify new password is hashed correctly
    const updateData = mockPrisma.user.update.mock.calls[0][0].data;
    const isMatch = await bcrypt.compare('NewPass123!', updateData.password);
    expect(isMatch).toBe(true);
  });

  it('should use employeeId as default when newPassword not provided', async () => {
    const req = createAuthReq({ params: { id: '10' }, body: {} });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue({ id: 10, employeeId: 'DRV010' });
    mockPrisma.user.update.mockResolvedValue({ id: 10 });

    await resetPassword(req, res);

    const updateData = mockPrisma.user.update.mock.calls[0][0].data;
    const isMatch = await bcrypt.compare('DRV010', updateData.password);
    expect(isMatch).toBe(true);
  });

  it('should return 404 when user not found', async () => {
    const req = createAuthReq({ params: { id: '999' }, body: {} });
    const res = createMockRes();

    mockPrisma.user.findFirst.mockResolvedValue(null);

    await resetPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─────────────────────────────────────────
// exportMyData
// ─────────────────────────────────────────

describe('exportMyData controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should export all user data as JSON attachment', async () => {
    const req = createAuthReq();
    const res = createMockRes();

    const userData = {
      id: 1, name: '관리자', email: 'admin@test.busync.kr', employeeId: 'ADM001', role: 'ADMIN',
    };
    mockPrisma.user.findUnique.mockResolvedValue(userData);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([]);
    mockPrisma.payrollRecord.findMany.mockResolvedValue([]);
    mockPrisma.dayOffRequest.findMany.mockResolvedValue([]);
    mockPrisma.approval.findMany.mockResolvedValue([]);
    mockPrisma.approvalStep.findMany.mockResolvedValue([]);
    mockPrisma.trainingRecord.findMany.mockResolvedValue([]);
    mockPrisma.directMessage.count.mockResolvedValue(0);
    mockPrisma.scheduleSlot.findMany.mockResolvedValue([]);
    mockPrisma.incidentRecord.findMany.mockResolvedValue([]);

    await exportMyData(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('personal-data-ADM001'),
    );
    expect(res.send).toHaveBeenCalled();
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq();
    const res = createMockRes();

    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    await exportMyData(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─────────────────────────────────────────
// deleteMyData (anonymization)
// ─────────────────────────────────────────

describe('deleteMyData controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 400 if password is missing', async () => {
    const req = createAuthReq({ body: {} });
    const res = createMockRes();

    await deleteMyData(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 401 for wrong password', async () => {
    const hashedPw = await bcrypt.hash('correct', 10);
    const req = createAuthReq({ body: { password: 'wrong' } });
    const res = createMockRes();

    mockPrisma.user.findUnique.mockResolvedValue({ id: 1, password: hashedPw });

    await deleteMyData(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should anonymize user data on valid password', async () => {
    const hashedPw = await bcrypt.hash('MyPassword1!', 10);
    const req = createAuthReq({ body: { password: 'MyPassword1!' } });
    const res = createMockRes();

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1, name: '관리자', email: 'admin@test.com', phone: '010-1234-5678', password: hashedPw,
    });
    mockPrisma.user.update.mockResolvedValue({ id: 1 });
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

    await deleteMyData(req, res);

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: false,
          name: '탈퇴회원',
          email: null,
          phone: null,
          password: null,
        }),
      }),
    );
    expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 1 } });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('should return 404 when user not found', async () => {
    const req = createAuthReq({ body: { password: 'test' } });
    const res = createMockRes();

    mockPrisma.user.findUnique.mockResolvedValue(null);

    await deleteMyData(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 500 on error', async () => {
    const req = createAuthReq({ body: { password: 'test' } });
    const res = createMockRes();

    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    await deleteMyData(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
