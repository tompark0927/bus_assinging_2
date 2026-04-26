import { Router } from 'express';
import {
  getApprovals,
  getApproval,
  createApproval,
  processApproval,
  cancelApproval,
  getApprovalStats,
} from '../controllers/approvalController';
import { authenticate } from '../middleware/auth';
import { approvalValidation } from '../middleware/validate';

const router = Router();

router.use(authenticate);

router.get('/stats', getApprovalStats);
router.get('/', getApprovals);
router.get('/:id', ...approvalValidation.getById, getApproval);
router.post('/', ...approvalValidation.create, createApproval);
router.put('/:id/process', ...approvalValidation.process, processApproval);
router.delete('/:id', ...approvalValidation.cancel, cancelApproval);

export default router;
