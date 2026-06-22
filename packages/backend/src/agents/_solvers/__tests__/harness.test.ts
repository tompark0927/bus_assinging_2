import { runSuite, aggregate, evaluateGates, compareToBaseline, DEFAULT_GATES } from '../bench/harness';
import { SCENARIO_SUITE } from '../bench/scenarios';

describe('harness', () => {
  it('runSuite는 각 시나리오에 대해 결과(또는 error)를 반환한다', () => {
    const small = SCENARIO_SUITE.filter((s) => s.label.startsWith('small-city')).slice(0, 1);
    const results = runSuite(small);
    expect(results.length).toBe(small.length);
    expect(results[0].label).toBe(small[0].label);
    expect(results[0].error).toBeUndefined();
    expect(results[0].quality?.compositeScore).toBeGreaterThanOrEqual(0);
  });

  it('aggregate는 지표별 min/median/p25/mean을 낸다', () => {
    const stats = aggregate([
      { label: 'a', spec: {} as never, elapsedMs: 1, quality: q(80) },
      { label: 'b', spec: {} as never, elapsedMs: 1, quality: q(60) },
      { label: 'c', spec: {} as never, elapsedMs: 1, quality: q(100) },
    ]);
    expect(stats.compositeScore.min).toBe(60);
    expect(stats.compositeScore.median).toBe(80);
    expect(stats.compositeScore.mean).toBeCloseTo(80, 5);
  });

  it('evaluateGates는 절대 목표 위반을 잡는다', () => {
    const bad = [{ label: 'x', spec: {} as never, elapsedMs: 1, quality: { ...q(50), hardViolationCount: 3 } }];
    const report = evaluateGates(bad, DEFAULT_GATES);
    expect(report.passed).toBe(false);
    expect(report.failures.some((f) => f.includes('hardViolationCount'))).toBe(true);
  });

  it('compareToBaseline은 지표 델타를 만든다', () => {
    const cur = aggregate([{ label: 'a', spec: {} as never, elapsedMs: 1, quality: q(90) }]);
    const base = aggregate([{ label: 'a', spec: {} as never, elapsedMs: 1, quality: q(70) }]);
    const delta = compareToBaseline(cur, base);
    expect(delta.compositeScore.delta).toBeCloseTo(20, 5);
  });

  it('aggregate는 nullable 지표를 non-null 값만으로 집계하고, 전부 null이면 null이다', () => {
    const stats = aggregate([
      { label: 'a', spec: {} as never, elapsedMs: 1, quality: { ...q(80), spareUtilizationRate: 0.4 } },
      { label: 'b', spec: {} as never, elapsedMs: 1, quality: { ...q(80), spareUtilizationRate: null } },
      { label: 'c', spec: {} as never, elapsedMs: 1, quality: { ...q(80), spareUtilizationRate: 0.6 } },
    ]);
    // sorted [0.4, 0.6], percentile(0.5): idx = floor(0.5 * (2-1)) = 0 → 0.4
    expect(stats.spareUtilizationRate?.median).toBeCloseTo(0.4, 5);
    expect(stats.dayOffSatisfactionRate).toBeNull();
  });
});

function q(composite: number, overrides: Record<string, unknown> = {}) {
  return {
    workDayStdev: 0, nightStdev: 0, weekendStdev: 0, activeDriverRate: 1, spareUtilizationRate: null,
    idleDriverCount: 0, unfilledRate: 0, homeBusRate: 1, crossRouteRate: 0, preferenceSatisfactionRate: null,
    dayOffSatisfactionRate: null, hardViolationCount: 0, exemptedCount: 0, constitutionalViolationCount: 0, constitutionalByRule: {},
    restCycleCompliance: 1, compositeScore: composite,
    ...overrides,
  };
}
