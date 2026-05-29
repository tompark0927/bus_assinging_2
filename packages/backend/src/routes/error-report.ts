import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { reportError } from '../controllers/errorReportController';

const router = Router();

// 10 reports per minute per IP
const errorReportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many error reports. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', errorReportLimiter, reportError);

export default router;
