/**
 * DailyReportAgent v1 — 6개 도구.
 *
 * 도구 카테고리:
 *   조회 (5): yesterday_activity, today_priorities, fairness_drift, upcoming_alerts, agent_health
 *   기록 (1): save_daily_report
 *
 * 모든 조회 도구는 회사 격리 (ToolContext.companyId) 자동.
 * save_daily_report 만 외부 효과 — 시뮬레이션 모드에서는 stub.
 *
 * 디자인 원칙:
 *   - "데이터를 모아 모델에게 넘기고 → 모델이 자연어 보고서 작성 → 한 번에 저장"
 *   - 모델이 언제든 우선순위·문맥 판단 가능 (강제 룰 없음)
 *   - 단, severity 계산은 도구 내부에서 객관적 신호 기반으로도 제안 (모델이 무시 가능)
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { calculateFairness, type SlotForFairness } from './fairness';
import type { AgentTool, ToolContext } from '../_core/types';

// ─────────────────────────────────────────────
// 입력 타입
// ─────────────────────────────────────────────

interface GetYesterdayActivityInput {
  /** 보고 대상 날짜 (YYYY-MM-DD). 기본: ctx.virtualNow 의 어제 (KST) */
  date?: string;
}

interface GetTodayPrioritiesInput {
  /** 오늘 날짜 (YYYY-MM-DD). 기본: ctx.virtualNow (KST) */
  date?: string;
}

interface GetFairnessDriftInput {
  /** 비교 대상 연·월 (기본: 현재 월) */
  year?: number;
  month?: number;
}

interface GetUpcomingAlertsInput {
  /** 향후 N일 이내 만료/이벤트 (기본 30) */
  daysAhead?: number;
}

interface GetAgentHealthInput {
  /** 조회 일수 (기본 7) */
  days?: number;
}

interface SaveDailyReportInput {
  reportDate: string; // YYYY-MM-DD
  /** 한국어 마크다운 본문 (모델이 작성) */
  content: string;
  /** 구조화 요약 (대시보드용) */
  summary: Record<string, unknown>;
  /** INFO | ATTENTION | URGENT */
  severity: 'INFO' | 'ATTENTION' | 'URGENT';
}

// ─────────────────────────────────────────────
// 헬퍼: KST 기준 날짜 계산
// ─────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ctx.virtualNow 의 KST 기준 "오늘" 을 UTC Date 로 (자정) 반환 */
function todayInKst(virtualNow: Date): Date {
  const kstNow = new Date(virtualNow.getTime() + KST_OFFSET_MS);
  const dateStr = kstNow.toISOString().slice(0, 10);
  return new Date(`${dateStr}T00:00:00Z`);
}

function yesterdayInKst(virtualNow: Date): Date {
  const today = todayInKst(virtualNow);
  return new Date(today.getTime() - 24 * 3600 * 1000);
}

function parseYmdOrDefault(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// 1. get_yesterday_activity
// ─────────────────────────────────────────────

const getYesterdayActivity: AgentTool<GetYesterdayActivityInput, unknown> = {
  name: 'get_yesterday_activity',
  description:
    '어제 회사에서 발생한 운영 활동을 종합 조회합니다. ' +
    '결원 처리(생성/수락/만료), 휴무 신청 처리(승인/거절), 스케줄 슬롯 변경, ' +
    '운행 완료 슬롯 수, 결근 발생을 모두 반환합니다. ' +
    '일일 보고서의 "어제 무슨 일이 있었나" 섹션의 데이터 소스.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '대상 날짜 YYYY-MM-DD (기본: 어제 KST)' },
    },
  },
  handler: async (input, ctx: ToolContext) => {
    const date = parseYmdOrDefault(input.date, yesterdayInKst(ctx.virtualNow));
    const dayStart = new Date(date);
    const dayEnd = new Date(date.getTime() + 24 * 3600 * 1000);

    // 어제 생성된 EmergencyDrop (slot 의 driver 가 같은 회사인지로 격리)
    const drops = await prisma.emergencyDrop.findMany({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
        slot: { driver: { companyId: ctx.companyId } },
      },
      select: {
        id: true,
        status: true,
        filledBy: true,
        filledAt: true,
        createdAt: true,
        slot: {
          select: {
            date: true,
            shift: true,
            route: { select: { routeNumber: true } },
          },
        },
      },
    });

    const dropsByStatus = {
      total: drops.length,
      filled: drops.filter((d) => d.status === 'FILLED').length,
      expired: drops.filter((d) => d.status === 'EXPIRED').length,
      cancelled: drops.filter((d) => d.status === 'CANCELLED').length,
      stillOpen: drops.filter((d) => d.status === 'OPEN').length,
    };

    // 어제 처리된 휴무 신청 (updatedAt 기준)
    const dayoffs = await prisma.dayOffRequest.findMany({
      where: {
        companyId: ctx.companyId,
        updatedAt: { gte: dayStart, lt: dayEnd },
        status: { in: ['APPROVED', 'REJECTED'] },
      },
      select: {
        id: true,
        status: true,
        date: true,
        driver: { select: { id: true, name: true } },
      },
    });

    // 어제 생성된 새 휴무 신청 (PENDING)
    const newDayoffs = await prisma.dayOffRequest.count({
      where: {
        companyId: ctx.companyId,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });

    // 어제 수동 변경된 슬롯 (isManualOverride=true + updatedAt 어제)
    const manualOverrides = await prisma.scheduleSlot.count({
      where: {
        schedule: { companyId: ctx.companyId },
        isManualOverride: true,
        updatedAt: { gte: dayStart, lt: dayEnd },
      },
    });

    // 어제 결근 (ABSENT) 발생
    const absent = await prisma.scheduleSlot.count({
      where: {
        schedule: { companyId: ctx.companyId },
        date: dayStart,
        status: 'ABSENT',
      },
    });

    return {
      date: dateOnly(date),
      drops: {
        ...dropsByStatus,
        details: drops.map((d) => ({
          dropId: d.id,
          status: d.status,
          route: d.slot.route.routeNumber,
          shift: d.slot.shift,
          slotDate: d.slot.date.toISOString().slice(0, 10),
          filledBy: d.filledBy,
        })),
      },
      dayoffs: {
        approvedCount: dayoffs.filter((d) => d.status === 'APPROVED').length,
        rejectedCount: dayoffs.filter((d) => d.status === 'REJECTED').length,
        newSubmissionsCount: newDayoffs,
      },
      schedule: {
        manualOverrides,
        absentCount: absent,
      },
    };
  },
};

// ─────────────────────────────────────────────
// 2. get_today_priorities
// ─────────────────────────────────────────────

const getTodayPriorities: AgentTool<GetTodayPrioritiesInput, unknown> = {
  name: 'get_today_priorities',
  description:
    '오늘 처리해야 할 우선순위 항목을 반환합니다. PENDING 휴무 신청, 오늘의 OPEN 결원, ' +
    '오늘 운행 슬롯 수, 결근 위험 (ABSENT 또는 DROPPED 미해결) 을 포함합니다. ' +
    '일일 보고서의 "오늘 챙길 것" 섹션의 데이터 소스.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: '대상 날짜 YYYY-MM-DD (기본: 오늘 KST)' },
    },
  },
  handler: async (input, ctx: ToolContext) => {
    const date = parseYmdOrDefault(input.date, todayInKst(ctx.virtualNow));

    // PENDING 휴무 (전체)
    const pendingDayoffs = await prisma.dayOffRequest.findMany({
      where: { companyId: ctx.companyId, status: 'PENDING' },
      select: {
        id: true,
        date: true,
        driver: { select: { id: true, name: true } },
        createdAt: true,
      },
      orderBy: { date: 'asc' },
      take: 30,
    });

    // 오늘 OPEN 드랍
    const openDrops = await prisma.emergencyDrop.findMany({
      where: {
        status: 'OPEN',
        slot: {
          driver: { companyId: ctx.companyId },
          date,
        },
      },
      select: {
        id: true,
        slot: {
          select: {
            shift: true,
            route: { select: { routeNumber: true } },
          },
        },
      },
    });

    // 오늘 운행 예정 슬롯 수
    const todaySlotsCount = await prisma.scheduleSlot.count({
      where: {
        schedule: { companyId: ctx.companyId },
        date,
        isRestDay: false,
        status: { in: ['SCHEDULED', 'FILLED'] },
      },
    });

    // 오늘 DROPPED 잔존 (대타 미확보)
    const droppedToday = await prisma.scheduleSlot.count({
      where: {
        schedule: { companyId: ctx.companyId },
        date,
        status: 'DROPPED',
      },
    });

    return {
      date: dateOnly(date),
      pendingDayoffs: {
        count: pendingDayoffs.length,
        oldest:
          pendingDayoffs.length > 0
            ? pendingDayoffs[0].createdAt.toISOString().slice(0, 10)
            : null,
        details: pendingDayoffs.map((d) => ({
          id: d.id,
          driver: d.driver,
          requestedDate: d.date.toISOString().slice(0, 10),
        })),
      },
      todayOperations: {
        scheduledSlots: todaySlotsCount,
        openDrops: openDrops.length,
        droppedSlots: droppedToday,
        openDropDetails: openDrops.map((d) => ({
          dropId: d.id,
          route: d.slot.route.routeNumber,
          shift: d.slot.shift,
        })),
      },
    };
  },
};

// ─────────────────────────────────────────────
// 3. get_fairness_drift
// ─────────────────────────────────────────────

const getFairnessDrift: AgentTool<GetFairnessDriftInput, unknown> = {
  name: 'get_fairness_drift',
  description:
    '현재 활성 배차표의 공정성 점수 + 전월 대비 변화를 반환합니다. ' +
    '점수가 5점 이상 떨어졌으면 ATTENTION, 10점 이상이면 URGENT 신호로 사용 권장. ' +
    '발행된 PUBLISHED 배차표만 분석 (DRAFT 제외).',
  inputSchema: {
    type: 'object',
    properties: {
      year: { type: 'integer', description: '연도 (기본: 현재 KST 월)' },
      month: { type: 'integer', description: '월 (기본: 현재 KST 월)' },
    },
  },
  handler: async (input, ctx: ToolContext) => {
    const today = todayInKst(ctx.virtualNow);
    const year = input.year ?? today.getUTCFullYear();
    const month = input.month ?? today.getUTCMonth() + 1;

    const computeForMonth = async (
      y: number,
      m: number
    ): Promise<{ exists: boolean; fairnessScore: number; outliers: number; stdev: number }> => {
      const schedule = await prisma.schedule.findUnique({
        where: { companyId_year_month: { companyId: ctx.companyId, year: y, month: m } },
        include: {
          slots: {
            select: {
              driverId: true,
              routeId: true,
              shift: true,
              isRestDay: true,
              date: true,
              status: true,
            },
          },
        },
      });
      if (!schedule || schedule.slots.length === 0) {
        return { exists: false, fairnessScore: 0, outliers: 0, stdev: 0 };
      }
      const slotsForCalc: SlotForFairness[] = schedule.slots.map((s) => ({
        driverId: s.driverId,
        routeId: s.routeId,
        shift: s.shift as 'MORNING' | 'AFTERNOON' | 'FULL_DAY',
        date: s.date,
        isRestDay: s.isRestDay,
        status: s.status,
      }));
      const report = calculateFairness(slotsForCalc);
      return {
        exists: true,
        fairnessScore: report.fairnessScore,
        outliers: report.outliers.length,
        stdev: report.stdev.work,
      };
    };

    const current = await computeForMonth(year, month);

    // 전월
    const prevDate = new Date(Date.UTC(year, month - 2, 1));
    const previous = await computeForMonth(prevDate.getUTCFullYear(), prevDate.getUTCMonth() + 1);

    const drift =
      current.exists && previous.exists ? current.fairnessScore - previous.fairnessScore : null;

    let driftSignal: 'NORMAL' | 'ATTENTION' | 'URGENT' = 'NORMAL';
    if (drift !== null) {
      if (drift <= -10) driftSignal = 'URGENT';
      else if (drift <= -5) driftSignal = 'ATTENTION';
    }

    return {
      currentMonth: { year, month, ...current },
      previousMonth: {
        year: prevDate.getUTCFullYear(),
        month: prevDate.getUTCMonth() + 1,
        ...previous,
      },
      drift,
      driftSignal,
    };
  },
};

// ─────────────────────────────────────────────
// 4. get_upcoming_alerts
// ─────────────────────────────────────────────

const getUpcomingAlerts: AgentTool<GetUpcomingAlertsInput, unknown> = {
  name: 'get_upcoming_alerts',
  description:
    '향후 N일 이내에 만료되는 면허·자격증·휴무 신청을 반환합니다. ' +
    '면허는 만료일 30일 이내가 ATTENTION, 7일 이내가 URGENT. ' +
    '오늘 이후 D-day 범위 안에 있는 모든 만료 사건을 정렬해서 반환.',
  inputSchema: {
    type: 'object',
    properties: {
      daysAhead: { type: 'integer', description: '며칠 이내 (기본 30, 최대 90)' },
    },
  },
  handler: async (input, ctx: ToolContext) => {
    const daysAhead = Math.min(90, Math.max(1, input.daysAhead ?? 30));
    const today = todayInKst(ctx.virtualNow);
    const horizon = new Date(today.getTime() + daysAhead * 24 * 3600 * 1000);

    const drivers = await prisma.user.findMany({
      where: {
        companyId: ctx.companyId,
        role: 'DRIVER',
        isActive: true,
        OR: [
          { licenseExpiresAt: { gte: today, lte: horizon } },
          { qualificationExpiresAt: { gte: today, lte: horizon } },
        ],
      },
      select: {
        id: true,
        name: true,
        employeeId: true,
        licenseExpiresAt: true,
        qualificationExpiresAt: true,
      },
    });

    const alerts: Array<{
      driverId: number;
      driverName: string;
      employeeId: string;
      type: 'license' | 'qualification';
      expiresAt: string;
      daysRemaining: number;
      severity: 'ATTENTION' | 'URGENT';
    }> = [];

    for (const driver of drivers) {
      const evaluate = (
        expiresAt: Date | null,
        type: 'license' | 'qualification'
      ): void => {
        if (!expiresAt) return;
        if (expiresAt < today || expiresAt > horizon) return;
        const days = Math.ceil((expiresAt.getTime() - today.getTime()) / (24 * 3600 * 1000));
        alerts.push({
          driverId: driver.id,
          driverName: driver.name,
          employeeId: driver.employeeId,
          type,
          expiresAt: expiresAt.toISOString().slice(0, 10),
          daysRemaining: days,
          severity: days <= 7 ? 'URGENT' : 'ATTENTION',
        });
      };

      evaluate(driver.licenseExpiresAt, 'license');
      evaluate(driver.qualificationExpiresAt, 'qualification');
    }

    alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);

    return {
      windowDays: daysAhead,
      totalAlerts: alerts.length,
      urgentCount: alerts.filter((a) => a.severity === 'URGENT').length,
      attentionCount: alerts.filter((a) => a.severity === 'ATTENTION').length,
      alerts,
    };
  },
};

// ─────────────────────────────────────────────
// 5. get_agent_health
// ─────────────────────────────────────────────

const getAgentHealth: AgentTool<GetAgentHealthInput, unknown> = {
  name: 'get_agent_health',
  description:
    '최근 N일 (기본 7) 동안 EmergencyAgent / DispatchAgent 의 결정 이력 통계를 반환합니다. ' +
    '인간 거부율, 실패율, 누적 비용, 평균 토큰을 포함합니다. 거부율 ≥ 5% 면 ATTENTION 신호.',
  inputSchema: {
    type: 'object',
    properties: {
      days: { type: 'integer', description: '조회 일수 (기본 7, 최대 30)' },
    },
  },
  handler: async (input, ctx: ToolContext) => {
    const days = Math.min(30, Math.max(1, input.days ?? 7));
    const since = new Date(ctx.virtualNow.getTime() - days * 24 * 3600 * 1000);

    const where: Prisma.AgentDecisionWhereInput = {
      companyId: ctx.companyId,
      createdAt: { gte: since },
      isSimulation: false,
    };

    const [decisions, costAgg] = await Promise.all([
      prisma.agentDecision.findMany({
        where,
        select: {
          agentName: true,
          status: true,
          humanOverride: true,
          tokensIn: true,
          tokensOut: true,
        },
      }),
      prisma.agentDecision.aggregate({
        where,
        _sum: { costKrw: true },
      }),
    ]);

    const byAgent = new Map<string, { total: number; failed: number; overridden: number }>();
    for (const d of decisions) {
      const stat = byAgent.get(d.agentName) ?? { total: 0, failed: 0, overridden: 0 };
      stat.total++;
      if (d.status === 'FAILED') stat.failed++;
      if (d.humanOverride) stat.overridden++;
      byAgent.set(d.agentName, stat);
    }

    const total = decisions.length;
    const failed = decisions.filter((d) => d.status === 'FAILED').length;
    const overridden = decisions.filter((d) => d.humanOverride).length;
    const totalTokens = decisions.reduce((s, d) => s + d.tokensIn + d.tokensOut, 0);

    const overrideRate = total > 0 ? overridden / total : 0;
    const failureRate = total > 0 ? failed / total : 0;

    let healthSignal: 'NORMAL' | 'ATTENTION' | 'URGENT' = 'NORMAL';
    if (overrideRate >= 0.1 || failureRate >= 0.1) healthSignal = 'URGENT';
    else if (overrideRate >= 0.05 || failureRate >= 0.05) healthSignal = 'ATTENTION';

    return {
      windowDays: days,
      total,
      failed,
      overridden,
      overrideRate,
      failureRate,
      totalTokens,
      totalCostKrw: costAgg._sum.costKrw ?? 0,
      byAgent: Array.from(byAgent.entries()).map(([agentName, stat]) => ({
        agentName,
        ...stat,
        overrideRate: stat.total > 0 ? stat.overridden / stat.total : 0,
        failureRate: stat.total > 0 ? stat.failed / stat.total : 0,
      })),
      healthSignal,
    };
  },
};

// ─────────────────────────────────────────────
// 6. save_daily_report
// ─────────────────────────────────────────────

const saveDailyReport: AgentTool<SaveDailyReportInput, unknown> = {
  name: 'save_daily_report',
  description:
    '작성한 일일 보고서를 DailyReport 테이블에 저장합니다. ' +
    '같은 회사·같은 reportDate 가 이미 있으면 덮어쓰기 (upsert). ' +
    '이 도구는 에이전트 작업의 마지막 단계로 정확히 1번 호출되어야 합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      reportDate: {
        type: 'string',
        description: '보고서 대상 날짜 YYYY-MM-DD (보통 어제)',
      },
      content: {
        type: 'string',
        description:
          '한국어 마크다운 본문. ## 어제 요약 / ## 오늘 우선순위 / ## 공정성 추이 / ## 알림 / ## 권장 조치 섹션 권장.',
      },
      summary: {
        type: 'object',
        description:
          '구조화 요약 (대시보드 표시용). yesterdayDrops, todayPending, fairnessScore, urgentAlerts, agentHealth 등 키 권장.',
      },
      severity: {
        type: 'string',
        enum: ['INFO', 'ATTENTION', 'URGENT'],
        description:
          '보고서 우선순위. URGENT 는 관리자 알림 센터 상단 강조, ATTENTION 은 노란색, INFO 는 일반.',
      },
    },
    required: ['reportDate', 'content', 'summary', 'severity'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({
    simulated: true,
    reportDate: input.reportDate,
    severity: input.severity,
  }),
  handler: async (input, ctx: ToolContext) => {
    const reportDate = parseYmdOrDefault(input.reportDate, yesterdayInKst(ctx.virtualNow));

    if (input.content.trim().length < 50) {
      throw new Error('보고서 본문이 너무 짧습니다 (최소 50자).');
    }

    // upsert: 같은 회사·같은 날짜는 1개만
    const report = await prisma.dailyReport.upsert({
      where: {
        companyId_reportDate: {
          companyId: ctx.companyId,
          reportDate,
        },
      },
      create: {
        companyId: ctx.companyId,
        reportDate,
        content: input.content,
        summary: input.summary as Prisma.JsonObject,
        severity: input.severity,
        generatedAt: ctx.virtualNow,
      },
      update: {
        content: input.content,
        summary: input.summary as Prisma.JsonObject,
        severity: input.severity,
        generatedAt: ctx.virtualNow,
        // 재생성 시 이전 읽음 상태 초기화
        isRead: false,
        readById: null,
        readAt: null,
      },
    });

    return {
      reportId: report.id,
      reportDate: dateOnly(report.reportDate),
      severity: report.severity,
      generatedAt: report.generatedAt.toISOString(),
      contentLength: input.content.length,
    };
  },
};

// ─────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────

export const REPORT_TOOLS_V1: AgentTool[] = [
  getYesterdayActivity as AgentTool,
  getTodayPriorities as AgentTool,
  getFairnessDrift as AgentTool,
  getUpcomingAlerts as AgentTool,
  getAgentHealth as AgentTool,
  saveDailyReport as AgentTool,
];
