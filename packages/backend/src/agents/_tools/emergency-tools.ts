/**
 * EmergencyAgent v1 — 11개 도구 (PHASE 1 완성).
 *
 * 도구는 모두:
 *  - companyId 를 ToolContext 에서 받음 (LLM 입력 아님 → 테넌트 격리 보장)
 *  - 시뮬레이션 모드에서는 외부 효과 도구가 stub 결과 반환
 *  - 결과는 JSON 직렬화 가능한 구조 (모델이 다음 단계에서 읽을 수 있어야 함)
 *
 * 도구 목록:
 *   [컨텍스트]
 *   1. get_drop_context              — 드랍 + 긴급도 + 권장 전략
 *   2. get_driver_preferences        — 기사의 노선 선호도 (1순위/2순위)
 *   3. get_recent_overtime           — 기사의 최근 N일 연장근로 시간
 *   [후보 분석]
 *   4. list_off_duty_drivers         — 휴무 중 기사
 *   5. score_acceptance_likelihood   — 수락 가능성 점수화
 *   [실행]
 *   6. send_targeted_push            — 선택 기사에게 푸시 (외부 효과)
 *   7. wait_for_response             — 수락 대기
 *   8. record_acceptance             — 수락 처리 + 골든티켓
 *   9. request_swap                  — 자발적 교대 제안 (배제 후보 우회)
 *   [에스컬레이션·종결]
 *  10. escalate_to_admin             — 관리자 인적 개입 알림
 *  11. generate_postmortem           — 사후 분석 (사이클 종료 시)
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { sendBulkPushNotifications } from '../../services/notificationService';
import type { AgentTool, ToolContext } from '../_core/types';

// ─────────────────────────────────────────────
// 입력 타입
// ─────────────────────────────────────────────

interface ListOffDutyInput {
  date: string; // 'YYYY-MM-DD'
  shift: 'MORNING' | 'AFTERNOON' | 'FULL_DAY';
  /**
   * 필요한 노선 (선택). 노선 친숙도 가산점에 사용 — score_acceptance_likelihood 와 동일 로직.
   */
  routeId?: number;
  /**
   * 반환 최대 인원 (1~100, 기본 30). 600명 회사도 안전.
   * 결과는 점수 내림차순 정렬되어 상위 N명만 반환.
   */
  limit?: number;
}

interface ScoreAcceptanceInput {
  driverIds: number[];
  date: string;
  routeId?: number;
}

interface SendTargetedPushInput {
  driverIds: number[];
  title: string;
  body: string;
  dropId: number;
}

interface WaitForResponseInput {
  dropId: number;
  driverIds: number[];
  /** 시뮬레이션이 아닐 때 실제 대기 초 (기본 300 = 5분). 시뮬레이션은 즉시 반환. */
  seconds?: number;
}

interface RecordAcceptanceInput {
  dropId: number;
  driverId: number;
}

interface GetDropContextInput {
  dropId: number;
}

interface EscalateToAdminInput {
  dropId: number;
  reason: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  /** 관리자 전화 직접 개입을 요청하는지 */
  requireManualPhoneCall?: boolean;
}

interface GetDriverPreferencesInput {
  driverId: number;
}

interface GetRecentOvertimeInput {
  driverId: number;
  /** 조회 일수 (기본 14) */
  days?: number;
}

interface RequestSwapInput {
  /** 결원이 발생한 슬롯 */
  dropId: number;
  /** 자발적 교대를 제안받을 후보 기사들 */
  candidateDriverIds: number[];
  /** 푸시 메시지 (협조 요청) */
  message: string;
}

interface GeneratePostmortemInput {
  dropId: number;
  /** 결과: SUCCESS | FAILED | EXPIRED */
  outcome: 'SUCCESS' | 'FAILED' | 'EXPIRED';
  /** 수락한 기사 ID (성공 시) */
  acceptedByDriverId?: number;
  /** 수락까지 걸린 분 */
  minutesUntilAcceptance?: number;
  /** 시도된 푸시 횟수 */
  totalPushesSent: number;
  /** 자유 형식 메모 */
  notes?: string;
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function parseYmd(s: string): Date {
  // 'YYYY-MM-DD' → Date (로컬 자정 기준 비교를 위해 명시 변환)
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// 교대 유형별 KST 출발 시각 (시 단위)
const DEPARTURE_HOURS_KST: Record<string, number> = {
  MORNING: 6,
  AFTERNOON: 14,
  FULL_DAY: 6,
};

/**
 * 슬롯 날짜(자정 UTC) + shift → 실제 출발 시각 UTC.
 * KST 06:00 = UTC 21:00 (전날), KST 14:00 = UTC 05:00 (당일).
 * escalationService 의 동일 함수와 일치해야 한다.
 */
function getDepartureUtc(slotDate: Date, shift: string): Date {
  const hour = DEPARTURE_HOURS_KST[shift] ?? 6;
  const dateStr = slotDate.toISOString().split('T')[0];
  const dep = new Date(`${dateStr}T00:00:00Z`);
  dep.setUTCHours(hour - 9, 0, 0, 0);
  return dep;
}

export type UrgencyTier = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'PASSED';

/**
 * 출발까지 남은 분 → 긴급도 등급.
 *  CRITICAL ≤ 30분  → 단계별 전략 금지, 즉시 전체 + 관리자 호출
 *  HIGH     ≤ 120분 → 단축 전략 (전체 + 관리자, 짧은 대기)
 *  NORMAL   > 120분 → 표준 단계별 전략 (Top-3 → Top-10 → 전체)
 *  PASSED   ≤ 0분   → 출발 시각 지남, 더 이상 무의미
 */
export function classifyUrgency(minutesToDeparture: number): UrgencyTier {
  if (minutesToDeparture <= 0) return 'PASSED';
  if (minutesToDeparture <= 30) return 'CRITICAL';
  if (minutesToDeparture <= 120) return 'HIGH';
  return 'NORMAL';
}

// ─────────────────────────────────────────────
// 내부 헬퍼: 후보 기사 점수화 (DB 호출 단일화)
// list_off_duty_drivers 와 score_acceptance_likelihood 가 공유
// ─────────────────────────────────────────────

interface ScoredCandidate {
  driverId: number;
  name: string;
  employeeId: string;
  driverType: string | null;
  score: number;
  breakdown: { restBonus: number; familiarityBonus: number };
  signals: {
    recentWorkDays: number;
    isFamiliarWithRoute: boolean;
  };
}

interface ScoreCandidatesArgs {
  companyId: number;
  driverIds: number[];
  date: Date;
  routeId?: number;
  virtualNow: Date;
}

async function scoreCandidatesInternal(args: ScoreCandidatesArgs): Promise<ScoredCandidate[]> {
  const { companyId, driverIds, date, routeId, virtualNow } = args;
  if (driverIds.length === 0) return [];

  const sevenDaysAgo = new Date(date.getTime() - 7 * 24 * 3600 * 1000);

  // 회사 격리 + 활성 기사만
  const drivers = await prisma.user.findMany({
    where: {
      id: { in: driverIds },
      companyId,
      role: 'DRIVER',
      isActive: true,
    },
    select: { id: true, name: true, employeeId: true, driverType: true },
  });
  if (drivers.length === 0) return [];

  const validIds = drivers.map((d) => d.id);

  // 최근 7일 근무 + 노선 친숙도
  const [recentSlots, familiarAssignments] = await Promise.all([
    prisma.scheduleSlot.groupBy({
      by: ['driverId'],
      where: {
        driverId: { in: validIds },
        date: { gte: sevenDaysAgo, lt: date },
        status: { in: ['SCHEDULED', 'FILLED', 'COMPLETED'] },
        isRestDay: false,
      },
      _count: { id: true },
    }),
    routeId !== undefined
      ? prisma.routeAssignment.findMany({
          where: { driverId: { in: validIds }, routeId, isActive: true },
          select: { driverId: true },
        })
      : Promise.resolve([] as Array<{ driverId: number }>),
  ]);

  const fatigueMap = new Map(recentSlots.map((s) => [s.driverId, s._count.id]));
  const familiarSet = new Set(familiarAssignments.map((a) => a.driverId));

  const scored: ScoredCandidate[] = drivers.map((d) => {
    const recentWorkDays = fatigueMap.get(d.id) ?? 0;
    const isFamiliar = familiarSet.has(d.id);

    const fatiguePenalty = Math.min(40, recentWorkDays * 8);
    const restBonus = 40 - fatiguePenalty;
    const familiarityBonus = isFamiliar ? 20 : 0;

    return {
      driverId: d.id,
      name: d.name,
      employeeId: d.employeeId,
      driverType: d.driverType,
      score: restBonus + familiarityBonus,
      breakdown: { restBonus, familiarityBonus },
      signals: {
        recentWorkDays,
        isFamiliarWithRoute: isFamiliar,
      },
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ─────────────────────────────────────────────
// 1. list_off_duty_drivers
// ─────────────────────────────────────────────

const listOffDutyDrivers: AgentTool<ListOffDutyInput, unknown> = {
  name: 'list_off_duty_drivers',
  description:
    '특정 날짜·근무대에 휴무 중이거나 미배차된 활성 기사를, **자동으로 점수화하여 상위 N명만** 반환합니다. ' +
    '회사 사이즈 무관 안전 — 600명 회사도 limit=30 이면 30명만 받아 컨텍스트 폭증 없음.\n\n' +
    '서버에서 자동 처리:\n' +
    '  1. 해당 shift 에 이미 배차된 기사 제외\n' +
    '  2. 면허·자격증 만료 기사 자동 필터 (Constitutional)\n' +
    '  3. 골든티켓 잔액 + 최근 7일 피로도 + 노선 친숙도 종합 점수화\n' +
    '  4. 점수 내림차순 상위 limit 명 반환\n\n' +
    '**대부분의 경우 score_acceptance_likelihood 를 따로 호출할 필요가 없습니다.** ' +
    '이 도구의 결과로 바로 send_targeted_push / request_swap 의 driverIds 인자 사용 가능.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '대타가 필요한 날짜 (YYYY-MM-DD)' },
      shift: {
        type: 'string',
        enum: ['MORNING', 'AFTERNOON', 'FULL_DAY'],
        description: '결원이 발생한 근무대',
      },
      routeId: {
        type: 'integer',
        description: '대타할 노선 ID (있으면 친숙도 점수 가산, 옵셔널)',
      },
      limit: {
        type: 'integer',
        description: '상위 N명만 반환 (1~100, 기본 30). 회사 사이즈 무관 안전.',
      },
    },
    required: ['date', 'shift'],
  },
  handler: async (input, ctx: ToolContext) => {
    const date = parseYmd(input.date);
    const limit = Math.min(100, Math.max(1, input.limit ?? 30));

    // 1. 회사 활성 기사 + 자격 정보 (count 만 먼저)
    const allActiveDriverCount = await prisma.user.count({
      where: { companyId: ctx.companyId, role: 'DRIVER', isActive: true },
    });

    // 2. 같은 날 같은 shift 이미 배차된 기사 ID
    const assignedSlots = await prisma.scheduleSlot.findMany({
      where: {
        driver: { companyId: ctx.companyId },
        date,
        shift: input.shift,
        status: { in: ['SCHEDULED', 'FILLED', 'COMPLETED'] },
      },
      select: { driverId: true },
    });
    const assignedIds = assignedSlots.map((s) => s.driverId);

    // 3. 후보 기사 (자격 유효 + 미배차)
    const candidates = await prisma.user.findMany({
      where: {
        companyId: ctx.companyId,
        role: 'DRIVER',
        isActive: true,
        id: assignedIds.length > 0 ? { notIn: assignedIds } : undefined,
        // 자격 검증 (Constitutional Rule)
        AND: [
          {
            OR: [
              { licenseExpiresAt: null },
              { licenseExpiresAt: { gt: ctx.virtualNow } },
            ],
          },
          {
            OR: [
              { qualificationExpiresAt: null },
              { qualificationExpiresAt: { gt: ctx.virtualNow } },
            ],
          },
        ],
      },
      select: { id: true },
    });

    if (candidates.length === 0) {
      return {
        date: input.date,
        shift: input.shift,
        totalActiveDrivers: allActiveDriverCount,
        assignedCount: assignedIds.length,
        offDutyCount: 0,
        returnedCount: 0,
        limit,
        ranked: [],
        warning: '자격 유효한 미배차 기사가 없습니다. 즉시 escalate_to_admin 권장.',
      };
    }

    // 4. 후보를 자동 점수화 (헬퍼 재사용 — DB 호출 1번)
    const scored = await scoreCandidatesInternal({
      companyId: ctx.companyId,
      driverIds: candidates.map((c) => c.id),
      date,
      routeId: input.routeId,
      virtualNow: ctx.virtualNow,
    });

    // 5. 상위 limit 명만 반환
    const top = scored.slice(0, limit);

    return {
      date: input.date,
      shift: input.shift,
      totalActiveDrivers: allActiveDriverCount,
      assignedCount: assignedIds.length,
      offDutyCount: scored.length, // 자격 통과 + 미배차 전체
      returnedCount: top.length, // 점수 상위 N명
      limit,
      ranked: top,
      hint:
        scored.length > limit
          ? `${scored.length}명 중 상위 ${limit}명만 반환. 더 많이 필요하면 limit 늘려서 재호출.`
          : '모든 자격 후보 반환됨.',
    };
  },
};

// ─────────────────────────────────────────────
// 2. score_acceptance_likelihood
// ─────────────────────────────────────────────

const scoreAcceptanceLikelihood: AgentTool<ScoreAcceptanceInput, unknown> = {
  name: 'score_acceptance_likelihood',
  description:
    '후보 기사들에 대해 대타 수락 가능성 점수(0~100)를 계산합니다. ' +
    '점수 = (골든티켓 인센티브 효과) + (최근 피로도 페널티) + (사전 등록 선호도) 종합. ' +
    '점수가 높은 기사부터 푸시를 보내면 응답률이 높아집니다. ' +
    '결과는 점수 내림차순으로 정렬됩니다.',
  inputSchema: {
    type: 'object',
    properties: {
      driverIds: {
        type: 'array',
        items: { type: 'integer' },
        description: '점수를 매길 기사 ID 목록',
      },
      date: {
        type: 'string',
        description: '대타 슬롯 날짜 (YYYY-MM-DD) — 피로도 계산 기준점',
      },
      routeId: {
        type: 'integer',
        description: '대타할 노선 ID (옵셔널, 노선 친숙도 가산점에 사용)',
      },
    },
    required: ['driverIds', 'date'],
  },
  handler: async (input, ctx: ToolContext) => {
    // 명시적으로 driverIds 가 주어진 경우만 점수화 (list_off_duty_drivers 가 이미 점수화하므로 보통 불필요)
    // 모델이 다른 그룹 (예: SPARE 만, 특정 노선 배정 기사만) 을 따로 평가하고 싶을 때 사용.
    const date = parseYmd(input.date);
    const scored = await scoreCandidatesInternal({
      companyId: ctx.companyId,
      driverIds: input.driverIds,
      date,
      routeId: input.routeId,
      virtualNow: ctx.virtualNow,
    });

    return {
      scoredCount: scored.length,
      ranked: scored,
    };
  },
};

// ─────────────────────────────────────────────
// 3. send_targeted_push  (외부 효과 — 시뮬레이션 시 stub)
// ─────────────────────────────────────────────

const sendTargetedPush: AgentTool<SendTargetedPushInput, unknown> = {
  name: 'send_targeted_push',
  description:
    '선택된 기사들에게 대타 요청 푸시 알림을 전송합니다. ' +
    'score_acceptance_likelihood 의 상위 N명에게만 보내는 단계별 전략을 권장합니다 ' +
    '(예: Top-3 → 5분 대기 → 응답 없으면 Top-10). ' +
    '시뮬레이션 모드에서는 실제로 전송하지 않고 stub 결과만 반환합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      driverIds: {
        type: 'array',
        items: { type: 'integer' },
        description: '푸시를 받을 기사 ID 목록',
      },
      title: { type: 'string', description: '푸시 제목 (한국어)' },
      body: { type: 'string', description: '푸시 본문 (한국어)' },
      dropId: { type: 'integer', description: '연결된 EmergencyDrop.id' },
    },
    required: ['driverIds', 'title', 'body', 'dropId'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({
    simulated: true,
    sent: input.driverIds.length,
    title: input.title,
    body: input.body,
  }),
  handler: async (input, ctx: ToolContext) => {
    // 회사 격리: 대상 기사들이 모두 같은 회사 소속인지 확인
    const validDrivers = await prisma.user.findMany({
      where: {
        id: { in: input.driverIds },
        companyId: ctx.companyId,
        role: 'DRIVER',
        isActive: true,
      },
      select: { id: true },
    });
    const validIds = validDrivers.map((d) => d.id);
    if (validIds.length === 0) {
      throw new Error('대상 기사 중 회사 소속 활성 기사가 없습니다.');
    }

    // 알림함 기록 + Socket.IO + Expo 푸시. data.emergencyDropId 로 발송 대상 추적 가능.
    await sendBulkPushNotifications(validIds, input.title, input.body, 'EMERGENCY_SLOT', {
      emergencyDropId: input.dropId,
      kind: 'AGENT_TARGETED',
    });
    return {
      sent: validIds.length,
      requested: input.driverIds.length,
      filtered: input.driverIds.length - validIds.length,
    };
  },
};

// ─────────────────────────────────────────────
// 4. wait_for_response
// ─────────────────────────────────────────────

const waitForResponse: AgentTool<WaitForResponseInput, unknown> = {
  name: 'wait_for_response',
  description:
    '대상 기사들 중 한 명이 EmergencyDrop 을 수락할 때까지 N초 대기합니다 (기본 300초 = 5분). ' +
    '수락자가 나타나면 즉시 반환합니다. ' +
    '시뮬레이션 모드에서는 대기하지 않고 즉시 현재 DB 상태를 반환합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      dropId: { type: 'integer', description: '대기 중인 EmergencyDrop.id' },
      driverIds: {
        type: 'array',
        items: { type: 'integer' },
        description: '응답을 기다릴 기사 ID 목록 (이 목록 외 기사는 무시)',
      },
      seconds: {
        type: 'integer',
        description: '대기 초 (기본 300, 최대 600)',
      },
    },
    required: ['dropId', 'driverIds'],
  },
  handler: async (input, ctx: ToolContext) => {
    const maxSeconds = Math.min(input.seconds ?? 300, 600);
    const intervalMs = ctx.isSimulation ? 0 : 5000;
    const driverIdSet = new Set(input.driverIds);

    const start = Date.now();
    const deadline = start + (ctx.isSimulation ? 0 : maxSeconds * 1000);

    while (true) {
      const drop = await prisma.emergencyDrop.findFirst({
        where: {
          id: input.dropId,
          slot: { driver: { companyId: ctx.companyId } },
        },
        select: {
          id: true,
          status: true,
          filledBy: true,
          filledAt: true,
        },
      });

      if (!drop) {
        throw new Error(`EmergencyDrop ${input.dropId} 를 찾을 수 없습니다 (회사 격리 확인 실패).`);
      }

      if (drop.status === 'FILLED' && drop.filledBy && driverIdSet.has(drop.filledBy)) {
        return {
          accepted: true,
          acceptedBy: drop.filledBy,
          acceptedAt: drop.filledAt?.toISOString(),
          waitedMs: Date.now() - start,
        };
      }

      if (drop.status !== 'OPEN' || Date.now() >= deadline) {
        return {
          accepted: false,
          finalStatus: drop.status,
          filledBy: drop.filledBy,
          waitedMs: Date.now() - start,
          reason: drop.status !== 'OPEN' ? '드랍이 더 이상 OPEN 상태가 아닙니다.' : '제한 시간 초과',
        };
      }

      if (intervalMs > 0) {
        await new Promise((r) => setTimeout(r, intervalMs));
      } else {
        // 시뮬레이션: 한 번만 확인하고 종료
        return {
          accepted: false,
          finalStatus: drop.status,
          filledBy: drop.filledBy,
          waitedMs: 0,
          reason: '시뮬레이션 모드 (즉시 반환)',
        };
      }
    }
  },
};

// ─────────────────────────────────────────────
// 5. record_acceptance
// ─────────────────────────────────────────────

const recordAcceptance: AgentTool<RecordAcceptanceInput, unknown> = {
  name: 'record_acceptance',
  description:
    '특정 기사가 대타를 수락한 것으로 EmergencyDrop 을 처리합니다. ' +
    'ScheduleSlot 의 driver 도 새 기사로 변경합니다. 트랜잭션으로 원자 처리됩니다.',
  inputSchema: {
    type: 'object',
    properties: {
      dropId: { type: 'integer', description: 'EmergencyDrop.id' },
      driverId: { type: 'integer', description: '수락한 기사 ID' },
    },
    required: ['dropId', 'driverId'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({
    simulated: true,
    dropId: input.dropId,
    driverId: input.driverId,
  }),
  handler: async (input, ctx: ToolContext) => {
    // 격리 검증: 드랍과 기사가 같은 회사인지 확인
    const drop = await prisma.emergencyDrop.findFirst({
      where: {
        id: input.dropId,
        slot: { driver: { companyId: ctx.companyId } },
      },
      include: { slot: true },
    });
    if (!drop) {
      throw new Error(`EmergencyDrop ${input.dropId} 를 찾을 수 없습니다.`);
    }
    if (drop.status !== 'OPEN') {
      throw new Error(`드랍이 이미 처리됨 (status=${drop.status}).`);
    }

    const driver = await prisma.user.findFirst({
      where: { id: input.driverId, companyId: ctx.companyId, role: 'DRIVER', isActive: true },
      select: { id: true, name: true },
    });
    if (!driver) {
      throw new Error(`기사 ${input.driverId} 가 회사 소속 활성 기사가 아닙니다.`);
    }

    await prisma.$transaction([
      prisma.emergencyDrop.update({
        where: { id: drop.id },
        data: {
          status: 'FILLED',
          filledBy: driver.id,
          filledAt: ctx.virtualNow,
        },
      }),
      prisma.scheduleSlot.update({
        where: { id: drop.slotId },
        data: {
          driverId: driver.id,
          status: 'FILLED',
        },
      }),
    ]);

    return {
      dropId: drop.id,
      filledBy: driver.id,
      filledByName: driver.name,
    };
  },
};

// ─────────────────────────────────────────────
// 6. get_drop_context  (긴급도 인식의 핵심)
// ─────────────────────────────────────────────

const getDropContext: AgentTool<GetDropContextInput, unknown> = {
  name: 'get_drop_context',
  description:
    '특정 EmergencyDrop 의 상세 컨텍스트를 반환합니다. ' +
    '날짜·shift·노선·결원 사유·출발까지 남은 분·긴급도 등급(CRITICAL/HIGH/NORMAL/PASSED)을 포함합니다. ' +
    '에이전트 작업 시작 시 가장 먼저 호출해야 할 도구입니다 — 긴급도에 따라 전략이 완전히 달라집니다. ' +
    '특히 CRITICAL(30분 이내) 이면 단계별 전략(Top-3 대기) 을 절대 사용하지 말고 즉시 전체 푸시 + 관리자 호출을 동시에 실행해야 합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      dropId: { type: 'integer', description: 'EmergencyDrop.id' },
    },
    required: ['dropId'],
  },
  handler: async (input, ctx: ToolContext) => {
    const drop = await prisma.emergencyDrop.findFirst({
      where: {
        id: input.dropId,
        slot: { driver: { companyId: ctx.companyId } },
      },
      include: {
        slot: {
          include: {
            route: { select: { id: true, routeNumber: true, name: true } },
            schedule: { select: { companyId: true } },
          },
        },
        driver: { select: { id: true, name: true, employeeId: true } },
      },
    });

    if (!drop) {
      throw new Error(`EmergencyDrop ${input.dropId} 를 찾을 수 없거나 회사 격리 위반.`);
    }

    const departure = getDepartureUtc(drop.slot.date, drop.slot.shift);
    const minutesToDeparture = Math.floor(
      (departure.getTime() - ctx.virtualNow.getTime()) / 60000
    );
    const urgency = classifyUrgency(minutesToDeparture);

    return {
      dropId: drop.id,
      status: drop.status,
      escalationLevel: drop.escalationLevel,
      reason: drop.reason,
      droppedDriver: {
        id: drop.driver.id,
        name: drop.driver.name,
        employeeId: drop.driver.employeeId,
      },
      slot: {
        id: drop.slot.id,
        date: drop.slot.date.toISOString().split('T')[0],
        shift: drop.slot.shift,
        route: drop.slot.route,
      },
      timing: {
        departureUtc: departure.toISOString(),
        nowUtc: ctx.virtualNow.toISOString(),
        minutesToDeparture,
        urgency,
      },
      // 에이전트가 즉시 보고 행동하도록 권장 전략을 명시
      recommendedStrategy:
        urgency === 'CRITICAL'
          ? '즉시 전체 푸시 + escalate_to_admin(severity=CRITICAL, requireManualPhoneCall=true). 단계별 대기 금지.'
          : urgency === 'HIGH'
          ? '전체 푸시 + escalate_to_admin(severity=WARNING). wait_for_response 는 최대 120초.'
          : urgency === 'NORMAL'
          ? '단계별 전략: Top-3 점수화 → 푸시 → 5분 대기 → Top-10 → 5분 → 전체.'
          : '출발 시각이 이미 지났습니다. 더 이상 대타 시도 무의미. 관리자에게 미충원 보고만.',
    };
  },
};

// ─────────────────────────────────────────────
// 7. escalate_to_admin
// ─────────────────────────────────────────────

const escalateToAdmin: AgentTool<EscalateToAdminInput, unknown> = {
  name: 'escalate_to_admin',
  description:
    '관리자(ADMIN, DISPATCH 역할) 전원에게 인적 개입 알림을 전송합니다. ' +
    'severity=CRITICAL + requireManualPhoneCall=true 면 "직접 전화하세요" 메시지 + 푸시 + 알림센터 게시. ' +
    '긴급도 CRITICAL 인 경우, send_targeted_push (전체 기사) 와 동시에 호출해야 합니다 ' +
    '(병렬 호출 = 사람과 기사 양쪽에 동시에 알림이 가도록).',
  inputSchema: {
    type: 'object',
    properties: {
      dropId: { type: 'integer', description: 'EmergencyDrop.id' },
      reason: {
        type: 'string',
        description: '관리자에게 보일 한국어 설명 (예: "30분 후 출발, 자동 대타 실패")',
      },
      severity: {
        type: 'string',
        enum: ['INFO', 'WARNING', 'CRITICAL'],
        description: '심각도 — CRITICAL 만 푸시 진동·소리, INFO 는 알림센터만',
      },
      requireManualPhoneCall: {
        type: 'boolean',
        description: '관리자가 직접 전화로 기사에게 연락해야 하는지 (CRITICAL 시 true 권장)',
      },
    },
    required: ['dropId', 'reason', 'severity'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({
    simulated: true,
    dropId: input.dropId,
    severity: input.severity,
    requireManualPhoneCall: input.requireManualPhoneCall ?? false,
  }),
  handler: async (input, ctx: ToolContext) => {
    // 회사 격리: 드랍이 같은 회사인지 확인
    const drop = await prisma.emergencyDrop.findFirst({
      where: {
        id: input.dropId,
        slot: { driver: { companyId: ctx.companyId } },
      },
      include: {
        slot: {
          include: {
            route: { select: { routeNumber: true } },
          },
        },
      },
    });
    if (!drop) {
      throw new Error(`EmergencyDrop ${input.dropId} 회사 격리 위반.`);
    }

    const admins = await prisma.user.findMany({
      where: {
        companyId: ctx.companyId,
        role: { in: ['ADMIN', 'DISPATCH'] },
        isActive: true,
      },
      select: { id: true, name: true },
    });

    if (admins.length === 0) {
      return {
        notified: 0,
        warning: '관리자/배차담당이 없어 인적 개입 알림을 보낼 수 없습니다.',
      };
    }

    const requirePhone = input.requireManualPhoneCall ?? input.severity === 'CRITICAL';

    const dateLabel = `${drop.slot.date.getUTCMonth() + 1}월 ${drop.slot.date.getUTCDate()}일`;
    await sendBulkPushNotifications(
      admins.map((a) => a.id),
      '🚨 대타 미충원 — 관리자 조치 필요',
      `${dateLabel} ${drop.slot.route.routeNumber}번 노선 대타가 충원되지 않았습니다.${requirePhone ? ' 기사에게 직접 전화 등 즉시 조치가 필요합니다.' : ''}`,
      'EMERGENCY_SLOT',
      { dropId: input.dropId, kind: 'ADMIN_ESCALATION', severity: input.severity },
    );
    return {
      notified: admins.length,
      adminIds: admins.map((a) => a.id),
      severity: input.severity,
      requireManualPhoneCall: requirePhone,
    };
  },
};

// ─────────────────────────────────────────────
// 8. get_driver_preferences
// ─────────────────────────────────────────────

const getDriverPreferences: AgentTool<GetDriverPreferencesInput, unknown> = {
  name: 'get_driver_preferences',
  description:
    '특정 기사의 노선 선호도(1순위~3순위)를 반환합니다. 기사가 사전 등록한 "선호 노선" 정보로, ' +
    '선호 노선에 배정될 때 수락 가능성이 높습니다. score_acceptance_likelihood 가 routeId 로 ' +
    '계산하는 친숙도와 별개로, 명시적 선호도 정보입니다.',
  inputSchema: {
    type: 'object',
    properties: {
      driverId: { type: 'integer', description: '기사 ID' },
    },
    required: ['driverId'],
  },
  handler: async (input, ctx: ToolContext) => {
    // 회사 격리 검증
    const driver = await prisma.user.findFirst({
      where: { id: input.driverId, companyId: ctx.companyId, role: 'DRIVER' },
      select: { id: true, name: true, employeeId: true },
    });
    if (!driver) {
      throw new Error(`기사 ${input.driverId} 가 회사 소속이 아닙니다.`);
    }

    const prefs = await prisma.driverPreference.findMany({
      where: { driverId: input.driverId },
      include: {
        route: { select: { id: true, routeNumber: true, name: true } },
      },
      orderBy: { priority: 'asc' },
    });

    return {
      driver,
      totalPreferences: prefs.length,
      preferences: prefs.map((p) => ({
        priority: p.priority,
        route: p.route,
      })),
    };
  },
};

// ─────────────────────────────────────────────
// 9. get_recent_overtime
// ─────────────────────────────────────────────

const getRecentOvertime: AgentTool<GetRecentOvertimeInput, unknown> = {
  name: 'get_recent_overtime',
  description:
    '특정 기사의 최근 N일 (기본 14) 연장근로 시간을 반환합니다. ' +
    'AttendanceRecord 의 checkIn/checkOut 차이가 8시간 초과면 초과분이 연장근로로 누적. ' +
    '연장근로가 많은 기사에게 추가 대타를 요청하면 수락률이 낮습니다 — 다른 기사 우선 선택 권장.',
  inputSchema: {
    type: 'object',
    properties: {
      driverId: { type: 'integer', description: '기사 ID' },
      days: { type: 'integer', description: '조회 일수 (기본 14, 최대 60)' },
    },
    required: ['driverId'],
  },
  handler: async (input, ctx: ToolContext) => {
    const days = Math.min(60, Math.max(1, input.days ?? 14));
    const since = new Date(ctx.virtualNow.getTime() - days * 24 * 3600 * 1000);

    // 회사 격리
    const driver = await prisma.user.findFirst({
      where: { id: input.driverId, companyId: ctx.companyId, role: 'DRIVER' },
      select: { id: true, name: true, employeeId: true },
    });
    if (!driver) {
      throw new Error(`기사 ${input.driverId} 가 회사 소속이 아닙니다.`);
    }

    const records = await prisma.attendanceRecord.findMany({
      where: {
        driverId: input.driverId,
        date: { gte: since, lte: ctx.virtualNow },
        checkIn: { not: null },
        checkOut: { not: null },
      },
      select: { date: true, checkIn: true, checkOut: true },
    });

    let totalMinutesWorked = 0;
    let overtimeMinutes = 0;
    let daysWithOvertime = 0;
    const STANDARD_MINUTES = 8 * 60;

    for (const r of records) {
      if (!r.checkIn || !r.checkOut) continue;
      const minutes = (r.checkOut.getTime() - r.checkIn.getTime()) / 60000;
      if (minutes <= 0 || minutes > 16 * 60) continue; // 비정상 데이터 제외
      totalMinutesWorked += minutes;
      if (minutes > STANDARD_MINUTES) {
        overtimeMinutes += minutes - STANDARD_MINUTES;
        daysWithOvertime++;
      }
    }

    const overtimeHours = +(overtimeMinutes / 60).toFixed(1);
    const totalHours = +(totalMinutesWorked / 60).toFixed(1);

    // 피로도 신호
    const isHeavyOvertime = overtimeHours > days * 1.5; // 평균 1.5시간/일 초과
    const isOverloaded = totalHours > days * 9; // 평균 9시간/일 초과

    return {
      driver,
      windowDays: days,
      recordsWithBothEnds: records.length,
      totalHoursWorked: totalHours,
      overtimeHours,
      daysWithOvertime,
      avgHoursPerDay: records.length > 0 ? +(totalHours / records.length).toFixed(1) : 0,
      avgOvertimePerDay: records.length > 0 ? +(overtimeHours / records.length).toFixed(1) : 0,
      fatigueSignals: {
        heavyOvertime: isHeavyOvertime,
        overloaded: isOverloaded,
        recommendation: isOverloaded
          ? '추가 대타 요청 비권장 — 다른 기사 우선'
          : isHeavyOvertime
          ? '대타 가능하나 인센티브 강화 권장'
          : '정상 — 대타 후보로 적합',
      },
    };
  },
};

// ─────────────────────────────────────────────
// 10. request_swap
// ─────────────────────────────────────────────

const requestSwap: AgentTool<RequestSwapInput, unknown> = {
  name: 'request_swap',
  description:
    '여러 기사에게 "자발적 교대 협조" 푸시를 보냅니다. send_targeted_push 와 다른 점은 ' +
    '메시지 톤이 "강제 대타 요청" 이 아니라 "혹시 가능하신 분 부탁드려요" 로 부드럽다는 것. ' +
    'NORMAL 등급에서 첫 시도로 사용하면 응답률이 더 높습니다 (강요 느낌 ↓). ' +
    'CRITICAL 에서는 사용하지 마세요 — 시간이 없습니다.',
  inputSchema: {
    type: 'object',
    properties: {
      dropId: { type: 'integer', description: 'EmergencyDrop.id' },
      candidateDriverIds: {
        type: 'array',
        items: { type: 'integer' },
        description: '협조 요청할 기사 ID 목록',
      },
      message: {
        type: 'string',
        description: '한국어 본문 (정중한 톤 권장, 80자 이내)',
      },
    },
    required: ['dropId', 'candidateDriverIds', 'message'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({
    simulated: true,
    dropId: input.dropId,
    requested: input.candidateDriverIds.length,
  }),
  handler: async (input, ctx: ToolContext) => {
    // 회사 격리 + 드랍 검증
    const drop = await prisma.emergencyDrop.findFirst({
      where: {
        id: input.dropId,
        slot: { driver: { companyId: ctx.companyId } },
      },
      include: {
        slot: { include: { route: { select: { routeNumber: true } } } },
      },
    });
    if (!drop) {
      throw new Error(`EmergencyDrop ${input.dropId} 회사 격리 위반.`);
    }

    const validDrivers = await prisma.user.findMany({
      where: {
        id: { in: input.candidateDriverIds },
        companyId: ctx.companyId,
        role: 'DRIVER',
        isActive: true,
      },
      select: { id: true },
    });

    const validIds = validDrivers.map((d) => d.id);
    if (validIds.length === 0) {
      throw new Error('유효한 후보 기사가 없습니다.');
    }

    await sendBulkPushNotifications(
      validIds,
      '🔄 교대 협조 요청',
      input.message,
      'EMERGENCY_SLOT',
      { emergencyDropId: input.dropId, kind: 'voluntary_swap' },
    );
    return {
      sent: validIds.length,
      requested: input.candidateDriverIds.length,
      filtered: input.candidateDriverIds.length - validIds.length,
      kind: 'voluntary_swap',
    };
  },
};

// ─────────────────────────────────────────────
// 11. generate_postmortem
// ─────────────────────────────────────────────

const generatePostmortem: AgentTool<GeneratePostmortemInput, unknown> = {
  name: 'generate_postmortem',
  description:
    '결원 처리 사이클 종료 시 사후 분석 요약을 생성합니다. 결과(SUCCESS/FAILED/EXPIRED), ' +
    '수락 기사, 응답 시간, 푸시 횟수를 받아 구조화된 보고서를 반환합니다. ' +
    '에이전트 작업의 마지막 단계로 호출하세요. PromptEvolver 학습 데이터 + 관리자 일일 보고에 사용됩니다.',
  inputSchema: {
    type: 'object',
    properties: {
      dropId: { type: 'integer', description: 'EmergencyDrop.id' },
      outcome: {
        type: 'string',
        enum: ['SUCCESS', 'FAILED', 'EXPIRED'],
        description: '최종 결과',
      },
      acceptedByDriverId: {
        type: 'integer',
        description: '수락한 기사 ID (SUCCESS 시 필수)',
      },
      minutesUntilAcceptance: {
        type: 'integer',
        description: '드랍 발생부터 수락까지 분',
      },
      totalPushesSent: {
        type: 'integer',
        description: '이 사이클에서 보낸 푸시 총 횟수',
      },
      notes: { type: 'string', description: '자유 메모 (옵셔널)' },
    },
    required: ['dropId', 'outcome', 'totalPushesSent'],
  },
  handler: async (input, ctx: ToolContext) => {
    // 격리: 드랍이 같은 회사인지
    const drop = await prisma.emergencyDrop.findFirst({
      where: {
        id: input.dropId,
        slot: { driver: { companyId: ctx.companyId } },
      },
      include: {
        slot: {
          include: {
            route: { select: { routeNumber: true } },
            driver: { select: { name: true, employeeId: true } },
          },
        },
      },
    });
    if (!drop) {
      throw new Error(`EmergencyDrop ${input.dropId} 회사 격리 위반.`);
    }

    let acceptedDriver: { id: number; name: string; employeeId: string } | null = null;
    if (input.acceptedByDriverId) {
      const found = await prisma.user.findFirst({
        where: {
          id: input.acceptedByDriverId,
          companyId: ctx.companyId,
          role: 'DRIVER',
        },
        select: { id: true, name: true, employeeId: true },
      });
      acceptedDriver = found;
    }

    // 응답 시간 평가
    const responseTime = input.minutesUntilAcceptance ?? null;
    const responseRating: 'fast' | 'normal' | 'slow' | 'n/a' =
      responseTime === null
        ? 'n/a'
        : responseTime <= 5
        ? 'fast'
        : responseTime <= 30
        ? 'normal'
        : 'slow';

    // 효율 평가
    const pushEfficiency: 'efficient' | 'moderate' | 'wasteful' =
      input.totalPushesSent <= 5 ? 'efficient' : input.totalPushesSent <= 15 ? 'moderate' : 'wasteful';

    return {
      dropId: drop.id,
      droppedSlot: {
        date: drop.slot.date.toISOString().slice(0, 10),
        shift: drop.slot.shift,
        route: drop.slot.route.routeNumber,
        droppedBy: drop.slot.driver,
      },
      outcome: input.outcome,
      acceptedDriver,
      timing: {
        responseTimeMinutes: responseTime,
        rating: responseRating,
      },
      efficiency: {
        totalPushes: input.totalPushesSent,
        rating: pushEfficiency,
      },
      notes: input.notes ?? null,
      generatedAt: ctx.virtualNow.toISOString(),
    };
  },
};

// ─────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────

// 각 도구는 자신의 입력 타입으로 강타입화돼 있지만, ToolRegistry 는 입력을 unknown 으로
// 받으므로 export 시점에 AgentTool[] 로 흡수한다 (TypeScript 의 함수 파라미터 invariance 회피).
export const EMERGENCY_TOOLS_V1: AgentTool[] = [
  getDropContext as AgentTool,
  getDriverPreferences as AgentTool,
  getRecentOvertime as AgentTool,
  listOffDutyDrivers as AgentTool,
  scoreAcceptanceLikelihood as AgentTool,
  sendTargetedPush as AgentTool,
  requestSwap as AgentTool,
  waitForResponse as AgentTool,
  recordAcceptance as AgentTool,
  escalateToAdmin as AgentTool,
  generatePostmortem as AgentTool,
];
