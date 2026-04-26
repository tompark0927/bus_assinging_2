import { Router } from 'express';
import {
  listAgentDecisions,
  getAgentDecision,
  overrideAgentDecision,
  getAgentDecisionStats,
} from '../controllers/agentDecisionController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// 모든 에이전트 결정 조회·오버라이드는 ADMIN/DISPATCH 권한 필요
router.get('/decisions', requireRole('ADMIN', 'DISPATCH'), listAgentDecisions);
router.get('/decisions/stats', requireRole('ADMIN', 'DISPATCH'), getAgentDecisionStats);
router.get('/decisions/:id', requireRole('ADMIN', 'DISPATCH'), getAgentDecision);
router.post('/decisions/:id/override', requireRole('ADMIN', 'DISPATCH'), overrideAgentDecision);

export default router;
