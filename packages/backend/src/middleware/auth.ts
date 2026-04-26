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
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: number;
      companyId: number;
      email: string;
      role: string;
      name: string;
    };

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: '유효하지 않은 계정입니다.' });
    }

    req.user = decoded;
    // 테넌트 컨텍스트 세팅 — 이후 모든 Prisma 쿼리에서 companyId 격리 검증 + 자동 감사 로그 userId에 사용
    return runWithCompany(decoded.companyId, () => next(), decoded.id);
  } catch {
    return res.status(401).json({ success: false, message: '유효하지 않은 토큰입니다.' });
  }
};

// ─────────────────────────────────────────
// 역할 기반 접근 제어
// ─────────────────────────────────────────

// 전체 관리자 역할 (모든 메뉴 접근 가능)
const FULL_ACCESS_ROLES = ['OWNER', 'DIRECTOR', 'ADMIN'];

// 역할이 전체 접근 권한인지 확인
function isFullAccess(role: string): boolean {
  return FULL_ACCESS_ROLES.includes(role);
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
