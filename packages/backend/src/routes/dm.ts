import { Router } from 'express';
import { getConversations, getMessages, sendMessage, getUnreadCount, getCompanyUsers } from '../controllers/dmController';
import { authenticate } from '../middleware/auth';
import { dmValidation } from '../middleware/validate';

const router = Router();
router.use(authenticate);

router.get('/conversations', getConversations);
router.get('/unread-count', getUnreadCount);
router.get('/users', getCompanyUsers);
router.get('/:partnerId', ...dmValidation.getMessages, getMessages);
router.post('/', ...dmValidation.send, sendMessage);

export default router;
