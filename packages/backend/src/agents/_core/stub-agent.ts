/**
 * StubAgent — BaseAgent 와 동일한 인터페이스를 가지지만 Anthropic API 호출 없음.
 *
 * 용도:
 *   1. CI 백테스트 (smoke test) — API 키 없이 전체 파이프라인 검증
 *   2. 시나리오 생성기·SimulationRunner·DecisionLogger 통합 검증
 *   3. 도구 호출 흐름 단위 테스트 (예측 가능한 결정)
 *
 * 작동 방식:
 *   - 생성자에 "도구 호출 시퀀스" 를 리스트로 전달
 *   - run() 호출 시 시퀀스를 차례로 실행 → toolCalls 기록
 *   - 마지막에 합성 텍스트 응답 + AgentRunResult 반환
 *   - DecisionLogger 에도 정상 기록되어 BaseAgent 와 동일하게 동작
 *
 * BaseAgent 를 mock 할 수도 있지만, StubAgent 는 실제 도구를 호출하므로
 * 도구 → DB 변경 → fairness 측정 까지 end-to-end 파이프라인을 검증 가능.
 */

import { runWithCompany } from '../../utils/tenantContext';
import { ToolRegistry } from './tool-registry';
import { logDecision, buildResultFromDecision } from './decision-logger';
import type {
  AgentRunInput,
  AgentRunResult,
  ToolCallRecord,
  ToolContext,
} from './types';

// ─────────────────────────────────────────────
// 시나리오 정의
// ─────────────────────────────────────────────

/**
 * 정적 호출 — 고정된 args 로 도구 호출.
 */
export interface StaticToolCall {
  type: 'static';
  tool: string;
  args: Record<string, unknown>;
}

/**
 * 동적 호출 — 이전 호출 결과를 보고 args 를 동적으로 생성.
 * 이전 도구 호출 기록을 받아 다음 호출의 args 를 반환.
 *
 * 예: list_off_duty_drivers 결과에서 driverId 를 추출해 send_targeted_push 의 args 로 사용.
 */
export interface DynamicToolCall {
  type: 'dynamic';
  tool: string;
  argsBuilder: (priorResults: ToolCallRecord[]) => Record<string, unknown>;
  /** argsBuilder 가 throw 하면 (조건 미충족 등) 이 호출을 건너뜀 */
  skipOnError?: boolean;
}

export type StubToolCall = StaticToolCall | DynamicToolCall;

export interface StubAgentConfig {
  name: string;
  tools: ToolRegistry;
  /** 호출 시퀀스 — 순서대로 실행됨 */
  scriptedCalls: StubToolCall[];
  /** 최종 텍스트 응답 (기본: 자동 생성) */
  finalText?: string;
  /** 토큰 사용량 추정값 (회계용, 기본 0) */
  pretendTokensIn?: number;
  pretendTokensOut?: number;
}

// ─────────────────────────────────────────────
// StubAgent
// ─────────────────────────────────────────────

export class StubAgent {
  private readonly name: string;
  private readonly tools: ToolRegistry;
  private readonly scriptedCalls: StubToolCall[];
  private readonly finalText: string | undefined;
  private readonly pretendTokensIn: number;
  private readonly pretendTokensOut: number;

  constructor(config: StubAgentConfig) {
    this.name = config.name;
    this.tools = config.tools;
    this.scriptedCalls = config.scriptedCalls;
    this.finalText = config.finalText;
    this.pretendTokensIn = config.pretendTokensIn ?? 0;
    this.pretendTokensOut = config.pretendTokensOut ?? 0;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const sessionId = input.sessionId ?? `${this.name}-stub-${Date.now()}`;
    const isSimulation = input.isSimulation ?? false;
    const virtualNow = input.virtualNow ?? new Date();

    return runWithCompany(input.companyId, async () => {
      const startedAt = Date.now();
      const toolCalls: ToolCallRecord[] = [];
      let status: 'COMPLETED' | 'FAILED' | 'CANCELLED' = 'COMPLETED';
      let errorMessage: string | undefined;

      const ctx: ToolContext = {
        companyId: input.companyId,
        agentName: this.name,
        sessionId,
        isSimulation,
        virtualNow,
      };

      try {
        for (const scripted of this.scriptedCalls) {
          let args: Record<string, unknown>;
          try {
            if (scripted.type === 'static') {
              args = scripted.args;
            } else {
              args = scripted.argsBuilder(toolCalls);
            }
          } catch (err) {
            if (scripted.type === 'dynamic' && scripted.skipOnError) {
              continue;
            }
            throw err;
          }

          const callStart = Date.now();
          try {
            const result = await this.tools.invoke(scripted.tool, args, ctx);
            toolCalls.push({
              tool: scripted.tool,
              args,
              result,
              ts: new Date().toISOString(),
              durationMs: Date.now() - callStart,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toolCalls.push({
              tool: scripted.tool,
              args,
              error: msg,
              ts: new Date().toISOString(),
              durationMs: Date.now() - callStart,
            });
            // 도구 에러는 BaseAgent 와 동일하게 계속 진행 (모델이 다음 시도 가능한 것처럼)
          }
        }
      } catch (err) {
        status = 'FAILED';
        errorMessage = err instanceof Error ? err.message : String(err);
      }

      const durationMs = Date.now() - startedAt;
      const reasoning =
        this.finalText ??
        `[StubAgent] ${this.scriptedCalls.length}개 호출 완료. 성공: ${
          toolCalls.filter((c) => !c.error).length
        }, 실패: ${toolCalls.filter((c) => c.error).length}`;

      const finalAction = reasoning.split('\n')[0]?.slice(0, 200) ?? 'stub completed';

      const decisionId = await logDecision({
        companyId: input.companyId,
        agentName: this.name,
        sessionId,
        triggerType: input.triggerType,
        triggerRefId: input.triggerRefId,
        isSimulation,
        toolCalls,
        finalAction,
        reasoning,
        status,
        errorMessage,
        tokensIn: this.pretendTokensIn,
        tokensOut: this.pretendTokensOut,
        costKrw: 0,
        durationMs,
      });

      return buildResultFromDecision(decisionId, {
        sessionId,
        finalAction,
        reasoning,
        status,
        toolCalls,
        tokensIn: this.pretendTokensIn,
        tokensOut: this.pretendTokensOut,
        costKrw: 0,
        durationMs,
        errorMessage,
      });
    });
  }
}
