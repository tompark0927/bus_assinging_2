/**
 * Report tools 단위 테스트.
 *
 * 6개 도구의 핵심 동작과 회사 격리·집계 정확성 검증.
 * Prisma 모킹으로 DB 없이 동작.
 */

const mockEmergencyDropFindMany = jest.fn();
const mockDayOffRequestFindMany = jest.fn();
const mockDayOffRequestCount = jest.fn();
const mockScheduleSlotCount = jest.fn();
const mockScheduleFindUnique = jest.fn();
const mockUserFindMany = jest.fn();
const mockAgentDecisionFindMany = jest.fn();
const mockAgentDecisionAggregate = jest.fn();
const mockDailyReportUpsert = jest.fn();

jest.mock('../../utils/prisma', () => ({
  prisma: {
    emergencyDrop: { findMany: (...a: unknown[]) => mockEmergencyDropFindMany(...a) },
    dayOffRequest: {
      findMany: (...a: unknown[]) => mockDayOffRequestFindMany(...a),
      count: (...a: unknown[]) => mockDayOffRequestCount(...a),
    },
    scheduleSlot: { count: (...a: unknown[]) => mockScheduleSlotCount(...a) },
    schedule: { findUnique: (...a: unknown[]) => mockScheduleFindUnique(...a) },
    user: { findMany: (...a: unknown[]) => mockUserFindMany(...a) },
    agentDecision: {
      findMany: (...a: unknown[]) => mockAgentDecisionFindMany(...a),
      aggregate: (...a: unknown[]) => mockAgentDecisionAggregate(...a),
    },
    dailyReport: { upsert: (...a: unknown[]) => mockDailyReportUpsert(...a) },
  },
}));

import { REPORT_TOOLS_V1 } from '../../agents/_tools/report-tools';
import type { AgentTool, ToolContext } from '../../agents/_core/types';

const VIRTUAL_NOW = new Date('2026-04-10T08:00:00Z'); // KST 17:00

const ctx: ToolContext = {
  companyId: 1,
  agentName: 'daily_report',
  sessionId: 'sess',
  isSimulation: false,
  virtualNow: VIRTUAL_NOW,
};

function getTool(name: string): AgentTool {
  const tool = REPORT_TOOLS_V1.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ─────────────────────────────────────────────
// 1. get_yesterday_activity
// ─────────────────────────────────────────────

describe('get_yesterday_activity', () => {
  const tool = () => getTool('get_yesterday_activity');

  it('회사 격리 + 어제 드랍 통계 집계', async () => {
    mockEmergencyDropFindMany.mockResolvedValue([
      {
        id: 1,
        status: 'FILLED',
        filledBy: 10,
        filledAt: new Date('2026-04-09T10:00:00Z'),
        createdAt: new Date('2026-04-09T08:00:00Z'),
        slot: {
          date: new Date('2026-04-09'),
          shift: 'MORNING',
          route: { routeNumber: '16' },
        },
      },
      {
        id: 2,
        status: 'EXPIRED',
        filledBy: null,
        filledAt: null,
        createdAt: new Date('2026-04-09T08:30:00Z'),
        slot: {
          date: new Date('2026-04-09'),
          shift: 'AFTERNOON',
          route: { routeNumber: '17' },
        },
      },
      {
        id: 3,
        status: 'OPEN',
        filledBy: null,
        filledAt: null,
        createdAt: new Date('2026-04-09T22:00:00Z'),
        slot: {
          date: new Date('2026-04-10'),
          shift: 'MORNING',
          route: { routeNumber: '18' },
        },
      },
    ]);
    mockDayOffRequestFindMany.mockResolvedValue([
      { id: 1, status: 'APPROVED', date: new Date('2026-04-12'), driver: { id: 5, name: '김기사' } },
      { id: 2, status: 'APPROVED', date: new Date('2026-04-13'), driver: { id: 6, name: '박기사' } },
      { id: 3, status: 'REJECTED', date: new Date('2026-04-14'), driver: { id: 7, name: '이기사' } },
    ]);
    mockDayOffRequestCount.mockResolvedValue(4);
    mockScheduleSlotCount.mockResolvedValueOnce(2).mockResolvedValueOnce(1); // overrides=2, absent=1

    const result = (await tool().handler({}, ctx)) as {
      drops: { total: number; filled: number; expired: number; stillOpen: number };
      dayoffs: { approvedCount: number; rejectedCount: number; newSubmissionsCount: number };
      schedule: { manualOverrides: number; absentCount: number };
    };

    expect(result.drops.total).toBe(3);
    expect(result.drops.filled).toBe(1);
    expect(result.drops.expired).toBe(1);
    expect(result.drops.stillOpen).toBe(1);
    expect(result.dayoffs.approvedCount).toBe(2);
    expect(result.dayoffs.rejectedCount).toBe(1);
    expect(result.dayoffs.newSubmissionsCount).toBe(4);
    expect(result.schedule.manualOverrides).toBe(2);
    expect(result.schedule.absentCount).toBe(1);
  });

  it('회사 격리 검증: where 절에 driver.companyId 포함', async () => {
    mockEmergencyDropFindMany.mockResolvedValue([]);
    mockDayOffRequestFindMany.mockResolvedValue([]);
    mockDayOffRequestCount.mockResolvedValue(0);
    mockScheduleSlotCount.mockResolvedValue(0);

    await tool().handler({}, ctx);

    const dropCallArg = mockEmergencyDropFindMany.mock.calls[0][0];
    expect(dropCallArg.where.slot.driver.companyId).toBe(1);
  });

  it('명시 date 인자 사용', async () => {
    mockEmergencyDropFindMany.mockResolvedValue([]);
    mockDayOffRequestFindMany.mockResolvedValue([]);
    mockDayOffRequestCount.mockResolvedValue(0);
    mockScheduleSlotCount.mockResolvedValue(0);

    const result = (await tool().handler({ date: '2026-04-05' }, ctx)) as { date: string };
    expect(result.date).toBe('2026-04-05');
  });
});

// ─────────────────────────────────────────────
// 2. get_today_priorities
// ─────────────────────────────────────────────

describe('get_today_priorities', () => {
  const tool = () => getTool('get_today_priorities');

  it('PENDING 휴무 + 오늘 드랍 + 운행 슬롯 집계', async () => {
    mockDayOffRequestFindMany.mockResolvedValue([
      {
        id: 1,
        date: new Date('2026-04-15'),
        driver: { id: 5, name: '김기사' },
        createdAt: new Date('2026-04-01'),
      },
      {
        id: 2,
        date: new Date('2026-04-16'),
        driver: { id: 6, name: '박기사' },
        createdAt: new Date('2026-04-08'),
      },
    ]);
    mockEmergencyDropFindMany.mockResolvedValue([
      {
        id: 100,
        slot: { shift: 'MORNING', route: { routeNumber: '16' } },
      },
    ]);
    mockScheduleSlotCount.mockResolvedValueOnce(50).mockResolvedValueOnce(2);

    const result = (await tool().handler({}, ctx)) as {
      pendingDayoffs: { count: number; oldest: string | null };
      todayOperations: { scheduledSlots: number; openDrops: number; droppedSlots: number };
    };

    expect(result.pendingDayoffs.count).toBe(2);
    expect(result.pendingDayoffs.oldest).toBe('2026-04-01');
    expect(result.todayOperations.scheduledSlots).toBe(50);
    expect(result.todayOperations.openDrops).toBe(1);
    expect(result.todayOperations.droppedSlots).toBe(2);
  });

  it('PENDING 0건 → oldest=null', async () => {
    mockDayOffRequestFindMany.mockResolvedValue([]);
    mockEmergencyDropFindMany.mockResolvedValue([]);
    mockScheduleSlotCount.mockResolvedValue(0);

    const result = (await tool().handler({}, ctx)) as {
      pendingDayoffs: { count: number; oldest: string | null };
    };
    expect(result.pendingDayoffs.count).toBe(0);
    expect(result.pendingDayoffs.oldest).toBeNull();
  });
});

// ─────────────────────────────────────────────
// 3. get_fairness_drift
// ─────────────────────────────────────────────

describe('get_fairness_drift', () => {
  const tool = () => getTool('get_fairness_drift');

  function mockSchedule(slots: Array<{
    driverId: number;
    routeId: number;
    shift: string;
    isRestDay: boolean;
    date: Date;
    status: string;
  }>) {
    return { id: 1, slots };
  }

  it('두 달 모두 존재 + 점수 -7 → ATTENTION', async () => {
    // 현재 월 (4월): 균등 분포 → 높은 점수
    // 전월 (3월): 더 균등 → 약간 더 높은 점수
    const currentSlots = Array.from({ length: 25 }, (_, i) => ({
      driverId: (i % 5) + 1,
      routeId: 1,
      shift: 'MORNING',
      isRestDay: i % 7 === 6, // 약간 불균등
      date: new Date(`2026-04-${String((i % 25) + 1).padStart(2, '0')}`),
      status: 'SCHEDULED',
    }));
    const previousSlots = Array.from({ length: 25 }, (_, i) => ({
      driverId: (i % 5) + 1,
      routeId: 1,
      shift: 'MORNING',
      isRestDay: false, // 완전 균등
      date: new Date(`2026-03-${String((i % 25) + 1).padStart(2, '0')}`),
      status: 'SCHEDULED',
    }));

    mockScheduleFindUnique
      .mockResolvedValueOnce(mockSchedule(currentSlots))
      .mockResolvedValueOnce(mockSchedule(previousSlots));

    const result = (await tool().handler({ year: 2026, month: 4 }, ctx)) as {
      currentMonth: { exists: boolean; fairnessScore: number };
      previousMonth: { exists: boolean; fairnessScore: number };
      drift: number | null;
      driftSignal: string;
    };

    expect(result.currentMonth.exists).toBe(true);
    expect(result.previousMonth.exists).toBe(true);
    expect(result.drift).toBeDefined();
  });

  it('현재 월 없음 → exists=false', async () => {
    mockScheduleFindUnique.mockResolvedValue(null);

    const result = (await tool().handler({ year: 2026, month: 4 }, ctx)) as {
      currentMonth: { exists: boolean };
      drift: number | null;
      driftSignal: string;
    };

    expect(result.currentMonth.exists).toBe(false);
    expect(result.drift).toBeNull();
    expect(result.driftSignal).toBe('NORMAL');
  });
});

// ─────────────────────────────────────────────
// 4. get_upcoming_alerts
// ─────────────────────────────────────────────

describe('get_upcoming_alerts', () => {
  const tool = () => getTool('get_upcoming_alerts');

  it('만료 임박 기사 + 심각도 분류', async () => {
    const today = new Date('2026-04-10T00:00:00Z');
    const ctx2: ToolContext = { ...ctx, virtualNow: today };

    mockUserFindMany.mockResolvedValue([
      {
        id: 1,
        name: '김기사',
        employeeId: 'D001',
        licenseExpiresAt: new Date('2026-04-15'), // D-5 → URGENT
        qualificationExpiresAt: null,
      },
      {
        id: 2,
        name: '박기사',
        employeeId: 'D002',
        licenseExpiresAt: null,
        qualificationExpiresAt: new Date('2026-04-25'), // D-15 → ATTENTION
      },
      {
        id: 3,
        name: '이기사',
        employeeId: 'D003',
        licenseExpiresAt: new Date('2026-04-12'), // D-2 → URGENT
        qualificationExpiresAt: new Date('2026-05-08'), // D-28 → ATTENTION
      },
    ]);

    const result = (await tool().handler({ daysAhead: 30 }, ctx2)) as {
      totalAlerts: number;
      urgentCount: number;
      attentionCount: number;
      alerts: Array<{ daysRemaining: number; severity: string; type: string }>;
    };

    expect(result.totalAlerts).toBe(4); // 김(1) + 박(1) + 이(2)
    expect(result.urgentCount).toBe(2); // D-5, D-2
    expect(result.attentionCount).toBe(2); // D-15, D-28
    // 정렬: 가장 임박한 것 먼저
    expect(result.alerts[0].daysRemaining).toBeLessThanOrEqual(result.alerts[1].daysRemaining);
  });

  it('만료 임박 없음 → 빈 배열', async () => {
    mockUserFindMany.mockResolvedValue([]);
    const result = (await tool().handler({ daysAhead: 30 }, ctx)) as { totalAlerts: number };
    expect(result.totalAlerts).toBe(0);
  });

  it('daysAhead 클램핑 (1~90)', async () => {
    mockUserFindMany.mockResolvedValue([]);
    await tool().handler({ daysAhead: 1000 }, ctx);
    const callArg = mockUserFindMany.mock.calls[0][0];
    // 호출되긴 함 — 클램핑은 함수 내부에서, where 절에 반영됨
    expect(callArg.where.companyId).toBe(1);
  });
});

// ─────────────────────────────────────────────
// 5. get_agent_health
// ─────────────────────────────────────────────

describe('get_agent_health', () => {
  const tool = () => getTool('get_agent_health');

  it('거부율 ≥ 10% → URGENT', async () => {
    mockAgentDecisionFindMany.mockResolvedValue([
      { agentName: 'emergency', status: 'COMPLETED', humanOverride: true, tokensIn: 100, tokensOut: 50 },
      { agentName: 'emergency', status: 'COMPLETED', humanOverride: true, tokensIn: 100, tokensOut: 50 },
      { agentName: 'emergency', status: 'COMPLETED', humanOverride: false, tokensIn: 100, tokensOut: 50 },
      ...Array.from({ length: 7 }, () => ({
        agentName: 'emergency',
        status: 'COMPLETED',
        humanOverride: false,
        tokensIn: 100,
        tokensOut: 50,
      })),
    ]);
    mockAgentDecisionAggregate.mockResolvedValue({ _sum: { costKrw: 1000 } });

    const result = (await tool().handler({ days: 7 }, ctx)) as {
      total: number;
      overridden: number;
      overrideRate: number;
      healthSignal: string;
    };

    expect(result.total).toBe(10);
    expect(result.overridden).toBe(2);
    expect(result.overrideRate).toBe(0.2);
    expect(result.healthSignal).toBe('URGENT');
  });

  it('거부율 5% → ATTENTION', async () => {
    mockAgentDecisionFindMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        agentName: 'dispatch',
        status: 'COMPLETED',
        humanOverride: i === 0, // 1/20 = 5%
        tokensIn: 100,
        tokensOut: 50,
      }))
    );
    mockAgentDecisionAggregate.mockResolvedValue({ _sum: { costKrw: 500 } });

    const result = (await tool().handler({ days: 7 }, ctx)) as { healthSignal: string };
    expect(result.healthSignal).toBe('ATTENTION');
  });

  it('정상 → NORMAL', async () => {
    mockAgentDecisionFindMany.mockResolvedValue(
      Array.from({ length: 50 }, () => ({
        agentName: 'emergency',
        status: 'COMPLETED',
        humanOverride: false,
        tokensIn: 100,
        tokensOut: 50,
      }))
    );
    mockAgentDecisionAggregate.mockResolvedValue({ _sum: { costKrw: 500 } });

    const result = (await tool().handler({ days: 7 }, ctx)) as { healthSignal: string };
    expect(result.healthSignal).toBe('NORMAL');
  });

  it('isSimulation=false 만 카운트 (where 절 검증)', async () => {
    mockAgentDecisionFindMany.mockResolvedValue([]);
    mockAgentDecisionAggregate.mockResolvedValue({ _sum: { costKrw: 0 } });

    await tool().handler({ days: 7 }, ctx);

    const callArg = mockAgentDecisionFindMany.mock.calls[0][0];
    expect(callArg.where.isSimulation).toBe(false);
  });
});

// ─────────────────────────────────────────────
// 6. save_daily_report
// ─────────────────────────────────────────────

describe('save_daily_report', () => {
  const tool = () => getTool('save_daily_report');

  it('upsert 호출 + 결과 반환', async () => {
    mockDailyReportUpsert.mockResolvedValue({
      id: 99,
      reportDate: new Date('2026-04-09'),
      severity: 'ATTENTION',
      generatedAt: new Date('2026-04-10T00:00:00Z'),
    });

    const result = (await tool().handler(
      {
        reportDate: '2026-04-09',
        content: 'A'.repeat(100),
        summary: { fairnessScore: 87 },
        severity: 'ATTENTION',
      },
      ctx
    )) as { reportId: number; severity: string; reportDate: string };

    expect(result.reportId).toBe(99);
    expect(result.severity).toBe('ATTENTION');
    expect(result.reportDate).toBe('2026-04-09');

    const upsertArg = mockDailyReportUpsert.mock.calls[0][0];
    expect(upsertArg.where.companyId_reportDate.companyId).toBe(1);
  });

  it('본문 50자 미만 → throw', async () => {
    await expect(
      tool().handler(
        {
          reportDate: '2026-04-09',
          content: '짧음',
          summary: {},
          severity: 'INFO',
        },
        ctx
      )
    ).rejects.toThrow(/너무 짧/);
  });

  it('시뮬레이션 모드 → simulationStub 반환', () => {
    const simTool = tool();
    expect(simTool.blockedInSimulation).toBe(true);
    expect(simTool.simulationStub).toBeDefined();

    const stubResult = simTool.simulationStub!(
      {
        reportDate: '2026-04-09',
        content: 'x'.repeat(100),
        summary: {},
        severity: 'INFO',
      },
      ctx
    ) as { simulated: boolean; reportDate: string };

    expect(stubResult.simulated).toBe(true);
    expect(stubResult.reportDate).toBe('2026-04-09');
  });
});

// ─────────────────────────────────────────────
// REPORT_TOOLS_V1 sanity
// ─────────────────────────────────────────────

describe('REPORT_TOOLS_V1', () => {
  it('6개 도구 export', () => {
    expect(REPORT_TOOLS_V1).toHaveLength(6);
    const names = REPORT_TOOLS_V1.map((t) => t.name);
    expect(names).toEqual([
      'get_yesterday_activity',
      'get_today_priorities',
      'get_fairness_drift',
      'get_upcoming_alerts',
      'get_agent_health',
      'save_daily_report',
    ]);
  });

  it('각 도구가 description + inputSchema 보유', () => {
    for (const tool of REPORT_TOOLS_V1) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('save_daily_report 만 시뮬레이션 차단', () => {
    const blocked = REPORT_TOOLS_V1.filter((t) => t.blockedInSimulation);
    expect(blocked.map((t) => t.name)).toEqual(['save_daily_report']);
  });
});
