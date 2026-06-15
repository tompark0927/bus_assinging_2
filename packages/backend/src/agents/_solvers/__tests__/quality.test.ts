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
