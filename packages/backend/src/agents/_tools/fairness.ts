/**
 * 공정성 지수 계산 — 순수 함수 모듈.
 *
 * DispatchAgent 의 score_fairness 도구가 사용하는 핵심 로직.
 * Prisma 의존성 없이 슬롯 배열만 받아 계산 → 단위 테스트·시뮬레이션·배차 알고리즘
 * 모두에서 재사용.
 *
 * 측정 항목 (각각 표준편차):
 *   - workDays: 기사별 근무일 수 (편차 ≤ 1일 = PHASE 2 출시 기준)
 *   - nightShifts: 기사별 야간(AFTERNOON shift) 횟수
 *   - weekendShifts: 기사별 주말 근무 횟수
 *   - popularRouteShifts: 기사별 인기 노선 근무 횟수 (옵셔널)
 *
 * 점수 = max(0, 100 - (workStd × 10 + nightStd × 5 + weekendStd × 5))
 */

// ─────────────────────────────────────────────
// 입력 타입 (Prisma 모델과 디커플링)
// ─────────────────────────────────────────────

export type SlotShift = 'MORNING' | 'AFTERNOON' | 'FULL_DAY' | 'NIGHT';
export type SlotStatus = 'SCHEDULED' | 'DROPPED' | 'FILLED' | 'COMPLETED' | 'ABSENT';

export interface SlotForFairness {
  driverId: number;
  routeId?: number;
  shift: SlotShift;
  date: Date;
  isRestDay: boolean;
  status?: SlotStatus;
}

export interface DriverStats {
  driverId: number;
  workDays: number;
  nightShifts: number;
  weekendShifts: number;
  popularRouteShifts: number;
}

export interface FairnessOutlier {
  driverId: number;
  workDays: number;
  deviationFromMean: number;
}

export interface FairnessReport {
  /** 0~100 점, 100=완전 공정 */
  fairnessScore: number;
  /** 평균 근무일 수 */
  meanWorkDays: number;
  /** 평균 야간 근무 횟수 */
  meanNightShifts: number;
  /** 평균 주말 근무 횟수 */
  meanWeekendShifts: number;
  /** 표준편차 */
  stdev: {
    work: number;
    night: number;
    weekend: number;
  };
  /** 분석 대상 기사 수 */
  driversCount: number;
  /** 평균에서 ≥1일 벗어난 기사 (workDays 기준), 절대 편차 큰 순 */
  outliers: FairnessOutlier[];
  /** PHASE 2 출시 기준: workDays 표준편차 < 1.0 */
  meetsTarget: boolean;
  /** 기사별 상세 통계 (디버그·UI 표시용) */
  perDriver: DriverStats[];
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function isNightShift(shift: SlotShift): boolean {
  // AFTERNOON = 오후 ~ 야간 운행 (한국 시내버스 1일 2교대 체계)
  // NIGHT = 명시적 야간
  return shift === 'AFTERNOON' || shift === 'NIGHT';
}

function isCountableWork(slot: SlotForFairness): boolean {
  if (slot.isRestDay) return false;
  if (slot.status === 'ABSENT') return false;
  return true;
}

/** 표준편차. 빈 배열이면 0. */
export function stdev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/** 평균. 빈 배열이면 0. */
export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─────────────────────────────────────────────
// 핵심 계산: aggregateByDriver
// ─────────────────────────────────────────────

/**
 * 슬롯 배열을 기사별 통계로 집계.
 *
 * @param slots 슬롯 배열
 * @param popularRouteIds 인기 노선 ID Set (옵셔널 — 별도 가산 통계용)
 */
export function aggregateByDriver(
  slots: SlotForFairness[],
  popularRouteIds: ReadonlySet<number> = new Set()
): DriverStats[] {
  const map = new Map<number, DriverStats>();

  for (const slot of slots) {
    if (!isCountableWork(slot)) continue;

    const stat = map.get(slot.driverId) ?? {
      driverId: slot.driverId,
      workDays: 0,
      nightShifts: 0,
      weekendShifts: 0,
      popularRouteShifts: 0,
    };

    stat.workDays++;
    if (isNightShift(slot.shift)) stat.nightShifts++;
    if (isWeekend(slot.date)) stat.weekendShifts++;
    if (slot.routeId !== undefined && popularRouteIds.has(slot.routeId)) {
      stat.popularRouteShifts++;
    }

    map.set(slot.driverId, stat);
  }

  return Array.from(map.values());
}

// ─────────────────────────────────────────────
// 핵심 계산: calculateFairness
// ─────────────────────────────────────────────

/**
 * 슬롯 배열에서 공정성 지수와 outliers 를 계산.
 *
 * @param slots 분석 대상 슬롯 (예: 한 달치 ScheduleSlot)
 * @param popularRouteIds 인기 노선 ID Set (옵셔널)
 * @returns 공정성 보고서
 */
export function calculateFairness(
  slots: SlotForFairness[],
  popularRouteIds: ReadonlySet<number> = new Set()
): FairnessReport {
  const perDriver = aggregateByDriver(slots, popularRouteIds);

  if (perDriver.length === 0) {
    return {
      fairnessScore: 100,
      meanWorkDays: 0,
      meanNightShifts: 0,
      meanWeekendShifts: 0,
      stdev: { work: 0, night: 0, weekend: 0 },
      driversCount: 0,
      outliers: [],
      meetsTarget: true,
      perDriver: [],
    };
  }

  const workArr = perDriver.map((d) => d.workDays);
  const nightArr = perDriver.map((d) => d.nightShifts);
  const weekendArr = perDriver.map((d) => d.weekendShifts);

  const workStd = stdev(workArr);
  const nightStd = stdev(nightArr);
  const weekendStd = stdev(weekendArr);

  const meanWork = mean(workArr);
  const meanNight = mean(nightArr);
  const meanWeekend = mean(weekendArr);

  // 점수 공식: workDays 편차가 가장 크게 가중. 100점 만점.
  const fairnessScore = Math.max(
    0,
    Math.round(100 - (workStd * 10 + nightStd * 5 + weekendStd * 5))
  );

  const outliers: FairnessOutlier[] = perDriver
    .filter((d) => Math.abs(d.workDays - meanWork) >= 1)
    .map((d) => ({
      driverId: d.driverId,
      workDays: d.workDays,
      deviationFromMean: +(d.workDays - meanWork).toFixed(1),
    }))
    .sort((a, b) => Math.abs(b.deviationFromMean) - Math.abs(a.deviationFromMean));

  return {
    fairnessScore,
    meanWorkDays: +meanWork.toFixed(1),
    meanNightShifts: +meanNight.toFixed(1),
    meanWeekendShifts: +meanWeekend.toFixed(1),
    stdev: {
      work: +workStd.toFixed(2),
      night: +nightStd.toFixed(2),
      weekend: +weekendStd.toFixed(2),
    },
    driversCount: perDriver.length,
    outliers,
    meetsTarget: workStd < 1.0,
    perDriver,
  };
}

// ─────────────────────────────────────────────
// 두 배차표 비교 (개선 측정)
// ─────────────────────────────────────────────

export interface FairnessComparison {
  before: FairnessReport;
  after: FairnessReport;
  scoreImprovement: number;
  workStdReduction: number;
  outlierReduction: number;
  improved: boolean;
}

/**
 * 변경 전후 공정성 비교 — 에이전트의 modify_slot 호출이 실제로 공정성을 개선하는지 검증.
 */
export function compareFairness(
  before: FairnessReport,
  after: FairnessReport
): FairnessComparison {
  const scoreImprovement = after.fairnessScore - before.fairnessScore;
  const workStdReduction = before.stdev.work - after.stdev.work;
  const outlierReduction = before.outliers.length - after.outliers.length;

  return {
    before,
    after,
    scoreImprovement,
    workStdReduction,
    outlierReduction,
    improved: scoreImprovement > 0 || (scoreImprovement === 0 && workStdReduction > 0),
  };
}
