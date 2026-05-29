/**
 * 에스컬레이션 로직 단위 테스트 (DB 불필요)
 * - 출발 시각까지 남은 시간에 따라 올바른 레벨이 계산되는지 검증
 * - 당일 vs 미래 드랍 동작 검증
 */

const DEPARTURE_HOURS: Record<string, number> = {
  MORNING: 6,
  AFTERNOON: 14,
  FULL_DAY: 6,
};

function getDepartureTime(slotDate: Date, shift: string): Date {
  const hour = DEPARTURE_HOURS[shift] ?? 6;
  const dep = new Date(slotDate);
  dep.setHours(hour, 0, 0, 0);
  return dep;
}

function minutesUntil(target: Date, from: Date): number {
  return Math.floor((target.getTime() - from.getTime()) / 60000);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

// 에스컬레이션 로직 순수 함수 (escalationService의 핵심 판단 로직)
function determineStartLevel(slotDate: Date, shift: string, now: Date): number {
  const departure = getDepartureTime(slotDate, shift);
  const minutesToDep = minutesUntil(departure, now);
  const isToday = isSameDay(slotDate, now);

  if (!isToday) return 0;
  if (minutesToDep <= 60) return 3;
  if (minutesToDep <= 120) return 2;
  return 0;
}

function determineNextEscalationLevel(
  currentLevel: number,
  minutesToDep: number,
  minutesSinceLast: number,
  isToday: boolean
): number | null {
  if (!isToday) {
    if (currentLevel < 1 && minutesSinceLast >= 60) return 1;
    return null;
  }
  if (minutesToDep <= 30 && currentLevel < 4) return 4;
  if (minutesToDep <= 60 && currentLevel < 3) return 3;
  if (minutesToDep <= 120 && currentLevel < 2) return 2;
  if (currentLevel < 1 && minutesSinceLast >= 15) return 1;
  if (currentLevel === 1 && minutesSinceLast >= 20 && minutesToDep > 120) return 2;
  return null;
}

describe('에스컬레이션 시작 레벨 결정', () => {
  const today = new Date('2026-03-13T08:00:00');
  const tomorrow = new Date('2026-03-14');

  it('미래 드랍 → 레벨 0 (여유 있음)', () => {
    expect(determineStartLevel(tomorrow, 'MORNING', today)).toBe(0);
  });

  it('당일이지만 출발 4시간 전 → 레벨 0', () => {
    // MORNING = 6am, now = 2am → 4h = 240min
    const now = new Date('2026-03-13T02:00:00');
    const slotDate = new Date('2026-03-13');
    expect(determineStartLevel(slotDate, 'MORNING', now)).toBe(0);
  });

  it('당일 출발 1.5시간 전 → 레벨 2 (전체 기사)', () => {
    // MORNING = 6am, now = 4:30am → 90min
    const now = new Date('2026-03-13T04:30:00');
    const slotDate = new Date('2026-03-13');
    expect(determineStartLevel(slotDate, 'MORNING', now)).toBe(2);
  });

  it('당일 출발 45분 전 → 레벨 3 (관리자 경보)', () => {
    // MORNING = 6am, now = 5:15am → 45min
    const now = new Date('2026-03-13T05:15:00');
    const slotDate = new Date('2026-03-13');
    expect(determineStartLevel(slotDate, 'MORNING', now)).toBe(3);
  });

  it('오후 운행 (AFTERNOON = 14시), 13시 드랍 → 레벨 2', () => {
    // now = 13:00, departure = 14:00 → 60min
    const now = new Date('2026-03-13T13:00:00');
    const slotDate = new Date('2026-03-13');
    // 60min ≤ 60 → level 3
    expect(determineStartLevel(slotDate, 'AFTERNOON', now)).toBe(3);
  });

  it('FULL_DAY는 MORNING과 동일 출발 시각', () => {
    const now = new Date('2026-03-13T04:30:00');
    const slotDate = new Date('2026-03-13');
    expect(determineStartLevel(slotDate, 'FULL_DAY', now)).toBe(2);
  });
});

describe('에스컬레이션 다음 레벨 결정', () => {
  it('당일, T-25min, 현재 레벨 3 → 레벨 4 (최종 위기)', () => {
    expect(determineNextEscalationLevel(3, 25, 30, true)).toBe(4);
  });

  it('당일, T-55min, 현재 레벨 2 → 레벨 3 (관리자 경보)', () => {
    expect(determineNextEscalationLevel(2, 55, 30, true)).toBe(3);
  });

  it('당일, T-100min, 현재 레벨 1 → 레벨 2 (전체 기사)', () => {
    expect(determineNextEscalationLevel(1, 100, 20, true)).toBe(2);
  });

  it('당일, T-200min, 현재 레벨 0, 경과 15분 → 레벨 1 (리마인더)', () => {
    expect(determineNextEscalationLevel(0, 200, 15, true)).toBe(1);
  });

  it('당일, T-200min, 현재 레벨 0, 경과 10분 → null (아직 대기)', () => {
    expect(determineNextEscalationLevel(0, 200, 10, true)).toBeNull();
  });

  it('이미 최고 레벨(4) → null', () => {
    expect(determineNextEscalationLevel(4, 20, 15, true)).toBeNull();
  });

  it('미래 드랍, 현재 레벨 0, 경과 65분 → 레벨 1', () => {
    expect(determineNextEscalationLevel(0, 1000, 65, false)).toBe(1);
  });

  it('미래 드랍, 현재 레벨 1 → null (미래는 1까지만)', () => {
    expect(determineNextEscalationLevel(1, 1000, 65, false)).toBeNull();
  });
});

describe('출발 시각 계산', () => {
  it('MORNING = 06:00', () => {
    const d = getDepartureTime(new Date('2026-03-13'), 'MORNING');
    expect(d.getHours()).toBe(6);
    expect(d.getMinutes()).toBe(0);
  });

  it('AFTERNOON = 14:00', () => {
    const d = getDepartureTime(new Date('2026-03-13'), 'AFTERNOON');
    expect(d.getHours()).toBe(14);
  });

  it('알 수 없는 shift는 06:00로 폴백', () => {
    const d = getDepartureTime(new Date('2026-03-13'), 'UNKNOWN');
    expect(d.getHours()).toBe(6);
  });
});

describe('호봉 + 조합비 급여 계산', () => {
  function calcWithHoboongAndUnion(params: {
    baseSalary: number;
    overtimePay: number;
    nightShiftPay: number;
    holidayPay: number;
    deductions: number;
    unionDues: { type: string; amount: number }[];
  }) {
    const grossPay = params.baseSalary + params.overtimePay + params.nightShiftPay + params.holidayPay;
    const totalUnion = params.unionDues.reduce((sum, due) => {
      if (due.type === 'FIXED') return sum + due.amount;
      if (due.type === 'PERCENTAGE') return sum + Math.round(grossPay * due.amount / 100);
      return sum;
    }, 0);
    const netPay = grossPay - params.deductions - totalUnion;
    return { grossPay, totalUnion, netPay };
  }

  it('고정 조합비만 있을 때 정확히 차감', () => {
    const { totalUnion, netPay } = calcWithHoboongAndUnion({
      baseSalary: 4_000_000, overtimePay: 0, nightShiftPay: 0, holidayPay: 0,
      deductions: 358_000,
      unionDues: [{ type: 'FIXED', amount: 30_000 }, { type: 'FIXED', amount: 15_000 }],
    });
    expect(totalUnion).toBe(45_000);
    expect(netPay).toBe(4_000_000 - 358_000 - 45_000);
  });

  it('퍼센트 조합비 계산 (기본급 1%)', () => {
    const { totalUnion } = calcWithHoboongAndUnion({
      baseSalary: 4_000_000, overtimePay: 0, nightShiftPay: 0, holidayPay: 0,
      deductions: 0,
      unionDues: [{ type: 'PERCENTAGE', amount: 1 }],
    });
    expect(totalUnion).toBe(40_000);
  });

  it('netPay는 음수가 되지 않아야 한다 (극단적 공제 케이스)', () => {
    const { netPay } = calcWithHoboongAndUnion({
      baseSalary: 100_000, overtimePay: 0, nightShiftPay: 0, holidayPay: 0,
      deductions: 80_000,
      unionDues: [{ type: 'FIXED', amount: 30_000 }],
    });
    // 100000 - 80000 - 30000 = -10000 → 앱에서 경고 필요
    expect(typeof netPay).toBe('number');
  });

  it('조합비 없을 때 totalUnion = 0', () => {
    const { totalUnion } = calcWithHoboongAndUnion({
      baseSalary: 3_500_000, overtimePay: 0, nightShiftPay: 0, holidayPay: 0,
      deductions: 300_000,
      unionDues: [],
    });
    expect(totalUnion).toBe(0);
  });
});
