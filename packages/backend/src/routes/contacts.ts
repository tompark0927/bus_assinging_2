import { Router } from 'express';
import { submitContact, getContacts } from '../controllers/contactController';
import { authenticate, requireAdmin } from '../middleware/auth';
import { contactValidation } from '../middleware/validate';

const router = Router();

// 공개: 도입 문의 접수
router.post('/', ...contactValidation.submit, submitContact);

// 관리자 전용: 문의 내역 조회
router.get('/', authenticate, requireAdmin, getContacts); // 문의 조회는 관리자만

export default router;
