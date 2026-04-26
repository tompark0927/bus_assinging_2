/**
 * BaseAgent 도구 호출 루프 단위 테스트.
 *
 * Anthropic SDK 와 DecisionLogger 를 jest.mock 으로 가짜 구현해
 * 네트워크·DB 없이 루프 동작을 검증한다.
 *
 * 검증 항목:
 *  1. 모델이 tool_use 를 한 번 반환 → 도구 실행 → 결과 전달 → 모델이 텍스트로 종료
 *  2. 도구 호출 결과가 toolCalls 배열에 누적
 *  3. 도구 throw 시 모델에게 is_error: true 로 전달, 루프는 계속
 *  4. maxIterations 도달 시 종료
 *  5. AgentDecision.isSimulation 플래그 전파
 */

import { ToolRegistry } from '../../agents/_core/tool-registry';
import type { AgentTool } from '../../agents/_core/types';

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

const loggedDecisions: unknown[] = [];
jest.mock('../../agents/_core/decision-logger', () => ({
  logDecision: jest.fn(async (input: unknown) => {
    loggedDecisions.push(input);
    return 999;
  }),
  buildResultFromDecision: jest.requireActual('../../agents/_core/decision-logger').buildResultFromDecision,
}));

// tenantContext 의 runWithCompany 는 단순히 콜백 실행만 (AsyncLocalStorage 우회)
jest.mock('../../utils/tenantContext', () => ({
  runWithCompany: <T>(_companyId: number, fn: () => T) => fn(),
  getCurrentCompanyId: () => 1,
  getCurrentUserId: () => undefined,
  TENANT_MODELS: new Set<string>(),
}));

// PromptEvolver: base prompt 를 그대로 반환 (DB 없이 동작)
jest.mock('../../agents/_core/prompt-evolver', () => ({
  getEvolvedSystemPrompt: jest.fn(async (base: string) => base),
  invalidatePromptCache: jest.fn(),
}));

import { BaseAgent } from '../../agents/_core/base-agent';

beforeEach(() => {
  mockCreate.mockReset();
  loggedDecisions.length = 0;
});

function makeAgent(tools: AgentTool[]): BaseAgent {
  const reg = new ToolRegistry();
  reg.registerAll(tools);
  return new BaseAgent({
    name: 'test_agent',
    systemPrompt: 'You are a test agent.',
    tools: reg,
    maxIterations: 5,
  });
}

function textResponse(text: string) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-6',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function toolUseResponse(toolName: string, toolInput: object, id = 'tu_1') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-6',
    content: [
      { type: 'text', text: '도구 호출 중...' },
      { type: 'tool_use', id, name: toolName, input: toolInput },
    ],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 10 },
  };
}

describe('BaseAgent — tool use loop', () => {
  it('도구 호출 없이 텍스트만 반환 → 1회 호출로 종료', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('완료했습니다.'));
    const agent = makeAgent([]);

    const result = await agent.run({
      companyId: 1,
      triggerType: 'manual',
      task: '아무것도 하지 마세요.',
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('COMPLETED');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.reasoning).toContain('완료');
    expect(result.tokensIn).toBe(10);
    expect(result.tokensOut).toBe(5);
    expect(loggedDecisions).toHaveLength(1);
  });

  it('도구 호출 1회 → 결과 전달 → 텍스트 종료', async () => {
    const echoTool: AgentTool = {
      name: 'echo',
      description: '입력을 그대로 반환',
      inputSchema: {
        type: 'object',
        properties: { msg: { type: 'string' } },
        required: ['msg'],
      },
      handler: async (input) => ({ echoed: input }),
    };

    mockCreate
      .mockResolvedValueOnce(toolUseResponse('echo', { msg: 'hello' }))
      .mockResolvedValueOnce(textResponse('echo 호출 완료.'));

    const agent = makeAgent([echoTool]);
    const result = await agent.run({
      companyId: 1,
      triggerType: 'event',
      task: 'echo 도구를 호출하세요.',
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe('echo');
    expect(result.toolCalls[0].args).toEqual({ msg: 'hello' });
    expect(result.toolCalls[0].result).toEqual({ echoed: { msg: 'hello' } });
    expect(result.toolCalls[0].error).toBeUndefined();
    expect(result.tokensIn).toBe(30); // 20 + 10
    expect(result.tokensOut).toBe(15); // 10 + 5
  });

  it('도구 throw → toolCalls 에 error 기록 + 루프 계속', async () => {
    const failTool: AgentTool = {
      name: 'fail',
      description: '항상 실패',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        throw new Error('의도된 실패');
      },
    };

    mockCreate
      .mockResolvedValueOnce(toolUseResponse('fail', {}))
      .mockResolvedValueOnce(textResponse('실패를 인지했습니다, 종료합니다.'));

    const agent = makeAgent([failTool]);
    const result = await agent.run({
      companyId: 1,
      triggerType: 'manual',
      task: '실패 도구 호출',
    });

    expect(result.status).toBe('COMPLETED'); // 도구 실패가 에이전트 실패는 아님
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].error).toBe('의도된 실패');
    expect(result.toolCalls[0].result).toBeUndefined();
  });

  it('알 수 없는 도구 호출 → ToolRegistry 에러가 모델에게 전달', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseResponse('ghost', {}))
      .mockResolvedValueOnce(textResponse('도구가 없어 종료.'));

    const agent = makeAgent([]);
    const result = await agent.run({
      companyId: 1,
      triggerType: 'manual',
      task: '존재하지 않는 도구 호출 시도',
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].error).toMatch(/알 수 없는 도구/);
  });

  it('maxIterations 도달 시 루프 종료 (도구 호출이 무한 반복되어도 멈춤)', async () => {
    const echoTool: AgentTool = {
      name: 'loop',
      description: '계속 호출됨',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ ok: true }),
    };

    // 5번 모두 tool_use 반환 → maxIterations(5) 에 의해 종료
    for (let i = 0; i < 5; i++) {
      mockCreate.mockResolvedValueOnce(toolUseResponse('loop', {}, `tu_${i}`));
    }

    const agent = makeAgent([echoTool]);
    const result = await agent.run({
      companyId: 1,
      triggerType: 'manual',
      task: '무한 루프 테스트',
    });

    expect(mockCreate).toHaveBeenCalledTimes(5);
    expect(result.toolCalls).toHaveLength(5);
    expect(result.status).toBe('COMPLETED');
  });

  it('isSimulation 플래그가 ToolContext + DecisionLogger 까지 전파', async () => {
    let receivedSim: boolean | null = null;
    const peekTool: AgentTool = {
      name: 'peek',
      description: '컨텍스트 확인',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input, ctx) => {
        receivedSim = ctx.isSimulation;
        return { sim: ctx.isSimulation };
      },
    };

    mockCreate
      .mockResolvedValueOnce(toolUseResponse('peek', {}))
      .mockResolvedValueOnce(textResponse('완료.'));

    const agent = makeAgent([peekTool]);
    await agent.run({
      companyId: 1,
      triggerType: 'simulation',
      task: '시뮬레이션',
      isSimulation: true,
      virtualNow: new Date('2025-06-15T10:00:00Z'),
    });

    expect(receivedSim).toBe(true);
    const logged = loggedDecisions[0] as { isSimulation: boolean };
    expect(logged.isSimulation).toBe(true);
  });

  it('SDK 자체가 throw → status=FAILED 로 기록되지만 결과는 반환', async () => {
    mockCreate.mockRejectedValueOnce(new Error('네트워크 다운'));

    const agent = makeAgent([]);
    const result = await agent.run({
      companyId: 1,
      triggerType: 'manual',
      task: '네트워크 실패 시뮬레이션',
    });

    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toBe('네트워크 다운');
    expect(loggedDecisions).toHaveLength(1);
  });

  describe('API 재시도 (지수 백오프)', () => {
    // setTimeout 을 가짜로 대체해 백오프 지연 실시간 대기 회피
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    async function flushPromisesAndTimers(): Promise<void> {
      // 백오프 지연 (1s, 2s, 4s) 을 한 번에 흘려보냄
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
        jest.runAllTimers();
      }
    }

    it('429 rate limit → 재시도 후 성공', async () => {
      const rateLimit = Object.assign(new Error('rate limited'), { status: 429 });
      mockCreate
        .mockRejectedValueOnce(rateLimit)
        .mockResolvedValueOnce(textResponse('재시도 후 성공'));

      const agent = makeAgent([]);
      const promise = agent.run({
        companyId: 1,
        triggerType: 'manual',
        task: 'retry test',
      });

      await flushPromisesAndTimers();
      const result = await promise;

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('COMPLETED');
      expect(result.reasoning).toContain('재시도');
    });

    it('529 overloaded → 재시도', async () => {
      const overloaded = Object.assign(new Error('overloaded'), { status: 529 });
      mockCreate
        .mockRejectedValueOnce(overloaded)
        .mockResolvedValueOnce(textResponse('ok'));

      const agent = makeAgent([]);
      const promise = agent.run({ companyId: 1, triggerType: 'manual', task: 't' });
      await flushPromisesAndTimers();
      const result = await promise;

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('COMPLETED');
    });

    it('503 server error → 재시도', async () => {
      const serverErr = Object.assign(new Error('service unavailable'), { status: 503 });
      mockCreate
        .mockRejectedValueOnce(serverErr)
        .mockResolvedValueOnce(textResponse('ok'));

      const agent = makeAgent([]);
      const promise = agent.run({ companyId: 1, triggerType: 'manual', task: 't' });
      await flushPromisesAndTimers();
      const result = await promise;

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('COMPLETED');
    });

    it('401 unauthorized → 재시도 안 함, 즉시 실패', async () => {
      const auth = Object.assign(new Error('invalid api key'), { status: 401 });
      mockCreate.mockRejectedValueOnce(auth);

      const agent = makeAgent([]);
      const promise = agent.run({ companyId: 1, triggerType: 'manual', task: 't' });
      await flushPromisesAndTimers();
      const result = await promise;

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('FAILED');
      expect(result.errorMessage).toBe('invalid api key');
    });

    it('400 bad request → 재시도 안 함', async () => {
      const bad = Object.assign(new Error('bad request'), { status: 400 });
      mockCreate.mockRejectedValueOnce(bad);

      const agent = makeAgent([]);
      const promise = agent.run({ companyId: 1, triggerType: 'manual', task: 't' });
      await flushPromisesAndTimers();
      const result = await promise;

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('FAILED');
    });

    it('재시도 4회 모두 실패 → status=FAILED', async () => {
      const rateLimit = Object.assign(new Error('rate limited'), { status: 429 });
      // MAX_RETRIES=3 → 총 4번 호출 (1 + 3 재시도)
      mockCreate
        .mockRejectedValueOnce(rateLimit)
        .mockRejectedValueOnce(rateLimit)
        .mockRejectedValueOnce(rateLimit)
        .mockRejectedValueOnce(rateLimit);

      const agent = makeAgent([]);
      const promise = agent.run({ companyId: 1, triggerType: 'manual', task: 't' });
      await flushPromisesAndTimers();
      const result = await promise;

      expect(mockCreate).toHaveBeenCalledTimes(4);
      expect(result.status).toBe('FAILED');
      expect(result.errorMessage).toContain('rate limited');
    });

    it('네트워크 ECONNRESET → 재시도', async () => {
      const netErr = new Error('socket hang up: ECONNRESET');
      mockCreate.mockRejectedValueOnce(netErr).mockResolvedValueOnce(textResponse('ok'));

      const agent = makeAgent([]);
      const promise = agent.run({ companyId: 1, triggerType: 'manual', task: 't' });
      await flushPromisesAndTimers();
      const result = await promise;

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('COMPLETED');
    });
  });
});
