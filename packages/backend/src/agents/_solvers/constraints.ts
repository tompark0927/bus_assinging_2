/**
 * 헌법 룰 검증기 — Stage 3: 정책 기반 (ConstitutionalPolicy).
 *
 * 모든 룰이 ConstitutionalPolicy 의 enabled 플래그로 on/off 가능.
 * 회사·지역·단협별로 다른 룰셋을 적용 가능.
 *
 * 슬롯 단위 (checkAssignment) — Phase B 에서 호출:
 *   - noAssignOnApprovedOff (구 R5)
 *   - noExpiredLicense (구 R6)
 *   - noExpiredQualification (구 R7)
 *   - noBlockedRoute (구 R11)
 *   - noSameDayDoubleAssign (구 R3)
 *   - minRestBetweenShifts (구 R4, 디폴트 비활성)
 *
 * 그리드 후처리 (validateFullGrid):
 *   - noNightStreak (구 R1)
 *   - weeklyMaxWorkDays (구 R2)
 *   - guaranteedWeekendOff (구 R9)
 *
 * 호출자 책임 (솔버 본체에서):
 *   - noNewHireSolo (구 R10) — pickDriver 내부
 */

import {
  DEFAULT_CONSTITUTIONAL,
  type AssignedSlot,
  type CompanyPolicy,
  type ConstitutionalPolicy,
  type ConstitutionalViolation,
  type ConstitutionalRuleKey,
  type ShiftSlot,
  type SolverDriver,
} from './types';

export interface ConstraintContext {
  drivers: Map<number, SolverDriver>;
  /** 기사별 날짜순 슬롯 (Phase A 채우기 중 확장) */
  driverSlots: Map<number, AssignedSlot[]>;
}

// ─────────────────────────────────────────────
// Helper — 룰 키 → 한국어 이름 + 구 ruleId 매핑
// ─────────────────────────────────────────────

const RULE_INFO: Record<
  ConstitutionalRuleKey,
  { ruleId: number; ruleName: string }
> = {
  noNightStreak: { ruleId: 1, ruleName: '야간 연속 근무 제한' },
  weeklyMaxWorkDays: { ruleId: 2, ruleName: '주간 최대 근무일' },
  noSameDayDoubleAssign: { ruleId: 3, ruleName: '같은 날 중복 배정 금지' },
  minRestBetweenShifts: { ruleId: 4, ruleName: '운행 후 최소 휴식' },
  noAssignOnApprovedOff: { ruleId: 5, ruleName: '휴무 승인일 배정 금지' },
  noExpiredLicense: { ruleId: 6, ruleName: '면허 만료 운전자 배정 금지' },
  noExpiredQualification: { ruleId: 7, ruleName: '적성검사 만료 운전자 배정 금지' },
  guaranteedWeekendOff: { ruleId: 9, ruleName: '월 최소 주말 휴무' },
  noNewHireSolo: { ruleId: 10, ruleName: '신규 기사 단독 배정 금지' },
  noBlockedRoute: { ruleId: 11, ruleName: '사고 이력 노선 재배치 금지' },
};

function makeViolation(
  ruleKey: ConstitutionalRuleKey,
  driverId: number,
  detail: string,
  date?: string,
): ConstitutionalViolation {
  const info = RULE_INFO[ruleKey];
  return { ruleKey, ruleId: info.ruleId, ruleName: info.ruleName, driverId, date, detail };
}

/**
 * 정책 또는 디폴트 헌법 정책에서 룰 추출.
 * 룰이 정의되지 않았거나 enabled=false 면 비활성으로 간주.
 */
function getRule<K extends ConstitutionalRuleKey>(
  policy: CompanyPolicy | undefined,
  key: K,
): NonNullable<ConstitutionalPolicy[K]> | null {
  const constitutional = policy?.constitutional ?? DEFAULT_CONSTITUTIONAL;
  const rule = constitutional[key];
  if (!rule || !(rule as { enabled: boolean }).enabled) return null;
  return rule as NonNullable<ConstitutionalPolicy[K]>;
}

// ─────────────────────────────────────────────
// 슬롯 단위 검증 (Phase B 에서 호출)
// ─────────────────────────────────────────────

/**
 * 특정 운전자를 (date, busId, shift) 슬롯에 배정 가능한지 검증.
 * 위반 시 ConstitutionalViolation 반환, 가능하면 null.
 */
export function checkAssignment(
  ctx: ConstraintContext,
  driverId: number,
  date: string,
  shift: ShiftSlot,
  routeId: number,
  policy?: CompanyPolicy,
): ConstitutionalViolation | null {
  const driver = ctx.drivers.get(driverId);
  if (!driver) {
    return {
      ruleKey: 'noSameDayDoubleAssign', // sentinel
      ruleId: 0,
      ruleName: 'UNKNOWN_DRIVER',
      driverId,
      date,
      detail: `Driver ${driverId} not found`,
    };
  }

  // noAssignOnApprovedOff (R5)
  if (getRule(policy, 'noAssignOnApprovedOff')) {
    if (driver.approvedDayOffs.includes(date)) {
      return makeViolation(
        'noAssignOnApprovedOff',
        driverId,
        `${driver.name} 은(는) ${date} 휴무 승인됨`,
        date,
      );
    }
  }

  // noExpiredLicense (R6)
  if (getRule(policy, 'noExpiredLicense')) {
    if (driver.licenseExpiresAt) {
      const dateObj = parseDate(date);
      if (dateObj >= driver.licenseExpiresAt) {
        return makeViolation(
          'noExpiredLicense',
          driverId,
          `${driver.name} 면허 만료일: ${driver.licenseExpiresAt.toISOString().slice(0, 10)}`,
          date,
        );
      }
    }
  }

  // noExpiredQualification (R7)
  if (getRule(policy, 'noExpiredQualification')) {
    if (driver.qualificationExpiresAt) {
      const dateObj = parseDate(date);
      if (dateObj >= driver.qualificationExpiresAt) {
        return makeViolation(
          'noExpiredQualification',
          driverId,
          `${driver.name} 자격 만료일: ${driver.qualificationExpiresAt.toISOString().slice(0, 10)}`,
          date,
        );
      }
    }
  }

  // noBlockedRoute (R11)
  if (getRule(policy, 'noBlockedRoute')) {
    if (driver.blockedRouteIds?.includes(routeId)) {
      return makeViolation(
        'noBlockedRoute',
        driverId,
        `${driver.name} 은(는) 노선 ${routeId} 배정 차단됨 (사고 이력)`,
        date,
      );
    }
  }

  const existing = ctx.driverSlots.get(driverId) ?? [];

  // noSameDayDoubleAssign (R3)
  if (getRule(policy, 'noSameDayDoubleAssign')) {
    const sameDay = existing.find((s) => s.date === date);
    if (sameDay) {
      return makeViolation(
        'noSameDayDoubleAssign',
        driverId,
        `${driver.name} 은(는) ${date} 에 이미 ${sameDay.shift} 배정됨`,
        date,
      );
    }
  }

  // minRestBetweenShifts (R4) — 디폴트 비활성, 시간 추적 필요
  // 활성 시 단순히 PM → 익일 AM 만 차단 (정확히는 시프트별 종료·시작 시간 입력 필요)
  const restRule = getRule(policy, 'minRestBetweenShifts');
  if (restRule && shift === 'AM') {
    const prev = previousDate(date);
    const prevPM = existing.find((s) => s.date === prev && s.shift === 'PM');
    if (prevPM) {
      return makeViolation(
        'minRestBetweenShifts',
        driverId,
        `${driver.name} ${prev} PM → ${date} AM (휴식 < ${restRule.minHours}시간)`,
        date,
      );
    }
  }

  return null;
}

// ─────────────────────────────────────────────
// 그리드 후처리 검증 (validateFullGrid)
// ─────────────────────────────────────────────

export function validateFullGrid(
  drivers: SolverDriver[],
  slots: AssignedSlot[],
  monthStart: Date,
  monthEnd: Date,
  policy?: CompanyPolicy,
): ConstitutionalViolation[] {
  const violations: ConstitutionalViolation[] = [];
  const byDriver = new Map<number, AssignedSlot[]>();

  for (const slot of slots) {
    const arr = byDriver.get(slot.driverId) ?? [];
    arr.push(slot);
    byDriver.set(slot.driverId, arr);
  }

  const nightRule = getRule(policy, 'noNightStreak');
  const weeklyRule = getRule(policy, 'weeklyMaxWorkDays');
  const weekendRule = getRule(policy, 'guaranteedWeekendOff');
  const totalWeekendDays = weekendRule
    ? countWeekendDays(monthStart, monthEnd)
    : 0;

  for (const driver of drivers) {
    const dSlots = (byDriver.get(driver.id) ?? []).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    // noNightStreak (R1) — 야간 시프트 maxConsecutive+1 일 연속이면 위반
    if (nightRule && nightRule.nightShifts.length > 0) {
      const isNight = (s: AssignedSlot) => nightRule.nightShifts.includes(s.shift);
      let streak = 0;
      let streakStart: string | null = null;
      let lastDate: string | null = null;
      for (const s of dSlots) {
        if (isNight(s) && (lastDate === null || isNextDate(lastDate, s.date))) {
          if (streak === 0) streakStart = s.date;
          streak++;
          if (streak > nightRule.maxConsecutive) {
            violations.push(
              makeViolation(
                'noNightStreak',
                driver.id,
                `${driver.name} 야간 연속 ${streak}일 (시작: ${streakStart}, 임계 ${nightRule.maxConsecutive})`,
                s.date,
              ),
            );
            break;
          }
        } else if (isNight(s)) {
          streak = 1;
          streakStart = s.date;
        } else {
          streak = 0;
          streakStart = null;
        }
        lastDate = s.date;
      }
    }

    // weeklyMaxWorkDays (R2)
    if (weeklyRule) {
      const weeklyCount = countByWeek(dSlots);
      for (const [weekStart, count] of weeklyCount.entries()) {
        if (count > weeklyRule.maxDays) {
          violations.push(
            makeViolation(
              'weeklyMaxWorkDays',
              driver.id,
              `${driver.name} 주(${weekStart}~) ${count}일 근무 (>${weeklyRule.maxDays}일)`,
              weekStart,
            ),
          );
        }
      }
    }

    // guaranteedWeekendOff (R9)
    if (weekendRule) {
      const workedWeekends = dSlots.filter((s) => isWeekend(s.date)).length;
      const offWeekends = totalWeekendDays - workedWeekends;
      if (offWeekends < weekendRule.minPerMonth) {
        violations.push(
          makeViolation(
            'guaranteedWeekendOff',
            driver.id,
            `${driver.name} 주말 휴무 ${offWeekends}일 (월 최소 ${weekendRule.minPerMonth}일 필요)`,
          ),
        );
      }
    }
  }

  return violations;
}

// ─── 날짜 헬퍼 ───
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function previousDate(iso: string): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() - 1);
  return formatDate(d);
}

export function isNextDate(prev: string, next: string): boolean {
  return previousDate(next) === prev;
}

export function isWeekend(iso: string): boolean {
  const d = parseDate(iso);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function countByWeek(slots: AssignedSlot[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const s of slots) {
    const d = parseDate(s.date);
    const dayOfWeek = d.getUTCDay();
    const weekStart = new Date(d);
    weekStart.setUTCDate(d.getUTCDate() - dayOfWeek);
    const key = formatDate(weekStart);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

export function countWeekendDays(start: Date, end: Date): number {
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day === 0 || day === 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}
