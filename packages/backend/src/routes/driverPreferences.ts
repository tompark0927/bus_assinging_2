import { Router } from 'express';
import { getMyPreferences, getAllPreferences, setPreferences } from '../controllers/driverPreferenceController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', getMyPreferences);
router.get('/all', requireRole('DISPATCH'), getAllPreferences);
router.put('/', setPreferences);

export default router;
