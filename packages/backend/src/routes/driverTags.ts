import { Router } from 'express';
import { getDriverTags, createDriverTag, deleteDriverTag } from '../controllers/driverTagController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', requireRole('DISPATCH'), getDriverTags);
router.post('/', requireRole('DISPATCH'), createDriverTag);
router.delete('/:id', requireRole('DISPATCH'), deleteDriverTag);

export default router;
