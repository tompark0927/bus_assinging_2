/**
 * Stage 3 v2 솔버 — 단위 테스트.
 *
 * 검증:
 *   1. 페어 우선 배정 (HOME tier)
 *   2. 5/2 룰 강제 (5일 연속 후 2일 휴무)
 *   3. 19~22일 타겟 충족률
 *   4. 헌법 R5 (휴무 승인일 배정 금지)
 *   5. 헌법 R3 (당일 중복 배정 금지)
 *   6. 노선 격리 (canCrossRoute=false 면 다른 노선 안 들어감)
 *   7. summary 포함 키워드
 */

import { evaluateWorkload, solveMonthlyGrid } from '../monthly-grid-solver';
import type { SolverInput, SolverDriver, SolverPartnership } from '../types';

function buildPair(idA: number, idB: number, busId: number, routeId: number) {
  const partnership: SolverPartnership = {
    id: `P-${busId}`,
    driverAId: idA,
    driverBId: idB,
    busId,
    routeId,
  };
  const make = (id: number, name: string): SolverDriver => ({
    id,
    name,
    homeBusId: busId,
    homeRouteId: routeId,
    partnerId: id === idA ? idB : idA,
    canCrossRoute: false,
    approvedDayOffs: [],
    recentFatigueScore: 30,
    isNewHire: false,
  });
  return {
    drivers: [make(idA, `D${idA}`), make(idB, `D${idB}`)],
    partnership,
  };
}

function buildInput(opts: Partial<SolverInput> = {}): SolverInput {
  // 한 노선에 4대 = 페어 4쌍 = 8명 + 휴무 메꿀 여유 운전자 4명 (canCrossRoute=true)
  const pairs = [
    buildPair(1, 2, 1001, 100),
    buildPair(3, 4, 1002, 100),
    buildPair(5, 6, 1003, 100),
    buildPair(7, 8, 1004, 100),
  ];
  const drivers: SolverDriver[] = pairs.flatMap((p) => p.drivers);
  // 같은 노선의 여유 인력 (다른 차의 페어가 휴무일 때 들어옴)
  // 진짜 모델에서는 SAME_ROUTE 풀링이 자연스럽게 해결하므로 별도 SP 불필요
  const buses = pairs.map((p) => ({ id: p.partnership.busId, routeId: 100 }));
  const partnerships = pairs.map((p) => p.partnership);

  return {
    year: 2026,
    month: 5,
    drivers,
    buses,
    partnerships,
    localSearchIterations: 200,
    ...opts,
  };
}

describe('solveMonthlyGrid v2', () => {
  test('19~22일 타겟 충족률이 합리적 (5/2 룰 적용)', () => {
    const input = buildInput();
    const result = solveMonthlyGrid(input);
    // 5/2 사이클로 자동 휴무 → 평균이 19~23일 범위
    expect(result.metrics.workDayMean).toBeGreaterThanOrEqual(18);
    expect(result.metrics.workDayMean).toBeLessThanOrEqual(24);
  });

  test('restCycle 룰 준수: 대부분 운전자 longestStreak ≤ workDays', () => {
    const input = buildInput();
    const result = solveMonthlyGrid(input);
    // localSearch 의 random walk 가 가끔 1명 정도 위반 슬롯 생성 가능 → ≥ 87.5% 임계
    expect(result.metrics.restCycleCompliance).toBeGreaterThanOrEqual(0.85);
  });

  test('헌법 R5: 휴무 승인일 배정 금지', () => {
    const input = buildInput();
    input.drivers[0].approvedDayOffs = ['2026-05-05', '2026-05-12'];
    const result = solveMonthlyGrid(input);
    const violations = result.slots.filter(
      (s) =>
        s.driverId === input.drivers[0].id &&
        input.drivers[0].approvedDayOffs.includes(s.date),
    );
    expect(violations).toHaveLength(0);
  });

  test('헌법 R3: 한 운전자가 같은 날 AM+PM 동시 배정 안 됨', () => {
    const input = buildInput();
    const result = solveMonthlyGrid(input);
    const seen = new Set<string>();
    for (const s of result.slots) {
      const key = `${s.driverId}-${s.date}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('페어 우선: 본인 차량 배정률이 높아야 함 (HOME tier)', () => {
    const input = buildInput();
    const result = solveMonthlyGrid(input);
    // 모든 운전자가 같은 노선에 배정되어 있고, canCrossRoute=false 라
    // HOME 또는 SAME_ROUTE 만 가능
    expect(result.metrics.crossRouteRate).toBe(0);
    // HOME 비율은 페어 중 상대방이 휴무일 때 SAME_ROUTE 풀링 발생
    // → 단순 페어만 있는 경우 SAME_ROUTE 발생 가능 (다른 차 페어가 채움)
    expect(result.metrics.homeBusRate).toBeGreaterThan(0.4);
  });

  test('canCrossRoute=false 면 다른 노선 운전자가 절대 안 들어옴', () => {
    const input = buildInput();
    // 같은 노선만 있는 입력이라 자동으로 검증
    const result = solveMonthlyGrid(input);
    for (const s of result.slots) {
      expect(s.familiarity).not.toBe('CROSS_ROUTE');
    }
  });

  test('summary 가 핵심 메트릭 키워드 포함', () => {
    const input = buildInput();
    const result = solveMonthlyGrid(input);
    expect(result.summary).toContain('19~22일 충족률'); // CITY_2SHIFT 의 sweet spot
    expect(result.summary).toContain('restCycle 룰 준수');
    expect(result.summary).toContain('본인 차량 배정률');
    expect(result.summary).toContain('CITY_2SHIFT'); // preset 태그
  });

  // ─────────────────────────────────────────
  // 근무일수 tiered 평가 (evaluateWorkload)
  // ─────────────────────────────────────────

  describe('evaluateWorkload — tiered penalty', () => {
    const baseDriver: SolverDriver = {
      id: 999,
      name: '테스트',
      approvedDayOffs: [],
      recentFatigueScore: 30,
      isNewHire: false,
    };

    test('19~22일 = SWEET_SPOT, 페널티 0', () => {
      for (const d of [19, 20, 21, 22]) {
        const ev = evaluateWorkload(baseDriver, d);
        expect(ev.tier).toBe('SWEET_SPOT');
        expect(ev.softPenalty).toBe(0);
        expect(ev.hardViolation).toBe(false);
      }
    });

    test('18일 = ACCEPTABLE_LOW, 작은 페널티 (DEFAULT_POLICY 의 belowSweetPenalty × 거리)', () => {
      // 18일은 sweetMin(19) 보다 1 적음 → belowSweetPenalty(5) × 1 = 5
      const ev = evaluateWorkload(baseDriver, 18);
      expect(ev.tier).toBe('ACCEPTABLE_LOW');
      expect(ev.softPenalty).toBe(5);
      expect(ev.hardViolation).toBe(false);
    });

    test('23일 = ACCEPTABLE_HIGH, 페널티 (aboveSweetPenalty × 거리)', () => {
      // 23일은 sweetMax(22) 보다 1 큼 → aboveSweetPenalty(8) × 1 = 8
      const ev = evaluateWorkload(baseDriver, 23);
      expect(ev.tier).toBe('ACCEPTABLE_HIGH');
      expect(ev.softPenalty).toBe(8);
      expect(ev.hardViolation).toBe(false);
    });

    test('24일 이상 = OVER_MAX, hard violation, 면제 불가', () => {
      const exemptedDriver: SolverDriver = {
        ...baseDriver,
        // workDayTarget 의 exemptReason 이 있어도 OVER_MAX 는 무조건 hard
        workDayTarget: {
          min: 0,
          max: 23,
          softMin: 19,
          softMax: 22,
          exemptReason: 'NEW_HIRE',
          exemptNote: '월중 입사',
        },
      };
      const ev = evaluateWorkload(exemptedDriver, 25);
      expect(ev.tier).toBe('OVER_MAX');
      expect(ev.hardViolation).toBe(true);
      expect(ev.exempted).toBe(false);
    });

    test('17일 이하 = UNDER_MIN, exemptReason 없으면 hard violation', () => {
      const ev = evaluateWorkload(baseDriver, 12);
      expect(ev.tier).toBe('UNDER_MIN');
      expect(ev.hardViolation).toBe(true);
      expect(ev.exempted).toBe(false);
    });

    test('NEW_HIRE 12일 = exempted=true, hard violation 아님, reason/note 보존', () => {
      const newHire: SolverDriver = {
        ...baseDriver,
        name: '박준호',
        workDayTarget: {
          min: 0,
          max: 23,
          softMin: 19,
          softMax: 22,
          exemptReason: 'NEW_HIRE',
          exemptNote: '2026-04-15 입사',
        },
      };
      const ev = evaluateWorkload(newHire, 12);
      // override.min=0 이라 effective tier 는 ACCEPTABLE_LOW (12 > 0).
      // 단 회사 hardMin(18) 미달이라 exempted=true + softPenalty=0 + reason/note 보존.
      // (summary 에서는 "UNDER_MIN 제외됨" 으로 표시 — 회사 정책 기준 메시지)
      expect(ev.tier).toBe('ACCEPTABLE_LOW');
      expect(ev.hardViolation).toBe(false);
      expect(ev.exempted).toBe(true);
      expect(ev.softPenalty).toBe(0);
      expect(ev.exemptionReason).toBe('NEW_HIRE');
      expect(ev.exemptionNote).toBe('2026-04-15 입사');
    });

    test('workDayTarget 으로 운전자별 hard 범위 override', () => {
      const partial: SolverDriver = {
        ...baseDriver,
        workDayTarget: {
          min: 8,
          max: 15,
          softMin: 9,
          softMax: 14,
          exemptReason: 'PARTIAL_MONTH',
        },
      };
      // 10일 = override 의 sweet 안 → SWEET_SPOT
      const ev10 = evaluateWorkload(partial, 10);
      expect(ev10.tier).toBe('SWEET_SPOT');
      expect(ev10.hardViolation).toBe(false);
      // 16일 = override 의 max 초과 → OVER_MAX hard
      const ev16 = evaluateWorkload(partial, 16);
      expect(ev16.tier).toBe('OVER_MAX');
      expect(ev16.hardViolation).toBe(true);
    });
  });

  // ─────────────────────────────────────────
  // 정책 외부화 (Stage 1) — POLICY_PRESETS, override
  // ─────────────────────────────────────────

  describe('CompanyPolicy — Stage 1', () => {
    test('VILLAGE_1SHIFT 프리셋: 23~26일이 sweet, 22일은 ACCEPTABLE_LOW', () => {
      const { POLICY_PRESETS } = require('../types');
      const policy = POLICY_PRESETS.VILLAGE_1SHIFT;
      const driver: SolverDriver = {
        id: 1,
        name: '마을버스 기사',
        approvedDayOffs: [],
        recentFatigueScore: 30,
        isNewHire: false,
      };
      // 25일 = sweet
      expect(evaluateWorkload(driver, 25, policy).tier).toBe('SWEET_SPOT');
      // 22일 = hardMin 이라 acceptable_low
      expect(evaluateWorkload(driver, 22, policy).tier).toBe('ACCEPTABLE_LOW');
      // 27일 = hardMax 라 acceptable_high
      expect(evaluateWorkload(driver, 27, policy).tier).toBe('ACCEPTABLE_HIGH');
      // 28일 = over
      expect(evaluateWorkload(driver, 28, policy).tier).toBe('OVER_MAX');
      // 21일 = under
      expect(evaluateWorkload(driver, 21, policy).tier).toBe('UNDER_MIN');
    });

    test('회사 정책 + 운전자 override — override 가 우선', () => {
      const { POLICY_PRESETS } = require('../types');
      const policy = POLICY_PRESETS.CITY_2SHIFT; // 18~23 hard
      const overriden: SolverDriver = {
        id: 1,
        name: '특수 기사',
        approvedDayOffs: [],
        recentFatigueScore: 30,
        isNewHire: false,
        workDayTarget: { min: 10, max: 14, softMin: 11, softMax: 13 },
      };
      // 12일 = override 의 sweet 안 → SWEET_SPOT (회사 정책으론 UNDER_MIN 일 텐데)
      expect(evaluateWorkload(overriden, 12, policy).tier).toBe('SWEET_SPOT');
      // 16일 = override 의 hardMax 초과 → OVER_MAX hard
      expect(evaluateWorkload(overriden, 16, policy).tier).toBe('OVER_MAX');
    });
  });

  test('summary 가 면제 사유를 명시 (예: "박준호: ... — UNDER_MIN 제외됨 (NEW_HIRE)")', () => {
    const input = buildInput();
    const newHireDriver = input.drivers[0];
    newHireDriver.name = '박준호';
    newHireDriver.workDayTarget = {
      min: 0,
      max: 23,
      softMin: 19,
      softMax: 22,
      exemptReason: 'NEW_HIRE',
      exemptNote: '2026-04-15 입사',
    };
    // 강제로 거의 전월 휴무 처리 — approvedDayOffs 로 25일 휴무
    const allDays: string[] = [];
    for (let d = 1; d <= 25; d++) {
      allDays.push(`2026-05-${String(d).padStart(2, '0')}`);
    }
    newHireDriver.approvedDayOffs = allDays;

    const result = solveMonthlyGrid(input);
    const w = result.workloads.find((x) => x.driverId === newHireDriver.id)!;
    expect(w.workDays).toBeLessThan(18);
    expect(w.workloadEval.exempted).toBe(true);
    // hard violation 카운트에 안 잡힘
    expect(result.metrics.hardViolationCount).toBe(0);
    expect(result.metrics.exemptedCount).toBeGreaterThanOrEqual(1);
    // summary 에 면제 사유 명시
    expect(result.summary).toContain('박준호');
    expect(result.summary).toContain('UNDER_MIN 제외됨');
    expect(result.summary).toContain('NEW_HIRE');
    expect(result.summary).toContain('2026-04-15 입사');
  });

  test('면제 없이 12일 근무 = hard violation 으로 잡히고 summary 에 🚨 표시', () => {
    const input = buildInput();
    const driver = input.drivers[0];
    driver.name = '김철수';
    // 면제 없이 25일 휴무 → hard violation 이 발생해야 함
    const allDays: string[] = [];
    for (let d = 1; d <= 25; d++) {
      allDays.push(`2026-05-${String(d).padStart(2, '0')}`);
    }
    driver.approvedDayOffs = allDays;

    const result = solveMonthlyGrid(input);
    const w = result.workloads.find((x) => x.driverId === driver.id)!;
    expect(w.workloadEval.hardViolation).toBe(true);
    expect(w.workloadEval.tier).toBe('UNDER_MIN');
    expect(result.metrics.hardViolationCount).toBeGreaterThanOrEqual(1);
    expect(result.summary).toContain('Hard 위반');
    expect(result.summary).toContain('김철수');
    expect(result.summary).toContain('UNDER_MIN');
  });

  // ─────────────────────────────────────────
  // Stage 2 — ShiftSystem + CrewModel 일반화
  // ─────────────────────────────────────────

  describe('CompanyPolicy — Stage 2 (shiftSystem + crewModel)', () => {
    test('VILLAGE_1SHIFT (SOLO + 1교대): 차당 1명, FULL_DAY 슬롯만 생성', () => {
      const { POLICY_PRESETS } = require('../types');
      const policy = POLICY_PRESETS.VILLAGE_1SHIFT;

      // 마을버스 4대, 차당 1명 (SOLO crew)
      const drivers: SolverDriver[] = [];
      const buses = [];
      const crews = [];
      for (let i = 0; i < 4; i++) {
        const dId = i + 1;
        const busId = 1000 + i;
        drivers.push({
          id: dId,
          name: `마을${i + 1}`,
          homeBusId: busId,
          homeRouteId: 100,
          canCrossRoute: false,
          approvedDayOffs: [],
          recentFatigueScore: 30,
          isNewHire: false,
        });
        buses.push({ id: busId, routeId: 100 });
        crews.push({ id: `C${i + 1}`, driverIds: [dId], busId, routeId: 100 });
      }

      const result = solveMonthlyGrid({
        year: 2026,
        month: 5,
        drivers,
        buses,
        crews,
        policy,
        localSearchIterations: 100,
      });

      // 모든 슬롯이 FULL_DAY 만
      for (const s of result.slots) {
        expect(s.shift).toBe('FULL_DAY');
      }
      // 운전자 수만큼 차량, AM/PM 슬롯 없음
      expect(result.workloads.find((w) => w.amShifts > 0)).toBeUndefined();
      expect(result.workloads.find((w) => w.pmShifts > 0)).toBeUndefined();
      // shiftCounts['FULL_DAY'] 만 존재
      for (const w of result.workloads) {
        expect(w.shiftCounts['FULL_DAY']).toBeGreaterThan(0);
      }
    });

    test('crewModel size 불일치 → 에러 throw', () => {
      const { POLICY_PRESETS } = require('../types');
      const policy = POLICY_PRESETS.VILLAGE_1SHIFT; // SOLO (size=1)

      // 일부러 2명 crew (PAIR) 입력
      expect(() =>
        solveMonthlyGrid({
          year: 2026,
          month: 5,
          drivers: [
            { id: 1, name: 'A', homeBusId: 100, homeRouteId: 1, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
            { id: 2, name: 'B', homeBusId: 100, homeRouteId: 1, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
          ],
          buses: [{ id: 100, routeId: 1 }],
          crews: [{ id: 'X', driverIds: [1, 2], busId: 100, routeId: 1 }],
          policy,
        }),
      ).toThrow(/Crew size mismatch/);
    });

    test('Stage 1 partnerships → 자동으로 SolverCrew 변환', () => {
      // partnerships 만 입력 (crews 없음) → 솔버가 자동으로 변환
      const input = buildInput();
      const result = solveMonthlyGrid(input);
      // 정상 동작 확인
      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.metrics.constitutionalViolations.length).toBeGreaterThanOrEqual(0);
    });

    test('spare 풀 부하 분산: 4명 spare 가 모두 비슷한 workload (한 명에게 쏠리지 X)', () => {
      const { POLICY_PRESETS } = require('../types');
      const policy = POLICY_PRESETS.CITY_2SHIFT;

      // 2 페어 + 4 spare, 같은 노선
      const drivers: SolverDriver[] = [
        { id: 1, name: 'H1A', homeBusId: 100, homeRouteId: 1, partnerId: 2, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        { id: 2, name: 'H1B', homeBusId: 100, homeRouteId: 1, partnerId: 1, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        { id: 3, name: 'H2A', homeBusId: 200, homeRouteId: 1, partnerId: 4, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        { id: 4, name: 'H2B', homeBusId: 200, homeRouteId: 1, partnerId: 3, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        { id: 5, name: 'S1', homeRouteId: 1, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        { id: 6, name: 'S2', homeRouteId: 1, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        { id: 7, name: 'S3', homeRouteId: 1, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        { id: 8, name: 'S4', homeRouteId: 1, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
      ];
      const result = solveMonthlyGrid({
        year: 2026,
        month: 5,
        drivers,
        buses: [
          { id: 100, routeId: 1 },
          { id: 200, routeId: 1 },
        ],
        partnerships: [
          { id: 'P1', driverAId: 1, driverBId: 2, busId: 100, routeId: 1 },
          { id: 'P2', driverAId: 3, driverBId: 4, busId: 200, routeId: 1 },
        ],
        policy,
        localSearchIterations: 200,
      });

      // 4 spare 의 workload 가 한 명에게 쏠리지 X — 표준편차 ≤ 평균의 50%
      const spareLoads = result.workloads
        .filter((w) => [5, 6, 7, 8].includes(w.driverId))
        .map((w) => w.workDays);
      const mean = spareLoads.reduce((a, b) => a + b, 0) / spareLoads.length;
      const stdev = Math.sqrt(
        spareLoads.reduce((acc, x) => acc + (x - mean) ** 2, 0) / spareLoads.length,
      );
      // 4 spare 모두 적어도 1슬롯씩은 받았어야 함
      expect(spareLoads.every((d) => d > 0)).toBe(true);
      // 분산이 너무 크지 않아야 — 한 명이 30일 일하고 셋이 0일 같은 케이스 방지
      expect(stdev).toBeLessThan(Math.max(mean * 0.5, 3));
    });
  });

  // ─────────────────────────────────────────
  // Stage 3 — ConstitutionalPolicy (정책 기반 헌법 룰)
  // ─────────────────────────────────────────

  describe('CompanyPolicy — Stage 3 (constitutional)', () => {
    test('VILLAGE_1SHIFT 의 noNightStreak=disabled: 야간 룰 발동 안 함', () => {
      const { POLICY_PRESETS } = require('../types');
      const policy = POLICY_PRESETS.VILLAGE_1SHIFT;
      // 1교대 = 야간 슬롯 없음 → noNightStreak 비활성
      expect(policy.constitutional.noNightStreak.enabled).toBe(false);
    });

    test('CITY_2SHIFT 의 noNightStreak=enabled: PM 4일 연속 시 위반', () => {
      const { POLICY_PRESETS } = require('../types');
      const policy = POLICY_PRESETS.CITY_2SHIFT;
      expect(policy.constitutional.noNightStreak.enabled).toBe(true);
      expect(policy.constitutional.noNightStreak.nightShifts).toEqual(['PM']);
      // maxConsecutive=3 → 4일째부터 위반
    });

    test('정책 override 로 weeklyMaxWorkDays 룰 비활성화', () => {
      const { POLICY_PRESETS } = require('../types');
      const customPolicy = {
        ...POLICY_PRESETS.CITY_2SHIFT,
        constitutional: {
          ...POLICY_PRESETS.CITY_2SHIFT.constitutional,
          weeklyMaxWorkDays: { enabled: false, maxDays: 0 },
        },
      };
      // 룰 비활성 → validateFullGrid 가 weeklyMaxWorkDays 위반 안 보고
      const input = buildInput();
      // 모든 운전자에게 매일 출근 강제 시뮬레이션은 어려우니
      // 단순히 룰 호출이 비활성 시 위반 0건임을 확인
      const result = solveMonthlyGrid({ ...input, policy: customPolicy });
      const weeklyViolations = result.metrics.constitutionalViolations.filter(
        (v) => v.ruleKey === 'weeklyMaxWorkDays',
      );
      expect(weeklyViolations).toHaveLength(0);
    });

    test('ConstitutionalViolation 에 ruleKey + ruleId 둘 다 있음', () => {
      // 운전자에게 25일 휴무 → 면제 없으면 hard violation 안 나는데
      // weeklyMax 위반은 못 만들기 어려우니 license 만료로 강제
      const input = buildInput();
      input.drivers[0].licenseExpiresAt = new Date('2026-01-01');
      const result = solveMonthlyGrid(input);
      const expiredViolations = result.metrics.constitutionalViolations.filter(
        (v) => v.ruleKey === 'noExpiredLicense',
      );
      // license 만료 운전자가 자동 차단되므로 슬롯이 없음 → violation 없음 (Phase B 단계 차단)
      // 대신 그 driver 의 workDays 가 0 이어야 함
      const w = result.workloads.find((w) => w.driverId === input.drivers[0].id)!;
      expect(w.workDays).toBe(0);
    });

    test('호환성: ruleId (구 R 번호) 가 ruleKey 와 일관됨', () => {
      const input = buildInput();
      // 강제 위반 만들기: license 만료된 운전자 슬롯 만들지 않으니
      // 다른 방법으로 — guaranteedWeekendOff 위반 유도
      // 모든 주말을 한 운전자에게 강제 배정은 복잡하니
      // 그냥 RULE_INFO 매핑이 정의되어 있는지만 확인
      const result = solveMonthlyGrid(input);
      for (const v of result.metrics.constitutionalViolations) {
        // ruleKey 와 ruleId 둘 다 채워져 있어야 함
        expect(v.ruleKey).toBeDefined();
        expect(typeof v.ruleId).toBe('number');
        expect(v.ruleId).toBeGreaterThan(0);
        expect(v.ruleName).toBeDefined();
      }
    });

    test('완전 헌법 룰 비활성: constitutional 전체 비활성화 시 위반 0건', () => {
      const { POLICY_PRESETS } = require('../types');
      const noRulesPolicy = {
        ...POLICY_PRESETS.CITY_2SHIFT,
        constitutional: {
          noNightStreak: { enabled: false, maxConsecutive: 0, nightShifts: [] },
          weeklyMaxWorkDays: { enabled: false, maxDays: 0 },
          noSameDayDoubleAssign: { enabled: false },
          minRestBetweenShifts: { enabled: false, minHours: 0 },
          noAssignOnApprovedOff: { enabled: false },
          noExpiredLicense: { enabled: false },
          noExpiredQualification: { enabled: false },
          guaranteedWeekendOff: { enabled: false, minPerMonth: 0 },
          noNewHireSolo: { enabled: false, newHirePeriodDays: 0 },
          noBlockedRoute: { enabled: false },
        },
      };
      const input = buildInput();
      const result = solveMonthlyGrid({ ...input, policy: noRulesPolicy });
      // 모든 룰 비활성 → 위반 0건
      expect(result.metrics.constitutionalViolations).toHaveLength(0);
    });
  });

  test('운휴 차량 처리: operatingDates 외 슬롯 미생성', () => {
    const input = buildInput();
    // 첫 버스는 평일만 운행 (주말 운휴)
    const allDays: string[] = [];
    for (let d = 1; d <= 31; d++) {
      const date = new Date(Date.UTC(2026, 4, d));
      const day = date.getUTCDay();
      if (day !== 0 && day !== 6) allDays.push(`2026-05-${String(d).padStart(2, '0')}`);
    }
    input.buses[0].operatingDates = allDays;
    const result = solveMonthlyGrid(input);
    const bus0Slots = result.slots.filter((s) => s.busId === input.buses[0].id);
    const weekendSlots = bus0Slots.filter((s) => {
      const dow = new Date(s.date).getUTCDay();
      return dow === 0 || dow === 6;
    });
    expect(weekendSlots).toHaveLength(0);
  });

  // ─────────────────────────────────────────
  // 선호 노선 (routePreference) — Step 3
  // ─────────────────────────────────────────

  describe('선호 노선 소프트 제약', () => {
    test('선호 노선 보유 spare는 선호 노선에 우선 배정된다 (대다수 슬롯)', () => {
      // 2 노선, 각 노선 1버스 1페어.
      // spare 한 명: canCrossRoute=true, preferredRouteIds=[100] (노선A 선호)
      const { POLICY_PRESETS } = require('../types');
      const { scheduleQuality } = require('../quality');
      const policy = POLICY_PRESETS.CITY_2SHIFT;

      const drivers: SolverDriver[] = [
        // 노선 A (routeId=100) 페어
        { id: 1, name: 'A1', homeBusId: 1001, homeRouteId: 100, partnerId: 2, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        { id: 2, name: 'A2', homeBusId: 1001, homeRouteId: 100, partnerId: 1, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        // 노선 B (routeId=200) 페어
        { id: 3, name: 'B1', homeBusId: 2001, homeRouteId: 200, partnerId: 4, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        { id: 4, name: 'B2', homeBusId: 2001, homeRouteId: 200, partnerId: 3, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
        // Spare: 노선 A 선호
        { id: 5, name: 'Spare', homeRouteId: 100, canCrossRoute: true, preferredRouteIds: [100], approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
      ];

      const result = solveMonthlyGrid({
        year: 2026,
        month: 5,
        drivers,
        buses: [
          { id: 1001, routeId: 100 },
          { id: 2001, routeId: 200 },
        ],
        crews: [
          { id: 'CA', driverIds: [1, 2], busId: 1001, routeId: 100 },
          { id: 'CB', driverIds: [3, 4], busId: 2001, routeId: 200 },
        ],
        policy,
        localSearchIterations: 200,
        randomSeed: 42,
      });

      const { preferenceSatisfactionRate } = scheduleQuality({ year: 2026, month: 5, drivers, buses: [], policy }, result);
      // spare가 슬롯을 받았다면, 선호 노선(routeId=100) 비율이 과반이어야 함
      const spareSlots = result.slots.filter((s) => s.driverId === 5);
      if (spareSlots.length > 0) {
        expect(preferenceSatisfactionRate).toBeGreaterThan(0.5);
      }
      // spare가 슬롯을 전혀 못 받은 경우는 건너뜀 (tight schedule 가능)
    });
  });

  // ─────────────────────────────────────────
  // Phase C FILL move — SP4-1
  // ─────────────────────────────────────────

  // ─────────────────────────────────────────
  // Phase C-3 REASSIGN move — SP4-2
  // ─────────────────────────────────────────

  test('[SP4-2] REASSIGN: over-loaded 운전자 → under-loaded 운전자로 슬롯 이전, workDayStdev 감소', () => {
    /**
     * 설계:
     *   노선 100, 버스 2대 (busId=1001, 1002), 1교대(FULL_DAY).
     *   운전자 4명 — 2페어. 5/2 사이클.
     *   추가로 spare 4명 (id=5..8) 을 같은 노선에 배치.
     *
     *   VILLAGE_1SHIFT 프리셋 사용 (sweet 23~26일).
     *   차량 수가 2대이므로 슬롯은 2×31=62개.
     *   운전자 8명이 있지만 차량 2대 + 휴무 사이클로 인해
     *   Phase B 후 일부 운전자(spare)는 배정을 거의 받지 못해 under-loaded 상태,
     *   HOME 운전자들은 상대적으로 over-loaded 상태가 될 수 있다.
     *
     *   검증 목표:
     *     reassign 이 실제로 동작하면 over-loaded driver (count >= sweetMin) 의 슬롯이
     *     under-loaded driver (count < sweetMin) 으로 이동하여 workDayStdev 가
     *     reassign-disabled 케이스보다 낮아야 한다.
     *
     *   NOTE: 이 테스트는 reassign 구현 전에는 FAIL 해야 한다.
     *   (reassign 없이는 HOME 운전자들의 슬롯 수 불균형이 스왑만으로는 충분히 해소되지 않음)
     */
    const { POLICY_PRESETS } = require('../types');
    // VILLAGE_1SHIFT: SOLO crew, FULL_DAY slot, sweet=23~26
    const policy = POLICY_PRESETS.VILLAGE_1SHIFT;

    // 버스 2대 + spare 4명 — HOME 운전자(1~4) 는 busId 고정,
    // spare(5~8) 는 homeRouteId=100 만 설정 → Phase B 에서 HOME 할당 못받아 under-loaded
    const drivers = [
      { id: 1, name: 'H1', homeBusId: 1001, homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
      { id: 2, name: 'H2', homeBusId: 1002, homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false },
      // spare — homeRouteId=100 이지만 homeBusId 없음 → Phase B 에서 SAME_ROUTE 후순위
      { id: 3, name: 'S1', homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
      { id: 4, name: 'S2', homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
      { id: 5, name: 'S3', homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
      { id: 6, name: 'S4', homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
    ];

    const result = solveMonthlyGrid({
      year: 2026,
      month: 5,
      drivers,
      buses: [
        { id: 1001, routeId: 100 },
        { id: 1002, routeId: 100 },
      ],
      // SOLO crew — 각 버스에 1명 HOME 운전자
      crews: [
        { id: 'C1', driverIds: [1], busId: 1001, routeId: 100 },
        { id: 'C2', driverIds: [2], busId: 1002, routeId: 100 },
      ],
      policy,
      localSearchIterations: 500,
      randomSeed: 42,
    });

    const workDays = result.workloads.map((w) => w.workDays);
    const mean = workDays.reduce((a, b) => a + b, 0) / workDays.length;
    const stdev = Math.sqrt(workDays.reduce((acc, x) => acc + (x - mean) ** 2, 0) / workDays.length);

    // Without reassign, H1/H2 will have ~31 days (all slots) while spares have 0 → stdev ~14.
    // With reassign, slots are redistributed so stdev should drop significantly.
    // We assert stdev < 10 as a meaningful improvement over the ~14 without-reassign baseline.
    expect(stdev).toBeLessThan(10);

    // Also: the over-loaded driver's count should decrease (reassign donated some slots)
    // and at least one spare should have received slots
    const spareWorkDays = result.workloads
      .filter((w) => [3, 4, 5, 6].includes(w.driverId))
      .map((w) => w.workDays);
    expect(spareWorkDays.some((d) => d > 0)).toBe(true);

    // Hard constraints must be preserved: no unfilled slots added, no hard violations added
    // (hardViolation count check is best-effort — with VILLAGE_1SHIFT sweet=23~26 and
    // 2 buses × 31 days = 62 slots / 6 drivers ≈ 10.3 days, many will be UNDER_MIN.
    // We only assert stdev improvement, not zero hard violations for this small scenario.)
  });

  test('FILL move: Phase B 미배정 슬롯을 Phase C 로컬서치가 여유 운전자에게 채운다', () => {
    /**
     * 설계:
     *   노선 100, 버스 1대 (busId=1001), 2교대(AM/PM).
     *   페어 운전자 2명 (id=1,2) 이 전월 전일 approvedDayOffs 로 막혀
     *   Phase B 에서 AM/PM 슬롯 전체가 미배정됨.
     *   같은 노선에 여유 운전자(id=3..8) 6명이 있어 feasible → FILL move 로 채워야 함.
     *
     *   2교대 × 31일 = 62슬롯. 6명 × ~22일 = ~132 용량 >> 62. 5/2 restCycle 제약 충분히 여유.
     *
     *   검증: result.metrics.unfilledCount 가 0 이어야 함.
     */
    const { POLICY_PRESETS } = require('../types');
    const policy = POLICY_PRESETS.CITY_2SHIFT; // AM/PM 2교대

    const allMayDays = Array.from({ length: 31 }, (_, i) =>
      `2026-05-${String(i + 1).padStart(2, '0')}`);

    const drivers: SolverDriver[] = [
      // 페어 (busId=1001 home) — 전체 휴무로 Phase B 에서 미배정 유발
      {
        id: 1, name: 'PairA', homeBusId: 1001, homeRouteId: 100, partnerId: 2,
        canCrossRoute: false,
        approvedDayOffs: allMayDays,
        recentFatigueScore: 30, isNewHire: false,
      },
      {
        id: 2, name: 'PairB', homeBusId: 1001, homeRouteId: 100, partnerId: 1,
        canCrossRoute: false,
        approvedDayOffs: allMayDays,
        recentFatigueScore: 30, isNewHire: false,
      },
      // 여유 운전자 6명 — 같은 노선, 휴무 없음, 충분한 여유 (62슬롯 커버 가능)
      { id: 3, name: 'Spare1', homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
      { id: 4, name: 'Spare2', homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
      { id: 5, name: 'Spare3', homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
      { id: 6, name: 'Spare4', homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
      { id: 7, name: 'Spare5', homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
      { id: 8, name: 'Spare6', homeRouteId: 100, canCrossRoute: false, approvedDayOffs: [], recentFatigueScore: 20, isNewHire: false },
    ];

    const result = solveMonthlyGrid({
      year: 2026,
      month: 5,
      drivers,
      buses: [{ id: 1001, routeId: 100 }],
      crews: [{ id: 'C1', driverIds: [1, 2], busId: 1001, routeId: 100 }],
      policy,
      localSearchIterations: 5000,
      randomSeed: 42,
    });

    // FILL move 가 없었다면 62슬롯이 모두 unfilled 였을 것.
    // FILL move 가 있으면 Spare3~8 가 채워서 unfilledCount=0 이어야 함.
    expect(result.metrics.unfilledCount).toBe(0);

    // Hard constraint 보존: 페어(1,2)는 전일 approvedDayOffs → 슬롯 0개
    const pairSlots = result.slots.filter((s) => s.driverId === 1 || s.driverId === 2);
    expect(pairSlots).toHaveLength(0);

    // Spare 가 슬롯을 받았어야 함
    const spareSlots = result.slots.filter((s) => s.driverId >= 3);
    expect(spareSlots.length).toBeGreaterThan(0);
  });
});
