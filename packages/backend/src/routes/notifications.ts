import { Router } from 'express';
import { getNotifications, markAsRead, markAllAsRead } from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';
import { notificationValidation } from '../middleware/validate';

const router = Router();

router.use(authenticate);

router.get('/', getNotifications);
router.put('/:id/read', ...notificationValidation.markAsRead, markAsRead);
router.put('/read-all', markAllAsRead);

export default router;
