import { Router } from 'express';
import {
  registerCompany,
  checkCompanyCode,
  getCompanyPolicy,
  updateCompanyPolicy,
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

// Authenticated routes - 회사 정보·정책
router.get('/me', authenticate, getCompanyInfo);
router.put('/me', authenticate, requireRole('DISPATCH'), updateCompanyInfo);
router.get('/policy', authenticate, getCompanyPolicy);
router.put('/policy', authenticate, requireRole('DISPATCH'), updateCompanyPolicy);

export default router;
