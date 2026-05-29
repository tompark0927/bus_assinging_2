import { Router } from 'express';
import { getAuditLogs } from '../controllers/auditController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Only OWNER and DIRECTOR can access audit logs
router.get('/', requireRole('OWNER', 'DIRECTOR'), getAuditLogs);

export default router;
