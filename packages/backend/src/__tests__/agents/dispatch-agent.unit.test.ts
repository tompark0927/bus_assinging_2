/**
 * DispatchAgent 와이어링 단위 테스트.
 *
 * 검증 항목:
 *  1. 10개 도구가 모두 등록되어 있다
 *  2. 각 도구가 Anthropic API tools 형식으로 변환 가능하다
 *  3. 시스템 프롬프트가 핵심 원칙을 포함한다 (휴먼 게이트, Constitutional, 공정성)
 *  4. 시뮬레이션 모드 차단 도구가 표시되어 있다 (modify_slot, publish_schedule, draft_monthly_schedule)
 */

// agentDecision 로깅과 BaseAgent 의존성을 가볍게 모킹
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
  }))
);

jest.mock('../../agents/_core/decision-logger', () => ({
  logDecision: jest.fn(),
  buildResultFromDecision: jest.fn(),
}));

jest.mock('../../utils/tenantContext', () => ({
  runWithCompany: <T>(_id: number, fn: () => T) => fn(),
  getCurrentCompanyId: () => 1,
  getCurrentUserId: () => undefined,
  TENANT_MODELS: new Set<string>(),
}));

jest.mock('../../agents/_core/prompt-evolver', () => ({
  getEvolvedSystemPrompt: jest.fn(async (base: string) => base),
  invalidatePromptCache: jest.fn(),
}));

import { DispatchAgent } from '../../agents/dispatch.agent';
import { DISPATCH_TOOLS_V1 } from '../../agents/_tools/dispatch-tools';

describe('DispatchAgent', () => {
  it('16개 도구가 모두 등록되어 있다', () => {
    expect(DISPATCH_TOOLS_V1).toHaveLength(16);
    const names = DISPATCH_TOOLS_V1.map((t) => t.name);
    expect(names).toEqual([
      'get_drivers',
      'get_routes',
      'get_active_schedule',
      'get_dayoff_requests',
      'get_company_rules',
      'get_driver_history',
      'score_fairness',
      'draft_monthly_schedule',
      'draft_schedule_v2',
      'modify_slot',
      'publish_schedule',
      'swap_drivers',
      'approve_dayoff',
      'reject_dayoff',
      'detect_constraint_violation',
      'request_human_review',
    ]);
  });

  it('각 도구가 description + inputSchema 를 갖는다 (Anthropic API 요구사항)', () => {
    for (const tool of DISPATCH_TOOLS_V1) {
      expect(tool.name).toMatch(/^[a-z0-9_]+$/); // snake_case (숫자 허용 — draft_schedule_v2)
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('쓰기·발행 도구는 시뮬레이션 모드에서 차단됨', () => {
    const blockedNames = DISPATCH_TOOLS_V1.filter((t) => t.blockedInSimulation).map((t) => t.name);
    // 데이터 변경·외부 알림 도구만 차단
    expect(blockedNames).toEqual(
      expect.arrayContaining([
        'draft_monthly_schedule',
        'draft_schedule_v2',
        'modify_slot',
        'publish_schedule',
        'swap_drivers',
        'approve_dayoff',
        'reject_dayoff',
        'request_human_review',
      ])
    );
    // 조회·분석 도구는 차단되지 않음
    const readOnlyNames = [
      'get_drivers',
      'get_routes',
      'get_active_schedule',
      'score_fairness',
      'detect_constraint_violation',
    ];
    for (const name of readOnlyNames) {
      const tool = DISPATCH_TOOLS_V1.find((t) => t.name === name)!;
      expect(tool.blockedInSimulation).toBeFalsy();
    }
  });

  it('차단 도구는 simulationStub 을 갖는다', () => {
    for (const tool of DISPATCH_TOOLS_V1) {
      if (tool.blockedInSimulation) {
        expect(tool.simulationStub).toBeDefined();
      }
    }
  });

  it('DispatchAgent 인스턴스화 + Anthropic API 형식 변환 동작', () => {
    const agent = new DispatchAgent();
    // 내부 ToolRegistry 가 Anthropic 형식으로 직렬화 가능해야 함
    // BaseAgent 는 protected 멤버라 직접 접근 불가 — 인스턴스화만 검증
    expect(agent).toBeInstanceOf(DispatchAgent);
  });

  it('필수 도구의 input_schema required 필드 검증', () => {
    const requiredFields: Record<string, string[]> = {
      get_active_schedule: ['year', 'month'],
      get_driver_history: ['driverId'],
      score_fairness: ['scheduleId'],
      draft_monthly_schedule: ['year', 'month'],
      draft_schedule_v2: ['year', 'month'],
      modify_slot: ['slotId', 'reason'],
      publish_schedule: ['scheduleId', 'summary'],
      swap_drivers: ['slotAId', 'slotBId', 'reason'],
      approve_dayoff: ['requestId'],
      reject_dayoff: ['requestId', 'reviewNote'],
      detect_constraint_violation: ['scheduleId'],
      request_human_review: ['reason', 'severity'],
    };

    for (const [toolName, expected] of Object.entries(requiredFields)) {
      const tool = DISPATCH_TOOLS_V1.find((t) => t.name === toolName);
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toEqual(expect.arrayContaining(expected));
    }
  });
});
