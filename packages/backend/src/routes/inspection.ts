import { Router } from 'express';
import { getTemplate, getInspections, submitInspection, getInspectionStats } from '../controllers/inspectionController';
import { authenticate, requireRole } from '../middleware/auth';
import { inspectionValidation } from '../middleware/validate';

const router = Router();
router.use(authenticate);

router.get('/template', getTemplate);
router.get('/', getInspections);
router.post('/', ...inspectionValidation.submit, submitInspection);
router.get('/stats', requireRole('SAFETY_MGR', 'DISPATCH'), getInspectionStats);

export default router;
