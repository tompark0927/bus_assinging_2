import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listMaintenance,
  createMaintenance,
  updateMaintenance,
  deleteMaintenance,
} from '../controllers/maintenanceController';
import { maintenanceValidation } from '../middleware/validate';

const router = Router();

router.use(authenticate);

router.get('/', listMaintenance);                       // all users can view
router.post('/', requireRole('DISPATCH', 'SAFETY_MGR'), ...maintenanceValidation.create, createMaintenance);      // admin only
router.put('/:id', requireRole('DISPATCH', 'SAFETY_MGR'), ...maintenanceValidation.update, updateMaintenance);    // admin only
router.delete('/:id', requireRole('DISPATCH', 'SAFETY_MGR'), ...maintenanceValidation.delete, deleteMaintenance); // admin only

export default router;
