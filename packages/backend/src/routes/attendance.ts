import { Router } from 'express';
import { getAttendance, upsertAttendance, getWeeklyHoursAnalysis, gpsCheckIn, gpsCheckOut, getMyTodayStatus } from '../controllers/attendanceController';
import { authenticate, requireRole } from '../middleware/auth';
import { attendanceValidation } from '../middleware/validate';

const router = Router();
router.use(authenticate);

router.get('/', getAttendance);
router.post('/', requireRole('HR', 'DISPATCH'), ...attendanceValidation.upsert, upsertAttendance);
router.get('/weekly-hours', getWeeklyHoursAnalysis);
router.get('/today', getMyTodayStatus);
router.post('/check-in', ...attendanceValidation.gpsCheckIn, gpsCheckIn);
router.post('/check-out', ...attendanceValidation.gpsCheckOut, gpsCheckOut);

export default router;
