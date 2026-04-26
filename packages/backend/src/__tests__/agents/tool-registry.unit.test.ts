/**
 * ToolRegistry 단위 테스트.
 *
 * 검증 항목:
 *  - 등록·중복 검출
 *  - Anthropic API 형식 직렬화
 *  - 시뮬레이션 모드에서 blockedInSimulation 도구가 stub 으로 라우팅
 *  - 미등록 도구 호출 시 명확한 에러
 *  - ToolContext 가 핸들러에 전달
 */

import { ToolRegistry } from '../../agents/_core/tool-registry';
import type { AgentTool, ToolContext } from '../../agents/_core/types';

const baseCtx: ToolContext = {
  companyId: 1,
  agentName: 'test',
  sessionId: 'sess-1',
  isSimulation: false,
  virtualNow: new Date('2026-04-10T08:00:00Z'),
};

function makeTool(name: string, extra: Partial<AgentTool> = {}): AgentTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: 'object',
      properties: { foo: { type: 'string' } },
      required: ['foo'],
    },
    handler: async (input, _ctx) => ({ echoed: input }),
    ...extra,
  };
}

describe('ToolRegistry', () => {
  it('도구를 등록하고 조회할 수 있다', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('alpha'));
    expect(reg.has('alpha')).toBe(true);
    expect(reg.get('alpha')?.name).toBe('alpha');
    expect(reg.list()).toHaveLength(1);
  });

  it('같은 이름 도구 중복 등록 시 throw', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('beta'));
    expect(() => reg.register(makeTool('beta'))).toThrow(/중복/);
  });

  it('registerAll 로 한 번에 여러 도구 등록', () => {
    const reg = new ToolRegistry();
    reg.registerAll([makeTool('a'), makeTool('b'), makeTool('c')]);
    expect(reg.list()).toHaveLength(3);
  });

  it('Anthropic API 형식으로 직렬화', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('alpha'));
    const tools = reg.toAnthropicTools();
    expect(tools[0]).toEqual({
      name: 'alpha',
      description: 'alpha tool',
      input_schema: {
        type: 'object',
        properties: { foo: { type: 'string' } },
        required: ['foo'],
      },
    });
  });

  it('정상 모드에서 핸들러 호출 + ToolContext 전달', async () => {
    const reg = new ToolRegistry();
    let receivedCtx: ToolContext | null = null;
    reg.register(
      makeTool('peek', {
        handler: async (input, ctx) => {
          receivedCtx = ctx;
          return { input };
        },
      })
    );

    const result = await reg.invoke('peek', { foo: 'bar' }, baseCtx);
    expect(result).toEqual({ input: { foo: 'bar' } });
    expect(receivedCtx).toEqual(baseCtx);
  });

  it('미등록 도구 호출 → 명확한 에러', async () => {
    const reg = new ToolRegistry();
    await expect(reg.invoke('ghost', {}, baseCtx)).rejects.toThrow(/알 수 없는 도구/);
  });

  it('시뮬레이션 + blockedInSimulation → stub 호출, 실제 핸들러 안 호출', async () => {
    let realHandlerCalled = false;
    const reg = new ToolRegistry();
    reg.register(
      makeTool('send_push', {
        blockedInSimulation: true,
        simulationStub: (input) => ({ stubbed: true, input }),
        handler: async () => {
          realHandlerCalled = true;
          return { real: true };
        },
      })
    );

    const simCtx: ToolContext = { ...baseCtx, isSimulation: true };
    const result = await reg.invoke('send_push', { foo: 'x' }, simCtx);

    expect(result).toEqual({ stubbed: true, input: { foo: 'x' } });
    expect(realHandlerCalled).toBe(false);
  });

  it('시뮬레이션 + blockedInSimulation 인데 stub 미정의 → 기본 stub', async () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('side_effect', {
        blockedInSimulation: true,
        // simulationStub 생략
      })
    );

    const result = (await reg.invoke('side_effect', {}, {
      ...baseCtx,
      isSimulation: true,
    })) as { simulated: boolean };
    expect(result.simulated).toBe(true);
  });

  it('정상 모드에서 blockedInSimulation 도구는 실제 핸들러 호출', async () => {
    let realCalled = false;
    const reg = new ToolRegistry();
    reg.register(
      makeTool('mixed', {
        blockedInSimulation: true,
        simulationStub: () => ({ stubbed: true }),
        handler: async () => {
          realCalled = true;
          return { ok: true };
        },
      })
    );

    const result = await reg.invoke('mixed', { foo: 'y' }, baseCtx);
    expect(result).toEqual({ ok: true });
    expect(realCalled).toBe(true);
  });

  it('핸들러 throw → invoke 에서 그대로 propagate (BaseAgent 가 모델에게 전달)', async () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool('boom', {
        handler: async () => {
          throw new Error('의도된 실패');
        },
      })
    );

    await expect(reg.invoke('boom', {}, baseCtx)).rejects.toThrow('의도된 실패');
  });
});
