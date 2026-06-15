import type { SolverInput, SolverOutput, ConstitutionalRuleKey, ShiftSystemPolicy } from './types';

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
function nightLabels(shiftSystem: ShiftSystemPolicy): Set<string> {
  switch (shiftSystem.kind) {
    case 'TWO_SHIFT': return new Set(['PM']);
    case 'THREE_SHIFT': return new Set(['NIGHT']);
    default: return new Set<string>();
  }
}
function isWeekendDate(isoDate: string): boolean {
  const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
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

  const policy = input.policy;
  const nightSet = policy ? nightLabels(policy.shiftSystem) : new Set<string>();
  const nightById = new Map<number, number>();
  const weekendById = new Map<number, number>();
  for (const d of drivers) { nightById.set(d.id, 0); weekendById.set(d.id, 0); }
  for (const s of output.slots) {
    if (nightSet.has(s.shift)) nightById.set(s.driverId, (nightById.get(s.driverId) ?? 0) + 1);
    if (isWeekendDate(s.date)) weekendById.set(s.driverId, (weekendById.get(s.driverId) ?? 0) + 1);
  }

  const spareIds = drivers.filter((d) => d.homeBusId === undefined).map((d) => d.id);
  const homeIds = drivers.filter((d) => d.homeBusId !== undefined).map((d) => d.id);
  const avg = (ids: number[]) => ids.length === 0 ? 0 : ids.reduce((s, id) => s + (workDaysById.get(id) ?? 0), 0) / ids.length;
  let spareUtilizationRate: number | null = null;
  if (spareIds.length > 0) {
    const homeAvg = avg(homeIds);
    spareUtilizationRate = homeAvg === 0 ? 0 : clamp(avg(spareIds) / homeAvg, 0, 1);
  }

  const report: QualityReport = {
    workDayStdev: stdev(workDays),
    nightStdev: stdev(drivers.map((d) => nightById.get(d.id) ?? 0)),
    weekendStdev: stdev(drivers.map((d) => weekendById.get(d.id) ?? 0)),
    activeDriverRate,
    spareUtilizationRate,
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
