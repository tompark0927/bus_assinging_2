import { Router } from 'express';
import {
  getSessions,
  createSession,
  getSession,
  sendMessage,
  deleteSession,
} from '../controllers/chatController';
import { authenticate, requireAdmin } from '../middleware/auth';
import { chatValidation } from '../middleware/validate';

const router = Router();

router.use(authenticate, requireAdmin); // AI 챗은 관리자 전용

router.get('/sessions', getSessions);
router.post('/sessions', ...chatValidation.createSession, createSession);
router.get('/sessions/:id', ...chatValidation.getSession, getSession);
router.post('/sessions/:id/messages', ...chatValidation.sendMessage, sendMessage);
router.delete('/sessions/:id', ...chatValidation.deleteSession, deleteSession);

export default router;
