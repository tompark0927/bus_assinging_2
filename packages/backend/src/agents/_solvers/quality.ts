import type { SolverInput, SolverOutput, ConstitutionalRuleKey, ShiftSystemPolicy } from './types';

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
  const idleRatio = idleDriverCount / n;
  const hardViolationRatio = output.metrics.hardViolationCount / n;
  const constitutionalRatio = output.metrics.constitutionalViolations.length / n;
  const composite =
    100
    - QUALITY_WEIGHTS.workStdev * stdev(workDays)
    - QUALITY_WEIGHTS.nightStdev * stdev(drivers.map((d) => nightById.get(d.id) ?? 0))
    - QUALITY_WEIGHTS.weekendStdev * stdev(drivers.map((d) => weekendById.get(d.id) ?? 0))
    - QUALITY_WEIGHTS.unfilledRate * unfilledRate
    - QUALITY_WEIGHTS.idleRatio * idleRatio
    - QUALITY_WEIGHTS.hardViolationRatio * hardViolationRatio
    - QUALITY_WEIGHTS.constitutionalRatio * constitutionalRatio
    - QUALITY_WEIGHTS.restCycleShortfall * (1 - output.metrics.restCycleCompliance);

  const spareIds = drivers.filter((d) => d.homeBusId === undefined).map((d) => d.id);
  const homeIds = drivers.filter((d) => d.homeBusId !== undefined).map((d) => d.id);
  const avg = (ids: number[]) => ids.length === 0 ? 0 : ids.reduce((s, id) => s + (workDaysById.get(id) ?? 0), 0) / ids.length;
  let spareUtilizationRate: number | null = null;
  if (spareIds.length > 0) {
    const homeAvg = avg(homeIds);
    spareUtilizationRate = homeAvg === 0 ? null : clamp(avg(spareIds) / homeAvg, 0, 1);
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
    preferenceSatisfactionRate: null, // TODO: 하위 프로젝트 4에서 선호노선 데이터 연결 시 실측 (현재 데이터모델에 선호노선 없음)
    dayOffSatisfactionRate,
    hardViolationCount: output.metrics.hardViolationCount,
    constitutionalViolationCount: output.metrics.constitutionalViolations.length,
    constitutionalByRule,
    restCycleCompliance: output.metrics.restCycleCompliance,
    compositeScore: Math.round(clamp(composite, 0, 100) * 10) / 10,
  };
  return report;
}
