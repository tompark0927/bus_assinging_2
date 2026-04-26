import { Router } from 'express';
import {
  listDailyReports,
  getDailyReport,
  markDailyReportRead,
  regenerateDailyReport,
} from '../controllers/dailyReportController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// 모든 운영진이 일일 보고서 열람 가능
router.get('/', requireRole('ADMIN', 'DISPATCH', 'OWNER', 'DIRECTOR'), listDailyReports);

// 재생성은 OWNER/DIRECTOR/ADMIN 만 (Anthropic API 비용 발생)
// 주의: 라우트 순서 — 동적 :id 보다 먼저 등록해야 매칭됨
router.post('/regenerate', requireRole('OWNER', 'DIRECTOR', 'ADMIN'), regenerateDailyReport);

router.get('/:id', requireRole('ADMIN', 'DISPATCH', 'OWNER', 'DIRECTOR'), getDailyReport);
router.post('/:id/read', requireRole('ADMIN', 'DISPATCH', 'OWNER', 'DIRECTOR'), markDailyReportRead);

export default router;
