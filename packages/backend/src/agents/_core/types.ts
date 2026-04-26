/**
 * 에이전트 시스템 공용 타입.
 *
 * 도메인 에이전트(DispatchAgent, EmergencyAgent 등)는 모두 이 타입 위에서 동작한다.
 * Anthropic SDK의 tool use API를 직접 사용하므로 별도 SDK 추상화 없이 가벼운 레이어.
 */

// ─────────────────────────────────────────────
// 도구 정의
// ─────────────────────────────────────────────

/**
 * Anthropic tool use API가 요구하는 JSON Schema 형식의 input_schema.
 * 단순 객체 스키마만 지원 (대부분의 도메인 도구에 충분).
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: readonly string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * 도구 호출 컨텍스트 — handler 가 실행될 때 받는 정보.
 * companyId 는 절대 클라이언트 인풋이 아니라 인증 컨텍스트에서 주입 (테넌트 격리).
 */
export interface ToolContext {
  companyId: number;
  agentName: string;
  sessionId: string;
  isSimulation: boolean;
  /** 시뮬레이션 모드일 때 "현재 시각"을 과거 시점으로 되감기 위한 가상 시계 */
  virtualNow: Date;
}

/**
 * 도구 정의 — 핸들러 + 메타.
 * Anthropic API에 노출되는 형식과 내부 실행 형식을 한 번에 표현.
 */
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  /** snake_case, 예: 'list_off_duty_drivers' */
  name: string;
  /** 자연어 설명 — 모델이 이 설명을 보고 언제 호출할지 결정 */
  description: string;
  inputSchema: ToolInputSchema;
  /** 실제 동작 함수. throw 하면 모델에게 에러 메시지가 자동 전달됨. */
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
  /**
   * Constitutional 검증이 필요한 쓰기 도구 표시.
   * true 인 도구는 BaseAgent 가 Constitutional Rule 검증을 통과해야만 실행 가능.
   */
  requiresConstitutionalCheck?: boolean;
  /**
   * 시뮬레이션 모드에서 실행을 차단할 도구 표시 (예: 실제 푸시 전송).
   * 시뮬레이션 시 stub 결과를 자동 생성.
   */
  blockedInSimulation?: boolean;
  /** 시뮬레이션 모드에서 stub 결과 (blockedInSimulation 일 때 필요) */
  simulationStub?: (input: TInput, ctx: ToolContext) => unknown;
}

// ─────────────────────────────────────────────
// 도구 호출 기록 (DB AgentDecision.toolCalls 에 저장)
// ─────────────────────────────────────────────

export interface ToolCallRecord {
  tool: string;
  args: unknown;
  result?: unknown;
  error?: string;
  ts: string;
  durationMs: number;
}

// ─────────────────────────────────────────────
// 에이전트 실행 입력·출력
// ─────────────────────────────────────────────

export type AgentTriggerType = 'cron' | 'event' | 'manual' | 'simulation';

export interface AgentRunInput {
  companyId: number;
  triggerType: AgentTriggerType;
  triggerRefId?: number;
  /** 에이전트에게 전달할 자연어 작업 설명 */
  task: string;
  /** 시뮬레이션 모드 (실제 외부 효과 없음, AgentDecision.isSimulation=true) */
  isSimulation?: boolean;
  /** 시뮬레이션 시 가상 "현재 시각" */
  virtualNow?: Date;
  /** 같은 의사결정 흐름에 묶고 싶을 때 (없으면 자동 생성) */
  sessionId?: string;
}

export interface AgentRunResult {
  decisionId: number;
  sessionId: string;
  finalAction: string;
  reasoning: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  toolCalls: ToolCallRecord[];
  tokensIn: number;
  tokensOut: number;
  costKrw: number;
  durationMs: number;
  errorMessage?: string;
}

/**
 * 에이전트 공통 인터페이스 — BaseAgent 와 StubAgent 모두 충족.
 * SimulationRunner·DispatchSimulationRunner 등이 이 타입으로 받아 mock·real 모두 지원.
 */
export interface AgentLike {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
