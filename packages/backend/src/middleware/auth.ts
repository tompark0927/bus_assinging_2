import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { runWithCompany } from '../utils/tenantContext';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    companyId: number;
    email: string;
    role: string;
    name: string;
  };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as {
      id?: unknown;
      companyId?: unknown;
      email?: unknown;
      role?: unknown;
      name?: unknown;
    };

    // 런타임 타입 검증 — 토큰이 위조됐거나 형식이 다를 경우 400 보다 401 처리.
    // (jwt.verify 가 시그니처 검증은 통과시켰더라도 페이로드 형태가 다를 수 있음)
    if (
      typeof decoded.id !== 'number' ||
      typeof decoded.companyId !== 'number' ||
      typeof decoded.role !== 'string' ||
      typeof decoded.name !== 'string'
    ) {
      return res.status(401).json({ success: false, message: '유효하지 않은 토큰 형식입니다.' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: '유효하지 않은 계정입니다.' });
    }

    // ── 권한/소속 변경 차단 ──
    // 토큰 발급 후 관리자가 사용자의 role/companyId 를 변경했다면, 변경된 사용자의
    // 옛 토큰은 즉시 무효화되어야 한다. (OWNER 가 ADMIN 권한 박탈했는데 옛 JWT 로
    // 1시간 30분 더 admin 작업이 가능하면 안 됨.)
    if (user.companyId !== decoded.companyId || user.role !== decoded.role) {
      return res
        .status(401)
        .json({ success: false, message: '계정 권한이 변경되었습니다. 다시 로그인해주세요.' });
    }

    // DB 가 진실 — JWT 페이로드 대신 DB 값을 신뢰해 controller 에 넘긴다.
    req.user = {
      id: user.id,
      companyId: user.companyId,
      email: user.email ?? '',
      role: user.role,
      name: user.name,
    };
    // 테넌트 컨텍스트 세팅 — 이후 모든 Prisma 쿼리에서 companyId 격리 검증 + 자동 감사 로그 userId에 사용
    return runWithCompany(user.companyId, () => next(), user.id);
  } catch {
    return res.status(401).json({ success: false, message: '유효하지 않은 토큰입니다.' });
  }
};

// ─────────────────────────────────────────
// 역할 기반 접근 제어
// ─────────────────────────────────────────

// 전체 관리자 역할 (모든 메뉴 접근 가능)
export const FULL_ACCESS_ROLES = ['OWNER', 'DIRECTOR', 'ADMIN'] as const;

// 역할이 전체 접근 권한인지 확인. 다른 컨트롤러에서 권한 체크 시 사용 권장
// (개별 controller 가 'ADMIN' 리터럴만 비교하면 OWNER/DIRECTOR 가 권한 잠김 ↔ 보안 회피 모두 발생)
export function isFullAccess(role: string | undefined): boolean {
  return !!role && (FULL_ACCESS_ROLES as readonly string[]).includes(role);
}

// 기존 requireAdmin — 하위호환: OWNER, DIRECTOR, ADMIN 모두 통과
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!isFullAccess(req.user?.role || '')) {
    return res.status(403).json({ success: false, message: '관리자 권한이 필요합니다.' });
  }
  next();
};

// 특정 역할만 허용하는 미들웨어 팩토리
// 예: requireRole('DISPATCH', 'HR') → 배차담당, 인사팀 + 전체접근 역할 허용
export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userRole = req.user?.role || '';
    if (isFullAccess(userRole) || allowedRoles.includes(userRole)) {
      return next();
    }
    return res.status(403).json({ success: false, message: '해당 기능에 대한 접근 권한이 없습니다.' });
  };
};

// 기사가 아닌 모든 사무직 허용 (관리자 + 배차 + 인사 + 경리 + 안전)
export const requireOfficeStaff = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role === 'DRIVER') {
    return res.status(403).json({ success: false, message: '사무직 직원만 접근 가능합니다.' });
  }
  next();
};
