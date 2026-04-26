import { Router } from 'express';
import { registerCompany, checkCompanyCode } from '../controllers/companiesController';
import { registerLimiter } from '../middleware/rateLimits';
import { companyValidation } from '../middleware/validate';

const router = Router();

// Public routes - no auth required
router.post('/register', registerLimiter, ...companyValidation.register, registerCompany);
router.get('/check-code/:code', ...companyValidation.checkCode, checkCompanyCode);

export default router;
