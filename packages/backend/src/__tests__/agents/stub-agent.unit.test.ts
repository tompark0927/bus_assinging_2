/**
 * StubAgent 단위 테스트.
 *
 * 검증 항목:
 *  1. 정적 호출 시퀀스 실행
 *  2. 동적 호출 (이전 결과 의존)
 *  3. 도구 에러는 toolCalls 에 기록되지만 진행 계속
 *  4. dynamic argsBuilder 가 throw + skipOnError → 건너뜀
 *  5. AgentLike 인터페이스 충족 (run() 시그니처)
 *  6. AgentRunResult 형식 + DecisionLogger 호출
 */

const loggedDecisions: unknown[] = [];

jest.mock('../../agents/_core/decision-logger', () => ({
  logDecision: jest.fn(async (input: unknown) => {
    loggedDecisions.push(input);
    return 555;
  }),
  buildResultFromDecision: jest.requireActual('../../agents/_core/decision-logger')
    .buildResultFromDecision,
}));

jest.mock('../../utils/tenantContext', () => ({
  runWithCompany: <T>(_id: number, fn: () => T) => fn(),
  getCurrentCompanyId: () => 1,
  getCurrentUserId: () => undefined,
  TENANT_MODELS: new Set<string>(),
}));

import { StubAgent } from '../../agents/_core/stub-agent';
import { ToolRegistry } from '../../agents/_core/tool-registry';
import type { AgentTool } from '../../agents/_core/types';

beforeEach(() => {
  loggedDecisions.length = 0;
});

function makeTool(
  name: string,
  handler: (input: unknown) => unknown
): AgentTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async (input) => handler(input),
  };
}

function makeRegistry(tools: AgentTool[]): ToolRegistry {
  const reg = new ToolRegistry();
  reg.registerAll(tools);
  return reg;
}

// ─────────────────────────────────────────────

describe('StubAgent', () => {
  it('정적 호출 시퀀스 실행', async () => {
    const calls: string[] = [];
    const tools = makeRegistry([
      makeTool('a', () => {
        calls.push('a');
        return { ok: 'a' };
      }),
      makeTool('b', () => {
        calls.push('b');
        return { ok: 'b' };
      }),
    ]);

    const agent = new StubAgent({
      name: 'test',
      tools,
      scriptedCalls: [
        { type: 'static', tool: 'a', args: { x: 1 } },
        { type: 'static', tool: 'b', args: { y: 2 } },
      ],
    });

    const result = await agent.run({
      companyId: 1,
      triggerType: 'manual',
      task: 'test',
    });

    expect(calls).toEqual(['a', 'b']);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].tool).toBe('a');
    expect(result.toolCalls[0].args).toEqual({ x: 1 });
    expect(result.toolCalls[0].result).toEqual({ ok: 'a' });
    expect(result.toolCalls[1].tool).toBe('b');
  });

  it('동적 호출: 이전 결과를 args 로 사용', async () => {
    const tools = makeRegistry([
      makeTool('first', () => ({ value: 42 })),
      makeTool('second', (input) => ({ received: input })),
    ]);

    const agent = new StubAgent({
      name: 'test',
      tools,
      scriptedCalls: [
        { type: 'static', tool: 'first', args: {} },
        {
          type: 'dynamic',
          tool: 'second',
          argsBuilder: (prior) => {
            const firstResult = prior[0].result as { value: number };
            return { passed: firstResult.value };
          },
        },
      ],
    });

    const result = await agent.run({
      companyId: 1,
      triggerType: 'manual',
      task: 'test',
    });

    expect(result.toolCalls[1].args).toEqual({ passed: 42 });
    expect(result.toolCalls[1].result).toEqual({ received: { passed: 42 } });
  });

  it('도구 에러 → toolCalls 에 error 기록 + 다음 호출 계속', async () => {
    const tools = makeRegistry([
      makeTool('boom', () => {
        throw new Error('의도된 실패');
      }),
      makeTool('after', () => ({ ok: true })),
    ]);

    const agent = new StubAgent({
      name: 'test',
      tools,
      scriptedCalls: [
        { type: 'static', tool: 'boom', args: {} },
        { type: 'static', tool: 'after', args: {} },
      ],
    });

    const result = await agent.run({
      companyId: 1,
      triggerType: 'manual',
      task: 'test',
    });

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].error).toBe('의도된 실패');
    expect(result.toolCalls[0].result).toBeUndefined();
    expect(result.toolCalls[1].result).toEqual({ ok: true });
    expect(result.status).toBe('COMPLETED');
  });

  it('dynamic argsBuilder throw + skipOnError=true → 호출 건너뜀', async () => {
    const tools = makeRegistry([
      makeTool('a', () => ({ ok: 'a' })),
      makeTool('skipped', () => ({ should: 'not be called' })),
      makeTool('after', () => ({ ok: 'after' })),
    ]);

    let skippedCalled = false;
    const agent = new StubAgent({
      name: 'test',
      tools: makeRegistry([
        makeTool('a', () => ({ ok: 'a' })),
        makeTool('skipped', () => {
          skippedCalled = true;
          return {};
        }),
        makeTool('after', () => ({ ok: 'after' })),
      ]),
      scriptedCalls: [
        { type: 'static', tool: 'a', args: {} },
        {
          type: 'dynamic',
          tool: 'skipped',
          argsBuilder: () => {
            throw new Error('조건 미충족');
          },
          skipOnError: true,
        },
        { type: 'static', tool: 'after', args: {} },
      ],
    });

    const result = await agent.run({ companyId: 1, triggerType: 'manual', task: 't' });

    // skipped 는 toolCalls 에도 안 들어감
    expect(skippedCalled).toBe(false);
    expect(result.toolCalls.map((c) => c.tool)).toEqual(['a', 'after']);
    void tools; // 미사용 변수 회피
  });

  it('dynamic argsBuilder throw + skipOnError=false → status=FAILED', async () => {
    const tools = makeRegistry([
      makeTool('a', () => ({ ok: true })),
      makeTool('boom', () => ({})),
    ]);

    const agent = new StubAgent({
      name: 'test',
      tools,
      scriptedCalls: [
        { type: 'static', tool: 'a', args: {} },
        {
          type: 'dynamic',
          tool: 'boom',
          argsBuilder: () => {
            throw new Error('필수 데이터 없음');
          },
          // skipOnError 미지정
        },
      ],
    });

    const result = await agent.run({ companyId: 1, triggerType: 'manual', task: 't' });

    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toContain('필수 데이터');
  });

  it('finalText 명시 → reasoning 에 사용', async () => {
    const tools = makeRegistry([makeTool('noop', () => ({}))]);
    const agent = new StubAgent({
      name: 'test',
      tools,
      scriptedCalls: [{ type: 'static', tool: 'noop', args: {} }],
      finalText: '커스텀 종료 메시지',
    });

    const result = await agent.run({ companyId: 1, triggerType: 'manual', task: 't' });
    expect(result.reasoning).toBe('커스텀 종료 메시지');
    expect(result.finalAction).toBe('커스텀 종료 메시지');
  });

  it('DecisionLogger 에 정상 기록', async () => {
    const tools = makeRegistry([makeTool('noop', () => ({}))]);
    const agent = new StubAgent({
      name: 'test',
      tools,
      scriptedCalls: [{ type: 'static', tool: 'noop', args: {} }],
      pretendTokensIn: 100,
      pretendTokensOut: 50,
    });

    const result = await agent.run({
      companyId: 7,
      triggerType: 'simulation',
      task: 't',
      isSimulation: true,
    });

    expect(loggedDecisions).toHaveLength(1);
    const logged = loggedDecisions[0] as {
      companyId: number;
      tokensIn: number;
      tokensOut: number;
      isSimulation: boolean;
      agentName: string;
    };
    expect(logged.companyId).toBe(7);
    expect(logged.tokensIn).toBe(100);
    expect(logged.tokensOut).toBe(50);
    expect(logged.isSimulation).toBe(true);
    expect(logged.agentName).toBe('test');
    expect(result.decisionId).toBe(555);
  });

  it('빈 시퀀스 → 0개 호출 + 정상 종료', async () => {
    const tools = makeRegistry([]);
    const agent = new StubAgent({
      name: 'test',
      tools,
      scriptedCalls: [],
    });

    const result = await agent.run({ companyId: 1, triggerType: 'manual', task: 't' });
    expect(result.toolCalls).toHaveLength(0);
    expect(result.status).toBe('COMPLETED');
  });

  it('AgentLike 호환: run(input) → AgentRunResult 시그니처', async () => {
    const tools = makeRegistry([makeTool('noop', () => ({}))]);
    const agent = new StubAgent({
      name: 'test',
      tools,
      scriptedCalls: [{ type: 'static', tool: 'noop', args: {} }],
    });

    // 타입 컴파일 검증: AgentLike 처럼 사용 가능해야 함
    // (실제 AgentLike import 안 해도 시그니처가 맞으면 됨)
    const result = await agent.run({
      companyId: 1,
      triggerType: 'manual',
      task: 't',
    });

    // 모든 필수 필드 존재
    expect(result).toHaveProperty('decisionId');
    expect(result).toHaveProperty('sessionId');
    expect(result).toHaveProperty('finalAction');
    expect(result).toHaveProperty('reasoning');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('toolCalls');
    expect(result).toHaveProperty('tokensIn');
    expect(result).toHaveProperty('tokensOut');
    expect(result).toHaveProperty('costKrw');
    expect(result).toHaveProperty('durationMs');
  });
});
