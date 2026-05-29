import { Router } from 'express';
import { getBuses, getBusById, createBus, updateBus, deleteBus, updateLocation, liveLocations } from '../controllers/busController';
import { authenticate, requireRole } from '../middleware/auth';
import { busValidation } from '../middleware/validate';

const router = Router();

router.use(authenticate);

router.get('/', getBuses);
router.get('/live-locations', liveLocations); // GPS real-time view
router.get('/:id', ...busValidation.getById, getBusById);
router.post('/', requireRole('DISPATCH'), ...busValidation.create, createBus);
router.put('/:id', requireRole('DISPATCH'), ...busValidation.update, updateBus);
router.delete('/:id', requireRole('DISPATCH'), ...busValidation.delete, deleteBus);
router.post('/:id/location', ...busValidation.updateLocation, updateLocation); // GPS ping from driver app

export default router;
