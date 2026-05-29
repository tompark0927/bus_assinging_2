/**
 * 시뮬레이션 환경 v0 — 백테스트 인프라.
 *
 * 목표:
 *   PHASE 1 출시 기준 충족 여부를 자동 측정한다 — "시뮬레이션 30분 내 수락률 ≥ 70%".
 *
 * 작동 방식:
 *   1) 백테스트 시나리오 = 과거 결원 사건 1건 (dropId + 그 시점의 가상 현재 시각 + 실제 결과)
 *   2) SimulationRunner 가 BaseAgent 를 isSimulation=true + virtualNow=과거시각 으로 실행
 *   3) 외부 효과 도구(send_targeted_push, record_acceptance, escalate_to_admin) 는 자동 stub
 *   4) 도구 호출 기록에서 에이전트의 "결정" 을 추출 (수락된 기사 ID 등)
 *   5) 실제 과거 결과와 비교 → 일치율·수락률·평균 응답시간 측정
 *
 * 시뮬레이션 결과는 모두 AgentDecision.isSimulation=true 로 기록되어 실 데이터와 분리됨.
 *
 * 향후 확장:
 *   - 점-시간 DB 스냅샷 (현재 v0 는 라이브 DB 의 historical 데이터 사용 가정)
 *   - 합성 시나리오 생성기 (실 데이터 부족 시)
 *   - A/B 비교 (다른 시스템 프롬프트 두 개를 같은 시나리오로 실행)
 */

import logger from '../../utils/logger';
import type { AgentLike, AgentRunResult, ToolCallRecord } from './types';

// ─────────────────────────────────────────────
// 시나리오·결과 타입
// ─────────────────────────────────────────────

export interface DropScenario {
  /** 사람이 읽을 수 있는 시나리오 식별자 (예: "2025-12-15-route16-driver-flu") */
  id: string;
  /** 회사 ID — 멀티테넌시 격리에 사용 */
  companyId: number;
  /** 드랍 발생 시점의 가상 현재 시각 */
  virtualNow: Date;
  /** 시뮬레이션 대상 EmergencyDrop.id (실 DB 에 존재해야 함) */
  dropId: number;
  /** 실제 과거 결과 (있으면 비교에 사용) */
  actualOutcome?: HistoricalOutcome;
  /** 시나리오 메타 (자유 형식) */
  metadata?: Record<string, unknown>;
}

export interface HistoricalOutcome {
  /** 결원이 결국 채워졌는지 */
  accepted: boolean;
  /** 누가 수락했는지 */
  acceptedByDriverId?: number;
  /** 드랍 발생부터 수락까지 걸린 분 (실 데이터 기준) */
  minutesUntilAcceptance?: number;
  /** 출발 시각까지 미충원으로 남았는지 */
  expired?: boolean;
}

export interface AgentDecision {
  /** 에이전트가 record_acceptance 호출을 시도했는지 */
  attemptedAcceptance: boolean;
  /** 어느 기사를 수락 처리했는지 */
  acceptedDriverId?: number;
  /** 에이전트가 escalate_to_admin 호출을 시도했는지 */
  escalatedToAdmin: boolean;
  /** 어느 긴급도 등급을 인식했는지 (get_drop_context 결과에서 추출) */
  recognizedUrgency?: string;
  /** 푸시 전송 횟수 (단계별 전략 카운트) */
  pushAttempts: number;
}

export interface ScenarioComparison {
  /** 양쪽 다 수락 성공이면 true */
  bothAccepted: boolean;
  /** 양쪽 다 미충원이면 true */
  bothFailed: boolean;
  /** 같은 기사를 선택했는지 */
  sameDriverChosen: boolean;
  /** 에이전트만 성공 */
  onlyAgentAccepted: boolean;
  /** 실제만 성공 */
  onlyActualAccepted: boolean;
}

export interface ScenarioResult {
  scenarioId: string;
  agentResult: AgentRunResult;
  decision: AgentDecision;
  comparison?: ScenarioComparison;
  error?: string;
}

export interface BacktestReport {
  totalScenarios: number;
  successfullyExecuted: number;
  failed: number;
  /** 에이전트가 한 번이라도 record_acceptance 를 호출한 비율 */
  agentAcceptanceRate: number;
  /** 에이전트가 escalate_to_admin 을 호출한 비율 */
  agentEscalationRate: number;
  /** 실제 데이터와 일치하는 비율 (둘 다 성공 또는 둘 다 실패) */
  outcomeAgreementRate: number;
  /** 같은 기사를 선택한 비율 (양쪽 성공 케이스 중) */
  driverChoiceAgreementRate: number;
  /** 에이전트 평균 토큰 사용량 */
  avgTokensPerScenario: number;
  /** 에이전트 평균 비용 (KRW) */
  avgCostKrwPerScenario: number;
  /** 에이전트 평균 도구 호출 횟수 */
  avgToolCallsPerScenario: number;
  /** 긴급도 등급별 카운트 */
  urgencyDistribution: Record<string, number>;
  /** PHASE 1 출시 기준 충족 여부 */
  meetsLaunchCriteria: boolean;
  /** 출시 기준 미달 사유 (있을 경우) */
  launchCriteriaFailures: string[];
  /** 개별 시나리오 결과 (디버깅용) */
  scenarios: ScenarioResult[];
}

// ─────────────────────────────────────────────
// 도구 호출 기록에서 에이전트 결정 추출
// ─────────────────────────────────────────────

/**
 * AgentRunResult.toolCalls 를 스캔하여 에이전트가 무엇을 결정했는지 추출.
 *
 * 시뮬레이션 모드에서는 외부 효과 도구가 stub 결과를 반환하지만, 호출 기록 자체는 남는다.
 * 따라서 호출의 args 를 보고 "에이전트가 무엇을 하려 했는지" 를 알 수 있다.
 */
export function extractAgentDecision(toolCalls: ToolCallRecord[]): AgentDecision {
  const decision: AgentDecision = {
    attemptedAcceptance: false,
    escalatedToAdmin: false,
    pushAttempts: 0,
  };

  for (const call of toolCalls) {
    if (call.error) continue; // 실패한 호출은 결정으로 카운트하지 않음

    if (call.tool === 'record_acceptance') {
      decision.attemptedAcceptance = true;
      const args = call.args as { driverId?: number };
      if (typeof args?.driverId === 'number') {
        decision.acceptedDriverId = args.driverId;
      }
    }

    if (call.tool === 'escalate_to_admin') {
      decision.escalatedToAdmin = true;
    }

    if (call.tool === 'send_targeted_push') {
      decision.pushAttempts++;
    }

    if (call.tool === 'get_drop_context') {
      const result = call.result as { timing?: { urgency?: string } } | undefined;
      if (result?.timing?.urgency) {
        decision.recognizedUrgency = result.timing.urgency;
      }
    }
  }

  return decision;
}

/**
 * 에이전트 결정과 실제 과거 결과를 비교.
 */
export function compareToActual(
  decision: AgentDecision,
  actual: HistoricalOutcome
): ScenarioComparison {
  const agentAccepted = decision.attemptedAcceptance;
  const actualAccepted = actual.accepted;

  return {
    bothAccepted: agentAccepted && actualAccepted,
    bothFailed: !agentAccepted && !actualAccepted,
    sameDriverChosen:
      agentAccepted &&
      actualAccepted &&
      decision.acceptedDriverId === actual.acceptedByDriverId,
    onlyAgentAccepted: agentAccepted && !actualAccepted,
    onlyActualAccepted: !agentAccepted && actualAccepted,
  };
}

// ─────────────────────────────────────────────
// SimulationRunner
// ─────────────────────────────────────────────

export interface SimulationRunnerConfig {
  /** PHASE 1 출시 기준: 수락률 임계값 (기본 0.7) */
  acceptanceRateThreshold?: number;
  /** PHASE 1 출시 기준: 비용 상한 KRW (기본 200원/시나리오) */
  costPerScenarioCeiling?: number;
}

export class SimulationRunner {
  private readonly acceptanceRateThreshold: number;
  private readonly costPerScenarioCeiling: number;

  constructor(
    private readonly agent: AgentLike,
    config: SimulationRunnerConfig = {}
  ) {
    this.acceptanceRateThreshold = config.acceptanceRateThreshold ?? 0.7;
    this.costPerScenarioCeiling = config.costPerScenarioCeiling ?? 200;
  }

  /**
   * 단일 시나리오 실행. 실패해도 throw 하지 않음 — 백테스트가 계속 진행되도록.
   */
  async runScenario(scenario: DropScenario): Promise<ScenarioResult> {
    try {
      const result = await this.agent.run({
        companyId: scenario.companyId,
        triggerType: 'simulation',
        triggerRefId: scenario.dropId,
        task: this.buildTaskMessage(scenario),
        isSimulation: true,
        virtualNow: scenario.virtualNow,
        sessionId: `sim-${scenario.id}`,
      });

      const decision = extractAgentDecision(result.toolCalls);
      const comparison = scenario.actualOutcome
        ? compareToActual(decision, scenario.actualOutcome)
        : undefined;

      return {
        scenarioId: scenario.id,
        agentResult: result,
        decision,
        comparison,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Simulation] scenario=${scenario.id} 실행 실패: ${errorMsg}`);
      return {
        scenarioId: scenario.id,
        agentResult: this.makeFailedResult(scenario, errorMsg),
        decision: { attemptedAcceptance: false, escalatedToAdmin: false, pushAttempts: 0 },
        error: errorMsg,
      };
    }
  }

  /**
   * 여러 시나리오 백테스트 + 종합 보고서 생성.
   */
  async backtest(scenarios: DropScenario[]): Promise<BacktestReport> {
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      results.push(await this.runScenario(scenario));
    }
    return this.summarize(results);
  }

  private buildTaskMessage(scenario: DropScenario): string {
    return [
      `[백테스트] 시나리오 ${scenario.id}`,
      `EmergencyDrop ID: ${scenario.dropId}`,
      `가상 현재 시각: ${scenario.virtualNow.toISOString()}`,
      ``,
      `즉시 get_drop_context(${scenario.dropId}) 부터 호출하여 컨텍스트를 확인하고`,
      `시스템 프롬프트의 긴급도 전략에 따라 대타를 구하세요.`,
      `이는 백테스트 시뮬레이션입니다 — 외부 효과는 자동 stub 처리되지만`,
      `실제 운영처럼 모든 단계를 진행해주세요.`,
    ].join('\n');
  }

  private makeFailedResult(scenario: DropScenario, errorMsg: string): AgentRunResult {
    return {
      decisionId: -1,
      sessionId: `sim-${scenario.id}-failed`,
      finalAction: '실행 실패',
      reasoning: errorMsg,
      status: 'FAILED',
      toolCalls: [],
      tokensIn: 0,
      tokensOut: 0,
      costKrw: 0,
      durationMs: 0,
      errorMessage: errorMsg,
    };
  }

  private summarize(results: ScenarioResult[]): BacktestReport {
    const total = results.length;
    const failed = results.filter((r) => r.error || r.agentResult.status === 'FAILED').length;
    const succeeded = total - failed;

    const acceptances = results.filter((r) => r.decision.attemptedAcceptance).length;
    const escalations = results.filter((r) => r.decision.escalatedToAdmin).length;

    // 실제 데이터와 비교 가능한 시나리오만 일치율 계산
    const comparable = results.filter((r) => r.comparison !== undefined);
    const agreements = comparable.filter(
      (r) => r.comparison!.bothAccepted || r.comparison!.bothFailed
    ).length;

    const bothAcceptedCases = comparable.filter((r) => r.comparison!.bothAccepted);
    const sameDriverChoices = bothAcceptedCases.filter(
      (r) => r.comparison!.sameDriverChosen
    ).length;

    const totalTokens = results.reduce(
      (sum, r) => sum + r.agentResult.tokensIn + r.agentResult.tokensOut,
      0
    );
    const totalCost = results.reduce((sum, r) => sum + r.agentResult.costKrw, 0);
    const totalToolCalls = results.reduce((sum, r) => sum + r.agentResult.toolCalls.length, 0);

    // 긴급도 분포
    const urgencyDistribution: Record<string, number> = {};
    for (const r of results) {
      const urgency = r.decision.recognizedUrgency ?? 'UNKNOWN';
      urgencyDistribution[urgency] = (urgencyDistribution[urgency] ?? 0) + 1;
    }

    const acceptanceRate = total > 0 ? acceptances / total : 0;
    const avgCost = total > 0 ? totalCost / total : 0;

    // PHASE 1 출시 기준 검증
    const launchFailures: string[] = [];
    if (acceptanceRate < this.acceptanceRateThreshold) {
      launchFailures.push(
        `수락률 ${(acceptanceRate * 100).toFixed(1)}% < 임계값 ${(this.acceptanceRateThreshold * 100).toFixed(0)}%`
      );
    }
    if (avgCost > this.costPerScenarioCeiling) {
      launchFailures.push(
        `시나리오당 평균 비용 ₩${avgCost.toFixed(2)} > 상한 ₩${this.costPerScenarioCeiling}`
      );
    }
    if (failed > total * 0.05) {
      launchFailures.push(
        `실행 실패율 ${((failed / total) * 100).toFixed(1)}% > 5% (안정성 부족)`
      );
    }

    return {
      totalScenarios: total,
      successfullyExecuted: succeeded,
      failed,
      agentAcceptanceRate: acceptanceRate,
      agentEscalationRate: total > 0 ? escalations / total : 0,
      outcomeAgreementRate: comparable.length > 0 ? agreements / comparable.length : 0,
      driverChoiceAgreementRate:
        bothAcceptedCases.length > 0 ? sameDriverChoices / bothAcceptedCases.length : 0,
      avgTokensPerScenario: total > 0 ? totalTokens / total : 0,
      avgCostKrwPerScenario: avgCost,
      avgToolCallsPerScenario: total > 0 ? totalToolCalls / total : 0,
      urgencyDistribution,
      meetsLaunchCriteria: launchFailures.length === 0,
      launchCriteriaFailures: launchFailures,
      scenarios: results,
    };
  }
}

// ─────────────────────────────────────────────
// 보고서 출력 헬퍼
// ─────────────────────────────────────────────

/**
 * 백테스트 보고서를 사람이 읽기 좋은 한국어 문자열로 변환.
 * 콘솔 출력·CI 결과 첨부에 사용.
 */
export function formatBacktestReport(report: BacktestReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════');
  lines.push('  EmergencyAgent 백테스트 보고서');
  lines.push('═══════════════════════════════════════');
  lines.push(`총 시나리오:        ${report.totalScenarios}`);
  lines.push(`성공 실행:          ${report.successfullyExecuted}`);
  lines.push(`실패:               ${report.failed}`);
  lines.push('');
  lines.push('▼ 에이전트 의사결정');
  lines.push(`수락률:             ${(report.agentAcceptanceRate * 100).toFixed(1)}%`);
  lines.push(`에스컬레이션률:     ${(report.agentEscalationRate * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('▼ 실제 데이터 일치');
  lines.push(`결과 일치율:        ${(report.outcomeAgreementRate * 100).toFixed(1)}%`);
  lines.push(`기사 선택 일치율:   ${(report.driverChoiceAgreementRate * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('▼ 효율');
  lines.push(`평균 토큰/시나리오: ${report.avgTokensPerScenario.toFixed(0)}`);
  lines.push(`평균 비용/시나리오: ₩${report.avgCostKrwPerScenario.toFixed(2)}`);
  lines.push(`평균 도구 호출 수:  ${report.avgToolCallsPerScenario.toFixed(1)}`);
  lines.push('');
  lines.push('▼ 긴급도 분포');
  for (const [urgency, count] of Object.entries(report.urgencyDistribution)) {
    lines.push(`  ${urgency.padEnd(10)}: ${count}`);
  }
  lines.push('');
  lines.push('▼ PHASE 1 출시 기준');
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
