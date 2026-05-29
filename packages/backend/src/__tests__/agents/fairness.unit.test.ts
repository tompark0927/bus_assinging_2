/**
 * Fairness 모듈 단위 테스트.
 *
 * 가장 중요한 메트릭: workDays 표준편차 < 1.0 (PHASE 2 출시 기준).
 * 이 모듈이 잘못 계산하면 에이전트가 잘못된 outliers 를 식별하고, 잘못된 swap 을 제안한다.
 */

import {
  calculateFairness,
  aggregateByDriver,
  compareFairness,
  stdev,
  mean,
  type SlotForFairness,
} from '../../agents/_tools/fairness';

// ─────────────────────────────────────────────
// 헬퍼: 슬롯 빌더
// ─────────────────────────────────────────────

function slot(
  driverId: number,
  date: string,
  shift: 'MORNING' | 'AFTERNOON' | 'FULL_DAY' = 'FULL_DAY',
  options: { isRestDay?: boolean; routeId?: number; status?: 'SCHEDULED' | 'ABSENT' } = {}
): SlotForFairness {
  return {
    driverId,
    routeId: options.routeId,
    shift,
    date: new Date(`${date}T00:00:00Z`),
    isRestDay: options.isRestDay ?? false,
    status: options.status ?? 'SCHEDULED',
  };
}

// ─────────────────────────────────────────────
// 통계 헬퍼
// ─────────────────────────────────────────────

describe('stdev / mean', () => {
  it('빈 배열 → 0', () => {
    expect(stdev([])).toBe(0);
    expect(mean([])).toBe(0);
  });

  it('단일 원소 → mean=값, stdev=0', () => {
    expect(mean([5])).toBe(5);
    expect(stdev([5])).toBe(0);
  });

  it('동일 값 배열 → stdev=0', () => {
    expect(stdev([3, 3, 3, 3])).toBe(0);
  });

  it('알려진 값 검증', () => {
    expect(mean([2, 4, 6])).toBe(4);
    // var = ((2-4)² + (4-4)² + (6-4)²) / 3 = (4+0+4)/3 = 8/3 ≈ 2.667
    // stdev = √2.667 ≈ 1.633
    expect(stdev([2, 4, 6])).toBeCloseTo(1.633, 2);
  });
});

// ─────────────────────────────────────────────
// aggregateByDriver
// ─────────────────────────────────────────────

describe('aggregateByDriver', () => {
  it('빈 슬롯 → 빈 결과', () => {
    expect(aggregateByDriver([])).toEqual([]);
  });

  it('휴무일 슬롯은 카운트 안 함', () => {
    const result = aggregateByDriver([
      slot(1, '2026-04-10', 'MORNING'),
      slot(1, '2026-04-11', 'MORNING', { isRestDay: true }),
      slot(1, '2026-04-12', 'MORNING'),
    ]);
    expect(result[0].workDays).toBe(2);
  });

  it('ABSENT 슬롯은 카운트 안 함 (병가 등)', () => {
    const result = aggregateByDriver([
      slot(1, '2026-04-10', 'MORNING'),
      slot(1, '2026-04-11', 'MORNING', { status: 'ABSENT' }),
    ]);
    expect(result[0].workDays).toBe(1);
  });

  it('AFTERNOON shift = nightShift 카운트', () => {
    const result = aggregateByDriver([
      slot(1, '2026-04-10', 'MORNING'),
      slot(1, '2026-04-11', 'AFTERNOON'),
      slot(1, '2026-04-12', 'AFTERNOON'),
    ]);
    expect(result[0].nightShifts).toBe(2);
    expect(result[0].workDays).toBe(3);
  });

  it('주말 (토/일) 카운트', () => {
    // 2026-04-11 (토), 2026-04-12 (일)
    const result = aggregateByDriver([
      slot(1, '2026-04-10'), // 금
      slot(1, '2026-04-11'), // 토
      slot(1, '2026-04-12'), // 일
      slot(1, '2026-04-13'), // 월
    ]);
    expect(result[0].weekendShifts).toBe(2);
    expect(result[0].workDays).toBe(4);
  });

  it('인기 노선 가산 (popularRouteIds)', () => {
    const popular = new Set([16]);
    const result = aggregateByDriver(
      [
        slot(1, '2026-04-10', 'MORNING', { routeId: 16 }),
        slot(1, '2026-04-11', 'MORNING', { routeId: 17 }),
        slot(1, '2026-04-12', 'MORNING', { routeId: 16 }),
      ],
      popular
    );
    expect(result[0].popularRouteShifts).toBe(2);
    expect(result[0].workDays).toBe(3);
  });

  it('여러 기사 분리', () => {
    const result = aggregateByDriver([
      slot(1, '2026-04-10'),
      slot(2, '2026-04-10'),
      slot(1, '2026-04-11'),
    ]);
    const byId = new Map(result.map((s) => [s.driverId, s]));
    expect(byId.get(1)?.workDays).toBe(2);
    expect(byId.get(2)?.workDays).toBe(1);
  });
});

// ─────────────────────────────────────────────
// calculateFairness
// ─────────────────────────────────────────────

describe('calculateFairness', () => {
  it('빈 슬롯 → score 100, meetsTarget=true', () => {
    const report = calculateFairness([]);
    expect(report.fairnessScore).toBe(100);
    expect(report.driversCount).toBe(0);
    expect(report.meetsTarget).toBe(true);
  });

  it('완벽 균등 배차 → score 100, outliers 0', () => {
    // 5명 기사 × 각 5일 = 25 슬롯, 모두 동일
    const slots: SlotForFairness[] = [];
    for (let driver = 1; driver <= 5; driver++) {
      for (let day = 10; day <= 14; day++) {
        slots.push(slot(driver, `2026-04-${day}`));
      }
    }
    const report = calculateFairness(slots);
    expect(report.fairnessScore).toBe(100);
    expect(report.outliers).toHaveLength(0);
    expect(report.meetsTarget).toBe(true);
    expect(report.stdev.work).toBe(0);
  });

  it('한 명만 더 일하면 outlier 로 식별', () => {
    // 기사 1~4는 5일, 기사 5는 8일 → 평균 5.6, std ~1.2
    const slots: SlotForFairness[] = [];
    for (let driver = 1; driver <= 4; driver++) {
      for (let day = 10; day <= 14; day++) {
        slots.push(slot(driver, `2026-04-${day}`));
      }
    }
    for (let day = 10; day <= 17; day++) {
      slots.push(slot(5, `2026-04-${day}`));
    }
    const report = calculateFairness(slots);
    expect(report.outliers.length).toBeGreaterThan(0);
    expect(report.outliers[0].driverId).toBe(5);
    expect(report.outliers[0].workDays).toBe(8);
    expect(report.outliers[0].deviationFromMean).toBeGreaterThan(2);
  });

  it('표준편차 < 1.0 → meetsTarget=true', () => {
    // 기사 1~5: 5,5,5,5,5
    const slots: SlotForFairness[] = [];
    for (let d = 1; d <= 5; d++) {
      for (let day = 10; day <= 14; day++) {
        slots.push(slot(d, `2026-04-${day}`));
      }
    }
    expect(calculateFairness(slots).meetsTarget).toBe(true);
  });

  it('표준편차 ≥ 1.0 → meetsTarget=false', () => {
    // 기사 1: 3일, 기사 2: 7일 → mean=5, var=4, std=2
    const slots: SlotForFairness[] = [];
    for (let day = 10; day <= 12; day++) slots.push(slot(1, `2026-04-${day}`));
    for (let day = 10; day <= 16; day++) slots.push(slot(2, `2026-04-${day}`));
    expect(calculateFairness(slots).meetsTarget).toBe(false);
  });

  it('야간 편차 점수 반영', () => {
    // 모두 같은 workDays 지만 야간 편차 큼
    const slots: SlotForFairness[] = [];
    for (let day = 10; day <= 14; day++) {
      slots.push(slot(1, `2026-04-${day}`, 'AFTERNOON')); // 5일 모두 야간
      slots.push(slot(2, `2026-04-${day}`, 'MORNING')); // 5일 모두 주간
    }
    const report = calculateFairness(slots);
    expect(report.fairnessScore).toBeLessThan(100);
    expect(report.stdev.night).toBeGreaterThan(0);
    expect(report.stdev.work).toBe(0); // workDays 는 동일
  });

  it('outliers 절대 편차 큰 순으로 정렬', () => {
    const slots: SlotForFairness[] = [];
    // 기사 1: 1일, 기사 2: 5일, 기사 3: 10일 → mean=5.33
    for (let day = 10; day <= 10; day++) slots.push(slot(1, `2026-04-${day}`));
    for (let day = 10; day <= 14; day++) slots.push(slot(2, `2026-04-${day}`));
    for (let day = 10; day <= 19; day++) slots.push(slot(3, `2026-04-${day}`));

    const report = calculateFairness(slots);
    // 기사 3 이 가장 큰 편차 (+4.67), 기사 1 이 두 번째 (-4.33)
    expect(report.outliers[0].driverId).toBe(3);
    expect(report.outliers[1].driverId).toBe(1);
  });

  it('휴무일·ABSENT 는 통계에서 제외', () => {
    const slots: SlotForFairness[] = [
      slot(1, '2026-04-10'),
      slot(1, '2026-04-11', 'MORNING', { isRestDay: true }),
      slot(1, '2026-04-12', 'MORNING', { status: 'ABSENT' }),
      slot(2, '2026-04-10'),
    ];
    const report = calculateFairness(slots);
    // 기사 1, 2 모두 1일 근무 → 균등
    expect(report.fairnessScore).toBe(100);
    expect(report.perDriver.find((d) => d.driverId === 1)?.workDays).toBe(1);
  });
});

// ─────────────────────────────────────────────
// compareFairness
// ─────────────────────────────────────────────

describe('compareFairness', () => {
  function makeSlots(byDriver: Record<number, number>): SlotForFairness[] {
    const slots: SlotForFairness[] = [];
    for (const [driverId, workDays] of Object.entries(byDriver)) {
      for (let i = 0; i < workDays; i++) {
        slots.push(slot(parseInt(driverId), `2026-04-${10 + i}`));
      }
    }
    return slots;
  }

  it('점수 개선 → improved=true', () => {
    const before = calculateFairness(makeSlots({ 1: 3, 2: 7 })); // 큰 편차
    const after = calculateFairness(makeSlots({ 1: 5, 2: 5 })); // 균등

    const result = compareFairness(before, after);
    expect(result.improved).toBe(true);
    expect(result.scoreImprovement).toBeGreaterThan(0);
    expect(result.workStdReduction).toBeGreaterThan(0);
    expect(result.outlierReduction).toBeGreaterThan(0);
  });

  it('점수 유지 + std 감소 → improved=true', () => {
    // 동일 점수지만 측정 정확도 다른 경우
    const before = { ...calculateFairness(makeSlots({ 1: 5, 2: 5 })), stdev: { work: 0.5, night: 0, weekend: 0 } };
    const after = { ...calculateFairness(makeSlots({ 1: 5, 2: 5 })), stdev: { work: 0.3, night: 0, weekend: 0 } };

    const result = compareFairness(before, after);
    expect(result.improved).toBe(true);
  });

  it('점수 악화 → improved=false', () => {
    const before = calculateFairness(makeSlots({ 1: 5, 2: 5 }));
    const after = calculateFairness(makeSlots({ 1: 3, 2: 7 }));

    const result = compareFairness(before, after);
    expect(result.improved).toBe(false);
    expect(result.scoreImprovement).toBeLessThan(0);
  });
});
