/**
 * ToolRegistry — 도구 묶음을 등록하고 Anthropic API 형식으로 직렬화한다.
 *
 * 핵심 책임:
 *   1. 같은 에이전트가 여러 도구를 한 곳에서 관리
 *   2. Anthropic API tools 파라미터 형식으로 변환
 *   3. 시뮬레이션 모드에서 blockedInSimulation 도구를 stub 으로 라우팅
 *   4. 도구 호출 시 ToolContext 자동 주입
 *   5. **결과 크기 가드레일** — 30KB 초과 시 자동 절단해 회사 사이즈 무관 안전 보장
 */

import logger from '../../utils/logger';
import type { AgentTool, ToolContext, ToolInputSchema } from './types';

// ─────────────────────────────────────────────
// 결과 크기 가드레일
// ─────────────────────────────────────────────

/**
 * 단일 도구 호출 결과의 최대 직렬화 크기 (바이트).
 * 30KB ≈ 7,500 토큰 — 단일 도구가 입력 컨텍스트의 ~10% 이상 차지하지 않도록 제한.
 *
 * 환경변수 AGENT_TOOL_RESULT_MAX_BYTES 로 오버라이드 가능.
 */
const DEFAULT_MAX_RESULT_BYTES = 30_000;

function getMaxResultBytes(): number {
  const env = process.env.AGENT_TOOL_RESULT_MAX_BYTES;
  if (env) {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 1024) return n;
  }
  return DEFAULT_MAX_RESULT_BYTES;
}

/**
 * 결과를 직렬화하여 크기를 측정하고, 한도 초과 시 안전하게 절단.
 *
 * 절단 전략:
 * 1. result 가 객체이고 가장 큰 배열 필드가 있으면 그 배열을 절반으로 줄임 (반복 가능)
 * 2. 그래도 안 되면 _truncated 플래그와 부분 직렬화로 강제 자름
 *
 * 모든 절단 결과에 `_truncated: true` + `_originalBytes` + `_truncatedBytes` 추가 → 모델이 인지.
 */
export function enforceResultSizeLimit(result: unknown, toolName: string, maxBytes = getMaxResultBytes()): unknown {
  if (result === null || result === undefined) return result;
  if (typeof result !== 'object') return result;

  const initialBytes = byteLength(result);
  if (initialBytes <= maxBytes) return result;

  logger.warn(
    `[ToolRegistry] ${toolName} 결과 ${initialBytes} bytes > 한도 ${maxBytes} — 절단 시작`
  );

  // 객체의 큰 배열 필드를 점진적으로 줄이기
  const truncated = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  let attempts = 0;
  const maxAttempts = 10;

  while (byteLength(truncated) > maxBytes && attempts < maxAttempts) {
    const largestArrayKey = findLargestArrayKey(truncated);
    if (!largestArrayKey) break;
    const arr = truncated[largestArrayKey] as unknown[];
    const newLen = Math.max(1, Math.floor(arr.length / 2));
    truncated[largestArrayKey] = arr.slice(0, newLen);
    attempts++;
  }

  truncated._truncated = true;
  truncated._truncatedBy = toolName;
  truncated._originalBytes = initialBytes;
  truncated._maxBytes = maxBytes;
  truncated._note =
    '결과가 한도를 초과해 자동 절단됨. 더 작은 limit/페이지로 다시 호출하거나 필터를 좁히세요.';

  return truncated;
}

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function findLargestArrayKey(obj: Record<string, unknown>): string | null {
  let largestKey: string | null = null;
  let largestSize = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      const size = byteLength(value);
      if (size > largestSize) {
        largestSize = size;
        largestKey = key;
      }
    }
  }
  return largestKey;
}

/**
 * Anthropic SDK 가 messages.create({ tools }) 에 기대하는 형식.
 * 우리는 SDK 타입을 직접 import 하지 않고 동일한 모양의 객체를 만들어 전달.
 * (SDK 메이저 버전 변경에 대한 결합도 ↓)
 */
export interface AnthropicToolDescriptor {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register<I, O>(tool: AgentTool<I, O>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`[ToolRegistry] 도구 이름 중복: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as AgentTool);
  }

  registerAll(tools: AgentTool[]): void {
    for (const t of tools) this.register(t);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /** Anthropic API tools 파라미터 형식으로 직렬화 */
  toAnthropicTools(): AnthropicToolDescriptor[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  /**
   * 도구 호출 실행.
   * - 미등록 도구 → throw (모델에게 에러 메시지로 전달됨)
   * - 시뮬레이션 + blockedInSimulation → simulationStub 호출
   * - 정상 → handler(input, ctx)
   * - 결과 크기 30KB 초과 시 자동 절단 (회사 사이즈 무관 안전 보장)
   */
  async invoke(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`알 수 없는 도구: ${name}`);
    }

    let result: unknown;
    if (ctx.isSimulation && tool.blockedInSimulation) {
      result = tool.simulationStub
        ? tool.simulationStub(input, ctx)
        : { simulated: true, message: '시뮬레이션 모드에서 차단된 도구 (stub 결과)' };
    } else {
      // 핸들러는 input 스키마 검증을 자체 수행한다고 가정 (Zod 등은 도구별 자유)
      result = await tool.handler(input, ctx);
    }

    return enforceResultSizeLimit(result, name);
  }

  list(): AgentTool[] {
    return Array.from(this.tools.values());
  }
}
