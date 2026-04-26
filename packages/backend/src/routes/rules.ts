import { Router } from 'express';
import { getRules, createRule, updateRule, deleteRule } from '../controllers/ruleController';
import { authenticate, requireRole } from '../middleware/auth';
import { ruleValidation } from '../middleware/validate';

const router = Router();

router.use(authenticate);
// 규칙 조회는 전 직원 가능, 생성/수정/삭제는 관리자만

router.get('/', getRules);
router.post('/', requireRole('DISPATCH', 'HR'), ...ruleValidation.create, createRule);
router.put('/:id', requireRole('DISPATCH', 'HR'), ...ruleValidation.update, updateRule);
router.delete('/:id', requireRole('DISPATCH', 'HR'), ...ruleValidation.delete, deleteRule);

export default router;
