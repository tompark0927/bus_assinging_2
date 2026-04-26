import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { sendSms, generateOtp } from '../services/smsService';
import logger from '../utils/logger';

// ─────────────────────────────────────────
// 공통: 토큰 발급
// ─────────────────────────────────────────
function issueAccessToken(user: { id: number; companyId: number; email: string | null; role: string; name: string }) {
  return jwt.sign(
    { id: user.id, companyId: user.companyId, email: user.email ?? '', role: user.role, name: user.name },
    process.env.JWT_SECRET!,
    { expiresIn: '2h' } as jwt.SignOptions // 액세스 토큰: 2시간
  );
}

async function issueRefreshToken(userId: number, family?: string): Promise<{ token: string; family: string }> {
  const token = crypto.randomBytes(64).toString('hex');
  const tokenFamily = family || crypto.randomUUID(); // 새 로그인이면 새 family 생성
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30일

  // 기존 만료 토큰 정리
  await prisma.refreshToken.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });

  await prisma.refreshToken.create({ data: { userId, token, family: tokenFamily, expiresAt } });
  return { token, family: tokenFamily };
}

async function issueTokenPair(user: { id: number; companyId: number; email: string | null; role: string; name: string }, family?: string) {
  const accessToken = issueAccessToken(user);
  const refresh = await issueRefreshToken(user.id, family);
  return { accessToken, refreshToken: refresh.token, family: refresh.family };
}

function safeUser(user: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, kakaoId, ...safe } = user;
  return safe;
}

// ─────────────────────────────────────────
// 1. 이메일 + 비밀번호 로그인
// ─────────────────────────────────────────
export const login = async (req: Request, res: Response) => {
  try {
    const { companyCode, email, password } = req.body;

    if (!companyCode || !email || !password) {
      return res.status(400).json({ success: false, message: '회사 코드, 이메일, 비밀번호를 모두 입력해주세요.' });
    }

    const company = await prisma.company.findUnique({ where: { code: companyCode } });
    if (!company || !company.isActive) {
      return res.status(401).json({ success: false, message: '유효하지 않은 회사 코드입니다.' });
    }

    // 이메일 또는 사원번호로 로그인 가능
    const user = await prisma.user.findFirst({
      where: {
        companyId: company.id,
        isActive: true,
        OR: [
          { email },
          { employeeId: email },
        ],
      },
    });
    if (!user) {
      return res.status(401).json({ success: false, message: '이메일/사원번호 또는 비밀번호가 올바르지 않습니다.' });
    }

    if (!user.password) {
      return res.status(401).json({ success: false, message: '이 계정은 카카오 또는 전화번호로 로그인하세요.' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      logger.warn('로그인 실패 - 잘못된 비밀번호', { email, companyCode, ip: req.ip });
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const tokens = await issueTokenPair(user);
    logger.info('로그인 성공', { userId: user.id, companyId: user.companyId, role: user.role });

    return res.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        // 하위 호환: token 필드도 유지
        token: tokens.accessToken,
        user: safeUser(user as unknown as Record<string, unknown>),
      },
    });
  } catch (error) {
    logger.error('로그인 오류', { error });
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// Refresh Token → 새 Access Token
// ─────────────────────────────────────────
export const refreshAccessToken = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'refreshToken이 필요합니다.' });
    }

    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    // 토큰이 DB에 없음 → 이미 사용된(회전된) 토큰이 재사용됨 = 탈취 의심
    // 해당 사용자의 모든 리프레시 토큰을 삭제하여 강제 재로그인
    if (!stored) {
      // refreshToken의 family를 알 수 없으므로, 혹시 같은 토큰이 과거에 있었는지
      // 확인할 수는 없지만, 이 경우 안전하게 처리하기 위해 401 반환
      logger.warn('리프레시 토큰 재사용 감지 (토큰 미발견)', { token: refreshToken.substring(0, 8) + '...' });
      return res.status(401).json({ success: false, message: '유효하지 않은 리프레시 토큰입니다. 다시 로그인해주세요.' });
    }

    // 만료된 토큰
    if (stored.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      return res.status(401).json({ success: false, message: '리프레시 토큰이 만료되었습니다. 다시 로그인해주세요.' });
    }

    if (!stored.user.isActive) {
      return res.status(403).json({ success: false, message: '비활성화된 계정입니다.' });
    }

    const family = stored.family;
    const userId = stored.userId;

    // ── 토큰 회전: 새 토큰 발급 + 기존 토큰 삭제를 원자적으로 처리 ──
    let tokens: Awaited<ReturnType<typeof issueTokenPair>>;
    try {
      tokens = await prisma.$transaction(async (tx) => {
        // 기존 토큰 삭제
        await tx.refreshToken.delete({ where: { id: stored.id } });
        // 새 토큰 발급 (issueRefreshToken은 prisma를 직접 사용하므로 여기서 수동으로 처리)
        const accessToken = issueAccessToken(stored.user);
        const newToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await tx.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
        await tx.refreshToken.create({ data: { userId, token: newToken, family, expiresAt } });
        return { accessToken, refreshToken: newToken, family };
      });
    } catch (tokenError) {
      logger.error('토큰 회전 중 오류 — 기존 토큰 유지', { userId, error: tokenError });
      return res.status(500).json({ success: false, message: '토큰 갱신 중 오류가 발생했습니다.' });
    }

    logger.info('토큰 회전 성공', { userId, family: family.substring(0, 8) + '...' });

    return res.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        token: tokens.accessToken, // 하위 호환
      },
    });
  } catch (error) {
    logger.error('토큰 갱신 오류', { error });
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 로그아웃 (refresh token 폐기)
// ─────────────────────────────────────────
export const logout = async (req: AuthRequest, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    // 푸시 토큰 초기화 (선택)
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { expoPushToken: null },
    });
    logger.info('로그아웃', { userId: req.user!.id });
    return res.json({ success: true, message: '로그아웃되었습니다.' });
  } catch (error) {
    logger.error('로그아웃 오류', { error });
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 강제 로그아웃 (관리자가 특정 기사 로그아웃)
// ─────────────────────────────────────────
export const forceLogout = async (req: AuthRequest, res: Response) => {
  try {
    const targetId = parseInt(req.params.userId);
    const target = await prisma.user.findFirst({
      where: { id: targetId, companyId: req.user!.companyId },
    });
    if (!target) return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });

    await prisma.refreshToken.deleteMany({ where: { userId: targetId } });
    await prisma.user.update({ where: { id: targetId }, data: { expoPushToken: null } });

    logger.warn('강제 로그아웃 실행', { targetUserId: targetId, adminId: req.user!.id });
    return res.json({ success: true, message: `${target.name} 계정이 강제 로그아웃되었습니다.` });
  } catch (error) {
    logger.error('강제 로그아웃 오류', { error });
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 2. 카카오 로그인
// ─────────────────────────────────────────
export const kakaoLogin = async (req: Request, res: Response) => {
  try {
    const { accessToken: directToken, code, redirectUri } = req.body;

    let kakaoAccessToken = directToken as string | undefined;

    if (!kakaoAccessToken && code && redirectUri) {
      const tokenRes = await axios.post<{ access_token: string }>(
        'https://kauth.kakao.com/oauth/token',
        null,
        {
          params: {
            grant_type: 'authorization_code',
            client_id: process.env.KAKAO_CLIENT_ID,
            client_secret: process.env.KAKAO_CLIENT_SECRET,
            redirect_uri: redirectUri,
            code,
          },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
      kakaoAccessToken = tokenRes.data.access_token;
    }

    if (!kakaoAccessToken) {
      return res.status(400).json({ success: false, message: 'accessToken 또는 code/redirectUri를 제공해주세요.' });
    }

    const profileRes = await axios.get<{
      id: number;
      kakao_account?: { email?: string; phone_number?: string };
    }>('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${kakaoAccessToken}` },
      params: { property_keys: '["kakao_account.email","kakao_account.phone_number"]' },
    });

    const kakaoId = String(profileRes.data.id);
    const kakaoEmail = profileRes.data.kakao_account?.email;
    const kakaoPhone = profileRes.data.kakao_account?.phone_number;

    const normalizedPhone = kakaoPhone
      ? kakaoPhone.replace(/^\+82\s?/, '0').replace(/\s/g, '')
      : undefined;

    // 멀티테넌시: companyCode가 주어지면 해당 회사 소속만 조회
    const { companyCode } = req.body;
    let companyFilter: { companyId?: number } = {};
    if (companyCode) {
      const company = await prisma.company.findUnique({ where: { code: companyCode } });
      if (!company || !company.isActive) {
        return res.status(401).json({ success: false, message: '유효하지 않은 회사 코드입니다.' });
      }
      companyFilter = { companyId: company.id };
    }

    let user = await prisma.user.findFirst({ where: { kakaoId, ...companyFilter } });
    if (!user && normalizedPhone) user = await prisma.user.findFirst({ where: { phone: normalizedPhone, ...companyFilter } });
    if (!user && kakaoEmail) user = await prisma.user.findFirst({ where: { email: kakaoEmail, ...companyFilter } });

    if (!user) {
      return res.status(404).json({ success: false, message: '등록되지 않은 계정입니다. 관리자에게 등록을 요청하세요.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: '비활성화된 계정입니다.' });
    }
    if (!user.kakaoId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { kakaoId } });
    }

    const tokens = await issueTokenPair(user);
    return res.json({
      success: true,
      data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, token: tokens.accessToken, user: safeUser(user as unknown as Record<string, unknown>) },
    });
  } catch (error) {
    logger.error('카카오 로그인 오류', { error });
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      return res.status(401).json({ success: false, message: '유효하지 않은 카카오 토큰입니다.' });
    }
    return res.status(500).json({ success: false, message: '카카오 로그인 중 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 3a. 전화번호 OTP 발송
// ─────────────────────────────────────────
export const sendPhoneOtp = async (req: Request, res: Response) => {
  try {
    const { phone, companyCode } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: '전화번호를 입력해주세요.' });

    // 멀티테넌시: companyCode가 주어지면 해당 회사 소속만 조회
    const whereClause: Record<string, unknown> = { phone, isActive: true };
    if (companyCode) {
      const company = await prisma.company.findUnique({ where: { code: companyCode } });
      if (!company || !company.isActive) {
        return res.status(401).json({ success: false, message: '유효하지 않은 회사 코드입니다.' });
      }
      whereClause.companyId = company.id;
    }

    const user = await prisma.user.findFirst({ where: whereClause });
    if (!user || !user.isActive) {
      return res.status(404).json({ success: false, message: '등록되지 않은 전화번호입니다.' });
    }

    const recent = await prisma.otpVerification.findFirst({
      where: { phone, used: false, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (recent) return res.status(429).json({ success: false, message: '1분 후 다시 시도해주세요.' });

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60_000);

    await prisma.otpVerification.create({ data: { phone, otp, expiresAt } });
    await sendSms(phone, `[Busync] 인증번호: ${otp} (5분 유효)`);

    return res.json({ success: true, message: '인증번호가 발송되었습니다.' });
  } catch (error) {
    logger.error('OTP 발송 오류', { error });
    return res.status(500).json({ success: false, message: '인증번호 발송에 실패했습니다.' });
  }
};

// ─────────────────────────────────────────
// 3b. 전화번호 OTP 검증
// ─────────────────────────────────────────
export const verifyPhoneOtp = async (req: Request, res: Response) => {
  try {
    const { phone, otp, companyCode } = req.body;
    if (!phone || !otp) return res.status(400).json({ success: false, message: '전화번호와 인증번호를 입력해주세요.' });

    // OTP 검증 + 사용 처리를 원자적으로 수행
    const record = await prisma.$transaction(async (tx) => {
      const found = await tx.otpVerification.findFirst({
        where: { phone, otp, used: false, expiresAt: { gte: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!found) return null;
      await tx.otpVerification.update({ where: { id: found.id }, data: { used: true } });
      return found;
    });

    if (!record) {
      return res.status(401).json({ success: false, message: '인증번호가 올바르지 않거나 만료되었습니다.' });
    }

    // 멀티테넌시: companyCode가 주어지면 해당 회사 소속만 조회
    const whereClause: Record<string, unknown> = { phone, isActive: true };
    if (companyCode) {
      const company = await prisma.company.findUnique({ where: { code: companyCode } });
      if (!company || !company.isActive) {
        return res.status(401).json({ success: false, message: '유효하지 않은 회사 코드입니다.' });
      }
      whereClause.companyId = company.id;
    }

    const user = await prisma.user.findFirst({ where: whereClause });
    if (!user || !user.isActive) return res.status(404).json({ success: false, message: '등록되지 않은 사용자입니다.' });

    const tokens = await issueTokenPair(user);
    return res.json({
      success: true,
      data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, token: tokens.accessToken, user: safeUser(user as unknown as Record<string, unknown>) },
    });
  } catch (error) {
    logger.error('OTP 검증 오류', { error });
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 비밀번호 변경 (본인)
// ─────────────────────────────────────────
export const changePassword = async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '현재 비밀번호와 새 비밀번호를 입력해주세요.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: '새 비밀번호는 6자리 이상이어야 합니다.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.password) {
      return res.status(400).json({ success: false, message: '비밀번호 변경이 불가능한 계정입니다.' });
    }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: '현재 비밀번호가 올바르지 않습니다.' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: req.user!.id }, data: { password: hashed } });

    logger.info('비밀번호 변경 완료', { userId: req.user!.id });
    return res.json({ success: true, message: '비밀번호가 변경되었습니다.' });
  } catch (error) {
    logger.error('비밀번호 변경 오류', { error });
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 내 정보 조회
// ─────────────────────────────────────────
export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        employeeId: true, licenseNumber: true, driverType: true,
        kakaoId: true, isActive: true, createdAt: true,
        licenseExpiresAt: true, qualificationExpiresAt: true,
      },
    });
    return res.json({ success: true, data: user });
  } catch (error) {
    logger.error('내 정보 조회 오류', { error });
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 푸시 토큰 업데이트
// ─────────────────────────────────────────
export const updatePushToken = async (req: AuthRequest, res: Response) => {
  try {
    const { expoPushToken } = req.body;
    await prisma.user.update({ where: { id: req.user!.id }, data: { expoPushToken } });
    return res.json({ success: true, message: '푸시 토큰이 업데이트되었습니다.' });
  } catch (error) {
    logger.error('푸시 토큰 업데이트 오류', { error });
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
