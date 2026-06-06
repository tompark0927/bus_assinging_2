import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { sendSms, generateOtp } from '../services/smsService';
import { sendEmail, otpEmailHtml } from '../services/emailService';
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

// 다른 컨트롤러(companies registerCompany 등)에서 동일한 토큰 발급 정책을 재사용하도록 export
export async function issueTokenPair(user: { id: number; companyId: number; email: string | null; role: string; name: string }, family?: string) {
  const accessToken = issueAccessToken(user);
  const refresh = await issueRefreshToken(user.id, family);
  return { accessToken, refreshToken: refresh.token, family: refresh.family };
}

function safeUser(user: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, kakaoId, ...safe } = user;
  return safe;
}

// 휴대폰 번호 마스킹: "010-1234-5678" / "01012345678" → "010-****-5678"
// 비밀번호 재설정 시 "어느 번호로 인증번호가 갔는지" 힌트를 안전하게 보여주기 위함.
function maskPhone(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length < 7) return '***';
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

// 이메일 마스킹: "tompark0927@gmail.com" → "to****@gmail.com"
function maskEmail(email: string | null | undefined): string {
  const e = String(email ?? '');
  const at = e.indexOf('@');
  if (at < 1) return '***';
  const local = e.slice(0, at);
  const domain = e.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}****${domain}`;
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

    // 이메일 / 사원번호 / 전화번호로 로그인 가능
    const phoneDigits = String(email).replace(/\D/g, '');
    const user = await prisma.user.findFirst({
      where: {
        companyId: company.id,
        isActive: true,
        OR: [
          { email },
          { employeeId: email },
          { phone: email },
          ...(phoneDigits ? [{ phone: phoneDigits }] : []),
        ],
      },
    });
    // 보안: 모든 인증 실패 케이스(존재 안함 / 비밀번호 미설정 / 비밀번호 틀림)에 대해
    // 동일한 응답을 내려 사용자 enumeration 을 차단. 차이점은 logger 에만 기록.
    const GENERIC_LOGIN_FAIL = '아이디(이메일/전화번호) 또는 비밀번호가 올바르지 않습니다.';

    if (!user) {
      logger.warn('로그인 실패 - 사용자 미존재', { email, companyCode, ip: req.ip });
      return res.status(401).json({ success: false, message: GENERIC_LOGIN_FAIL });
    }

    if (!user.password) {
      // 카카오/폰 전용 계정. 응답 메시지를 동일하게 유지해 attacker 가 "존재하지만 비번 없음" 을 구분 못하게 함.
      logger.warn('로그인 실패 - 비밀번호 미설정 계정 시도', { userId: user.id, ip: req.ip });
      return res.status(401).json({ success: false, message: GENERIC_LOGIN_FAIL });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      logger.warn('로그인 실패 - 잘못된 비밀번호', { email, companyCode, ip: req.ip });
      return res.status(401).json({ success: false, message: GENERIC_LOGIN_FAIL });
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
//
// 보안: 무차별 대입(6자리 1,000,000 조합) 방지를 위해
//   1. 가장 최근 유효한 (만료 전, 미사용) OTP 행을 lookup
//   2. 그 행 위에서 attempts 카운터를 증가시키며 매칭 시도
//   3. 5회 실패 시 해당 OTP 행을 used=true 로 잠금 → 사용자가 새 OTP 발송 필요
//   4. 응답 메시지는 동일 → 공격자에게 "OTP 자체는 맞는데 다른 게 틀렸다" 같은 단서 제공 안함
const MAX_OTP_ATTEMPTS = 5;

export const verifyPhoneOtp = async (req: Request, res: Response) => {
  try {
    const { phone, otp, companyCode } = req.body;
    if (!phone || !otp) return res.status(400).json({ success: false, message: '전화번호와 인증번호를 입력해주세요.' });

    // OTP 검증 + 시도 카운트 + 사용 처리를 원자적으로 수행
    const verifyResult = await prisma.$transaction(async (tx) => {
      const found = await tx.otpVerification.findFirst({
        where: { phone, used: false, expiresAt: { gte: new Date() } },
        orderBy: { createdAt: 'desc' },
      });

      if (!found) return { ok: false, locked: false };

      // 시도 횟수 초과 여부 사전 검사
      if (found.attempts >= MAX_OTP_ATTEMPTS) {
        await tx.otpVerification.update({
          where: { id: found.id },
          data: { used: true }, // 자동 잠금
        });
        return { ok: false, locked: true };
      }

      if (found.otp === otp) {
        await tx.otpVerification.update({ where: { id: found.id }, data: { used: true } });
        return { ok: true, record: found };
      }

      // 실패 → attempts 증가. 5회째 실패면 자동 잠금
      const nextAttempts = found.attempts + 1;
      await tx.otpVerification.update({
        where: { id: found.id },
        data: {
          attempts: nextAttempts,
          used: nextAttempts >= MAX_OTP_ATTEMPTS,
        },
      });
      return { ok: false, locked: nextAttempts >= MAX_OTP_ATTEMPTS };
    });

    if (!verifyResult.ok) {
      if (verifyResult.locked) {
        logger.warn('OTP 무차별 대입 의심 — 자동 잠금', { phone, ip: req.ip });
        return res.status(401).json({
          success: false,
          message: '인증 시도가 너무 많습니다. 인증번호를 새로 발송해주세요.',
        });
      }
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
// 4. 비밀번호 재설정 (이메일 발송 기능이 없으므로 휴대폰 OTP 기반)
//
//   흐름: (1) 회사코드 + 아이디(이메일/사원번호/전화) 로 본인 계정 확인
//        → 등록된 휴대폰으로 OTP 발송
//        (2) OTP + 새 비밀번호 제출 → 검증 후 비밀번호 교체 + 전 세션 무효화 + 즉시 로그인
// ─────────────────────────────────────────

// 회사코드 + 아이디로 사용자 1명을 해석 (login 의 OR 조건과 동일 규칙 재사용)
async function resolveUserByIdentifier(companyId: number, identifier: string) {
  const idStr = String(identifier).trim();
  const digits = idStr.replace(/\D/g, '');
  return prisma.user.findFirst({
    where: {
      companyId,
      isActive: true,
      OR: [
        { email: idStr },
        { employeeId: idStr },
        { phone: idStr },
        ...(digits ? [{ phone: digits }] : []),
      ],
    },
  });
}

// 4a. 비밀번호 재설정 — OTP 발송 (이메일)
export const forgotPasswordSendOtp = async (req: Request, res: Response) => {
  try {
    const { companyCode, identifier } = req.body;
    if (!companyCode || !identifier) {
      return res.status(400).json({ success: false, message: '회사 코드와 아이디(이메일/사원번호)를 입력해주세요.' });
    }

    const company = await prisma.company.findUnique({ where: { code: companyCode } });
    if (!company || !company.isActive) {
      return res.status(401).json({ success: false, message: '유효하지 않은 회사 코드입니다.' });
    }

    const user = await resolveUserByIdentifier(company.id, identifier);
    if (!user) {
      return res.status(404).json({ success: false, message: '일치하는 계정을 찾을 수 없습니다. 회사 코드와 아이디를 확인해주세요.' });
    }
    if (!user.email) {
      return res.status(400).json({
        success: false,
        message: '등록된 이메일이 없어 본인인증을 진행할 수 없습니다. 회사 관리자에게 비밀번호 재설정을 요청해주세요.',
      });
    }
    const userEmail = user.email;

    // 직전 1분 내 발송 제한
    const recent = await prisma.otpVerification.findFirst({
      where: { email: userEmail, used: false, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (recent) return res.status(429).json({ success: false, message: '인증번호는 1분에 한 번만 요청할 수 있습니다.' });

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await prisma.otpVerification.create({ data: { email: userEmail, otp, expiresAt } });
    await sendEmail(userEmail, '[Busync] 비밀번호 재설정 인증번호', otpEmailHtml(otp), `Busync 비밀번호 재설정 인증번호: ${otp} (5분 유효)`);

    logger.info('비밀번호 재설정 OTP 발송(이메일)', { userId: user.id, companyId: company.id });
    return res.json({
      success: true,
      message: '등록된 이메일로 인증번호를 발송했습니다.',
      data: { emailHint: maskEmail(userEmail) },
    });
  } catch (error) {
    logger.error('비밀번호 재설정 OTP 발송 오류', { error });
    return res.status(500).json({ success: false, message: '인증번호 발송에 실패했습니다.' });
  }
};

// 4b. 비밀번호 재설정 — OTP 검증 + 새 비밀번호 설정
export const forgotPasswordReset = async (req: Request, res: Response) => {
  try {
    const { companyCode, identifier, otp, newPassword } = req.body;
    if (!companyCode || !identifier || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: '모든 항목을 입력해주세요.' });
    }

    const company = await prisma.company.findUnique({ where: { code: companyCode } });
    if (!company || !company.isActive) {
      return res.status(401).json({ success: false, message: '유효하지 않은 회사 코드입니다.' });
    }

    const user = await resolveUserByIdentifier(company.id, identifier);
    if (!user || !user.email) {
      return res.status(404).json({ success: false, message: '일치하는 계정을 찾을 수 없습니다.' });
    }
    const userEmail = user.email;

    // OTP 검증 + 시도 카운트 (verifyPhoneOtp 와 동일한 원자적 패턴)
    const verifyResult = await prisma.$transaction(async (tx) => {
      const found = await tx.otpVerification.findFirst({
        where: { email: userEmail, used: false, expiresAt: { gte: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!found) return { ok: false, locked: false };
      if (found.attempts >= MAX_OTP_ATTEMPTS) {
        await tx.otpVerification.update({ where: { id: found.id }, data: { used: true } });
        return { ok: false, locked: true };
      }
      if (found.otp === otp) {
        await tx.otpVerification.update({ where: { id: found.id }, data: { used: true } });
        return { ok: true, locked: false };
      }
      const nextAttempts = found.attempts + 1;
      await tx.otpVerification.update({
        where: { id: found.id },
        data: { attempts: nextAttempts, used: nextAttempts >= MAX_OTP_ATTEMPTS },
      });
      return { ok: false, locked: nextAttempts >= MAX_OTP_ATTEMPTS };
    });

    if (!verifyResult.ok) {
      if (verifyResult.locked) {
        logger.warn('비밀번호 재설정 OTP 무차별 대입 의심 — 자동 잠금', { userId: user.id, ip: req.ip });
        return res.status(401).json({ success: false, message: '인증 시도가 너무 많습니다. 인증번호를 새로 발송해주세요.' });
      }
      return res.status(401).json({ success: false, message: '인증번호가 올바르지 않거나 만료되었습니다.' });
    }

    // 기존 비밀번호와 동일한 값은 거부 (있을 때만)
    if (user.password && (await bcrypt.compare(newPassword, user.password))) {
      return res.status(400).json({ success: false, message: '기존 비밀번호와 다른 비밀번호로 설정해주세요.' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed, mustChangePassword: false } });
    // 보안: 기존 모든 세션(리프레시 토큰) 무효화 → 탈취된 세션 차단
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    logger.info('비밀번호 재설정 완료', { userId: user.id, companyId: company.id });

    // UX: 재설정 직후 바로 로그인되도록 새 토큰 발급
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    const tokens = await issueTokenPair(fresh!);
    return res.json({
      success: true,
      message: '비밀번호가 변경되었습니다.',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        token: tokens.accessToken,
        user: safeUser(fresh as unknown as Record<string, unknown>),
      },
    });
  } catch (error) {
    logger.error('비밀번호 재설정 오류', { error });
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 5. 회사 코드 찾기 (등록된 휴대폰으로 문자 발송 — enumeration 방지)
// ─────────────────────────────────────────
export const findCompanyCode = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: '전화번호를 입력해주세요.' });

    const raw = String(phone).trim();
    const digits = raw.replace(/\D/g, '');

    const users = await prisma.user.findMany({
      where: { isActive: true, OR: [{ phone: raw }, ...(digits ? [{ phone: digits }] : [])] },
      include: { company: true },
    });

    // 회사 단위로 중복 제거 (활성 회사만)
    const companies = Array.from(
      new Map(users.filter((u) => u.company?.isActive).map((u) => [u.company.id, u.company])).values(),
    );

    // enumeration 방지: 찾았든 못 찾았든 동일한 일반 응답.
    // 실제 코드는 본인 휴대폰 문자로만 전달 (SMS_DEV_MODE=true 면 서버 콘솔에 출력).
    if (companies.length > 0) {
      const lines = companies.map((c) => `· ${c.name}: ${c.code}`).join('\n');
      await sendSms(raw, `[Busync] 가입된 회사 코드 안내\n${lines}`);
      logger.info('회사 코드 찾기 — 발송', { phone: maskPhone(raw), count: companies.length });
    } else {
      logger.warn('회사 코드 찾기 — 일치하는 계정 없음', { phone: maskPhone(raw) });
    }

    return res.json({
      success: true,
      message: '입력하신 번호로 가입된 회사 코드가 있다면 문자로 발송했습니다. 잠시 후 확인해주세요.',
    });
  } catch (error) {
    logger.error('회사 코드 찾기 오류', { error });
    return res.status(500).json({ success: false, message: '요청 처리에 실패했습니다.' });
  }
};

// ─────────────────────────────────────────
// 비밀번호 변경 (본인)
// ─────────────────────────────────────────
export const changePassword = async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ success: false, message: '새 비밀번호를 입력해주세요.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: '새 비밀번호는 6자리 이상이어야 합니다.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.password) {
      return res.status(400).json({ success: false, message: '비밀번호 변경이 불가능한 계정입니다.' });
    }

    // 최초 강제 변경(mustChangePassword)인 경우, 이미 이번 세션에서 인증된 상태이므로
    // 현재 비밀번호 재확인을 생략. 그 외 일반 변경은 현재 비밀번호 검증 필수.
    if (!user.mustChangePassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: '현재 비밀번호와 새 비밀번호를 입력해주세요.' });
      }
      const isValid = await bcrypt.compare(currentPassword, user.password);
      if (!isValid) {
        return res.status(401).json({ success: false, message: '현재 비밀번호가 올바르지 않습니다.' });
      }
    }

    // 최초 비밀번호와 동일한 새 비밀번호는 거부 (강제 변경의 의미 보존)
    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ success: false, message: '기존 비밀번호와 다른 비밀번호로 설정해주세요.' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: req.user!.id }, data: { password: hashed, mustChangePassword: false } });

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
        mustChangePassword: true,
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
