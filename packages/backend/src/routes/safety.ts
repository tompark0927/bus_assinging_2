import { Router } from 'express';
import {
  getIncidents, createIncident, updateIncident, resolveIncident, deleteIncident,
  getTrainings, createTraining,
  getLicenseExpiryAlerts, updateDriverLicense,
  getSafetyStats,
} from '../controllers/safetyController';
import { authenticate, requireRole } from '../middleware/auth';
import { safetyValidation } from '../middleware/validate';

const router = Router();
// 노무 관리(사고·지적사항 장부)는 안전관리자뿐 아니라 인사·배차 담당자도 쓴다
router.use(authenticate, requireRole('SAFETY_MGR', 'HR', 'DISPATCH'));

// 사고/위반
router.get('/incidents', getIncidents);
router.post('/incidents', ...safetyValidation.createIncident, createIncident);
// 표의 셀 편집 — 보낸 칸만 부분 수정
router.put('/incidents/:id', ...safetyValidation.updateIncident, updateIncident);
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
