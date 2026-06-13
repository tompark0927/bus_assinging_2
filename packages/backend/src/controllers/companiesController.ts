import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { issueTokenPair } from './authController';
import { DEFAULT_POLICY, POLICY_PRESETS } from '../agents/_solvers/types';
import { generateUniqueCompanyCode } from '../utils/companyCode';

function generateEmployeeId(): string {
  return 'ADM' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

export const registerCompany = async (req: Request, res: Response) => {
  try {
    const { companyName, adminName, adminEmail, adminPassword, adminPhone, emailVerifyToken } = req.body;

    if (!companyName || !adminName || !adminEmail || !adminPassword || !adminPhone) {
      return res.status(400).json({ success: false, message: '모든 필드를 입력해주세요.' });
    }

    if (adminPassword.length < 8) {
      return res.status(400).json({ success: false, message: '비밀번호는 8자 이상이어야 합니다.' });
    }

    // 이메일 인증 토큰 검증 — verifyEmailOtp 에서 발급한 토큰이어야 하고, 인증한 이메일과 일치해야 함
    if (!emailVerifyToken) {
      return res.status(400).json({ success: false, message: '이메일 인증이 필요합니다.' });
    }
    try {
      const decoded = jwt.verify(emailVerifyToken, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as { email?: string; purpose?: string };
      if (decoded.purpose !== 'email_verify' || decoded.email !== String(adminEmail).trim().toLowerCase()) {
        return res.status(400).json({ success: false, message: '이메일 인증 정보가 일치하지 않습니다. 이메일 인증을 다시 해주세요.' });
      }
    } catch {
      return res.status(400).json({ success: false, message: '이메일 인증이 만료되었습니다. 인증을 다시 해주세요.' });
    }

    const existingUser = await prisma.user.findFirst({ where: { email: adminEmail } });
    if (existingUser) {
      return res.status(409).json({ success: false, message: '이미 사용 중인 이메일입니다.' });
    }

    // 회사 코드는 회사명으로부터 자동 생성한다 (예: 진호버스 → JHBUS, 충돌 시 JHOBUS).
    const companyCode = await generateUniqueCompanyCode(
      companyName,
      async (code) => !!(await prisma.company.findUnique({ where: { code } })),
    );

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const employeeId = generateEmployeeId();

    // batch transaction: $use 미들웨어와 interactive transaction 충돌 회피
    const company = await prisma.company.create({
      data: { name: companyName, code: companyCode },
    });

    let user;
    try {
      user = await prisma.user.create({
        data: {
          companyId: company.id,
          name: adminName,
          email: adminEmail,
          phone: adminPhone,
          password: hashedPassword,
          role: 'ADMIN',
          employeeId,
        },
      });
    } catch (userError) {
      // 유저 생성 실패 시 회사도 롤백
      await prisma.company.delete({ where: { id: company.id } }).catch(() => {});
      throw userError;
    }

    // 로그인 흐름과 동일한 정책으로 토큰 발급:
    //   - 2시간짜리 access token (validateEnv 가 검증한 JWT_SECRET 직접 사용 — fallback 없음)
    //   - DB 추적되는 30일 refresh token (회전 + 강제 로그아웃 가능)
    const tokens = await issueTokenPair(user);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...safeUser } = user as Record<string, unknown>;

    return res.status(201).json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        token: tokens.accessToken, // 하위호환
        user: safeUser,
        company,
      },
      message: `${companyName} 등록이 완료되었습니다.`,
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const checkCompanyCode = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const existing = await prisma.company.findUnique({ where: { code: code.toUpperCase() } });
    return res.json({ success: true, available: !existing });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// 회사 정책 (CompanyPolicy JSON) — v2 솔버용 운영 정책
// ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/companies/me
 * 현재 로그인한 사용자의 회사 정보 조회. (이름, 코드, 통계)
 */
export const getCompanyInfo = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, code: true, isActive: true, createdAt: true },
    });
    if (!company) {
      return res.status(404).json({ success: false, message: '회사 정보를 찾을 수 없습니다.' });
    }
    const [driverCount, busCount, routeCount] = await Promise.all([
      prisma.user.count({ where: { companyId, role: 'DRIVER', isActive: true } }),
      prisma.bus.count({ where: { companyId, isActive: true } }),
      prisma.route.count({ where: { companyId, isActive: true } }),
    ]);
    return res.json({
      success: true,
      data: { ...company, stats: { drivers: driverCount, buses: busCount, routes: routeCount } },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

/**
 * PUT /api/v1/companies/me
 * 회사 이름 수정 (코드는 로그인용이라 변경 불가).
 */
export const updateCompanyInfo = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, message: '회사 이름이 필요합니다.' });
    }
    if (name.trim().length > 50) {
      return res.status(400).json({ success: false, message: '회사 이름은 50자 이하여야 합니다.' });
    }
    const updated = await prisma.company.update({
      where: { id: companyId },
      data: { name: name.trim() },
      select: { id: true, name: true, code: true },
    });
    return res.json({ success: true, data: updated, message: '회사 정보가 수정되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

/**
 * GET /api/v1/companies/policy
 * 회사 정책 조회. 미설정이면 회사 코드 기반 추정 또는 DEFAULT_POLICY 반환.
 */
export const getCompanyPolicy = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { code: true, policy: true },
    });
    if (!company) {
      return res.status(404).json({ success: false, message: '회사 정보를 찾을 수 없습니다.' });
    }
    let policy: unknown = company.policy && typeof company.policy === 'object' ? company.policy : null;
    let isDefault = false;
    if (!policy) {
      isDefault = true;
      const code = (company.code ?? '').toUpperCase();
      policy = code.startsWith('VILLAGE') || code.startsWith('MARUNGI')
        ? POLICY_PRESETS.VILLAGE_1SHIFT
        : DEFAULT_POLICY;
    }
    return res.json({ success: true, data: { policy, isDefault } });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

/**
 * PUT /api/v1/companies/policy
 * 회사 정책 업데이트. 가벼운 type guard 검증 후 저장.
 * (전체 검증은 v2 솔버 호출 시 validateCompanyPolicy 가 다시 수행)
 */
export const updateCompanyPolicy = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const policy = req.body?.policy;
    if (!policy || typeof policy !== 'object') {
      return res.status(400).json({ success: false, message: '정책 JSON 이 필요합니다.' });
    }
    // 필수 키 체크
    const required = ['workdayBands', 'restCycle', 'shiftSystem', 'crewModel'];
    for (const key of required) {
      if (!(key in policy)) {
        return res.status(400).json({
          success: false,
          message: `필수 항목 누락: ${key}`,
        });
      }
    }
    // 가벼운 타입 가드
    const wb = policy.workdayBands;
    if (typeof wb?.hardMin !== 'number' || typeof wb?.hardMax !== 'number') {
      return res.status(400).json({ success: false, message: 'workdayBands hardMin/hardMax 가 숫자여야 합니다.' });
    }
    if (wb.hardMin > wb.sweetMin || wb.sweetMax > wb.hardMax) {
      return res.status(400).json({ success: false, message: 'workdayBands 범위가 잘못되었습니다 (hardMin ≤ sweetMin ≤ sweetMax ≤ hardMax).' });
    }
    const rc = policy.restCycle;
    if (typeof rc?.workDays !== 'number' || typeof rc?.restDays !== 'number') {
      return res.status(400).json({ success: false, message: 'restCycle workDays/restDays 가 숫자여야 합니다.' });
    }
    const cm = policy.crewModel;
    if (![1, 2, 3].includes(cm?.size)) {
      return res.status(400).json({ success: false, message: 'crewModel.size 는 1~3 만 허용됩니다.' });
    }

    await prisma.company.update({
      where: { id: companyId },
      data: { policy },
    });
    logger.info(`[CompanyPolicy] 정책 업데이트 — companyId=${companyId} preset=${policy.preset ?? 'CUSTOM'}`);
    return res.json({ success: true, data: { policy }, message: '정책이 저장되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
