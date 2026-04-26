/**
 * Rule Compiler 단위 테스트.
 *
 * 자연어 노조 규칙을 정확히 파싱하고, 위반 사례를 정확히 잡아내야 한다.
 * 잘못 컴파일하면 에이전트가 노조 규칙을 위반하는 배차표를 생성한다.
 */

import {
  compileRule,
  compileRules,
  runRules,
  compileAndValidate,
  type CompiledRule,
} from '../../agents/_tools/rule-compiler';
import type { SlotForFairness } from '../../agents/_tools/fairness';

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function slot(
  driverId: number,
  date: string,
  shift: 'MORNING' | 'AFTERNOON' | 'FULL_DAY' = 'FULL_DAY',
  options: { isRestDay?: boolean } = {}
): SlotForFairness {
  return {
    driverId,
    shift,
    date: new Date(`${date}T00:00:00Z`),
    isRestDay: options.isRestDay ?? false,
    status: 'SCHEDULED',
  };
}

function consecutiveDays(driverId: number, startDate: string, count: number): SlotForFairness[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return {
      driverId,
      shift: 'FULL_DAY' as const,
      date: d,
      isRestDay: false,
      status: 'SCHEDULED' as const,
    };
  });
}

// ─────────────────────────────────────────────
// compileRule
// ─────────────────────────────────────────────

describe('compileRule', () => {
  it('빈 문자열 → null', () => {
    expect(compileRule('')).toBeNull();
    expect(compileRule('   ')).toBeNull();
  });

  it('인식 불가 규칙 → null', () => {
    expect(compileRule('아무 텍스트나')).toBeNull();
    expect(compileRule('이건 규칙이 아닙니다')).toBeNull();
  });

  describe('R1: 연속 N일 근무 금지', () => {
    it('"연속 4일 근무 금지" 컴파일', () => {
      const rule = compileRule('연속 4일 근무 금지');
      expect(rule?.kind).toBe('no_consecutive_work');
      expect(rule?.params.maxConsecutiveDays).toBe(4);
    });

    it('"연속 5일 이상 근무 불가" 컴파일', () => {
      const rule = compileRule('연속 5일 이상 근무 불가');
      expect(rule?.kind).toBe('no_consecutive_work');
      expect(rule?.params.maxConsecutiveDays).toBe(5);
    });

    it('컴파일된 규칙이 4일 연속 근무 → 위반 안 함 (정확히 한도)', () => {
      const rule = compileRule('연속 4일 근무 금지')!;
      const slots = consecutiveDays(1, '2026-04-10', 4);
      expect(rule.validate(slots)).toHaveLength(0);
    });

    it('5일 연속 근무 → 1건 위반', () => {
      const rule = compileRule('연속 4일 근무 금지')!;
      const slots = consecutiveDays(1, '2026-04-10', 5);
      const violations = rule.validate(slots);
      expect(violations).toHaveLength(1);
      expect(violations[0].driverId).toBe(1);
      expect(violations[0].message).toMatch(/5일/);
    });

    it('휴무로 streak 끊김', () => {
      const rule = compileRule('연속 4일 근무 금지')!;
      const slots: SlotForFairness[] = [
        slot(1, '2026-04-10'),
        slot(1, '2026-04-11'),
        slot(1, '2026-04-12', 'FULL_DAY', { isRestDay: true }),
        slot(1, '2026-04-13'),
        slot(1, '2026-04-14'),
        slot(1, '2026-04-15'),
      ];
      // 휴무 후 3일 연속 → 위반 아님
      expect(rule.validate(slots)).toHaveLength(0);
    });

    it('여러 기사 → 각각 독립 검증', () => {
      const rule = compileRule('연속 3일 근무 금지')!;
      const slots = [
        ...consecutiveDays(1, '2026-04-10', 4), // 위반
        ...consecutiveDays(2, '2026-04-10', 2), // 정상
      ];
      const violations = rule.validate(slots);
      expect(violations).toHaveLength(1);
      expect(violations[0].driverId).toBe(1);
    });
  });

  describe('R2: 야간 월 N회 이내', () => {
    it('"야간 월 8회 이내" 컴파일', () => {
      const rule = compileRule('야간 월 8회 이내');
      expect(rule?.kind).toBe('monthly_night_cap');
      expect(rule?.params.maxMonthlyNights).toBe(8);
    });

    it('"야간 12회 초과 금지" 컴파일', () => {
      const rule = compileRule('야간 12회 초과 금지');
      expect(rule?.kind).toBe('monthly_night_cap');
      expect(rule?.params.maxMonthlyNights).toBe(12);
    });

    it('정확히 한도 → 위반 없음', () => {
      const rule = compileRule('야간 월 5회 이내')!;
      const slots = Array.from({ length: 5 }, (_, i) =>
        slot(1, `2026-04-${10 + i}`, 'AFTERNOON')
      );
      expect(rule.validate(slots)).toHaveLength(0);
    });

    it('한도 초과 → 위반', () => {
      const rule = compileRule('야간 월 5회 이내')!;
      const slots = Array.from({ length: 6 }, (_, i) =>
        slot(1, `2026-04-${10 + i}`, 'AFTERNOON')
      );
      const violations = rule.validate(slots);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toMatch(/6회/);
    });

    it('주간 슬롯은 카운트 안 함', () => {
      const rule = compileRule('야간 월 3회 이내')!;
      const slots = Array.from({ length: 5 }, (_, i) =>
        slot(1, `2026-04-${10 + i}`, 'MORNING')
      );
      expect(rule.validate(slots)).toHaveLength(0);
    });
  });

  describe('R3: 주말 휴무 보장', () => {
    it('"주말 월 1회 휴무 보장" 컴파일', () => {
      const rule = compileRule('주말 월 1회 휴무 보장');
      expect(rule?.kind).toBe('weekend_rest_guarantee');
      expect(rule?.params.minWeekendRestDays).toBe(1);
    });

    it('"주말 휴무 보장" (횟수 생략) → 기본 1', () => {
      const rule = compileRule('주말 휴무 보장');
      expect(rule?.kind).toBe('weekend_rest_guarantee');
      expect(rule?.params.minWeekendRestDays).toBe(1);
    });

    it('주말 휴무 0일 → 위반', () => {
      const rule = compileRule('주말 월 1회 휴무 보장')!;
      // 모두 평일 휴무
      const slots: SlotForFairness[] = [
        slot(1, '2026-04-13', 'MORNING', { isRestDay: true }), // 월
        slot(1, '2026-04-14', 'MORNING', { isRestDay: true }), // 화
      ];
      const violations = rule.validate(slots);
      expect(violations).toHaveLength(1);
      expect(violations[0].driverId).toBe(1);
    });

    it('주말 휴무 1일 → 통과', () => {
      const rule = compileRule('주말 월 1회 휴무 보장')!;
      const slots: SlotForFairness[] = [
        slot(1, '2026-04-11', 'MORNING', { isRestDay: true }), // 토 (휴무)
        slot(1, '2026-04-12', 'MORNING'), // 일 (근무)
      ];
      expect(rule.validate(slots)).toHaveLength(0);
    });
  });

  describe('R5: 주 N시간 초과 금지', () => {
    it('"주 52시간 초과 금지" 컴파일', () => {
      const rule = compileRule('주 52시간 초과 금지');
      expect(rule?.kind).toBe('weekly_hour_cap');
      expect(rule?.params.maxWeeklyHours).toBe(52);
    });

    it('주 5일 × 8h = 40h → 통과', () => {
      const rule = compileRule('주 52시간 초과 금지')!;
      const slots = consecutiveDays(1, '2026-04-13', 5); // 월~금
      expect(rule.validate(slots)).toHaveLength(0);
    });

    it('주 7일 × 8h = 56h → 위반', () => {
      const rule = compileRule('주 52시간 초과 금지')!;
      const slots = consecutiveDays(1, '2026-04-13', 7);
      const violations = rule.validate(slots);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].message).toMatch(/56/);
    });
  });

  describe('R4: 1일 N시간 초과 금지', () => {
    it('"1일 9시간 초과 금지" 컴파일', () => {
      const rule = compileRule('1일 9시간 초과 금지');
      expect(rule?.kind).toBe('daily_hour_cap');
      expect(rule?.params.maxDailyHours).toBe(9);
    });

    it('표준 슬롯 8h < 한도 9h → 통과', () => {
      const rule = compileRule('1일 9시간 초과 금지')!;
      expect(rule.validate([slot(1, '2026-04-10')])).toHaveLength(0);
    });

    it('표준 슬롯 10h > 한도 9h → 시스템 설정 위반', () => {
      const rule = compileRule('1일 9시간 초과 금지')!;
      const violations = rule.validate([slot(1, '2026-04-10')], {
        standardHoursPerSlot: 10,
      });
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toMatch(/설정 점검/);
    });
  });
});

// ─────────────────────────────────────────────
// compileRules + runRules
// ─────────────────────────────────────────────

describe('compileRules', () => {
  it('여러 규칙 컴파일, 미인식은 null 표시', () => {
    const results = compileRules([
      '연속 4일 근무 금지',
      '아무 텍스트',
      '주 52시간 초과 금지',
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].compiled?.kind).toBe('no_consecutive_work');
    expect(results[1].compiled).toBeNull();
    expect(results[2].compiled?.kind).toBe('weekly_hour_cap');
  });
});

describe('runRules', () => {
  it('여러 규칙의 위반을 평탄화', () => {
    const rules: CompiledRule[] = [
      compileRule('연속 4일 근무 금지')!,
      compileRule('야간 월 3회 이내')!,
    ];
    const slots = [
      ...consecutiveDays(1, '2026-04-10', 5),
      slot(1, '2026-04-20', 'AFTERNOON'),
      slot(1, '2026-04-21', 'AFTERNOON'),
      slot(1, '2026-04-22', 'AFTERNOON'),
      slot(1, '2026-04-23', 'AFTERNOON'),
    ];

    const violations = runRules(slots, rules);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    const kinds = new Set(violations.map((v) => v.rule));
    expect(kinds.has('no_consecutive_work')).toBe(true);
    expect(kinds.has('monthly_night_cap')).toBe(true);
  });
});

// ─────────────────────────────────────────────
// compileAndValidate (전체 플로우)
// ─────────────────────────────────────────────

describe('compileAndValidate', () => {
  it('규칙 4개 (3개 인식, 1개 미인식) → 정확한 보고서', () => {
    const slots = consecutiveDays(1, '2026-04-10', 5);
    const report = compileAndValidate(
      [
        '연속 4일 근무 금지',
        '주 52시간 초과 금지',
        '주말 휴무 보장',
        '뜻을 알 수 없는 규칙',
      ],
      slots
    );

    expect(report.totalRules).toBe(4);
    expect(report.compiledRules).toBe(3);
    expect(report.unrecognizedRules).toEqual(['뜻을 알 수 없는 규칙']);
    expect(report.hasViolations).toBe(true);
    // 5일 연속 근무 + 주말 휴무 0 → 위반 다수
    expect(report.violations.length).toBeGreaterThan(0);
  });

  it('완벽 슬롯 → hasViolations=false', () => {
    // 4일 근무 → 1일 휴무 → 4일 근무
    const slots: SlotForFairness[] = [
      ...consecutiveDays(1, '2026-04-13', 4), // 월~목
      slot(1, '2026-04-17', 'MORNING', { isRestDay: true }), // 금 휴무
      slot(1, '2026-04-18', 'MORNING', { isRestDay: true }), // 토 휴무 (주말)
      slot(1, '2026-04-19', 'MORNING'), // 일 근무
    ];

    const report = compileAndValidate(
      ['연속 4일 근무 금지', '주말 월 1회 휴무 보장'],
      slots
    );

    expect(report.compiledRules).toBe(2);
    expect(report.violations).toHaveLength(0);
  });
});
