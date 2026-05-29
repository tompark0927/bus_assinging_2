/**
 * BaseAgent — Anthropic SDK 위의 얇은 도구 호출 루프.
 *
 * 책임:
 *   1. 도메인 에이전트(EmergencyAgent, DispatchAgent 등)가 상속해 system prompt + tools 만 정의
 *   2. messages.create → tool_use → tool_result → 다시 messages.create 루프
 *   3. 모든 도구 호출 결과를 ToolCallRecord 로 누적
 *   4. 토큰·비용·소요시간 측정
 *   5. 종료 시 DecisionLogger 에 영구 기록
 *
 * 상위 계층(컨트롤러·cron) 은 `agent.run({...})` 한 번 호출로 끝.
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from '../../utils/logger';
import { runWithCompany } from '../../utils/tenantContext';
import { ToolRegistry } from './tool-registry';
import { logDecision, buildResultFromDecision } from './decision-logger';
import { getEvolvedSystemPrompt } from './prompt-evolver';
import type {
  AgentRunInput,
  AgentRunResult,
  ToolCallRecord,
  ToolContext,
} from './types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_MODEL = process.env.AI_MODEL_AGENT || 'claude-opus-4-6';
const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_MAX_TOKENS = 4096;

// API 재시도 정책 (Anthropic 429 / 529 / 5xx / 네트워크 오류)
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 16000;
const BACKOFF_JITTER_MS = 250;

/**
 * 주어진 에러가 재시도 가능한지 판단.
 * - 429: rate limit
 * - 529: overloaded
 * - 500/502/503/504: 서버 오류
 * - 네트워크 끊김 (status 미정의)
 *
 * 401/403/400 등 클라이언트 오류는 재시도하지 않음 (영구 실패).
 */
function isRetryableApiError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; code?: string; message?: string };
  if (e.status !== undefined) {
    if (e.status === 429 || e.status === 529) return true;
    if (e.status >= 500 && e.status < 600) return true;
    return false; // 4xx (401/403/400 등) 는 재시도 불가
  }
  // 네트워크 오류 (status 없음) 는 메시지로 추정
  const msg = (e.message ?? '').toLowerCase();
  if (msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('enotfound')) {
    return true;
  }
  return false;
}

function backoffDelay(attempt: number): number {
  // exponential: 1s, 2s, 4s, 8s, ... + jitter
  const base = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * BACKOFF_JITTER_MS);
  return base + jitter;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Opus 4.6 토큰 단가 (KRW 환산, 2026-04 기준 추정)
// $15 / 1M input, $75 / 1M output, USD/KRW ≈ 1350
const OPUS_INPUT_KRW_PER_TOKEN = (15 / 1_000_000) * 1350;
const OPUS_OUTPUT_KRW_PER_TOKEN = (75 / 1_000_000) * 1350;

export interface BaseAgentConfig {
  /** 에이전트 식별자 (DB AgentDecision.agentName) */
  name: string;
  /** 시스템 프롬프트 — 에이전트 정체성·작업 원칙·금지사항 */
  systemPrompt: string;
  /** 도구 레지스트리 — 서브클래스가 구성한 도구 목록 */
  tools: ToolRegistry;
  /** 사용 모델 (생략 시 환경 변수 또는 기본값) */
  model?: string;
  /** 도구 호출 루프 최대 반복 수 (무한 루프 방지) */
  maxIterations?: number;
  /** 응답 한 번당 max_tokens */
  maxTokens?: number;
}

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicContentBlock = Anthropic.ContentBlock;
type ToolUseBlock = Extract<AnthropicContentBlock, { type: 'tool_use' }>;
type TextBlock = Extract<AnthropicContentBlock, { type: 'text' }>;

export class BaseAgent {
  protected readonly name: string;
  protected readonly systemPrompt: string;
  protected readonly tools: ToolRegistry;
  protected readonly model: string;
  protected readonly maxIterations: number;
  protected readonly maxTokens: number;

  constructor(config: BaseAgentConfig) {
    this.name = config.name;
    this.systemPrompt = config.systemPrompt;
    this.tools = config.tools;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  /**
   * 에이전트 실행. 단일 진입점.
   *
   * 항상 tenantContext (runWithCompany) 안에서 실행되도록 감싼다 — 모든 Prisma
   * 쿼리에서 멀티테넌시 격리 미들웨어가 자동으로 동작.
   */
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const sessionId = input.sessionId ?? this.generateSessionId();
    const isSimulation = input.isSimulation ?? false;
    const virtualNow = input.virtualNow ?? new Date();

    return runWithCompany(input.companyId, async () => {
      const startedAt = Date.now();
      const toolCalls: ToolCallRecord[] = [];
      let tokensIn = 0;
      let tokensOut = 0;

      const ctx: ToolContext = {
        companyId: input.companyId,
        agentName: this.name,
        sessionId,
        isSimulation,
        virtualNow,
      };

      const messages: AnthropicMessage[] = [
        { role: 'user', content: this.buildInitialUserMessage(input) },
      ];

      let finalText = '';
      let status: 'COMPLETED' | 'FAILED' | 'CANCELLED' = 'COMPLETED';
      let errorMessage: string | undefined;

      // PromptEvolver: 최근 인간 거부 패턴을 시스템 프롬프트에 주입
      // 시뮬레이션 모드에서는 base prompt 만 사용 (백테스트의 결과가 학습 데이터에 영향 안 받게)
      const effectiveSystemPrompt = isSimulation
        ? this.systemPrompt
        : await getEvolvedSystemPrompt(this.systemPrompt, this.name, input.companyId);

      try {
        for (let iteration = 0; iteration < this.maxIterations; iteration++) {
          const response = await this.callWithRetry(() =>
            anthropic.messages.create({
              model: this.model,
              max_tokens: this.maxTokens,
              system: effectiveSystemPrompt,
              tools: this.tools.toAnthropicTools() as unknown as Anthropic.Tool[],
              messages,
            })
          );

          tokensIn += response.usage.input_tokens;
          tokensOut += response.usage.output_tokens;

          // 텍스트 블록 누적 (최종 reasoning 으로 사용)
          const textBlocks = response.content.filter((b): b is TextBlock => b.type === 'text');
          if (textBlocks.length > 0) {
            finalText = textBlocks.map((b) => b.text).join('\n');
          }

          // tool_use 블록이 없으면 종료
          const toolUseBlocks = response.content.filter(
            (b): b is ToolUseBlock => b.type === 'tool_use'
          );

          if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
            break;
          }

          // assistant 의 tool_use 블록을 messages 에 추가
          messages.push({ role: 'assistant', content: response.content });

          // 모든 tool_use 를 실행하고 결과를 한 번에 user 메시지로 묶어 전달
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of toolUseBlocks) {
            const recordStartedAt = Date.now();
            try {
              const result = await this.tools.invoke(block.name, block.input, ctx);
              toolCalls.push({
                tool: block.name,
                args: block.input,
                result,
                ts: new Date().toISOString(),
                durationMs: Date.now() - recordStartedAt,
              });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result ?? null),
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              toolCalls.push({
                tool: block.name,
                args: block.input,
                error: msg,
                ts: new Date().toISOString(),
                durationMs: Date.now() - recordStartedAt,
              });
              // 에러는 모델에게 전달 — 모델이 다른 접근 시도 가능
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `에러: ${msg}`,
                is_error: true,
              });
            }
          }

          messages.push({ role: 'user', content: toolResults });
        }

        if (!finalText) {
          finalText = '에이전트가 도구 호출을 완료했지만 최종 텍스트 응답을 생성하지 않았습니다.';
        }
      } catch (err) {
        status = 'FAILED';
        errorMessage = err instanceof Error ? err.message : String(err);
        logger.error(`[Agent:${this.name}] 실행 중 오류`, err);
        finalText = finalText || `에이전트 실행 실패: ${errorMessage}`;
      }

      const durationMs = Date.now() - startedAt;
      const costKrw = tokensIn * OPUS_INPUT_KRW_PER_TOKEN + tokensOut * OPUS_OUTPUT_KRW_PER_TOKEN;

      const finalAction = this.summarizeFinalAction(finalText, toolCalls);

      const decisionId = await logDecision({
        companyId: input.companyId,
        agentName: this.name,
        sessionId,
        triggerType: input.triggerType,
        triggerRefId: input.triggerRefId,
        isSimulation,
        toolCalls,
        finalAction,
        reasoning: finalText,
        status,
        errorMessage,
        tokensIn,
        tokensOut,
        costKrw,
        durationMs,
      });

      return buildResultFromDecision(decisionId, {
        sessionId,
        finalAction,
        reasoning: finalText,
        status,
        toolCalls,
        tokensIn,
        tokensOut,
        costKrw,
        durationMs,
        errorMessage,
      });
    });
  }

  /**
   * 모델에게 전달할 최초 user 메시지 구성. 서브클래스가 오버라이드 가능.
   * 기본 구현: task + 시뮬레이션 모드면 가상 시각 명시.
   */
  protected buildInitialUserMessage(input: AgentRunInput): string {
    const lines = [input.task];
    if (input.isSimulation) {
      lines.push('');
      lines.push(`[시뮬레이션 모드] 가상 현재 시각: ${(input.virtualNow ?? new Date()).toISOString()}`);
      lines.push('실제 외부 효과는 발생하지 않습니다. 모든 결정은 백테스트 분석용으로 기록됩니다.');
    }
    return lines.join('\n');
  }

  /**
   * 최종 텍스트와 도구 호출 기록에서 한 줄 요약 추출.
   * AgentDecision.finalAction 에 저장 — 관리자 UI 의 결정 목록에 표시될 한 줄.
   */
  protected summarizeFinalAction(finalText: string, toolCalls: ToolCallRecord[]): string {
    const firstLine = finalText.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
    if (firstLine.length > 0 && firstLine.length <= 200) return firstLine;
    if (firstLine.length > 200) return firstLine.slice(0, 197) + '...';
    if (toolCalls.length > 0) {
      const last = toolCalls[toolCalls.length - 1];
      return `도구 ${toolCalls.length}회 호출, 마지막: ${last.tool}`;
    }
    return '결정 없음';
  }

  private generateSessionId(): string {
    return `${this.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Anthropic API 호출 + 지수 백오프 재시도.
   *
   * 재시도 가능 에러 (429/529/5xx/네트워크) 만 재시도.
   * 4xx 클라이언트 에러 (401 등) 는 즉시 throw.
   * MAX_RETRIES 초과 시 마지막 에러를 throw.
   */
  protected async callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (!isRetryableApiError(err) || attempt === MAX_RETRIES) {
          throw err;
        }
        const delay = backoffDelay(attempt);
        const status = (err as { status?: number }).status ?? 'network';
        logger.warn(
          `[Agent:${this.name}] API 호출 실패 (attempt ${attempt + 1}/${MAX_RETRIES + 1}, status=${status}), ${delay}ms 후 재시도`
        );
        await sleep(delay);
      }
    }
    throw lastError;
  }
}
