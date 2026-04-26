/**
 * DispatchAgent 백테스트 러너.
 *
 * EmergencyAgent 의 SimulationRunner 와 분리한 이유: 측정 메트릭이 완전히 다르다.
 *
 * EmergencyAgent 메트릭:
 *   - 수락률, 수락까지 분, 푸시 횟수, 일치율
 *
 * DispatchAgent 메트릭:
 *   - 공정성 점수 개선 (before vs after)
 *   - 노조 규칙 위반 감소
 *   - PENDING 휴무 처리율
 *   - publish_schedule 호출 여부 (배차 작업 완료 시그널)
 *   - modify_slot/swap_drivers 호출 횟수
 *   - Constitutional 위반 거부 횟수 (자가 학습 능력)
 *
 * PHASE 2 출시 기준:
 *   - 공정성 개선 ≥ 20점 또는 점수 ≥ 80
 *   - 노조 규칙 위반 0건
 *   - PENDING 휴무 100% 처리
 *   - publish_schedule 호출됨
 *   - 시나리오당 비용 ≤ ₩500
 *   - 실패율 < 5%
 */

import logger from '../../utils/logger';
import type { AgentLike, AgentRunResult, ToolCallRecord } from './types';
import {
  type DispatchScenarioFixture,
  measureFinalState,
} from './dispatch-scenario-generator';

// ─────────────────────────────────────────────
// 결과 타입
// ─────────────────────────────────────────────

export interface DispatchAgentSummary {
  /** draft_monthly_schedule 호출 여부 */
  draftCalled: boolean;
  /** modify_slot 호출 횟수 */
  modifySlotCount: number;
  /** swap_drivers 호출 횟수 */
  swapDriversCount: number;
  /** approve_dayoff 호출 횟수 */
  approveDayoffCount: number;
  /** reject_dayoff 호출 횟수 */
  rejectDayoffCount: number;
  /** detect_constraint_violation 호출 여부 */
  detectViolationCalled: boolean;
  /** publish_schedule 호출 여부 (작업 완료 시그널) */
  publishCalled: boolean;
  /** request_human_review 호출 여부 */
  humanReviewRequested: boolean;
  /** Constitutional 거부 횟수 (도구 에러 중 'Constitutional 위반' 메시지) */
  constitutionalRejections: number;
}

export interface DispatchScenarioResult {
  scenarioId: string;
  agentResult: AgentRunResult;
  summary: DispatchAgentSummary;
  baseline: DispatchScenarioFixture['baseline'];
  finalState: {
    fairnessScore: number;
    workStdev: number;
    outlierCount: number;
    ruleViolationCount: number;
    pendingDayoffCount: number;
  };
  improvements: {
    fairnessScoreDelta: number;
    workStdevReduction: number;
    outlierReduction: number;
    violationReduction: number;
    dayoffsProcessed: number;
  };
  /** PHASE 2 기준을 모두 충족하는지 */
  meetsCriteria: boolean;
  /** 미달 사유 */
  failures: string[];
  error?: string;
}

export interface DispatchBacktestReport {
  totalScenarios: number;
  successfullyExecuted: number;
  failed: number;
  /** 시나리오 평균 메트릭 */
  avg: {
    fairnessScoreImprovement: number;
    violationReduction: number;
    dayoffProcessingRate: number;
    publishCallRate: number;
    tokensPerScenario: number;
    costKrwPerScenario: number;
    toolCallsPerScenario: number;
  };
  /** PHASE 2 출시 기준 충족 시나리오 비율 */
  passingScenarioRate: number;
  meetsLaunchCriteria: boolean;
  launchCriteriaFailures: string[];
  scenarios: DispatchScenarioResult[];
}

// ─────────────────────────────────────────────
// 도구 호출 분석
// ─────────────────────────────────────────────

export function summarizeDispatchToolCalls(toolCalls: ToolCallRecord[]): DispatchAgentSummary {
  const summary: DispatchAgentSummary = {
    draftCalled: false,
    modifySlotCount: 0,
    swapDriversCount: 0,
    approveDayoffCount: 0,
    rejectDayoffCount: 0,
    detectViolationCalled: false,
    publishCalled: false,
    humanReviewRequested: false,
    constitutionalRejections: 0,
  };

  for (const call of toolCalls) {
    // Constitutional 거부는 모델 입장에서는 에러로 표시되지만 학습 신호로 카운트
    if (call.error && call.error.includes('Constitutional')) {
      summary.constitutionalRejections++;
      continue;
    }
    if (call.error) continue;

    switch (call.tool) {
      case 'draft_monthly_schedule':
        summary.draftCalled = true;
        break;
      case 'modify_slot':
        summary.modifySlotCount++;
        break;
      case 'swap_drivers':
        summary.swapDriversCount++;
        break;
      case 'approve_dayoff':
        summary.approveDayoffCount++;
        break;
      case 'reject_dayoff':
        summary.rejectDayoffCount++;
        break;
      case 'detect_constraint_violation':
        summary.detectViolationCalled = true;
        break;
      case 'publish_schedule':
        summary.publishCalled = true;
        break;
      case 'request_human_review':
        summary.humanReviewRequested = true;
        break;
    }
  }

  return summary;
}

// ─────────────────────────────────────────────
// 단일 시나리오 평가
// ─────────────────────────────────────────────

export interface DispatchScenarioCriteria {
  /** 최소 fairness 점수 (또는 최소 개선 폭) */
  minFairnessScore?: number;
  minFairnessImprovement?: number;
  /** 종료 시 노조 규칙 위반이 0 이어야 하는지 */
  requireZeroViolations?: boolean;
  /** PENDING 휴무 100% 처리해야 하는지 */
  requireAllDayoffsProcessed?: boolean;
  /** publish_schedule 호출 필수 */
  requirePublishCall?: boolean;
  /** 시나리오당 최대 비용 (KRW) */
  maxCostKrw?: number;
}

const DEFAULT_CRITERIA: Required<DispatchScenarioCriteria> = {
  minFairnessScore: 80,
  minFairnessImprovement: 20,
  requireZeroViolations: true,
  requireAllDayoffsProcessed: true,
  requirePublishCall: true,
  maxCostKrw: 500,
};

export function evaluateScenario(
  baseline: DispatchScenarioFixture['baseline'],
  finalState: DispatchScenarioResult['finalState'],
  summary: DispatchAgentSummary,
  result: AgentRunResult,
  criteriaInput: DispatchScenarioCriteria = {}
): { meetsCriteria: boolean; failures: string[] } {
  const criteria = { ...DEFAULT_CRITERIA, ...criteriaInput };
  const failures: string[] = [];

  const fairnessImprovement = finalState.fairnessScore - baseline.fairnessScore;
  if (
    finalState.fairnessScore < criteria.minFairnessScore &&
    fairnessImprovement < criteria.minFairnessImprovement
  ) {
    failures.push(
      `공정성 ${finalState.fairnessScore} (개선 ${fairnessImprovement >= 0 ? '+' : ''}${fairnessImprovement}) ` +
        `→ 목표: 점수 ≥${criteria.minFairnessScore} 또는 개선 ≥${criteria.minFairnessImprovement}`
    );
  }

  if (criteria.requireZeroViolations && finalState.ruleViolationCount > 0) {
    failures.push(`노조 규칙 위반 ${finalState.ruleViolationCount}건 잔존 (목표 0)`);
  }

  if (criteria.requireAllDayoffsProcessed && finalState.pendingDayoffCount > 0) {
    failures.push(
      `PENDING 휴무 ${finalState.pendingDayoffCount}건 미처리 (시작 ${baseline.pendingDayoffCount}건)`
    );
  }

  if (criteria.requirePublishCall && !summary.publishCalled) {
    failures.push('publish_schedule 미호출 (배차 작업 미완료)');
  }

  if (result.costKrw > criteria.maxCostKrw) {
    failures.push(`비용 ₩${result.costKrw.toFixed(2)} > 한도 ₩${criteria.maxCostKrw}`);
  }

  return { meetsCriteria: failures.length === 0, failures };
}

// ─────────────────────────────────────────────
// DispatchSimulationRunner
// ─────────────────────────────────────────────

export interface DispatchSimulationConfig {
  /** PHASE 2 출시 기준 — 통과 시나리오 비율 임계값 (기본 0.7) */
  passingRateThreshold?: number;
  /** 시나리오당 최대 비용 (기본 500원) */
  costPerScenarioCeiling?: number;
  /** 개별 시나리오 통과 기준 오버라이드 */
  scenarioCriteria?: DispatchScenarioCriteria;
}

export class DispatchSimulationRunner {
  private readonly passingRateThreshold: number;
  private readonly costPerScenarioCeiling: number;
  private readonly scenarioCriteria: DispatchScenarioCriteria;

  constructor(
    private readonly agent: AgentLike,
    config: DispatchSimulationConfig = {}
  ) {
    this.passingRateThreshold = config.passingRateThreshold ?? 0.7;
    this.costPerScenarioCeiling = config.costPerScenarioCeiling ?? 500;
    this.scenarioCriteria = {
      ...config.scenarioCriteria,
      maxCostKrw: config.costPerScenarioCeiling ?? config.scenarioCriteria?.maxCostKrw ?? 500,
    };
  }

  /**
   * 단일 DispatchAgent 시나리오 실행 + 평가.
   *
   * **중요**: 시뮬레이션 모드가 아니라 실제 모드로 실행한다 (DispatchAgent 의 modify_slot 등은
   * fixture DB 에 실제 변경을 가해야 fairness 개선이 측정됨). 단, 회사가 BT prefix 인 임시
   * 회사이므로 운영 데이터와 격리됨.
   */
  async runScenario(
    fixture: DispatchScenarioFixture,
    ruleTexts: string[]
  ): Promise<DispatchScenarioResult> {
    const scenarioId = `disp-${fixture.companyCode}-${fixture.scheduleId}`;

    let agentResult: AgentRunResult;

    try {
      agentResult = await this.agent.run({
        companyId: fixture.companyId,
        triggerType: 'simulation', // 회계 추적용 — DB 변경은 실제로 일어남
        triggerRefId: fixture.scheduleId,
        task: this.buildTaskMessage(fixture),
        // 의도적으로 isSimulation=false: DispatchAgent 의 효과를 측정하려면 실제 modify 필요
        isSimulation: false,
        sessionId: scenarioId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[DispatchSim] ${scenarioId} 실행 실패: ${msg}`);
      return this.failedResult(scenarioId, fixture, msg);
    }

    const summary = summarizeDispatchToolCalls(agentResult.toolCalls);
    const finalState = await measureFinalState(
      fixture.scheduleId,
      fixture.companyId,
      ruleTexts
    );

    const improvements = {
      fairnessScoreDelta: finalState.fairnessScore - fixture.baseline.fairnessScore,
      workStdevReduction: fixture.baseline.workStdev - finalState.workStdev,
      outlierReduction: fixture.baseline.outlierCount - finalState.outlierCount,
      violationReduction: fixture.baseline.ruleViolationCount - finalState.ruleViolationCount,
      dayoffsProcessed: fixture.baseline.pendingDayoffCount - finalState.pendingDayoffCount,
    };

    const evaluation = evaluateScenario(
      fixture.baseline,
      finalState,
      summary,
      agentResult,
      this.scenarioCriteria
    );

    return {
      scenarioId,
      agentResult,
      summary,
      baseline: fixture.baseline,
      finalState,
      improvements,
      meetsCriteria: evaluation.meetsCriteria,
      failures: evaluation.failures,
    };
  }

  /**
   * 여러 시나리오 백테스트 → 종합 보고서.
   *
   * @param fixtures 미리 생성된 시나리오들
   * @param ruleTexts 각 시나리오에 동일하게 적용할 규칙 텍스트 (DispatchAgent 가 검증할 규칙)
   */
  async backtest(
    fixtures: DispatchScenarioFixture[],
    ruleTexts: string[]
  ): Promise<DispatchBacktestReport> {
    const results: DispatchScenarioResult[] = [];
    for (const fixture of fixtures) {
      results.push(await this.runScenario(fixture, ruleTexts));
    }
    return this.summarize(results);
  }

  // ─────────────────────────────────────────────

  private buildTaskMessage(fixture: DispatchScenarioFixture): string {
    return [
      `[배차 검토 작업]`,
      ``,
      `현재 회사에 다음 상황이 있습니다:`,
      `- 배차표 ID: ${fixture.scheduleId}`,
      `- 시작 공정성 점수: ${fixture.baseline.fairnessScore}/100 (목표: 80+)`,
      `- 시작 노조 규칙 위반: ${fixture.baseline.ruleViolationCount}건 (목표: 0)`,
      `- PENDING 휴무 신청: ${fixture.baseline.pendingDayoffCount}건 (모두 처리 필요)`,
      `- workDays 표준편차: ${fixture.baseline.workStdev.toFixed(2)}일 (목표: < 1.0)`,
      `- outliers: ${fixture.baseline.outlierCount}명`,
      ``,
      `당신의 작업:`,
      `1. get_drivers, get_routes, get_company_rules 로 컨텍스트 파악`,
      `2. get_dayoff_requests(status='PENDING') → approve_dayoff/reject_dayoff 로 모두 처리`,
      `3. detect_constraint_violation(${fixture.scheduleId}) 으로 노조 규칙 위반 식별`,
      `4. score_fairness(${fixture.scheduleId}) 로 outliers 식별`,
      `5. modify_slot 또는 swap_drivers 로 위반·outliers 개선`,
      `6. 재검증 후 충족하면 publish_schedule(${fixture.scheduleId}, "...") 호출하여 발행 요청`,
      ``,
      `회사 코드는 BT prefix 임시 백테스트 회사입니다 — 운영 데이터 영향 없음.`,
      `배차표는 DRAFT 상태이므로 modify_slot 이 자유롭게 가능합니다.`,
    ].join('\n');
  }

  private failedResult(
    scenarioId: string,
    fixture: DispatchScenarioFixture,
    error: string
  ): DispatchScenarioResult {
    return {
      scenarioId,
      agentResult: {
        decisionId: -1,
        sessionId: scenarioId,
        finalAction: '실행 실패',
        reasoning: error,
        status: 'FAILED',
        toolCalls: [],
        tokensIn: 0,
        tokensOut: 0,
        costKrw: 0,
        durationMs: 0,
        errorMessage: error,
      },
      summary: summarizeDispatchToolCalls([]),
      baseline: fixture.baseline,
      finalState: {
        fairnessScore: fixture.baseline.fairnessScore,
        workStdev: fixture.baseline.workStdev,
        outlierCount: fixture.baseline.outlierCount,
        ruleViolationCount: fixture.baseline.ruleViolationCount,
        pendingDayoffCount: fixture.baseline.pendingDayoffCount,
      },
      improvements: {
        fairnessScoreDelta: 0,
        workStdevReduction: 0,
        outlierReduction: 0,
        violationReduction: 0,
        dayoffsProcessed: 0,
      },
      meetsCriteria: false,
      failures: [`실행 실패: ${error}`],
      error,
    };
  }

  private summarize(results: DispatchScenarioResult[]): DispatchBacktestReport {
    const total = results.length;
    const failed = results.filter((r) => r.error || r.agentResult.status === 'FAILED').length;
    const succeeded = total - failed;

    const passing = results.filter((r) => r.meetsCriteria).length;
    const passingRate = total > 0 ? passing / total : 0;

    const sumFairness = results.reduce((s, r) => s + r.improvements.fairnessScoreDelta, 0);
    const sumViolationReduction = results.reduce((s, r) => s + r.improvements.violationReduction, 0);
    const sumDayoffsProcessed = results.reduce((s, r) => s + r.improvements.dayoffsProcessed, 0);
    const totalDayoffsAvailable = results.reduce(
      (s, r) => s + r.baseline.pendingDayoffCount,
      0
    );
    const publishCalls = results.filter((r) => r.summary.publishCalled).length;

    const totalTokens = results.reduce(
      (sum, r) => sum + r.agentResult.tokensIn + r.agentResult.tokensOut,
      0
    );
    const totalCost = results.reduce((sum, r) => sum + r.agentResult.costKrw, 0);
    const totalToolCalls = results.reduce((sum, r) => sum + r.agentResult.toolCalls.length, 0);

    const launchFailures: string[] = [];
    if (passingRate < this.passingRateThreshold) {
      launchFailures.push(
        `통과 시나리오 ${(passingRate * 100).toFixed(1)}% < 임계값 ${(this.passingRateThreshold * 100).toFixed(0)}%`
      );
    }
    if (failed > total * 0.05) {
      launchFailures.push(
        `실행 실패율 ${((failed / total) * 100).toFixed(1)}% > 5%`
      );
    }
    const avgCost = total > 0 ? totalCost / total : 0;
    if (avgCost > this.costPerScenarioCeiling) {
      launchFailures.push(
        `평균 비용 ₩${avgCost.toFixed(2)} > 상한 ₩${this.costPerScenarioCeiling}`
      );
    }

    return {
      totalScenarios: total,
      successfullyExecuted: succeeded,
      failed,
      avg: {
        fairnessScoreImprovement: total > 0 ? sumFairness / total : 0,
        violationReduction: total > 0 ? sumViolationReduction / total : 0,
        dayoffProcessingRate:
          totalDayoffsAvailable > 0 ? sumDayoffsProcessed / totalDayoffsAvailable : 0,
        publishCallRate: total > 0 ? publishCalls / total : 0,
        tokensPerScenario: total > 0 ? totalTokens / total : 0,
        costKrwPerScenario: avgCost,
        toolCallsPerScenario: total > 0 ? totalToolCalls / total : 0,
      },
      passingScenarioRate: passingRate,
      meetsLaunchCriteria: launchFailures.length === 0,
      launchCriteriaFailures: launchFailures,
      scenarios: results,
    };
  }
}

// ─────────────────────────────────────────────
// 보고서 포맷터
// ─────────────────────────────────────────────

export function formatDispatchBacktestReport(report: DispatchBacktestReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════');
  lines.push('  DispatchAgent 백테스트 보고서');
  lines.push('═══════════════════════════════════════');
  lines.push(`총 시나리오:        ${report.totalScenarios}`);
  lines.push(`성공 실행:          ${report.successfullyExecuted}`);
  lines.push(`실패:               ${report.failed}`);
  lines.push(`통과 시나리오 비율: ${(report.passingScenarioRate * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('▼ 평균 개선 효과');
  lines.push(`공정성 점수 +${report.avg.fairnessScoreImprovement.toFixed(1)}`);
  lines.push(`규칙 위반 감소 -${report.avg.violationReduction.toFixed(1)}`);
  lines.push(`휴무 처리율: ${(report.avg.dayoffProcessingRate * 100).toFixed(1)}%`);
  lines.push(`발행 요청률: ${(report.avg.publishCallRate * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('▼ 효율');
  lines.push(`평균 토큰/시나리오: ${report.avg.tokensPerScenario.toFixed(0)}`);
  lines.push(`평균 비용/시나리오: ₩${report.avg.costKrwPerScenario.toFixed(2)}`);
  lines.push(`평균 도구 호출 수:  ${report.avg.toolCallsPerScenario.toFixed(1)}`);
  lines.push('');
  lines.push('▼ 시나리오 상세 (상위 5개)');
  for (const s of report.scenarios.slice(0, 5)) {
    const tag = s.meetsCriteria ? '✅' : '❌';
    lines.push(
      `  ${tag} ${s.scenarioId}: 공정성 ${s.baseline.fairnessScore} → ${s.finalState.fairnessScore}, ` +
        `위반 ${s.baseline.ruleViolationCount} → ${s.finalState.ruleViolationCount}, ` +
        `휴무 ${s.improvements.dayoffsProcessed}/${s.baseline.pendingDayoffCount}, ` +
        `tools=${s.agentResult.toolCalls.length}`
    );
    if (!s.meetsCriteria && s.failures.length > 0) {
      for (const f of s.failures) lines.push(`     - ${f}`);
    }
  }
  lines.push('');
  lines.push('▼ PHASE 2 출시 기준');
  if (report.meetsLaunchCriteria) {
    lines.push('✅ 모든 기준 충족 — 출시 가능');
  } else {
    lines.push('❌ 미달 항목:');
    for (const f of report.launchCriteriaFailures) {
      lines.push(`  - ${f}`);
    }
  }
  lines.push('═══════════════════════════════════════');
  return lines.join('\n');
}
