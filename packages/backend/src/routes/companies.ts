import { Router } from 'express';
import {
  registerCompany,
  checkCompanyCode,
  checkPhoneAvailable,
  getCompanyPolicy,
  updateCompanyPolicy,
  getEnginePolicy,
  updateEnginePolicy,
  getCompanyHolidays,
  updateCompanyHolidays,
  getCompanyInfo,
  updateCompanyInfo,
} from '../controllers/companiesController';
import { registerLimiter } from '../middleware/rateLimits';
import { companyValidation } from '../middleware/validate';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// Public routes - no auth required
router.post('/register', registerLimiter, ...companyValidation.register, registerCompany);
router.get('/check-code/:code', ...companyValidation.checkCode, checkCompanyCode);
router.post('/check-phone', checkPhoneAvailable);

// Authenticated routes - 회사 정보·정책
router.get('/me', authenticate, getCompanyInfo);
router.put('/me', authenticate, requireRole('DISPATCH'), updateCompanyInfo);
router.get('/policy', authenticate, getCompanyPolicy);
router.put('/policy', authenticate, requireRole('DISPATCH'), updateCompanyPolicy);
// AI 엔진 튜닝 정책 — 저장소는 DB (엔진은 요청마다 policy_json 을 받는 stateless 계산기)
router.get('/engine-policy', authenticate, getEnginePolicy);
router.put('/engine-policy', authenticate, requireRole('DISPATCH'), updateEnginePolicy);

// 공휴일(감차 적용일) 확인 — 조회는 로그인만, 확정은 배차 담당 이상
router.get('/holidays/:year', authenticate, getCompanyHolidays);
router.put('/holidays/:year', authenticate, requireRole('DISPATCH'), updateCompanyHolidays);

export default router;
