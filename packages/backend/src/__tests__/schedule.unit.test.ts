/**
 * 배차 생성 로직 단위 테스트 (DB 불필요)
 * - 근무/휴무 사이클 계산
 * - 조별 MORNING/AFTERNOON 배분
 * - 오프셋 분산
 * - 인력 충족 검증
 */

// ── 순수 함수 추출 (scheduleService 핵심 로직) ─────────────────────

function getShiftType(date: Date, shiftGroup: string | null): 'MORNING' | 'AFTERNOON' | 'FULL_DAY' {
  if (!shiftGroup) return 'FULL_DAY';
  const base = new Date(2000, 0, 1);
  const daySerial = Math.floor((date.getTime() - base.getTime()) / 86400000);
  const block = Math.floor(daySerial / 14) % 2; // 0 or 1
  if (shiftGroup === '1조') {
    return block === 0 ? 'MORNING' : 'AFTERNOON';
  } else {
    return block === 0 ? 'AFTERNOON' : 'MORNING';
  }
}

function isRestDay(dayIndex: number, offset: number, cycleLength: number, workDays: number): boolean {
  const posInCycle = (dayIndex + offset) % cycleLength;
  return posInCycle >= workDays;
}

function getMinDriversRequired(busCount: number, workDays: number, restDays: number): number {
  const cycleRatio = (workDays + restDays) / workDays;
  return Math.ceil(busCount * cycleRatio);
}

function distributeOffsets(driverCount: number, cycleLength: number): number[] {
  return Array.from({ length: driverCount }, (_, i) => i % cycleLength);
}

// ── MORNING/AFTERNOON 배분 테스트 ─────────────────────────────────

describe('조별 근무 시프트 결정', () => {
  // 2026-03-13: daySerial = (2026-03-13 - 2000-01-01) 기준
  // daySerial 계산: 약 9568일
  // block = Math.floor(9568 / 14) % 2 = Math.floor(683.4) % 2 = 683 % 2 = 1

  it('shiftGroup 없으면 FULL_DAY', () => {
    expect(getShiftType(new Date('2026-03-13'), null)).toBe('FULL_DAY');
  });

  it('1조: block=0이면 MORNING', () => {
    // 2000-01-01 = daySerial 0, block 0
    const date = new Date('2000-01-03'); // daySerial=2, block=0
    expect(getShiftType(date, '1조')).toBe('MORNING');
  });

  it('1조: block=1이면 AFTERNOON', () => {
    // 2000-01-15 = daySerial 14, block = floor(14/14)%2 = 1
    const date = new Date('2000-01-15');
    expect(getShiftType(date, '1조')).toBe('AFTERNOON');
  });

  it('2조: block=0이면 AFTERNOON (1조와 반대)', () => {
    const date = new Date('2000-01-03');
    expect(getShiftType(date, '2조')).toBe('AFTERNOON');
  });

  it('2조: block=1이면 MORNING', () => {
    const date = new Date('2000-01-15');
    expect(getShiftType(date, '2조')).toBe('MORNING');
  });

  it('1조와 2조는 항상 반대 시프트', () => {
    const testDates = [
      new Date('2026-01-01'),
      new Date('2026-02-15'),
      new Date('2026-03-13'),
      new Date('2026-06-01'),
    ];
    for (const date of testDates) {
      const shift1 = getShiftType(date, '1조');
      const shift2 = getShiftType(date, '2조');
      expect(shift1).not.toBe(shift2);
      expect(['MORNING', 'AFTERNOON']).toContain(shift1);
      expect(['MORNING', 'AFTERNOON']).toContain(shift2);
    }
  });

  it('14일마다 시프트 전환 (1조 기준)', () => {
    const date1 = new Date('2026-03-01');
    const date2 = new Date('2026-03-15'); // 14일 후
    const shift1 = getShiftType(date1, '1조');
    const shift2 = getShiftType(date2, '1조');
    expect(shift1).not.toBe(shift2);
  });
});

// ── 휴무 사이클 계산 테스트 ────────────────────────────────────────

describe('5일 근무 / 2일 휴무 사이클 (cycleLength=7)', () => {
  const WORK_DAYS = 5;
  const REST_DAYS = 2;
  const CYCLE = WORK_DAYS + REST_DAYS; // 7

  it('오프셋 0: 처음 5일 근무, 6~7일 휴무', () => {
    // dayIndex 0~4 → 근무 (posInCycle 0~4 < 5)
    // dayIndex 5~6 → 휴무 (posInCycle 5~6 >= 5)
    for (let i = 0; i < 5; i++) {
      expect(isRestDay(i, 0, CYCLE, WORK_DAYS)).toBe(false); // 근무
    }
    expect(isRestDay(5, 0, CYCLE, WORK_DAYS)).toBe(true);
    expect(isRestDay(6, 0, CYCLE, WORK_DAYS)).toBe(true);
  });

  it('오프셋 2: dayIndex=3,4가 휴무', () => {
    // posInCycle = (dayIndex + 2) % 7
    // dayIndex=3 → pos=5 → 휴무
    expect(isRestDay(3, 2, CYCLE, WORK_DAYS)).toBe(true);
    expect(isRestDay(4, 2, CYCLE, WORK_DAYS)).toBe(true);
    expect(isRestDay(2, 2, CYCLE, WORK_DAYS)).toBe(false);
  });

  it('사이클이 반복됨: dayIndex=7은 dayIndex=0과 동일', () => {
    for (let offset = 0; offset < CYCLE; offset++) {
      expect(isRestDay(0, offset, CYCLE, WORK_DAYS))
        .toBe(isRestDay(7, offset, CYCLE, WORK_DAYS));
    }
  });

  it('한달(31일) 동안 근무일 수: 약 21~23일', () => {
    let workCount = 0;
    for (let d = 0; d < 31; d++) {
      if (!isRestDay(d, 0, CYCLE, WORK_DAYS)) workCount++;
    }
    // 31일 / 7일 = 4.4 사이클 → 근무일 ≈ 4~5 * 5 = 20~25
    expect(workCount).toBeGreaterThanOrEqual(20);
    expect(workCount).toBeLessThanOrEqual(25);
  });
});

describe('근무 사이클 커스텀 (4근 2휴)', () => {
  const WORK_DAYS = 4;
  const REST_DAYS = 2;
  const CYCLE = WORK_DAYS + REST_DAYS; // 6

  it('오프셋 0: dayIndex=4,5가 휴무', () => {
    expect(isRestDay(4, 0, CYCLE, WORK_DAYS)).toBe(true);
    expect(isRestDay(5, 0, CYCLE, WORK_DAYS)).toBe(true);
    expect(isRestDay(3, 0, CYCLE, WORK_DAYS)).toBe(false);
  });
});

// ── 오프셋 분산 테스트 ────────────────────────────────────────────

describe('기사 오프셋 분산', () => {
  it('7명, cycleLength=7: 오프셋 0~6 각각 1명', () => {
    const offsets = distributeOffsets(7, 7);
    expect(offsets.sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('3명, cycleLength=7: 오프셋 0~2', () => {
    const offsets = distributeOffsets(3, 7);
    expect(offsets).toEqual([0, 1, 2]);
  });

  it('10명, cycleLength=7: 0~6 + 0~2 (반복)', () => {
    const offsets = distributeOffsets(10, 7);
    expect(offsets[0]).toBe(0);
    expect(offsets[6]).toBe(6);
    expect(offsets[7]).toBe(0); // wrap
    expect(offsets[9]).toBe(2);
  });

  it('오프셋 분산으로 같은 날 모두 쉬지 않음 (7명 기준)', () => {
    // 7명, cycleLength=7이면 매일 정확히 5명 근무
    const offsets = distributeOffsets(7, 7);
    for (let day = 0; day < 7; day++) {
      const workingCount = offsets.filter(
        offset => !isRestDay(day, offset, 7, 5)
      ).length;
      expect(workingCount).toBe(5); // 항상 정확히 5명
    }
  });
});

// ── 최소 인력 계산 테스트 ─────────────────────────────────────────

describe('노선별 최소 기사 수 계산', () => {
  it('5근 2휴, 버스 3대 → 최소 ceil(3 * 7/5) = ceil(4.2) = 5명', () => {
    expect(getMinDriversRequired(3, 5, 2)).toBe(5);
  });

  it('5근 2휴, 버스 5대 → 최소 ceil(5 * 7/5) = 7명', () => {
    expect(getMinDriversRequired(5, 5, 2)).toBe(7);
  });

  it('4근 2휴, 버스 2대 → 최소 ceil(2 * 6/4) = ceil(3) = 3명', () => {
    expect(getMinDriversRequired(2, 4, 2)).toBe(3);
  });

  it('버스 0대 → 0명', () => {
    expect(getMinDriversRequired(0, 5, 2)).toBe(0);
  });
});

// ── 배차 슬롯 생성 시뮬레이션 ─────────────────────────────────────

describe('배차 슬롯 생성 시뮬레이션 (3명, 5근 2휴)', () => {
  const WORK_DAYS = 5;
  const CYCLE = 7;
  const DAYS_IN_MONTH = 31;

  function simulateSlots(driverCount: number) {
    const offsets = distributeOffsets(driverCount, CYCLE);
    const results: { driverId: number; day: number; isRest: boolean }[] = [];

    for (let d = 0; d < driverCount; d++) {
      for (let day = 0; day < DAYS_IN_MONTH; day++) {
        results.push({
          driverId: d,
          day,
          isRest: isRestDay(day, offsets[d], CYCLE, WORK_DAYS),
        });
      }
    }
    return results;
  }

  it('3명 × 31일 = 93개 슬롯 생성', () => {
    const slots = simulateSlots(3);
    expect(slots.length).toBe(3 * DAYS_IN_MONTH);
  });

  it('각 기사 한달 근무일 수: 20~23일 (31일 × 5/7 ≈ 22.1)', () => {
    const slots = simulateSlots(3);
    for (let d = 0; d < 3; d++) {
      const workDays = slots.filter(s => s.driverId === d && !s.isRest).length;
      expect(workDays).toBeGreaterThanOrEqual(20);
      expect(workDays).toBeLessThanOrEqual(23);
    }
  });

  it('매일 최소 1명 이상 근무 (3명, 5근 2휴)', () => {
    const slots = simulateSlots(3);
    for (let day = 0; day < DAYS_IN_MONTH; day++) {
      const workingToday = slots.filter(s => s.day === day && !s.isRest).length;
      // 3명이면 사이클 7일 중 쉬는 사람 최대 2명 → 최소 1명 근무
      expect(workingToday).toBeGreaterThanOrEqual(1);
    }
  });

  it('7명이면 매일 정확히 5명 근무 (완벽한 분산)', () => {
    const slots = simulateSlots(7);
    for (let day = 0; day < DAYS_IN_MONTH; day++) {
      const workingToday = slots.filter(s => s.day === day && !s.isRest).length;
      expect(workingToday).toBe(5);
    }
  });
});

// ── 휴무 승인 처리 테스트 ─────────────────────────────────────────

describe('휴무 승인 시 슬롯 처리', () => {
  function getEffectiveCyclePosition(
    dayIndex: number,
    startOffset: number,
    approvedOffDayIndices: Set<number>
  ): number {
    // 승인된 휴무일은 cyclePosition을 증가시키지 않음
    let pos = startOffset;
    for (let i = 0; i < dayIndex; i++) {
      if (!approvedOffDayIndices.has(i)) {
        pos++;
      }
    }
    return pos;
  }

  it('휴무일에 cyclePosition 정지: 복귀 후 사이클 연속', () => {
    // dayIndex=2에 휴무 승인됨
    // getEffectiveCyclePosition는 해당 날 처리 시작 시점의 position 반환
    // (이전 날들까지의 increment 합산)
    const offDays = new Set([2]);
    const pos0 = getEffectiveCyclePosition(0, 0, offDays); // 0 (이전 날 없음)
    const pos1 = getEffectiveCyclePosition(1, 0, offDays); // 1 (day0 근무 → +1)
    const pos2 = getEffectiveCyclePosition(2, 0, offDays); // 2 (day0,1 근무 → +2)
    const pos3 = getEffectiveCyclePosition(3, 0, offDays); // 2 (day2 휴무 → 정지, +2만)

    expect(pos0).toBe(0);
    expect(pos1).toBe(1);
    expect(pos2).toBe(2); // 휴무 전날까지 2번 increment
    expect(pos3).toBe(2); // 휴무일은 increment 없어서 day3도 2에서 시작
  });
});
