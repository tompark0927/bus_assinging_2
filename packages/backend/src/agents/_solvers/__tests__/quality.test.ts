import { scheduleQuality } from '../quality';
import type { SolverInput, SolverOutput, AssignedSlot, SolverDriver } from '../types';
import { POLICY_PRESETS } from '../types';

function driver(id: number, extra: Partial<SolverDriver> = {}): SolverDriver {
  return {
    id, name: `D${id}`, homeBusId: 100 + id, homeRouteId: 1,
    approvedDayOffs: [], recentFatigueScore: 30, isNewHire: false, ...extra,
  };
}
function slot(driverId: number, date: string, shift = 'AM'): AssignedSlot {
  return { date, busId: 100 + driverId, routeId: 1, shift, driverId, familiarity: 'HOME', isHomeBus: true };
}
function output(slots: AssignedSlot[], unfilled = 0): SolverOutput {
  return {
    slots,
    unfilled: Array.from({ length: unfilled }, () => ({ date: '2026-05-01', busId: 999, routeId: 1, shift: 'AM', reason: 'no candidate' })),
    workloads: [],
    metrics: {
      fairnessScore: 0, workDayStdev: 0, workDayMean: 0, withinTargetRate: 0, withinAcceptableRate: 0,
      hardViolationCount: 0, exemptedCount: 0, homeBusRate: 0, crossRouteRate: 0, restCycleCompliance: 1,
      weeklyShiftConsistencyRate: 0, weekendStdev: 0, dayOffSatisfactionRate: 1,
      constitutionalViolations: [], unfilledCount: unfilled, localSearchSwaps: 0,
    },
    summary: '',
  };
}
function baseInput(drivers: SolverDriver[]): SolverInput {
  return { year: 2026, month: 5, drivers, buses: [], crews: [], policy: POLICY_PRESETS.CITY_2SHIFT };
}

describe('scheduleQuality — 근무일 균형', () => {
  it('일을 전혀 안 받은 기사도 stdev/idle 집계에 포함한다', () => {
    const input = baseInput([driver(1), driver(2)]);
    const out = output([slot(1, '2026-05-01'), slot(1, '2026-05-02')]);
    const q = scheduleQuality(input, out);
    expect(q.idleDriverCount).toBe(1);
    expect(q.activeDriverRate).toBeCloseTo(0.5, 5);
    expect(q.workDayStdev).toBeCloseTo(1, 5);
  });
  it('완전 균등하면 stdev=0, idle=0', () => {
    const input = baseInput([driver(1), driver(2)]);
    const out = output([slot(1, '2026-05-01'), slot(2, '2026-05-01')]);
    const q = scheduleQuality(input, out);
    expect(q.workDayStdev).toBeCloseTo(0, 5);
    expect(q.idleDriverCount).toBe(0);
    expect(q.activeDriverRate).toBeCloseTo(1, 5);
  });
  it('미배정 비율을 계산한다', () => {
    const input = baseInput([driver(1)]);
    const out = output([slot(1, '2026-05-01')], 1);
    const q = scheduleQuality(input, out);
    expect(q.unfilledRate).toBeCloseTo(0.5, 5);
  });
});

describe('scheduleQuality — 야간/주말 라벨 정규화', () => {
  it('PM(2교대 야간) 분포를 nightStdev로 잡는다 (AM/PM 라벨 버그 회귀 방지)', () => {
    const input = baseInput([driver(1), driver(2)]);
    const out = output([
      slot(1, '2026-05-05', 'PM'), slot(1, '2026-05-06', 'PM'),
      slot(2, '2026-05-05', 'AM'), slot(2, '2026-05-06', 'AM'),
    ]);
    const q = scheduleQuality(input, out);
    expect(q.nightStdev).toBeGreaterThan(0);
    expect(q.nightStdev).toBeCloseTo(1, 5);
  });
  it('주말 근무 분포를 weekendStdev로 잡는다', () => {
    const input = baseInput([driver(1), driver(2)]);
    const out = output([slot(1, '2026-05-02', 'AM'), slot(2, '2026-05-01', 'AM')]);
    const q = scheduleQuality(input, out);
    expect(q.weekendStdev).toBeCloseTo(0.5, 5);
  });
});

describe('scheduleQuality — SPARE 활용률', () => {
  it('SPARE(홈버스 없음) 활용률 = SPARE평균 / HOME평균', () => {
    const home = driver(1, { homeBusId: 101 });
    const spare = driver(2, { homeBusId: undefined, canCrossRoute: true });
    const input = baseInput([home, spare]);
    const out = output([
      slot(1, '2026-05-01'), slot(1, '2026-05-02'), slot(1, '2026-05-03'), slot(1, '2026-05-04'),
      { date: '2026-05-01', busId: 200, routeId: 1, shift: 'AM', driverId: 2, familiarity: 'SAME_ROUTE', isHomeBus: false },
      { date: '2026-05-02', busId: 200, routeId: 1, shift: 'AM', driverId: 2, familiarity: 'SAME_ROUTE', isHomeBus: false },
    ]);
    expect(scheduleQuality(input, out).spareUtilizationRate).toBeCloseTo(0.5, 5);
  });
  it('SPARE가 없으면 null', () => {
    const input = baseInput([driver(1, { homeBusId: 101 })]);
    expect(scheduleQuality(input, output([slot(1, '2026-05-01')])).spareUtilizationRate).toBeNull();
  });
});

describe('scheduleQuality — 선호 휴무 + 종합 점수', () => {
  it('선호 휴무를 지킨 비율을 계산한다', () => {
    const d1 = driver(1, { preferredDayOffs: ['2026-05-10', '2026-05-11'] });
    const input = baseInput([d1]);
    const out = output([slot(1, '2026-05-10')]);
    expect(scheduleQuality(input, out).dayOffSatisfactionRate).toBeCloseTo(0.5, 5);
  });
  it('선호 휴무가 아무에게도 없으면 null', () => {
    const input = baseInput([driver(1)]);
    expect(scheduleQuality(input, output([slot(1, '2026-05-01')])).dayOffSatisfactionRate).toBeNull();
  });
  it('compositeScore는 0~100 범위이고 완벽한 그리드일수록 높다', () => {
    const input = baseInput([driver(1), driver(2)]);
    const balanced = output([slot(1, '2026-05-01'), slot(2, '2026-05-01')]);
    const q = scheduleQuality(input, balanced);
    expect(q.compositeScore).toBeGreaterThanOrEqual(0);
    expect(q.compositeScore).toBeLessThanOrEqual(100);
    const worse = output([slot(1, '2026-05-01'), slot(1, '2026-05-02')], 2);
    expect(scheduleQuality(input, worse).compositeScore).toBeLessThan(q.compositeScore);
  });
});
