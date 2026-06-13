import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { login, refreshAccessToken, getMe } from '../../controllers/authController';
import { prisma } from '../../utils/prisma';
import { AuthRequest } from '../../middleware/auth';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../services/smsService', () => ({
  sendSms: jest.fn(),
  generateOtp: jest.fn().mockReturnValue('123456'),
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const JWT_SECRET = process.env.JWT_SECRET!;

function createMockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

const mockCompany = {
  id: 1,
  code: 'TESTCO',
  name: '테스트버스',
  isActive: true,
};

const hashedPassword = bcrypt.hashSync('Admin123!', 10);

const mockUser = {
  id: 1,
  companyId: 1,
  email: 'admin@test.busync.kr',
  name: '관리자',
  role: 'ADMIN',
  password: hashedPassword,
  isActive: true,
  kakaoId: null,
  employeeId: 'ADM001',
  phone: '010-1234-5678',
};

describe('login controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 400 if companyCode, email, or password is missing', async () => {
    const req = { body: { email: 'a@b.com', password: '123' } } as Request;
    const res = createMockRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  it('should return 401 for invalid company code', async () => {
    const req = {
      body: { companyCode: 'INVALID', email: 'a@b.com', password: '123' },
    } as Request;
    const res = createMockRes();

    mockPrisma.company.findUnique.mockResolvedValue(null);

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '유효하지 않은 회사 코드입니다.' }),
    );
  });

  it('should return 401 for inactive company', async () => {
    const req = {
      body: { companyCode: 'TESTCO', email: 'a@b.com', password: '123' },
    } as Request;
    const res = createMockRes();

    mockPrisma.company.findUnique.mockResolvedValue({ ...mockCompany, isActive: false });

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 when user is not found', async () => {
    const req = {
      body: { companyCode: 'TESTCO', email: 'noone@test.com', password: '123' },
    } as Request;
    const res = createMockRes();

    mockPrisma.company.findUnique.mockResolvedValue(mockCompany);
    mockPrisma.user.findFirst.mockResolvedValue(null);

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    // 보안: 사용자 존재 여부를 노출하지 않도록 모든 로그인 실패는 동일한 일반 메시지를 반환한다(계정 열거 방지).
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '아이디(이메일/전화번호) 또는 비밀번호가 올바르지 않습니다.' }),
    );
  });

  it('should return 401 when user belongs to a different company', async () => {
    const req = {
      body: { companyCode: 'TESTCO', email: 'admin@test.busync.kr', password: 'Admin123!' },
    } as Request;
    const res = createMockRes();

    mockPrisma.company.findUnique.mockResolvedValue(mockCompany);
    // findFirst는 companyId 필터로 조회하므로 다른 회사 사용자는 null 반환
    mockPrisma.user.findFirst.mockResolvedValue(null);

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 when user has no password (social login only)', async () => {
    const req = {
      body: { companyCode: 'TESTCO', email: 'admin@test.busync.kr', password: 'Admin123!' },
    } as Request;
    const res = createMockRes();

    mockPrisma.company.findUnique.mockResolvedValue(mockCompany);
    mockPrisma.user.findFirst.mockResolvedValue({ ...mockUser, password: null });

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    // 보안: 소셜 전용 계정임을 알려주면 계정 존재/유형이 노출되므로 동일한 일반 메시지를 반환한다.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '아이디(이메일/전화번호) 또는 비밀번호가 올바르지 않습니다.' }),
    );
  });

  it('should return 401 for wrong password', async () => {
    const req = {
      body: { companyCode: 'TESTCO', email: 'admin@test.busync.kr', password: 'WrongPass1!' },
      ip: '127.0.0.1',
    } as unknown as Request;
    const res = createMockRes();

    mockPrisma.company.findUnique.mockResolvedValue(mockCompany);
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return tokens and user data on successful login', async () => {
    const req = {
      body: { companyCode: 'TESTCO', email: 'admin@test.busync.kr', password: 'Admin123!' },
    } as Request;
    const res = createMockRes();

    mockPrisma.company.findUnique.mockResolvedValue(mockCompany);
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
    // issueRefreshToken internals
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 1, token: 'refresh-token-abc', family: 'fam-123' });

    await login(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          user: expect.objectContaining({
            id: 1,
            email: 'admin@test.busync.kr',
            name: '관리자',
          }),
        }),
      }),
    );

    // user data should NOT contain password or kakaoId
    const responseData = (res.json as jest.Mock).mock.calls[0][0].data.user;
    expect(responseData.password).toBeUndefined();
    expect(responseData.kakaoId).toBeUndefined();
  });

  it('should return 500 on unexpected error', async () => {
    const req = {
      body: { companyCode: 'TESTCO', email: 'admin@test.busync.kr', password: 'Admin123!' },
    } as Request;
    const res = createMockRes();

    mockPrisma.company.findUnique.mockRejectedValue(new Error('DB connection failed'));

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('refreshAccessToken controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 400 if refreshToken is missing', async () => {
    const req = { body: {} } as Request;
    const res = createMockRes();

    await refreshAccessToken(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 401 if refresh token is not found in DB', async () => {
    const req = { body: { refreshToken: 'non-existent-token' } } as Request;
    const res = createMockRes();

    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

    await refreshAccessToken(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 and delete expired refresh token', async () => {
    const req = { body: { refreshToken: 'expired-token' } } as Request;
    const res = createMockRes();

    const expiredToken = {
      id: 1,
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 1000), // expired
      user: { ...mockUser, isActive: true },
    };
    mockPrisma.refreshToken.findUnique.mockResolvedValue(expiredToken);
    mockPrisma.refreshToken.delete.mockResolvedValue(expiredToken);

    await refreshAccessToken(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockPrisma.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('should return 403 if user is inactive', async () => {
    const req = { body: { refreshToken: 'valid-token' } } as Request;
    const res = createMockRes();

    const storedToken = {
      id: 1,
      token: 'valid-token',
      expiresAt: new Date(Date.now() + 86400000),
      user: { ...mockUser, isActive: false },
    };
    mockPrisma.refreshToken.findUnique.mockResolvedValue(storedToken);

    await refreshAccessToken(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should return new access token for valid refresh token', async () => {
    const req = { body: { refreshToken: 'valid-token' } } as Request;
    const res = createMockRes();

    const storedToken = {
      id: 1,
      token: 'valid-token',
      family: 'test-family-1234567890',
      userId: 1,
      expiresAt: new Date(Date.now() + 86400000),
      user: { ...mockUser, isActive: true },
    };
    mockPrisma.refreshToken.findUnique.mockResolvedValue(storedToken);
    mockPrisma.refreshToken.delete.mockResolvedValue(storedToken);
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.refreshToken.create.mockResolvedValue({
      id: 2, token: 'new-refresh-token', family: storedToken.family,
    });

    await refreshAccessToken(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          accessToken: expect.any(String),
          token: expect.any(String),
        }),
      }),
    );

    // Verify the access token is a valid JWT
    const { accessToken } = (res.json as jest.Mock).mock.calls[0][0].data;
    const decoded = jwt.verify(accessToken, JWT_SECRET) as Record<string, unknown>;
    expect(decoded.id).toBe(1);
    expect(decoded.role).toBe('ADMIN');
  });

  it('should return 500 on unexpected error', async () => {
    const req = { body: { refreshToken: 'token' } } as Request;
    const res = createMockRes();

    mockPrisma.refreshToken.findUnique.mockRejectedValue(new Error('DB error'));

    await refreshAccessToken(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getMe controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return user data for authenticated user', async () => {
    const req = {
      user: { id: 1, companyId: 1, email: 'admin@test.busync.kr', role: 'ADMIN', name: '관리자' },
    } as AuthRequest;
    const res = createMockRes();

    const userData = {
      id: 1,
      name: '관리자',
      email: 'admin@test.busync.kr',
      phone: '010-1234-5678',
      role: 'ADMIN',
      employeeId: 'ADM001',
      licenseNumber: null,
      driverType: null,
      kakaoId: null,
      isActive: true,
      createdAt: new Date('2024-01-01'),
      licenseExpiresAt: null,
      qualificationExpiresAt: null,
    };
    mockPrisma.user.findUnique.mockResolvedValue(userData);

    await getMe(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: userData,
    });

    // Verify the select clause was used
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: expect.objectContaining({
        id: true,
        name: true,
        email: true,
        role: true,
      }),
    });
  });

  it('should return 500 on error', async () => {
    const req = {
      user: { id: 1, companyId: 1, email: 'admin@test.busync.kr', role: 'ADMIN', name: '관리자' },
    } as AuthRequest;
    const res = createMockRes();

    mockPrisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    await getMe(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
