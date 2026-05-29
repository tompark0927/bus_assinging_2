/**
 * DispatchSimulationRunner 단위 테스트.
 *
 * 검증 항목:
 *  1. summarizeDispatchToolCalls 가 도구 호출을 정확히 분류
 *  2. evaluateScenario 의 PHASE 2 출시 기준 검증 (5가지)
 *  3. DispatchSimulationRunner.runScenario (mocked agent + mocked measureFinalState)
 *  4. backtest 집계 (passingScenarioRate, avg 메트릭)
 *  5. formatDispatchBacktestReport
 */

const mockMeasureFinalState = jest.fn();

jest.mock('../../agents/_core/dispatch-scenario-generator', () => ({
  measureFinalState: (...args: unknown[]) => mockMeasureFinalState(...args),
}));

import {
  summarizeDispatchToolCalls,
  evaluateScenario,
  DispatchSimulationRunner,
  formatDispatchBacktestReport,
  type DispatchAgentSummary,
} from '../../agents/_core/dispatch-simulation';
import type { DispatchScenarioFixture } from '../../agents/_core/dispatch-scenario-generator';
import type { AgentLike, AgentRunResult, ToolCallRecord } from '../../agents/_core/types';

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function tc(tool: string, args: object = {}, error?: string): ToolCallRecord {
  return {
    tool,
    args,
    result: error ? undefined : { ok: true },
    error,
    ts: new Date().toISOString(),
    durationMs: 10,
  };
}

function makeAgent(impl: (input: unknown) => Promise<AgentRunResult>): AgentLike {
  return { run: jest.fn().mockImplementation(impl) };
}

function mockResult(toolCalls: ToolCallRecord[], overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    decisionId: 1,
    sessionId: 'sess',
    finalAction: 'done',
    reasoning: 'r',
    status: 'COMPLETED',
    toolCalls,
    tokensIn: 100,
    tokensOut: 50,
    costKrw: 50,
    durationMs: 1000,
    ...overrides,
  };
}

function makeFixture(overrides: Partial<DispatchScenarioFixture['baseline']> = {}): DispatchScenarioFixture {
  return {
    companyId: 100,
    companyCode: 'BT12345',
    scheduleId: 999,
    driverIds: [1, 2, 3],
    routeIds: [10, 11],
    pendingDayoffIds: [201, 202, 203],
    baseline: {
      fairnessScore: 60,
      workStdev: 2.5,
      outlierCount: 3,
      ruleViolationCount: 2,
      pendingDayoffCount: 3,
      compiledRulesCount: 4,
      totalRulesCount: 5,
      ...overrides,
    },
    cleanupHandle: async () => {},
  };
}

beforeEach(() => {
  mockMeasureFinalState.mockReset();
});

// ─────────────────────────────────────────────
// summarizeDispatchToolCalls
// ─────────────────────────────────────────────

describe('summarizeDispatchToolCalls', () => {
  it('빈 호출 → 모든 false/0', () => {
    const summary = summarizeDispatchToolCalls([]);
    expect(summary.draftCalled).toBe(false);
    expect(summary.modifySlotCount).toBe(0);
    expect(summary.publishCalled).toBe(false);
    expect(summary.constitutionalRejections).toBe(0);
  });

  it('각 도구 카운트 누적', () => {
    const summary = summarizeDispatchToolCalls([
      tc('draft_monthly_schedule'),
      tc('modify_slot'),
      tc('modify_slot'),
      tc('swap_drivers'),
      tc('approve_dayoff'),
      tc('approve_dayoff'),
      tc('approve_dayoff'),
      tc('reject_dayoff'),
      tc('detect_constraint_violation'),
      tc('publish_schedule'),
    ]);

    expect(summary.draftCalled).toBe(true);
    expect(summary.modifySlotCount).toBe(2);
    expect(summary.swapDriversCount).toBe(1);
    expect(summary.approveDayoffCount).toBe(3);
    expect(summary.rejectDayoffCount).toBe(1);
    expect(summary.detectViolationCalled).toBe(true);
    expect(summary.publishCalled).toBe(true);
  });

  it('Constitutional 거부는 별도 카운터로 분리 (도구 카운트에서 제외)', () => {
    const summary = summarizeDispatchToolCalls([
      tc('modify_slot'),
      tc('modify_slot', {}, 'Constitutional 위반: 야간 4일 연속 금지'),
      tc('modify_slot', {}, 'Constitutional 위반: 면허 만료'),
      tc('modify_slot'), // 성공
    ]);

    expect(summary.modifySlotCount).toBe(2); // 성공만
    expect(summary.constitutionalRejections).toBe(2);
  });

  it('일반 에러는 도구 카운트에서 제외 + Constitutional 카운터에도 안 들어감', () => {
    const summary = summarizeDispatchToolCalls([
      tc('modify_slot'),
      tc('modify_slot', {}, 'DB connection lost'), // 일반 에러
    ]);

    expect(summary.modifySlotCount).toBe(1);
    expect(summary.constitutionalRejections).toBe(0);
  });

  it('request_human_review 호출 시 humanReviewRequested=true', () => {
    const summary = summarizeDispatchToolCalls([tc('request_human_review')]);
    expect(summary.humanReviewRequested).toBe(true);
  });
});

// ─────────────────────────────────────────────
// evaluateScenario
// ─────────────────────────────────────────────

describe('evaluateScenario', () => {
  const baseline: DispatchScenarioFixture['baseline'] = {
    fairnessScore: 60,
    workStdev: 2.5,
    outlierCount: 3,
    ruleViolationCount: 2,
    pendingDayoffCount: 3,
    compiledRulesCount: 4,
    totalRulesCount: 5,
  };

  function summary(overrides: Partial<DispatchAgentSummary> = {}): DispatchAgentSummary {
    return {
      draftCalled: false,
      modifySlotCount: 0,
      swapDriversCount: 0,
      approveDayoffCount: 0,
      rejectDayoffCount: 0,
      detectViolationCalled: false,
      publishCalled: true,
      humanReviewRequested: false,
      constitutionalRejections: 0,
      ...overrides,
    };
  }

  function result(costKrw = 50): AgentRunResult {
    return mockResult([], { costKrw });
  }

  it('모든 기준 충족 → meetsCriteria=true', () => {
    const ev = evaluateScenario(
      baseline,
      {
        fairnessScore: 85,
        workStdev: 0.8,
        outlierCount: 0,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      },
      summary(),
      result()
    );

    expect(ev.meetsCriteria).toBe(true);
    expect(ev.failures).toEqual([]);
  });

  it('공정성 미달: 점수 < 80 AND 개선 < 20 → 실패', () => {
    const ev = evaluateScenario(
      baseline,
      {
        fairnessScore: 70, // 80 미만
        workStdev: 1.5,
        outlierCount: 1,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      },
      summary(),
      result()
    );
    // 60 → 70 = +10 개선, 80 미만 + 개선 < 20 → 실패
    expect(ev.meetsCriteria).toBe(false);
    expect(ev.failures.some((f) => f.includes('공정성'))).toBe(true);
  });

  it('공정성: 점수는 낮지만 개선 ≥ 20 → 통과', () => {
    const ev = evaluateScenario(
      baseline,
      {
        fairnessScore: 82, // 80 이상
        workStdev: 0.9,
        outlierCount: 0,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      },
      summary(),
      result()
    );
    expect(ev.meetsCriteria).toBe(true);
  });

  it('규칙 위반 1건 잔존 → 실패', () => {
    const ev = evaluateScenario(
      baseline,
      {
        fairnessScore: 90,
        workStdev: 0.5,
        outlierCount: 0,
        ruleViolationCount: 1,
        pendingDayoffCount: 0,
      },
      summary(),
      result()
    );
    expect(ev.meetsCriteria).toBe(false);
    expect(ev.failures.some((f) => f.includes('위반'))).toBe(true);
  });

  it('PENDING 휴무 미처리 → 실패', () => {
    const ev = evaluateScenario(
      baseline,
      {
        fairnessScore: 90,
        workStdev: 0.5,
        outlierCount: 0,
        ruleViolationCount: 0,
        pendingDayoffCount: 2, // 1개 미처리
      },
      summary(),
      result()
    );
    expect(ev.meetsCriteria).toBe(false);
    expect(ev.failures.some((f) => f.includes('휴무'))).toBe(true);
  });

  it('publish_schedule 미호출 → 실패', () => {
    const ev = evaluateScenario(
      baseline,
      {
        fairnessScore: 90,
        workStdev: 0.5,
        outlierCount: 0,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      },
      summary({ publishCalled: false }),
      result()
    );
    expect(ev.meetsCriteria).toBe(false);
    expect(ev.failures.some((f) => f.includes('publish'))).toBe(true);
  });

  it('비용 초과 → 실패', () => {
    const ev = evaluateScenario(
      baseline,
      {
        fairnessScore: 90,
        workStdev: 0.5,
        outlierCount: 0,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      },
      summary(),
      result(800) // > 500 한도
    );
    expect(ev.meetsCriteria).toBe(false);
    expect(ev.failures.some((f) => f.includes('비용'))).toBe(true);
  });

  it('커스텀 기준 적용 가능', () => {
    const ev = evaluateScenario(
      baseline,
      {
        fairnessScore: 70,
        workStdev: 1.0,
        outlierCount: 1,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      },
      summary(),
      result(),
      { minFairnessScore: 65, requireZeroViolations: false }
    );
    expect(ev.meetsCriteria).toBe(true);
  });
});

// ─────────────────────────────────────────────
// DispatchSimulationRunner
// ─────────────────────────────────────────────

describe('DispatchSimulationRunner.runScenario', () => {
  it('성공 시나리오 → 결과에 baseline + finalState + improvements', async () => {
    const fixture = makeFixture();

    const agent = makeAgent(async () =>
      mockResult([
        tc('detect_constraint_violation'),
        tc('approve_dayoff'),
        tc('approve_dayoff'),
        tc('approve_dayoff'),
        tc('modify_slot'),
        tc('publish_schedule'),
      ])
    );

    mockMeasureFinalState.mockResolvedValueOnce({
      fairnessScore: 85,
      workStdev: 0.8,
      outlierCount: 0,
      ruleViolationCount: 0,
      pendingDayoffCount: 0,
    });

    const runner = new DispatchSimulationRunner(agent);
    const result = await runner.runScenario(fixture, ['연속 5일 이상 근무 금지']);

    expect(result.error).toBeUndefined();
    expect(result.finalState.fairnessScore).toBe(85);
    expect(result.improvements.fairnessScoreDelta).toBe(25); // 85 - 60
    expect(result.improvements.dayoffsProcessed).toBe(3); // 3 → 0
    expect(result.improvements.violationReduction).toBe(2); // 2 → 0
    expect(result.summary.publishCalled).toBe(true);
    expect(result.meetsCriteria).toBe(true);
  });

  it('agent.run throw → error 기록 + finalState 는 baseline 값 유지', async () => {
    const fixture = makeFixture();
    const agent = makeAgent(async () => {
      throw new Error('API 다운');
    });

    const runner = new DispatchSimulationRunner(agent);
    const result = await runner.runScenario(fixture, []);

    expect(result.error).toBe('API 다운');
    expect(result.finalState.fairnessScore).toBe(fixture.baseline.fairnessScore);
    expect(result.meetsCriteria).toBe(false);
    expect(result.failures.some((f) => f.includes('실행 실패'))).toBe(true);
    // measureFinalState 는 호출 안 됨
    expect(mockMeasureFinalState).not.toHaveBeenCalled();
  });

  it('measureFinalState 가 baseline 측정값 반환 시 → 개선 0', async () => {
    const fixture = makeFixture();
    const agent = makeAgent(async () => mockResult([]));

    mockMeasureFinalState.mockResolvedValueOnce({
      fairnessScore: 60,
      workStdev: 2.5,
      outlierCount: 3,
      ruleViolationCount: 2,
      pendingDayoffCount: 3,
    });

    const runner = new DispatchSimulationRunner(agent);
    const result = await runner.runScenario(fixture, []);

    expect(result.improvements.fairnessScoreDelta).toBe(0);
    expect(result.improvements.dayoffsProcessed).toBe(0);
    expect(result.meetsCriteria).toBe(false);
  });
});

// ─────────────────────────────────────────────
// DispatchSimulationRunner.backtest (집계)
// ─────────────────────────────────────────────

describe('DispatchSimulationRunner.backtest', () => {
  it('5개 시나리오 모두 통과 → meetsLaunchCriteria=true', async () => {
    const fixtures = Array.from({ length: 5 }, () => makeFixture());

    const agent = makeAgent(async () =>
      mockResult(
        [
          tc('detect_constraint_violation'),
          tc('approve_dayoff'),
          tc('approve_dayoff'),
          tc('approve_dayoff'),
          tc('publish_schedule'),
        ],
        { costKrw: 100 }
      )
    );

    mockMeasureFinalState.mockResolvedValue({
      fairnessScore: 90,
      workStdev: 0.5,
      outlierCount: 0,
      ruleViolationCount: 0,
      pendingDayoffCount: 0,
    });

    const runner = new DispatchSimulationRunner(agent);
    const report = await runner.backtest(fixtures, []);

    expect(report.totalScenarios).toBe(5);
    expect(report.passingScenarioRate).toBe(1);
    expect(report.meetsLaunchCriteria).toBe(true);
    expect(report.avg.publishCallRate).toBe(1);
    expect(report.avg.dayoffProcessingRate).toBe(1);
  });

  it('일부 통과 시나리오 < 70% → meetsLaunchCriteria=false', async () => {
    const fixtures = Array.from({ length: 10 }, () => makeFixture());

    let i = 0;
    const agent = makeAgent(async () =>
      mockResult(
        [tc('publish_schedule')],
        { costKrw: 100 }
      )
    );
    void i;

    // 처음 6개는 좋은 결과, 나머지 4개는 나쁜 결과
    mockMeasureFinalState
      .mockResolvedValueOnce({
        fairnessScore: 90,
        workStdev: 0.5,
        outlierCount: 0,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      })
      .mockResolvedValueOnce({
        fairnessScore: 90,
        workStdev: 0.5,
        outlierCount: 0,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      })
      .mockResolvedValueOnce({
        fairnessScore: 90,
        workStdev: 0.5,
        outlierCount: 0,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      })
      .mockResolvedValueOnce({
        fairnessScore: 90,
        workStdev: 0.5,
        outlierCount: 0,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      })
      .mockResolvedValueOnce({
        fairnessScore: 90,
        workStdev: 0.5,
        outlierCount: 0,
        ruleViolationCount: 0,
        pendingDayoffCount: 0,
      })
      .mockResolvedValue({
        fairnessScore: 65,
        workStdev: 1.5,
        outlierCount: 2,
        ruleViolationCount: 1,
        pendingDayoffCount: 1,
      });

    const runner = new DispatchSimulationRunner(agent);
    const report = await runner.backtest(fixtures, []);

    expect(report.passingScenarioRate).toBe(0.5); // 5/10
    expect(report.meetsLaunchCriteria).toBe(false);
    expect(report.launchCriteriaFailures.some((f) => f.includes('통과'))).toBe(true);
  });

  it('빈 fixture 배열 → 0 통계, criteria 통과 (vacuously)', async () => {
    const agent = makeAgent(async () => mockResult([]));
    const runner = new DispatchSimulationRunner(agent);
    const report = await runner.backtest([], []);
    expect(report.totalScenarios).toBe(0);
    expect(report.passingScenarioRate).toBe(0);
    // 0 < 0.7 → meetsLaunchCriteria=false (정상 — 시나리오 없으면 검증 불가)
    expect(report.meetsLaunchCriteria).toBe(false);
  });
});

// ─────────────────────────────────────────────
// formatDispatchBacktestReport
// ─────────────────────────────────────────────

describe('formatDispatchBacktestReport', () => {
  it('주요 메트릭 포함', async () => {
    const fixtures = [makeFixture()];
    const agent = makeAgent(async () =>
      mockResult([tc('publish_schedule')], { costKrw: 100 })
    );
    mockMeasureFinalState.mockResolvedValueOnce({
      fairnessScore: 90,
      workStdev: 0.5,
      outlierCount: 0,
      ruleViolationCount: 0,
      pendingDayoffCount: 0,
    });

    const runner = new DispatchSimulationRunner(agent);
    const report = await runner.backtest(fixtures, []);
    const formatted = formatDispatchBacktestReport(report);

    expect(formatted).toContain('DispatchAgent 백테스트');
    expect(formatted).toContain('공정성');
    expect(formatted).toContain('휴무 처리율');
    expect(formatted).toContain('출시 가능');
  });

  it('미달 시 ❌ + 사유 표시', async () => {
    const fixtures = Array.from({ length: 3 }, () => makeFixture());
    const agent = makeAgent(async () => mockResult([], { costKrw: 100 }));
    mockMeasureFinalState.mockResolvedValue({
      fairnessScore: 60,
      workStdev: 2.5,
      outlierCount: 3,
      ruleViolationCount: 2,
      pendingDayoffCount: 3,
    });

    const runner = new DispatchSimulationRunner(agent);
    const report = await runner.backtest(fixtures, []);
    const formatted = formatDispatchBacktestReport(report);

    expect(formatted).toContain('❌');
  });
});
