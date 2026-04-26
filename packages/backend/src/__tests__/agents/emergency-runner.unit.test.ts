/**
 * emergencyAgentRunner 단위 테스트.
 *
 * 검증 항목:
 *  1. dispatchImmediateEmergency 가 feature flag 에 따라 올바른 백엔드를 선택
 *  2. fire-and-forget 시맨틱 (호출자에게 즉시 반환)
 *  3. flag OFF 시 기존 handleImmediateEscalation 으로 폴백
 *  4. flag ON 시 EmergencyAgent 경로로 라우팅
 *
 * 실제 에이전트와 escalationService 는 모킹.
 */

const mockHandleImmediateEscalation = jest.fn().mockResolvedValue(undefined);
const mockAgentRun = jest.fn();

jest.mock('../../services/escalationService', () => ({
  handleImmediateEscalation: mockHandleImmediateEscalation,
}));

jest.mock('../../agents/emergency.agent', () => ({
  EmergencyAgent: jest.fn().mockImplementation(() => ({
    run: mockAgentRun,
  })),
}));

// prisma findUnique 는 dispatchImmediateEmergency 자체에서는 호출되지 않지만,
// runAgentForDrop 이 fire-and-forget 으로 호출될 때 필요. 모킹.
jest.mock('../../utils/prisma', () => ({
  prisma: {
    emergencyDrop: {
      findUnique: jest.fn().mockResolvedValue({
        id: 1,
        status: 'OPEN',
        slot: {
          id: 100,
          date: new Date('2026-04-15'),
          shift: 'MORNING',
          schedule: { companyId: 1 },
          route: { id: 5, routeNumber: '16' },
        },
      }),
    },
  },
}));

import {
  dispatchImmediateEmergency,
  isEmergencyAgentEnabled,
} from '../../services/emergencyAgentRunner';

const args = {
  dropId: 1,
  slotDate: new Date('2026-04-15'),
  shift: 'MORNING',
  companyId: 1,
  routeId: 5,
};

beforeEach(() => {
  mockHandleImmediateEscalation.mockClear();
  mockAgentRun.mockClear();
  mockAgentRun.mockResolvedValue({
    decisionId: 999,
    sessionId: 'sess',
    finalAction: 'ok',
    reasoning: 'r',
    status: 'COMPLETED',
    toolCalls: [],
    tokensIn: 0,
    tokensOut: 0,
    costKrw: 0,
    durationMs: 0,
  });
});

afterEach(() => {
  delete process.env.EMERGENCY_AGENT_ENABLED;
});

describe('isEmergencyAgentEnabled', () => {
  it('환경변수 미설정 → false', () => {
    delete process.env.EMERGENCY_AGENT_ENABLED;
    expect(isEmergencyAgentEnabled()).toBe(false);
  });

  it("'false' → false", () => {
    process.env.EMERGENCY_AGENT_ENABLED = 'false';
    expect(isEmergencyAgentEnabled()).toBe(false);
  });

  it("'true' → true", () => {
    process.env.EMERGENCY_AGENT_ENABLED = 'true';
    expect(isEmergencyAgentEnabled()).toBe(true);
  });

  it('기타 값 → false (안전 디폴트)', () => {
    process.env.EMERGENCY_AGENT_ENABLED = '1';
    expect(isEmergencyAgentEnabled()).toBe(false);
    process.env.EMERGENCY_AGENT_ENABLED = 'yes';
    expect(isEmergencyAgentEnabled()).toBe(false);
  });
});

describe('dispatchImmediateEmergency', () => {
  it('flag OFF 시 handleImmediateEscalation 으로 폴백', async () => {
    delete process.env.EMERGENCY_AGENT_ENABLED;

    dispatchImmediateEmergency(args);

    // fire-and-forget — microtask 한 번 돌려야 mock 호출 확인 가능
    await new Promise((r) => setImmediate(r));

    expect(mockHandleImmediateEscalation).toHaveBeenCalledTimes(1);
    expect(mockHandleImmediateEscalation).toHaveBeenCalledWith(
      args.dropId,
      args.slotDate,
      args.shift,
      args.companyId,
      args.routeId
    );
    expect(mockAgentRun).not.toHaveBeenCalled();
  });

  it('flag ON 시 EmergencyAgent.run 으로 라우팅', async () => {
    process.env.EMERGENCY_AGENT_ENABLED = 'true';

    dispatchImmediateEmergency(args);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(mockAgentRun).toHaveBeenCalledTimes(1);
    expect(mockAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        triggerType: 'event',
        triggerRefId: 1,
      })
    );
    expect(mockHandleImmediateEscalation).not.toHaveBeenCalled();
  });

  it('flag ON 시 task 메시지에 긴급도와 dropId 가 포함됨', async () => {
    process.env.EMERGENCY_AGENT_ENABLED = 'true';

    dispatchImmediateEmergency(args);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const callArg = mockAgentRun.mock.calls[0][0] as { task: string };
    expect(callArg.task).toContain('EmergencyDrop ID: 1');
    expect(callArg.task).toContain('get_drop_context(1)');
    // 긴급도 등급 중 하나가 포함돼야 함
    expect(callArg.task).toMatch(/CRITICAL|HIGH|NORMAL|PASSED/);
  });

  it('동기 호출 — 호출자에게 즉시 반환 (fire-and-forget)', () => {
    process.env.EMERGENCY_AGENT_ENABLED = 'true';
    // mockAgentRun 이 영원히 pending 상태여도
    mockAgentRun.mockImplementation(() => new Promise(() => {}));

    const start = Date.now();
    dispatchImmediateEmergency(args);
    const elapsed = Date.now() - start;

    // 동기 반환 — 100ms 미만이어야 함
    expect(elapsed).toBeLessThan(100);
  });

  it('flag OFF 폴백에서도 동기 반환', () => {
    delete process.env.EMERGENCY_AGENT_ENABLED;
    mockHandleImmediateEscalation.mockImplementation(() => new Promise(() => {}));

    const start = Date.now();
    dispatchImmediateEmergency(args);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});
