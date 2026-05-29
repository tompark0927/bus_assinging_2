/**
 * SimulationRunner 단위 테스트.
 *
 * 핵심: 백테스트 결과 집계 로직이 정확해야 PHASE 1 출시 기준 검증을 신뢰할 수 있다.
 *
 * 검증 항목:
 *  - extractAgentDecision 이 도구 호출 기록에서 결정을 정확히 추출
 *  - compareToActual 의 4가지 비교 (양쪽성공/양쪽실패/에이전트만/실제만)
 *  - SimulationRunner 가 시나리오 실패를 격리하면서 backtest 진행
 *  - summarize 메트릭 계산 (수락률, 일치율, 평균 비용)
 *  - PHASE 1 출시 기준 평가 (수락률 < 70% → 미달)
 */

import {
  extractAgentDecision,
  compareToActual,
  SimulationRunner,
  formatBacktestReport,
  type DropScenario,
  type HistoricalOutcome,
} from '../../agents/_core/simulation';
import type { BaseAgent } from '../../agents/_core/base-agent';
import type { AgentRunResult, ToolCallRecord } from '../../agents/_core/types';

// ─────────────────────────────────────────────
// 헬퍼: 모킹된 BaseAgent 와 결과
// ─────────────────────────────────────────────

function mockResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    decisionId: 1,
    sessionId: 'sess',
    finalAction: '완료',
    reasoning: '...',
    status: 'COMPLETED',
    toolCalls: [],
    tokensIn: 100,
    tokensOut: 50,
    costKrw: 5,
    durationMs: 1000,
    ...overrides,
  };
}

function toolCall(
  tool: string,
  args: object,
  result?: object,
  error?: string
): ToolCallRecord {
  return {
    tool,
    args,
    result,
    error,
    ts: new Date().toISOString(),
    durationMs: 10,
  };
}

function makeMockAgent(runImpl: (input: unknown) => Promise<AgentRunResult>): BaseAgent {
  return { run: jest.fn().mockImplementation(runImpl) } as unknown as BaseAgent;
}

const baseScenario: DropScenario = {
  id: 'test-1',
  companyId: 1,
  dropId: 100,
  virtualNow: new Date('2026-04-10T08:00:00Z'),
};

// ─────────────────────────────────────────────
// extractAgentDecision
// ─────────────────────────────────────────────

describe('extractAgentDecision', () => {
  it('빈 toolCalls → 모두 false/0', () => {
    expect(extractAgentDecision([])).toEqual({
      attemptedAcceptance: false,
      escalatedToAdmin: false,
      pushAttempts: 0,
    });
  });

  it('record_acceptance 호출 → attemptedAcceptance + acceptedDriverId', () => {
    const decision = extractAgentDecision([
      toolCall('record_acceptance', { dropId: 100, driverId: 42 }, { simulated: true }),
    ]);
    expect(decision.attemptedAcceptance).toBe(true);
    expect(decision.acceptedDriverId).toBe(42);
  });

  it('escalate_to_admin 호출 → escalatedToAdmin=true', () => {
    const decision = extractAgentDecision([
      toolCall('escalate_to_admin', { dropId: 100, severity: 'CRITICAL', reason: '...' }),
    ]);
    expect(decision.escalatedToAdmin).toBe(true);
  });

  it('send_targeted_push 여러 번 → pushAttempts 누적', () => {
    const decision = extractAgentDecision([
      toolCall('send_targeted_push', { driverIds: [1, 2, 3] }),
      toolCall('send_targeted_push', { driverIds: [4, 5, 6] }),
      toolCall('send_targeted_push', { driverIds: [7, 8, 9] }),
    ]);
    expect(decision.pushAttempts).toBe(3);
  });

  it('get_drop_context 결과에서 urgency 추출', () => {
    const decision = extractAgentDecision([
      toolCall('get_drop_context', { dropId: 100 }, { timing: { urgency: 'CRITICAL' } }),
    ]);
    expect(decision.recognizedUrgency).toBe('CRITICAL');
  });

  it('실패한 도구 호출은 결정으로 카운트하지 않음', () => {
    const decision = extractAgentDecision([
      toolCall('record_acceptance', { driverId: 42 }, undefined, '드랍이 이미 처리됨'),
    ]);
    expect(decision.attemptedAcceptance).toBe(false);
    expect(decision.acceptedDriverId).toBeUndefined();
  });

  it('전체 시나리오: get_drop_context → push 2회 → record_acceptance', () => {
    const decision = extractAgentDecision([
      toolCall('get_drop_context', { dropId: 100 }, { timing: { urgency: 'NORMAL' } }),
      toolCall('list_off_duty_drivers', { date: '2026-04-15', shift: 'MORNING' }),
      toolCall('score_acceptance_likelihood', { driverIds: [1, 2, 3] }),
      toolCall('send_targeted_push', { driverIds: [1, 2, 3] }),
      toolCall('wait_for_response', { dropId: 100, driverIds: [1, 2, 3] }),
      toolCall('send_targeted_push', { driverIds: [4, 5, 6, 7, 8] }),
      toolCall('record_acceptance', { dropId: 100, driverId: 5 }),
    ]);
    expect(decision).toEqual({
      attemptedAcceptance: true,
      acceptedDriverId: 5,
      escalatedToAdmin: false,
      pushAttempts: 2,
      recognizedUrgency: 'NORMAL',
    });
  });
});

// ─────────────────────────────────────────────
// compareToActual
// ─────────────────────────────────────────────

describe('compareToActual', () => {
  const accepted = (driverId?: number): HistoricalOutcome => ({
    accepted: true,
    acceptedByDriverId: driverId,
  });
  const failed: HistoricalOutcome = { accepted: false };

  it('양쪽 성공 + 같은 기사 → bothAccepted + sameDriverChosen', () => {
    const c = compareToActual(
      { attemptedAcceptance: true, acceptedDriverId: 42, escalatedToAdmin: false, pushAttempts: 1 },
      accepted(42)
    );
    expect(c.bothAccepted).toBe(true);
    expect(c.sameDriverChosen).toBe(true);
    expect(c.bothFailed).toBe(false);
    expect(c.onlyAgentAccepted).toBe(false);
    expect(c.onlyActualAccepted).toBe(false);
  });

  it('양쪽 성공 + 다른 기사 → bothAccepted, sameDriverChosen=false', () => {
    const c = compareToActual(
      { attemptedAcceptance: true, acceptedDriverId: 42, escalatedToAdmin: false, pushAttempts: 1 },
      accepted(99)
    );
    expect(c.bothAccepted).toBe(true);
    expect(c.sameDriverChosen).toBe(false);
  });

  it('양쪽 실패 → bothFailed', () => {
    const c = compareToActual(
      { attemptedAcceptance: false, escalatedToAdmin: true, pushAttempts: 3 },
      failed
    );
    expect(c.bothFailed).toBe(true);
    expect(c.bothAccepted).toBe(false);
  });

  it('에이전트만 성공 → onlyAgentAccepted', () => {
    const c = compareToActual(
      { attemptedAcceptance: true, acceptedDriverId: 7, escalatedToAdmin: false, pushAttempts: 1 },
      failed
    );
    expect(c.onlyAgentAccepted).toBe(true);
    expect(c.onlyActualAccepted).toBe(false);
  });

  it('실제만 성공 → onlyActualAccepted', () => {
    const c = compareToActual(
      { attemptedAcceptance: false, escalatedToAdmin: true, pushAttempts: 5 },
      accepted(11)
    );
    expect(c.onlyActualAccepted).toBe(true);
    expect(c.onlyAgentAccepted).toBe(false);
  });
});

// ─────────────────────────────────────────────
// SimulationRunner.runScenario / backtest
// ─────────────────────────────────────────────

describe('SimulationRunner.runScenario', () => {
  it('성공 시나리오 → ScenarioResult 반환', async () => {
    const agent = makeMockAgent(async () =>
      mockResult({
        toolCalls: [
          toolCall('get_drop_context', { dropId: 100 }, { timing: { urgency: 'CRITICAL' } }),
          toolCall('record_acceptance', { dropId: 100, driverId: 7 }),
        ],
      })
    );
    const runner = new SimulationRunner(agent);

    const result = await runner.runScenario(baseScenario);

    expect(result.scenarioId).toBe('test-1');
    expect(result.error).toBeUndefined();
    expect(result.decision.attemptedAcceptance).toBe(true);
    expect(result.decision.acceptedDriverId).toBe(7);
    expect(result.decision.recognizedUrgency).toBe('CRITICAL');
  });

  it('agent.run 이 throw → ScenarioResult 에 error 기록, throw 안 함', async () => {
    const agent = makeMockAgent(async () => {
      throw new Error('Anthropic API timeout');
    });
    const runner = new SimulationRunner(agent);

    const result = await runner.runScenario(baseScenario);

    expect(result.error).toBe('Anthropic API timeout');
    expect(result.agentResult.status).toBe('FAILED');
  });

  it('agent.run 호출 시 isSimulation=true 와 virtualNow 가 전달', async () => {
    const runMock = jest.fn().mockResolvedValue(mockResult());
    const agent = { run: runMock } as unknown as BaseAgent;
    const runner = new SimulationRunner(agent);

    await runner.runScenario(baseScenario);

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        triggerType: 'simulation',
        triggerRefId: 100,
        isSimulation: true,
        virtualNow: baseScenario.virtualNow,
      })
    );
  });

  it('actualOutcome 이 있으면 comparison 생성', async () => {
    const agent = makeMockAgent(async () =>
      mockResult({
        toolCalls: [
          toolCall('record_acceptance', { dropId: 100, driverId: 7 }),
        ],
      })
    );
    const runner = new SimulationRunner(agent);

    const result = await runner.runScenario({
      ...baseScenario,
      actualOutcome: { accepted: true, acceptedByDriverId: 7 },
    });

    expect(result.comparison).toBeDefined();
    expect(result.comparison?.bothAccepted).toBe(true);
    expect(result.comparison?.sameDriverChosen).toBe(true);
  });

  it('actualOutcome 없으면 comparison 미생성', async () => {
    const agent = makeMockAgent(async () => mockResult());
    const runner = new SimulationRunner(agent);

    const result = await runner.runScenario(baseScenario);
    expect(result.comparison).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// SimulationRunner.backtest (집계)
// ─────────────────────────────────────────────

describe('SimulationRunner.backtest', () => {
  function makeScenarios(count: number): DropScenario[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `s-${i}`,
      companyId: 1,
      dropId: 100 + i,
      virtualNow: new Date('2026-04-10T08:00:00Z'),
      actualOutcome: { accepted: i % 2 === 0, acceptedByDriverId: i % 2 === 0 ? i : undefined },
    }));
  }

  it('수락률 100% → meetsLaunchCriteria=true', async () => {
    const agent = makeMockAgent(async (input: unknown) => {
      const i = (input as { triggerRefId: number }).triggerRefId - 100;
      return mockResult({
        toolCalls: [toolCall('record_acceptance', { dropId: 100 + i, driverId: i })],
      });
    });
    const runner = new SimulationRunner(agent);

    const report = await runner.backtest(makeScenarios(10));

    expect(report.totalScenarios).toBe(10);
    expect(report.successfullyExecuted).toBe(10);
    expect(report.agentAcceptanceRate).toBe(1);
    expect(report.meetsLaunchCriteria).toBe(true);
    expect(report.launchCriteriaFailures).toEqual([]);
  });

  it('수락률 50% → meetsLaunchCriteria=false (< 70% 임계값)', async () => {
    let i = 0;
    const agent = makeMockAgent(async () => {
      const calls = i++ % 2 === 0 ? [toolCall('record_acceptance', { driverId: 1 })] : [];
      return mockResult({ toolCalls: calls });
    });
    const runner = new SimulationRunner(agent);

    const report = await runner.backtest(makeScenarios(10));

    expect(report.agentAcceptanceRate).toBe(0.5);
    expect(report.meetsLaunchCriteria).toBe(false);
    expect(report.launchCriteriaFailures[0]).toMatch(/수락률 50.*임계값 70/);
  });

  it('비용 폭증 → 비용 상한 미달로 표시', async () => {
    const agent = makeMockAgent(async () =>
      mockResult({
        costKrw: 500, // 시나리오당 ₩500 (상한 200원 초과)
        toolCalls: [toolCall('record_acceptance', { driverId: 1 })],
      })
    );
    const runner = new SimulationRunner(agent);

    const report = await runner.backtest(makeScenarios(5));

    expect(report.avgCostKrwPerScenario).toBe(500);
    expect(report.meetsLaunchCriteria).toBe(false);
    expect(report.launchCriteriaFailures.some((f) => f.includes('비용'))).toBe(true);
  });

  it('실패율 6% (1/16) → 안정성 미달', async () => {
    let i = 0;
    const agent = makeMockAgent(async () => {
      i++;
      if (i === 1) throw new Error('boom');
      return mockResult({ toolCalls: [toolCall('record_acceptance', { driverId: 1 })] });
    });
    const runner = new SimulationRunner(agent);

    const report = await runner.backtest(makeScenarios(16));

    expect(report.failed).toBe(1);
    expect(report.meetsLaunchCriteria).toBe(false);
    expect(report.launchCriteriaFailures.some((f) => f.includes('실행 실패율'))).toBe(true);
  });

  it('일치율 계산: 양쪽 다 성공/실패 케이스만 일치로 카운트', async () => {
    // 시나리오 4개: i=0,2 → actual accepted; i=1,3 → actual failed
    // 에이전트는 모두 수락 시도 → 일치율: 0,2 일치(both accepted), 1,3 불일치(only agent)
    const agent = makeMockAgent(async () =>
      mockResult({
        toolCalls: [toolCall('record_acceptance', { driverId: 0 })],
      })
    );
    const runner = new SimulationRunner(agent);

    const report = await runner.backtest(makeScenarios(4));

    expect(report.outcomeAgreementRate).toBe(0.5); // 2/4
  });

  it('긴급도 분포 집계', async () => {
    const urgencies = ['CRITICAL', 'CRITICAL', 'HIGH', 'NORMAL', 'NORMAL', 'NORMAL'];
    let i = 0;
    const agent = makeMockAgent(async () =>
      mockResult({
        toolCalls: [
          toolCall('get_drop_context', {}, { timing: { urgency: urgencies[i++] } }),
          toolCall('record_acceptance', { driverId: 1 }),
        ],
      })
    );
    const runner = new SimulationRunner(agent);

    const report = await runner.backtest(makeScenarios(6));

    expect(report.urgencyDistribution).toEqual({
      CRITICAL: 2,
      HIGH: 1,
      NORMAL: 3,
    });
  });

  it('빈 시나리오 배열 → 0 통계', async () => {
    const agent = makeMockAgent(async () => mockResult());
    const runner = new SimulationRunner(agent);
    const report = await runner.backtest([]);
    expect(report.totalScenarios).toBe(0);
    expect(report.agentAcceptanceRate).toBe(0);
  });

  it('커스텀 임계값 적용', async () => {
    const agent = makeMockAgent(async () =>
      mockResult({
        toolCalls: [toolCall('record_acceptance', { driverId: 1 })],
      })
    );
    // 임계값 100% — 1건이라도 빠지면 미달
    const runner = new SimulationRunner(agent, {
      acceptanceRateThreshold: 1.0,
      costPerScenarioCeiling: 1000,
    });

    let i = 0;
    const agent2 = makeMockAgent(async () => {
      const calls = ++i <= 9 ? [toolCall('record_acceptance', { driverId: 1 })] : [];
      return mockResult({ toolCalls: calls });
    });
    const runner2 = new SimulationRunner(agent2, { acceptanceRateThreshold: 1.0 });

    const report = await runner2.backtest(makeScenarios(10));
    expect(report.agentAcceptanceRate).toBe(0.9);
    expect(report.meetsLaunchCriteria).toBe(false);

    // sanity check: 100% 통과 케이스
    const report100 = await runner.backtest(makeScenarios(3));
    expect(report100.meetsLaunchCriteria).toBe(true);
  });
});

// ─────────────────────────────────────────────
// formatBacktestReport
// ─────────────────────────────────────────────

describe('formatBacktestReport', () => {
  it('출력에 핵심 메트릭이 모두 포함', async () => {
    const agent = makeMockAgent(async () =>
      mockResult({
        toolCalls: [
          toolCall('get_drop_context', {}, { timing: { urgency: 'CRITICAL' } }),
          toolCall('record_acceptance', { driverId: 1 }),
        ],
      })
    );
    const runner = new SimulationRunner(agent);

    const report = await runner.backtest([
      {
        id: 's-1',
        companyId: 1,
        dropId: 1,
        virtualNow: new Date(),
        actualOutcome: { accepted: true, acceptedByDriverId: 1 },
      },
    ]);

    const formatted = formatBacktestReport(report);

    expect(formatted).toContain('백테스트 보고서');
    expect(formatted).toContain('수락률');
    expect(formatted).toContain('일치율');
    expect(formatted).toContain('CRITICAL');
    expect(formatted).toContain('출시 가능');
  });

  it('미달 시 ❌ + 사유 표시', async () => {
    const agent = makeMockAgent(async () => mockResult({ toolCalls: [] }));
    const runner = new SimulationRunner(agent);

    const report = await runner.backtest([
      { id: 's-1', companyId: 1, dropId: 1, virtualNow: new Date() },
    ]);

    const formatted = formatBacktestReport(report);
    expect(formatted).toContain('❌');
    expect(formatted).toContain('수락률');
  });
});
