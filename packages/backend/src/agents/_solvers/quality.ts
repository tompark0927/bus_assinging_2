import type { SolverInput, SolverOutput, ConstitutionalRuleKey } from './types';

export interface QualityReport {
  workDayStdev: number;
  nightStdev: number;
  weekendStdev: number;
  activeDriverRate: number;
  spareUtilizationRate: number | null;
  idleDriverCount: number;
  unfilledRate: number;
  homeBusRate: number;
  crossRouteRate: number;
  preferenceSatisfactionRate: number | null;
  dayOffSatisfactionRate: number | null;
  hardViolationCount: number;
  constitutionalViolationCount: number;
  constitutionalByRule: Partial<Record<ConstitutionalRuleKey, number>>;
  restCycleCompliance: number;
  compositeScore: number;
}

function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function scheduleQuality(input: SolverInput, output: SolverOutput): QualityReport {
  const drivers = input.drivers;
  const workDaysById = new Map<number, number>();
  for (const d of drivers) workDaysById.set(d.id, 0);
  for (const s of output.slots) workDaysById.set(s.driverId, (workDaysById.get(s.driverId) ?? 0) + 1);
  const workDays = drivers.map((d) => workDaysById.get(d.id) ?? 0);
  const idleDriverCount = workDays.filter((w) => w === 0).length;
  const activeDriverRate = drivers.length === 0 ? 0 : (drivers.length - idleDriverCount) / drivers.length;
  const totalSlots = output.slots.length + output.unfilled.length;
  const unfilledRate = totalSlots === 0 ? 0 : output.unfilled.length / totalSlots;

  const report: QualityReport = {
    workDayStdev: stdev(workDays),
    nightStdev: 0,
    weekendStdev: 0,
    activeDriverRate,
    spareUtilizationRate: null,
    idleDriverCount,
    unfilledRate,
    homeBusRate: output.metrics.homeBusRate,
    crossRouteRate: output.metrics.crossRouteRate,
    preferenceSatisfactionRate: null,
    dayOffSatisfactionRate: null,
    hardViolationCount: output.metrics.hardViolationCount,
    constitutionalViolationCount: output.metrics.constitutionalViolations.length,
    constitutionalByRule: {},
    restCycleCompliance: output.metrics.restCycleCompliance,
    compositeScore: 0,
  };
  return report;
}
