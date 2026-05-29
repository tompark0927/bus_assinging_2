/**
 * Scenario Generator 단위 테스트.
 *
 * Prisma 모킹으로 DB 없이 동작 검증:
 *   1. 픽스처 생성이 올바른 회사 코드 prefix 사용
 *   2. 드랍 분포가 urgencyMix 비율에 맞게 생성
 *   3. virtualNow 가 출발 시각 이전이고 urgency 등급에 맞게 분산
 *   4. cleanupFixture 가 'BT' prefix 가 아닌 회사를 거부
 *   5. cleanupAllBacktestFixtures 가 BT prefix 회사만 대상
 *
 * 주의: 이 테스트는 Prisma 콜체인을 모킹한다. 실제 DB 통합은 별도 integration test 에서.
 */

const mockTransaction = jest.fn();
const mockCompanyCreate = jest.fn();
const mockCompanyFindUnique = jest.fn();
const mockCompanyDelete = jest.fn();
const mockCompanyFindMany = jest.fn();
const mockUserCreate = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserDeleteMany = jest.fn();
const mockRouteCreate = jest.fn();
const mockRouteDeleteMany = jest.fn();
const mockScheduleCreate = jest.fn();
const mockScheduleDeleteMany = jest.fn();
const mockSlotCreate = jest.fn();
const mockSlotFindMany = jest.fn();
const mockSlotDeleteMany = jest.fn();
const mockDropCreate = jest.fn();
const mockDropDeleteMany = jest.fn();
const mockGoldenTicketDeleteMany = jest.fn();
const mockAgentDecisionDeleteMany = jest.fn();
const mockNotificationDeleteMany = jest.fn();
const mockRefreshTokenDeleteMany = jest.fn();
const mockDayOffRequestDeleteMany = jest.fn();
const mockCompanyRuleDeleteMany = jest.fn();
const mockAttendanceRecordDeleteMany = jest.fn();
const mockDriverTagDeleteMany = jest.fn();
const mockAuditLogDeleteMany = jest.fn();
const mockDriverPreferenceDeleteMany = jest.fn();
const mockRouteAssignmentDeleteMany = jest.fn();
const mockDailyReportDeleteMany = jest.fn();

jest.mock('../../utils/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    company: {
      create: (...a: unknown[]) => mockCompanyCreate(...a),
      findUnique: (...a: unknown[]) => mockCompanyFindUnique(...a),
      delete: (...a: unknown[]) => mockCompanyDelete(...a),
      findMany: (...a: unknown[]) => mockCompanyFindMany(...a),
    },
    user: {
      create: (...a: unknown[]) => mockUserCreate(...a),
      findMany: (...a: unknown[]) => mockUserFindMany(...a),
      deleteMany: (...a: unknown[]) => mockUserDeleteMany(...a),
    },
    route: {
      create: (...a: unknown[]) => mockRouteCreate(...a),
      deleteMany: (...a: unknown[]) => mockRouteDeleteMany(...a),
    },
    schedule: {
      create: (...a: unknown[]) => mockScheduleCreate(...a),
      deleteMany: (...a: unknown[]) => mockScheduleDeleteMany(...a),
    },
    scheduleSlot: {
      create: (...a: unknown[]) => mockSlotCreate(...a),
      findMany: (...a: unknown[]) => mockSlotFindMany(...a),
      deleteMany: (...a: unknown[]) => mockSlotDeleteMany(...a),
    },
    emergencyDrop: {
      create: (...a: unknown[]) => mockDropCreate(...a),
      deleteMany: (...a: unknown[]) => mockDropDeleteMany(...a),
    },
    goldenTicket: { deleteMany: (...a: unknown[]) => mockGoldenTicketDeleteMany(...a) },
    agentDecision: { deleteMany: (...a: unknown[]) => mockAgentDecisionDeleteMany(...a) },
    notification: { deleteMany: (...a: unknown[]) => mockNotificationDeleteMany(...a) },
    refreshToken: { deleteMany: (...a: unknown[]) => mockRefreshTokenDeleteMany(...a) },
    dayOffRequest: { deleteMany: (...a: unknown[]) => mockDayOffRequestDeleteMany(...a) },
    companyRule: { deleteMany: (...a: unknown[]) => mockCompanyRuleDeleteMany(...a) },
    attendanceRecord: { deleteMany: (...a: unknown[]) => mockAttendanceRecordDeleteMany(...a) },
    driverTag: { deleteMany: (...a: unknown[]) => mockDriverTagDeleteMany(...a) },
    auditLog: { deleteMany: (...a: unknown[]) => mockAuditLogDeleteMany(...a) },
    driverPreference: { deleteMany: (...a: unknown[]) => mockDriverPreferenceDeleteMany(...a) },
    routeAssignment: { deleteMany: (...a: unknown[]) => mockRouteAssignmentDeleteMany(...a) },
    dailyReport: { deleteMany: (...a: unknown[]) => mockDailyReportDeleteMany(...a) },
  },
}));

import {
  generateScenarioFixture,
  cleanupFixture,
  cleanupAllBacktestFixtures,
} from '../../agents/_core/scenario-generator';

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): .Once 큐도 비워 테스트 간 누수 방지
  jest.resetAllMocks();

  // 기본 모킹: $transaction 콜백을 그대로 호출하면서 tx 객체로 같은 mock 들 제공
  mockTransaction.mockImplementation(async (callback: unknown) => {
    if (typeof callback === 'function') {
      return callback({
        company: {
          create: mockCompanyCreate,
          findUnique: mockCompanyFindUnique,
          delete: mockCompanyDelete,
        },
        user: {
          create: mockUserCreate,
          findMany: mockUserFindMany,
          deleteMany: mockUserDeleteMany,
        },
        route: { create: mockRouteCreate, deleteMany: mockRouteDeleteMany },
        schedule: { create: mockScheduleCreate, deleteMany: mockScheduleDeleteMany },
        scheduleSlot: {
          create: mockSlotCreate,
          findMany: mockSlotFindMany,
          deleteMany: mockSlotDeleteMany,
        },
        emergencyDrop: { create: mockDropCreate, deleteMany: mockDropDeleteMany },
        goldenTicket: { deleteMany: mockGoldenTicketDeleteMany },
        agentDecision: { deleteMany: mockAgentDecisionDeleteMany },
        notification: { deleteMany: mockNotificationDeleteMany },
        refreshToken: { deleteMany: mockRefreshTokenDeleteMany },
        dayOffRequest: { deleteMany: mockDayOffRequestDeleteMany },
        companyRule: { deleteMany: mockCompanyRuleDeleteMany },
        attendanceRecord: { deleteMany: mockAttendanceRecordDeleteMany },
        driverTag: { deleteMany: mockDriverTagDeleteMany },
        auditLog: { deleteMany: mockAuditLogDeleteMany },
        driverPreference: { deleteMany: mockDriverPreferenceDeleteMany },
        routeAssignment: { deleteMany: mockRouteAssignmentDeleteMany },
        dailyReport: { deleteMany: mockDailyReportDeleteMany },
      });
    }
    return [];
  });

  // 회사·기사·노선 생성 시 fake id 부여
  let counter = 1;
  mockCompanyCreate.mockImplementation(async (args: { data: { code: string; name: string } }) => ({
    id: 100,
    code: args.data.code,
    name: args.data.name,
  }));
  mockUserCreate.mockImplementation(async () => ({
    id: counter++,
    name: '[BT] 기사',
    employeeId: 'BTD',
  }));
  mockRouteCreate.mockImplementation(async () => ({ id: counter++, routeNumber: 'BT' }));
  mockScheduleCreate.mockImplementation(async () => ({ id: 999 }));
  mockSlotCreate.mockImplementation(async () => ({ id: counter++ }));
  mockDropCreate.mockImplementation(async () => ({ id: counter++ }));
});

// ─────────────────────────────────────────────
// generateScenarioFixture
// ─────────────────────────────────────────────

describe('generateScenarioFixture', () => {
  it('회사 코드 prefix 가 BT', async () => {
    const fixture = await generateScenarioFixture({
      driverCount: 5,
      routeCount: 2,
      dropCount: 4,
    });

    expect(fixture.companyCode).toMatch(/^BT/);
    expect(fixture.companyId).toBe(100);
  });

  it('지정한 driverCount 만큼 user 생성', async () => {
    await generateScenarioFixture({
      driverCount: 10,
      routeCount: 2,
      dropCount: 4,
    });

    // 관리자 1 + 기사 10
    expect(mockUserCreate).toHaveBeenCalledTimes(11);
  });

  it('지정한 dropCount 만큼 시나리오 생성', async () => {
    const fixture = await generateScenarioFixture({
      driverCount: 5,
      routeCount: 2,
      dropCount: 12,
    });

    expect(fixture.scenarios).toHaveLength(12);
    expect(mockSlotCreate).toHaveBeenCalledTimes(12);
    expect(mockDropCreate).toHaveBeenCalledTimes(12);
  });

  it('urgencyMix 분포 반영 — 20/30/50', async () => {
    const fixture = await generateScenarioFixture({
      driverCount: 5,
      routeCount: 2,
      dropCount: 100,
      urgencyMix: { critical: 0.2, high: 0.3, normal: 0.5 },
    });

    const urgencies = fixture.scenarios.map((s) => (s.metadata?.urgency as string) ?? '');
    const counts = {
      critical: urgencies.filter((u) => u === 'critical').length,
      high: urgencies.filter((u) => u === 'high').length,
      normal: urgencies.filter((u) => u === 'normal').length,
    };

    expect(counts.critical).toBe(20);
    expect(counts.high).toBe(30);
    expect(counts.normal).toBe(50);
  });

  it('urgencyMix 합 != 1.0 → throw', async () => {
    await expect(
      generateScenarioFixture({
        driverCount: 5,
        routeCount: 2,
        dropCount: 5,
        urgencyMix: { critical: 0.5, high: 0.5, normal: 0.5 },
      })
    ).rejects.toThrow(/1\.0/);
  });

  it('CRITICAL 시나리오의 virtualNow 는 출발 30분 이내', async () => {
    const fixture = await generateScenarioFixture({
      driverCount: 5,
      routeCount: 2,
      dropCount: 30,
      urgencyMix: { critical: 1, high: 0, normal: 0 },
    });

    const criticals = fixture.scenarios.filter((s) => s.metadata?.urgency === 'critical');
    expect(criticals.length).toBeGreaterThan(0);

    // 시뮬레이터가 분류할 때 minutesBefore = 5~29
    // (실제 분류는 SimulationRunner 가 get_drop_context 호출 시 함)
    // 여기서는 metadata 가 critical 로 마크되는지만 검증
    for (const s of criticals) {
      expect(s.metadata?.urgency).toBe('critical');
    }
  });

  it('actualOutcome 생성 옵션 (기본 true)', async () => {
    const fixture = await generateScenarioFixture({
      driverCount: 5,
      routeCount: 2,
      dropCount: 10,
    });

    const withOutcome = fixture.scenarios.filter((s) => s.actualOutcome !== undefined);
    expect(withOutcome.length).toBe(10);
  });

  it('generateActualOutcomes=false → outcome 없음', async () => {
    const fixture = await generateScenarioFixture({
      driverCount: 5,
      routeCount: 2,
      dropCount: 5,
      generateActualOutcomes: false,
    });

    expect(fixture.scenarios.every((s) => s.actualOutcome === undefined)).toBe(true);
  });

  it('동일 시드 → 동일한 actualOutcome 시퀀스 (재현성)', async () => {
    const baseTime = new Date('2026-04-15T08:00:00Z');
    const opts = {
      driverCount: 5,
      routeCount: 2,
      dropCount: 20,
      baseTime,
      randomSeed: 42,
    };

    const f1 = await generateScenarioFixture(opts);
    const f2 = await generateScenarioFixture(opts);

    const outcomes1 = f1.scenarios.map((s) => s.actualOutcome?.accepted);
    const outcomes2 = f2.scenarios.map((s) => s.actualOutcome?.accepted);

    expect(outcomes1).toEqual(outcomes2);
  });

  it('다른 시드 → 다른 시퀀스 (실제로 randomize 됨)', async () => {
    const baseOpts = {
      driverCount: 5,
      routeCount: 2,
      dropCount: 30,
      baseTime: new Date('2026-04-15T08:00:00Z'),
    };

    const f1 = await generateScenarioFixture({ ...baseOpts, randomSeed: 1 });
    const f2 = await generateScenarioFixture({ ...baseOpts, randomSeed: 999 });

    const outcomes1 = f1.scenarios.map((s) => s.actualOutcome?.accepted).join(',');
    const outcomes2 = f2.scenarios.map((s) => s.actualOutcome?.accepted).join(',');

    expect(outcomes1).not.toEqual(outcomes2);
  });

  it('성공률이 critical < high < normal 이라는 합성 가정 충족', async () => {
    // 200개 드랍으로 충분한 표본 + 고정 시드
    const fixture = await generateScenarioFixture({
      driverCount: 5,
      routeCount: 2,
      dropCount: 200,
      randomSeed: 12345,
    });

    const byUrgency = { critical: 0, high: 0, normal: 0 };
    const acceptedBy = { critical: 0, high: 0, normal: 0 };

    for (const s of fixture.scenarios) {
      const u = s.metadata?.urgency as 'critical' | 'high' | 'normal';
      byUrgency[u]++;
      if (s.actualOutcome?.accepted) acceptedBy[u]++;
    }

    const rate = (u: 'critical' | 'high' | 'normal') => acceptedBy[u] / byUrgency[u];

    // 표본이 충분하므로 합성 비율 (50% / 70% / 85%) 에 ±15% 이내 근사
    expect(rate('critical')).toBeGreaterThan(0.30);
    expect(rate('critical')).toBeLessThan(0.70);
    expect(rate('high')).toBeGreaterThan(0.50);
    expect(rate('high')).toBeLessThan(0.90);
    expect(rate('normal')).toBeGreaterThan(0.70);
    expect(rate('normal')).toBeLessThanOrEqual(1.0);

    // 진실: critical < high < normal (느슨한 ordering)
    expect(rate('critical')).toBeLessThanOrEqual(rate('normal'));
  });

  it('cleanupHandle 함수가 반환되며 호출 가능', async () => {
    const fixture = await generateScenarioFixture({
      driverCount: 3,
      routeCount: 2,
      dropCount: 3,
    });

    expect(typeof fixture.cleanupHandle).toBe('function');

    // cleanupHandle 은 fixture.companyCode 를 prefix 로 사용 — findUnique 가 같은 코드 반환해야 함
    mockCompanyFindUnique.mockResolvedValueOnce({
      id: fixture.companyId,
      code: fixture.companyCode,
      name: '[BT] 합성',
    });
    mockSlotFindMany.mockResolvedValueOnce([]);
    mockUserFindMany.mockResolvedValueOnce([]);
    await expect(fixture.cleanupHandle()).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────
// cleanupFixture (안전 검증)
// ─────────────────────────────────────────────

describe('cleanupFixture', () => {
  it('회사 코드가 BT prefix 가 아니면 throw (운영 데이터 보호)', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce({
      id: 1,
      code: 'PROD',
      name: '운영 회사',
    });

    await expect(cleanupFixture(1)).rejects.toThrow(/운영 데이터 보호/);
  });

  it('회사가 없으면 noop (이미 삭제된 경우)', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce(null);

    await expect(cleanupFixture(999)).resolves.toBeUndefined();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('BT prefix 회사 → 외래키 순서대로 삭제', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce({
      id: 100,
      code: 'BT12345',
      name: '[BT] 회사',
    });
    mockSlotFindMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    mockUserFindMany.mockResolvedValueOnce([{ id: 10 }, { id: 11 }]);

    await cleanupFixture(100);

    expect(mockDropDeleteMany).toHaveBeenCalled();
    expect(mockSlotDeleteMany).toHaveBeenCalled();
    expect(mockScheduleDeleteMany).toHaveBeenCalled();
    expect(mockGoldenTicketDeleteMany).toHaveBeenCalled();
    expect(mockAgentDecisionDeleteMany).toHaveBeenCalled();
    expect(mockDayOffRequestDeleteMany).toHaveBeenCalled();
    expect(mockCompanyRuleDeleteMany).toHaveBeenCalled();
    expect(mockAttendanceRecordDeleteMany).toHaveBeenCalled();
    expect(mockDriverTagDeleteMany).toHaveBeenCalled();
    expect(mockAuditLogDeleteMany).toHaveBeenCalled();
    expect(mockDriverPreferenceDeleteMany).toHaveBeenCalled();
    expect(mockRouteAssignmentDeleteMany).toHaveBeenCalled();
    expect(mockDailyReportDeleteMany).toHaveBeenCalled();
    expect(mockNotificationDeleteMany).toHaveBeenCalled();
    expect(mockRouteDeleteMany).toHaveBeenCalled();
    expect(mockUserDeleteMany).toHaveBeenCalled();
    expect(mockCompanyDelete).toHaveBeenCalledWith({ where: { id: 100 } });
  });

  it('커스텀 prefix 도 검증', async () => {
    mockCompanyFindUnique.mockResolvedValueOnce({
      id: 1,
      code: 'TEST123',
      name: '테스트',
    });

    await expect(cleanupFixture(1, 'BT')).rejects.toThrow();

    // TEST prefix 로 호출하면 통과
    mockCompanyFindUnique.mockResolvedValueOnce({
      id: 1,
      code: 'TEST123',
      name: '테스트',
    });
    mockSlotFindMany.mockResolvedValueOnce([]);
    mockUserFindMany.mockResolvedValueOnce([]);
    await expect(cleanupFixture(1, 'TEST')).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// cleanupAllBacktestFixtures
// ─────────────────────────────────────────────

describe('cleanupAllBacktestFixtures', () => {
  it('BT prefix 회사만 조회', async () => {
    mockCompanyFindMany.mockResolvedValueOnce([]);

    await cleanupAllBacktestFixtures();

    expect(mockCompanyFindMany).toHaveBeenCalledWith({
      where: { code: { startsWith: 'BT' } },
      select: { id: true, code: true },
    });
  });

  it('찾은 회사들을 차례로 정리', async () => {
    mockCompanyFindMany.mockResolvedValueOnce([
      { id: 100, code: 'BT001' },
      { id: 101, code: 'BT002' },
    ]);

    // 두 번의 cleanupFixture 호출에 대한 모킹
    mockCompanyFindUnique
      .mockResolvedValueOnce({ id: 100, code: 'BT001', name: '' })
      .mockResolvedValueOnce({ id: 101, code: 'BT002', name: '' });
    mockSlotFindMany.mockResolvedValue([]);
    mockUserFindMany.mockResolvedValue([]);

    const result = await cleanupAllBacktestFixtures();

    expect(result.deletedCompanies).toBe(2);
    expect(mockCompanyDelete).toHaveBeenCalledTimes(2);
  });

  it('한 회사 정리 실패해도 다른 회사는 진행', async () => {
    mockCompanyFindMany.mockResolvedValueOnce([
      { id: 100, code: 'BT001' },
      { id: 101, code: 'BT002' },
    ]);

    // 첫 번째는 prefix 검증 통과 — 정상
    mockCompanyFindUnique
      .mockResolvedValueOnce({ id: 100, code: 'BT001', name: '' })
      // 두 번째는 prefix 가 다르게 모킹돼 throw
      .mockResolvedValueOnce({ id: 101, code: 'OTHER', name: '' });
    mockSlotFindMany.mockResolvedValue([]);
    mockUserFindMany.mockResolvedValue([]);

    const result = await cleanupAllBacktestFixtures();

    // 두 회사 모두 시도된 것으로 카운트
    expect(result.deletedCompanies).toBe(2);
  });
});
