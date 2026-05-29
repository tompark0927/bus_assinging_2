/**
 * EmergencyAgent 실행 어댑터.
 *
 * 역할:
 *  - cron / 컨트롤러에서 호출하는 단일 진입점
 *  - 드랍 1건을 받아 EmergencyAgent 를 실행하고 결과를 반환
 *  - 환경변수 EMERGENCY_AGENT_ENABLED='true' 일 때만 활성 (점진적 롤아웃)
 *  - 비활성 시 호출 측이 기존 escalationService 로 폴백
 *  - 에이전트 실패 시에도 polling 시간 안에 폴백 가능
 *
 * 트리거 메시지에 긴급도 컨텍스트를 미리 계산해서 포함 — 에이전트는 첫 도구 호출 전에도
 * 대략적인 전략을 미리 알 수 있다.
 */

import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import { EmergencyAgent } from '../agents/emergency.agent';
import { classifyUrgency } from '../agents/_tools/emergency-tools';
import { handleImmediateEscalation } from './escalationService';
import type { AgentRunResult } from '../agents/_core/types';

let cachedAgent: EmergencyAgent | null = null;

function getAgent(): EmergencyAgent {
  if (!cachedAgent) cachedAgent = new EmergencyAgent();
  return cachedAgent;
}

/** 에이전트 활성 여부 — 환경변수로 제어 (점진적 롤아웃) */
export function isEmergencyAgentEnabled(): boolean {
  return process.env.EMERGENCY_AGENT_ENABLED === 'true';
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEPARTURE_HOURS_KST: Record<string, number> = { MORNING: 6, AFTERNOON: 14, FULL_DAY: 6 };

function getDepartureUtc(slotDate: Date, shift: string): Date {
  const hour = DEPARTURE_HOURS_KST[shift] ?? 6;
  const dateStr = slotDate.toISOString().split('T')[0];
  const dep = new Date(`${dateStr}T00:00:00Z`);
  dep.setUTCHours(hour - 9, 0, 0, 0);
  return dep;
}

export interface RunAgentForDropOptions {
  /** 시뮬레이션 모드로 실행 (외부 효과 없음) */
  isSimulation?: boolean;
  /** 시뮬레이션 시 가상 현재 시각 */
  virtualNow?: Date;
  /** 명시적 트리거 타입 (기본: cron) */
  triggerType?: 'cron' | 'event' | 'manual' | 'simulation';
}

/**
 * 단일 EmergencyDrop 에 대해 EmergencyAgent 를 실행한다.
 *
 * - 드랍이 OPEN 상태가 아니면 즉시 noop 반환 (이미 다른 프로세스가 처리)
 * - 출발 시각이 이미 지난 드랍은 PASSED 로 분류되고 에이전트는 관리자 알림만 보냄
 * - 모든 결과(성공·실패·시뮬레이션) 는 AgentDecision 테이블에 기록됨
 */
export async function runAgentForDrop(
  dropId: number,
  options: RunAgentForDropOptions = {}
): Promise<AgentRunResult | { skipped: true; reason: string }> {
  const isSimulation = options.isSimulation ?? false;
  const virtualNow = options.virtualNow ?? new Date();
  const triggerType = options.triggerType ?? 'cron';

  // 드랍 + 회사 ID 조회 — 시뮬레이션에서도 드랍 자체는 실 DB에서 읽음
  const drop = await prisma.emergencyDrop.findUnique({
    where: { id: dropId },
    include: {
      slot: {
        include: {
          schedule: { select: { companyId: true } },
          route: { select: { id: true, routeNumber: true } },
        },
      },
    },
  });

  if (!drop) {
    return { skipped: true, reason: `EmergencyDrop ${dropId} 없음` };
  }
  if (!isSimulation && drop.status !== 'OPEN') {
    return { skipped: true, reason: `드랍 상태가 OPEN 아님 (${drop.status})` };
  }

  const companyId = drop.slot.schedule.companyId;
  const departure = getDepartureUtc(drop.slot.date, drop.slot.shift);
  const minutesToDeparture = Math.floor((departure.getTime() - virtualNow.getTime()) / 60000);
  const urgency = classifyUrgency(minutesToDeparture);

  // 트리거 메시지: 에이전트가 첫 호출 전에도 긴급도를 알 수 있게 명시
  const dateKstHHmm = new Date(departure.getTime() + KST_OFFSET_MS).toISOString().slice(11, 16);
  const task = [
    `긴급 결원이 발생했습니다.`,
    `EmergencyDrop ID: ${drop.id}`,
    `노선: ${drop.slot.route.routeNumber}번`,
    `날짜·shift: ${drop.slot.date.toISOString().slice(0, 10)} ${drop.slot.shift}`,
    `예상 출발: KST ${dateKstHHmm} (지금부터 ${minutesToDeparture}분)`,
    `긴급도 등급: ${urgency}`,
    ``,
    `즉시 get_drop_context(${drop.id}) 부터 호출하여 최신 컨텍스트를 확인하고,`,
    `시스템 프롬프트의 ${urgency} 전략을 따라 대타를 구하거나 관리자에게 인계하세요.`,
  ].join('\n');

  try {
    const result = await getAgent().run({
      companyId,
      triggerType,
      triggerRefId: drop.id,
      task,
      isSimulation,
      virtualNow,
      sessionId: `emergency-drop-${drop.id}-${Date.now()}`,
    });

    logger.info(
      `[EmergencyAgent] drop=${drop.id} urgency=${urgency} status=${result.status} ` +
        `tools=${result.toolCalls.length} tokens=${result.tokensIn + result.tokensOut} cost=₩${result.costKrw.toFixed(2)}`
    );
    return result;
  } catch (err) {
    logger.error(`[EmergencyAgent] drop=${drop.id} 실행 중 예외`, err);
    throw err;
  }
}

/**
 * 모든 OPEN 드랍을 순회하며 에이전트로 처리.
 *
 * - cron 진입점으로 사용
 * - feature flag OFF 시 빈 결과 반환 (호출 측이 폴백 처리)
 * - 한 드랍의 실패가 다른 드랍을 막지 않도록 try/catch 격리
 */
export async function runEmergencyAgentBatch(): Promise<{
  enabled: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}> {
  if (!isEmergencyAgentEnabled()) {
    return { enabled: false, processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const openDrops = await prisma.emergencyDrop.findMany({
    where: { status: 'OPEN' },
    select: { id: true },
  });

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const { id } of openDrops) {
    try {
      const result = await runAgentForDrop(id);
      if ('skipped' in result) skipped++;
      else if (result.status === 'COMPLETED') succeeded++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return {
    enabled: true,
    processed: openDrops.length,
    succeeded,
    failed,
    skipped,
  };
}

/**
 * 즉시 트리거 — 드랍 발생 직후 컨트롤러에서 호출.
 *
 * **의도적으로 fire-and-forget** 입니다. 에이전트의 도구 루프가 수 초 ~ 수 분 걸릴 수 있으므로
 * 컨트롤러 응답을 막으면 안 됩니다. 호출 측은 await 하지 마세요.
 *
 * - 에이전트 활성: runAgentForDrop(triggerType='event')
 * - 비활성: 기존 handleImmediateEscalation 폴백
 *
 * 에이전트가 fire-and-forget 으로 실패하더라도:
 *   1) AgentDecision 테이블에 status=FAILED 로 기록됨 (관찰 가능)
 *   2) 10분 후 cron 이 같은 드랍을 다시 시도 (재시도 보장)
 *   3) 재시도 또한 실패하면 cron 로그에 누적 → 운영자가 발견
 */
export function dispatchImmediateEmergency(args: {
  dropId: number;
  slotDate: Date;
  shift: string;
  companyId: number;
  routeId: number;
}): void {
  if (isEmergencyAgentEnabled()) {
    runAgentForDrop(args.dropId, { triggerType: 'event' })
      .then((result) => {
        if ('skipped' in result) {
          logger.info(`[EmergencyAgent immediate] drop=${args.dropId} skipped: ${result.reason}`);
        }
      })
      .catch((err) => {
        logger.error(`[EmergencyAgent immediate] drop=${args.dropId} 실패`, err);
      });
  } else {
    // 폴백: 기존 결정론적 로직 (await 하지 않음 — 동일한 fire-and-forget 시맨틱)
    handleImmediateEscalation(args.dropId, args.slotDate, args.shift, args.companyId, args.routeId).catch(
      (err) => logger.error(`[handleImmediateEscalation] drop=${args.dropId} 실패`, err)
    );
  }
}
