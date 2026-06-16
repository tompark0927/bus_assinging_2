import type { SolverInput, SolverOutput, ConstitutionalRuleKey, ShiftSystemPolicy, AssignedSlot } from './types';

/**
 * 품질 가중치 — 측정 전용 (솔버 objective 와 무관).
 *
 * 페널티 합계가 의도적으로 100을 초과하도록 설계되어 있어,
 * 최악의 일정도 0점 바닥에 고정됨. 아래의 clamp(..., 0, 100)은
 * 이를 위한 핵심 처리이며 제거해서는 안 됨.
 * 가중치는 일정 품질 측정용이며 솔버 목적함수와 독립적으로 동작함.
 */
const QUALITY_WEIGHTS = {
  workStdev: 8, nightStdev: 4, weekendStdev: 4, unfilledRate: 40,
  idleRatio: 20, hardViolationRatio: 30, constitutionalRatio: 30, restCycleShortfall: 30,
} as const;

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
  exemptedCount: number;
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
    case 'ONE_SHIFT':
    case 'ALTERNATING_DAY':
      return new Set<string>();
    default: {
      // 새 ShiftSystemPolicy.kind 추가 시 컴파일 에러로 누락 방지
      const _exhaustive: never = shiftSystem;
      void _exhaustive;
      return new Set<string>();
    }
  }
}
function isWeekendDate(isoDate: string): boolean {
  const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * 선호 노선 충족률 계산.
 * 선호 노선이 있고 ≥1 슬롯을 배정받은 기사에 대해,
 * 해당 기사 슬롯 중 선호 노선에 배정된 비율의 평균을 반환.
 * 해당 기사가 없으면 null.
 */
function computePreferenceSatisfactionRate(
  drivers: SolverInput['drivers'],
  slots: AssignedSlot[],
): number | null {
  // Build slot map per driver
  const slotsByDriver = new Map<number, AssignedSlot[]>();
  for (const s of slots) {
    const arr = slotsByDriver.get(s.driverId) ?? [];
    arr.push(s);
    slotsByDriver.set(s.driverId, arr);
  }

  const rates: number[] = [];
  for (const d of drivers) {
    if (!d.preferredRouteIds || d.preferredRouteIds.length === 0) continue;
    const driverSlots = slotsByDriver.get(d.id) ?? [];
    if (driverSlots.length === 0) continue;
    const prefSet = new Set(d.preferredRouteIds);
    const metCount = driverSlots.filter((s) => prefSet.has(s.routeId)).length;
    rates.push(metCount / driverSlots.length);
  }

  if (rates.length === 0) return null;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

export function scheduleQuality(input: SolverInput, output: SolverOutput): QualityReport {
  const drivers = input.drivers;
  // "rated" drivers = those without an exemption reason (partial-month new hires etc. are excluded from fairness metrics)
  const ratedDrivers = drivers.filter((d) => !d.workDayTarget?.exemptReason);

  // Build per-driver counts from ALL slots (keeps the maps authoritative for slot lookups)
  const workDaysById = new Map<number, number>();
  for (const d of drivers) workDaysById.set(d.id, 0);
  for (const s of output.slots) workDaysById.set(s.driverId, (workDaysById.get(s.driverId) ?? 0) + 1);

  const policy = input.policy;
  const nightSet = policy ? nightLabels(policy.shiftSystem) : new Set<string>();
  const nightById = new Map<number, number>();
  const weekendById = new Map<number, number>();
  for (const d of drivers) { nightById.set(d.id, 0); weekendById.set(d.id, 0); }
  for (const s of output.slots) {
    if (nightSet.has(s.shift)) nightById.set(s.driverId, (nightById.get(s.driverId) ?? 0) + 1);
    if (isWeekendDate(s.date)) weekendById.set(s.driverId, (weekendById.get(s.driverId) ?? 0) + 1);
  }

  // Fairness stats: only over ratedDrivers (exempted new-hires excluded)
  const ratedWorkDays = ratedDrivers.map((d) => workDaysById.get(d.id) ?? 0);
  const ratedNights = ratedDrivers.map((d) => nightById.get(d.id) ?? 0);
  const ratedWeekends = ratedDrivers.map((d) => weekendById.get(d.id) ?? 0);

  const idleDriverCount = ratedWorkDays.filter((w) => w === 0).length;
  const activeDriverRate = ratedDrivers.length === 0 ? 1 : (ratedDrivers.length - idleDriverCount) / ratedDrivers.length;

  const totalSlots = output.slots.length + output.unfilled.length;
  const unfilledRate = totalSlots === 0 ? 0 : output.unfilled.length / totalSlots;

  const workedKey = new Set(output.slots.map((s) => `${s.driverId}|${s.date}`));
  let prefTotal = 0, prefMet = 0;
  for (const d of drivers) {
    for (const day of d.preferredDayOffs ?? []) {
      prefTotal += 1;
      if (!workedKey.has(`${d.id}|${day}`)) prefMet += 1;
    }
  }
  const dayOffSatisfactionRate = prefTotal === 0 ? null : prefMet / prefTotal;

  const constitutionalByRule: Partial<Record<ConstitutionalRuleKey, number>> = {};
  for (const v of output.metrics.constitutionalViolations) {
    constitutionalByRule[v.ruleKey] = (constitutionalByRule[v.ruleKey] ?? 0) + 1;
  }

  const n = Math.max(1, drivers.length);
  const idleRatio = ratedDrivers.length === 0 ? 0 : idleDriverCount / ratedDrivers.length;
  const hardViolationRatio = output.metrics.hardViolationCount / n;
  const constitutionalRatio = output.metrics.constitutionalViolations.length / n;
  const composite =
    100
    - QUALITY_WEIGHTS.workStdev * stdev(ratedWorkDays)
    - QUALITY_WEIGHTS.nightStdev * stdev(ratedNights)
    - QUALITY_WEIGHTS.weekendStdev * stdev(ratedWeekends)
    - QUALITY_WEIGHTS.unfilledRate * unfilledRate
    - QUALITY_WEIGHTS.idleRatio * idleRatio
    - QUALITY_WEIGHTS.hardViolationRatio * hardViolationRatio
    - QUALITY_WEIGHTS.constitutionalRatio * constitutionalRatio
    - QUALITY_WEIGHTS.restCycleShortfall * (1 - output.metrics.restCycleCompliance);

  // spareUtilizationRate: only rated drivers (exempt new-hire spares excluded from pool)
  const spareIds = ratedDrivers.filter((d) => d.homeBusId === undefined).map((d) => d.id);
  const homeIds = ratedDrivers.filter((d) => d.homeBusId !== undefined).map((d) => d.id);
  const avg = (ids: number[]) => ids.length === 0 ? 0 : ids.reduce((s, id) => s + (workDaysById.get(id) ?? 0), 0) / ids.length;
  let spareUtilizationRate: number | null = null;
  if (spareIds.length > 0) {
    const homeAvg = avg(homeIds);
    spareUtilizationRate = homeAvg === 0 ? null : clamp(avg(spareIds) / homeAvg, 0, 1);
  }

  const report: QualityReport = {
    workDayStdev: stdev(ratedWorkDays),
    nightStdev: stdev(ratedNights),
    weekendStdev: stdev(ratedWeekends),
    activeDriverRate,
    spareUtilizationRate,
    idleDriverCount,
    unfilledRate,
    homeBusRate: output.metrics.homeBusRate,
    crossRouteRate: output.metrics.crossRouteRate,
    preferenceSatisfactionRate: computePreferenceSatisfactionRate(drivers, output.slots),
    dayOffSatisfactionRate,
    hardViolationCount: output.metrics.hardViolationCount,
    exemptedCount: output.metrics.exemptedCount,
    constitutionalViolationCount: output.metrics.constitutionalViolations.length,
    constitutionalByRule,
    restCycleCompliance: output.metrics.restCycleCompliance,
    compositeScore: Math.round(clamp(composite, 0, 100) * 10) / 10,
  };
  return report;
}
