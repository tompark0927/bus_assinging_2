import { Router } from 'express';
import {
  getRoutes,
  getRouteById,
  createRoute,
  updateRoute,
  deleteRoute,
  assignDriverToRoute,
  removeDriverFromRoute,
  updateRouteFatigue,
} from '../controllers/routeController';
import { authenticate, requireRole } from '../middleware/auth';
import { routeValidation } from '../middleware/validate';

const router = Router();

router.use(authenticate);

router.get('/', getRoutes);
router.get('/:id', ...routeValidation.getById, getRouteById);
router.post('/', requireRole('DISPATCH'), ...routeValidation.create, createRoute);
router.put('/:id', requireRole('DISPATCH'), ...routeValidation.update, updateRoute);
router.delete('/:id', requireRole('DISPATCH'), ...routeValidation.delete, deleteRoute);
router.post('/:id/assign', requireRole('DISPATCH'), ...routeValidation.assignDriver, assignDriverToRoute);
router.delete('/:id/assign/:driverId', requireRole('DISPATCH'), ...routeValidation.removeDriver, removeDriverFromRoute);
router.put('/:id/fatigue', requireRole('DISPATCH'), updateRouteFatigue);

export default router;
