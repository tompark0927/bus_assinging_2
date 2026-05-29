import { Router } from 'express';
import {
  getIncidents, createIncident, resolveIncident, deleteIncident,
  getTrainings, createTraining,
  getLicenseExpiryAlerts, updateDriverLicense,
  getSafetyStats,
} from '../controllers/safetyController';
import { authenticate, requireRole } from '../middleware/auth';
import { safetyValidation } from '../middleware/validate';

const router = Router();
router.use(authenticate, requireRole('SAFETY_MGR'));

// 사고/위반
router.get('/incidents', getIncidents);
router.post('/incidents', ...safetyValidation.createIncident, createIncident);
router.put('/incidents/:id/resolve', ...safetyValidation.resolveIncident, resolveIncident);
router.delete('/incidents/:id', ...safetyValidation.deleteIncident, deleteIncident);

// 교육
router.get('/trainings', getTrainings);
router.post('/trainings', ...safetyValidation.createTraining, createTraining);

// 면허 관리
router.get('/license-alerts', getLicenseExpiryAlerts);
router.put('/license/:driverId', ...safetyValidation.updateDriverLicense, updateDriverLicense);

// 통계
router.get('/stats', getSafetyStats);

export default router;
