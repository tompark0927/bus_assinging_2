/**
 * DecisionLogger — 모든 에이전트 결정을 AgentDecision 테이블에 영구 기록.
 *
 * 한 번의 에이전트 실행(BaseAgent.run) 이 끝나면 한 행이 생성된다.
 * 시뮬레이션 결과도 같은 테이블에 isSimulation=true 로 기록 — 백테스트 분석용.
 */

import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';
import type { AgentRunResult, AgentTriggerType, ToolCallRecord } from './types';

export interface CreateDecisionInput {
  companyId: number;
  agentName: string;
  sessionId: string;
  triggerType: AgentTriggerType;
  triggerRefId?: number;
  isSimulation: boolean;
  toolCalls: ToolCallRecord[];
  finalAction: string;
  reasoning: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  errorMessage?: string;
  tokensIn: number;
  tokensOut: number;
  costKrw: number;
  durationMs: number;
}

/**
 * 에이전트 결정 1건 기록.
 * 실패해도 throw 하지 않음 — 로깅 실패가 메인 플로우를 막지 않게.
 */
export async function logDecision(input: CreateDecisionInput): Promise<number | null> {
  try {
    const row = await prisma.agentDecision.create({
      data: {
        companyId: input.companyId,
        agentName: input.agentName,
        sessionId: input.sessionId,
        triggerType: input.triggerType,
        triggerRefId: input.triggerRefId ?? null,
        toolCalls: input.toolCalls as unknown as object,
        finalAction: input.finalAction,
        reasoning: input.reasoning,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        costKrw: input.costKrw,
        durationMs: input.durationMs,
        isSimulation: input.isSimulation,
      },
    });
    return row.id;
  } catch (err) {
    logger.error('[DecisionLogger] AgentDecision 기록 실패', err);
    return null;
  }
}

/**
 * 인간 오버라이드 기록 — 관리자가 에이전트 결정을 거부했을 때 호출.
 * 거부 사유는 다음 결정의 학습 컨텍스트로 들어가야 하므로 영구 저장 필수.
 */
export async function recordOverride(
  decisionId: number,
  overriddenById: number,
  reason: string
): Promise<void> {
  try {
    await prisma.agentDecision.update({
      where: { id: decisionId },
      data: {
        humanOverride: true,
        overriddenById,
        overrideReason: reason,
        status: 'OVERRIDDEN',
      },
    });
  } catch (err) {
    logger.error('[DecisionLogger] 오버라이드 기록 실패', err);
  }
}

export function buildResultFromDecision(
  decisionId: number | null,
  input: Omit<CreateDecisionInput, 'companyId' | 'agentName' | 'triggerType' | 'triggerRefId' | 'isSimulation'>
): AgentRunResult {
  return {
    decisionId: decisionId ?? -1,
    sessionId: input.sessionId,
    finalAction: input.finalAction,
    reasoning: input.reasoning,
    status: input.status,
    toolCalls: input.toolCalls,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    costKrw: input.costKrw,
    durationMs: input.durationMs,
    errorMessage: input.errorMessage,
  };
}
