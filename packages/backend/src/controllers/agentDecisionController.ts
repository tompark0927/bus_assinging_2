/**
 * AgentDecision REST API.
 *
 * 관리자가 어드민웹에서 에이전트 결정을 검토·승인·거부하는 엔드포인트.
 *
 * 라우트:
 *   GET    /api/v1/agents/decisions             — 목록 (필터·페이지)
 *   GET    /api/v1/agents/decisions/:id         — 상세 (도구 호출 + 추론)
 *   POST   /api/v1/agents/decisions/:id/override — 인간 오버라이드 (거부 + 사유)
 *   GET    /api/v1/agents/decisions/stats       — 자율 모드 진입 조건 점검 통계
 *
 * 보안: 모든 엔드포인트는 인증 + ADMIN/DISPATCH 권한 필요. 회사 격리는 자동.
 */

import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { recordOverride } from '../agents/_core/decision-logger';
import { invalidatePromptCache } from '../agents/_core/prompt-evolver';

// ─────────────────────────────────────────────
// GET /agents/decisions
// ─────────────────────────────────────────────

export const listAgentDecisions = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const {
      agentName,
      status,
      isSimulation,
      from,
      to,
      page = '1',
      pageSize = '50',
    } = req.query as Record<string, string | undefined>;

    const where: Prisma.AgentDecisionWhereInput = { companyId };

    if (agentName) where.agentName = agentName;
    if (status) where.status = status;
    if (isSimulation !== undefined) where.isSimulation = isSimulation === 'true';

    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        (where.createdAt as Prisma.DateTimeFilter).lte = end;
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const sizeNum = Math.min(200, Math.max(1, parseInt(pageSize, 10)));

    const [items, total] = await Promise.all([
      prisma.agentDecision.findMany({
        where,
        select: {
          id: true,
          agentName: true,
          sessionId: true,
          triggerType: true,
          triggerRefId: true,
          finalAction: true,
          status: true,
          humanOverride: true,
          tokensIn: true,
          tokensOut: true,
          costKrw: true,
          durationMs: true,
          isSimulation: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * sizeNum,
        take: sizeNum,
      }),
      prisma.agentDecision.count({ where }),
    ]);

    return res.json({
      success: true,
      data: {
        items,
        total,
        page: pageNum,
        pageSize: sizeNum,
        totalPages: Math.ceil(total / sizeNum),
      },
    });
  } catch (error) {
    logger.error('listAgentDecisions error', error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────
// GET /agents/decisions/:id
// ─────────────────────────────────────────────

export const getAgentDecision = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const id = parseInt(req.params.id, 10);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '잘못된 결정 ID' });
    }

    const decision = await prisma.agentDecision.findFirst({
      where: { id, companyId },
      include: {
        overriddenBy: {
          select: { id: true, name: true, employeeId: true },
        },
      },
    });

    if (!decision) {
      return res.status(404).json({ success: false, message: '결정을 찾을 수 없습니다.' });
    }

    return res.json({ success: true, data: decision });
  } catch (error) {
    logger.error('getAgentDecision error', error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────
// POST /agents/decisions/:id/override
// ─────────────────────────────────────────────

export const overrideAgentDecision = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body as { reason?: string };

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: '잘못된 결정 ID' });
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: '거부 사유는 최소 5자 이상이어야 합니다 (PromptEvolver 학습 데이터로 사용됨).',
      });
    }

    // 회사 격리: 결정이 같은 회사인지 확인
    const decision = await prisma.agentDecision.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, humanOverride: true, agentName: true },
    });
    if (!decision) {
      return res.status(404).json({ success: false, message: '결정을 찾을 수 없습니다.' });
    }
    if (decision.humanOverride) {
      return res.status(409).json({ success: false, message: '이미 오버라이드된 결정입니다.' });
    }

    await recordOverride(decision.id, userId, reason.trim());

    // PromptEvolver 캐시 무효화 — 다음 에이전트 실행이 새 거부 사례를 즉시 학습
    invalidatePromptCache(decision.agentName, companyId);

    const updated = await prisma.agentDecision.findUnique({
      where: { id: decision.id },
      include: {
        overriddenBy: {
          select: { id: true, name: true, employeeId: true },
        },
      },
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('overrideAgentDecision error', error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────────
// GET /agents/decisions/stats
// PHASE 4 자율 모드 진입 조건: 14일 연속 거부율 < 5% AND 수정율 < 10%
// ─────────────────────────────────────────────

export const getAgentDecisionStats = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const { agentName, days = '14' } = req.query as Record<string, string | undefined>;

    const windowDays = Math.min(90, Math.max(1, parseInt(days, 10)));
    const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);

    const where: Prisma.AgentDecisionWhereInput = {
      companyId,
      createdAt: { gte: since },
      isSimulation: false, // 실 운영 결정만 카운트 (시뮬레이션 제외)
    };
    if (agentName) where.agentName = agentName;

    const [total, completed, failed, overridden, totalCostAgg, totalTokensAgg] = await Promise.all([
      prisma.agentDecision.count({ where }),
      prisma.agentDecision.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.agentDecision.count({ where: { ...where, status: 'FAILED' } }),
      prisma.agentDecision.count({ where: { ...where, humanOverride: true } }),
      prisma.agentDecision.aggregate({
        where,
        _sum: { costKrw: true },
      }),
      prisma.agentDecision.aggregate({
        where,
        _sum: { tokensIn: true, tokensOut: true },
      }),
    ]);

    const overrideRate = total > 0 ? overridden / total : 0;
    const failureRate = total > 0 ? failed / total : 0;

    // PHASE 4 진입 조건
    const meetsAutonomyCriteria = total >= 20 && overrideRate < 0.05 && failureRate < 0.05;
    const blockers: string[] = [];
    if (total < 20) blockers.push(`샘플 부족 (${total}/20)`);
    if (overrideRate >= 0.05) blockers.push(`거부율 ${(overrideRate * 100).toFixed(1)}% ≥ 5%`);
    if (failureRate >= 0.05) blockers.push(`실패율 ${(failureRate * 100).toFixed(1)}% ≥ 5%`);

    return res.json({
      success: true,
      data: {
        windowDays,
        agentName: agentName ?? 'all',
        total,
        completed,
        failed,
        overridden,
        overrideRate,
        failureRate,
        totalCostKrw: totalCostAgg._sum.costKrw ?? 0,
        totalTokens: (totalTokensAgg._sum.tokensIn ?? 0) + (totalTokensAgg._sum.tokensOut ?? 0),
        meetsAutonomyCriteria,
        blockers,
      },
    });
  } catch (error) {
    logger.error('getAgentDecisionStats error', error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
