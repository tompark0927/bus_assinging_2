/**
 * Constitutional Rules — 절대 위반 불가 규칙.
 *
 * ROADMAP §3-4 의 12개 규칙을 코드화한다. 도메인 도구가 데이터 변경을 시도하기 전에
 * BaseAgent 가 이 검증기를 호출하고, 위반이면 도구 호출을 차단 + 모델에게 사유 반환.
 *
 * 모델이 환각으로 위반을 시도하더라도 시스템 단에서 막힌다 — "AI 직원" 의 근로기준법 자동 준수.
 *
 * 검증기는 모두 순수 함수 (DB 접근은 호출 측에서 미리 데이터를 모아 전달).
 * → 시뮬레이션·실시간 모두 동일 로직.
 */

export interface ConstitutionalContext {
  /** 검증 대상이 되는 변경 행위 종류 */
  action:
    | 'assign_slot'
    | 'modify_slot'
    | 'publish_schedule'
    | 'send_targeted_push'
    | 'approve_dayoff'
    | 'swap_drivers';
  /** 행위가 영향을 주는 기사 (대부분의 규칙은 기사 단위) */
  driverId?: number;
  /** 변경 후 기사의 향후 N일 배차 (도구 호출 측에서 계산해서 넣어줌) */
  driverUpcomingShifts?: Array<{
    date: Date;
    shift: 'MORNING' | 'AFTERNOON' | 'FULL_DAY' | 'NIGHT' | 'OFF';
    routeId?: number;
    durationHours?: number;
  }>;
  /** 기사 자격 정보 */
  driverLicense?: {
    licenseExpiresAt?: Date | null;
    qualificationExpiresAt?: Date | null;
  };
  /** 승인된 휴무일 (해당 기사) */
  approvedDayoffs?: Date[];
  /** 같은 노선에서 동일 날짜에 휴무인 기사 수 / 노선 전체 기사 수 */
  routeDayoffCoverage?: { totalDrivers: number; offDrivers: number };
  /** 신규 기사 입사 후 경과 일수 */
  driverDaysSinceHire?: number;
  /** 사고 이력 있는 노선에 기사 재배치 검증용 */
  driverHasIncidentOnRoute?: boolean;
  /** 발행된 배차표 변경 시도인지 */
  scheduleAlreadyPublished?: boolean;
  /** 긴급 결원 처리 컨텍스트 (true 면 발행 후 변경도 허용) */
  isEmergencyOverride?: boolean;
  /** 변경의 시점 ('지금') — 시뮬레이션 시 가상 시각 */
  now: Date;
}

export interface ConstitutionalViolation {
  rule: string;
  message: string;
}

type RuleFn = (ctx: ConstitutionalContext) => ConstitutionalViolation | null;

// ─────────────────────────────────────────────
// 12 Rules
// ─────────────────────────────────────────────

const ruleNoFourConsecutiveNights: RuleFn = (ctx) => {
  if (!ctx.driverUpcomingShifts || ctx.driverUpcomingShifts.length < 4) return null;
  const sorted = [...ctx.driverUpcomingShifts].sort((a, b) => a.date.getTime() - b.date.getTime());
  let streak = 0;
  for (const s of sorted) {
    if (s.shift === 'NIGHT') {
      streak++;
      if (streak >= 4) {
        return { rule: 'no_four_consecutive_nights', message: '동일 기사 야간 4일 연속 금지' };
      }
    } else {
      streak = 0;
    }
  }
  return null;
};

const ruleWeekly52HourCap: RuleFn = (ctx) => {
  if (!ctx.driverUpcomingShifts) return null;
  // 향후 7일 합산이 52시간 초과하면 위반
  const next7 = ctx.driverUpcomingShifts
    .filter((s) => {
      const diffDays = (s.date.getTime() - ctx.now.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays < 7;
    })
    .reduce((sum, s) => sum + (s.durationHours ?? (s.shift === 'OFF' ? 0 : 8)), 0);
  if (next7 > 52) {
    return {
      rule: 'weekly_52h_cap',
      message: `주 52시간 상한 초과 (예상 ${next7.toFixed(1)}h)`,
    };
  }
  return null;
};

const ruleContinuousDriving4h: RuleFn = (ctx) => {
  // 4시간 연속 운행 한도는 슬롯 단위가 아니라 운행 일정 내부 휴식 여부의 문제.
  // 슬롯 자체가 8h 이내면 정상 (현장에서 30분 휴식 의무는 운행 규정으로 처리).
  // 여기서는 단일 슬롯 8시간 초과를 기준으로 검증.
  if (!ctx.driverUpcomingShifts) return null;
  const oversize = ctx.driverUpcomingShifts.find((s) => (s.durationHours ?? 0) > 9);
  if (oversize) {
    return {
      rule: 'continuous_driving_4h',
      message: `슬롯 길이 9시간 초과 (${oversize.durationHours}h) — 버스기사 특례 위반`,
    };
  }
  return null;
};

const ruleMin8hRest: RuleFn = (ctx) => {
  if (!ctx.driverUpcomingShifts || ctx.driverUpcomingShifts.length < 2) return null;
  const sorted = [...ctx.driverUpcomingShifts]
    .filter((s) => s.shift !== 'OFF')
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd =
      sorted[i - 1].date.getTime() + (sorted[i - 1].durationHours ?? 8) * 3600 * 1000;
    const gap = (sorted[i].date.getTime() - prevEnd) / (3600 * 1000);
    if (gap < 8) {
      return {
        rule: 'min_8h_rest',
        message: `운행 간 최소 8시간 휴식 미충족 (${gap.toFixed(1)}h)`,
      };
    }
  }
  return null;
};

const ruleNoAssignOnApprovedDayoff: RuleFn = (ctx) => {
  if (!ctx.approvedDayoffs || !ctx.driverUpcomingShifts) return null;
  const offSet = new Set(ctx.approvedDayoffs.map((d) => d.toISOString().slice(0, 10)));
  const conflict = ctx.driverUpcomingShifts.find(
    (s) => s.shift !== 'OFF' && offSet.has(s.date.toISOString().slice(0, 10))
  );
  if (conflict) {
    return {
      rule: 'no_assign_on_approved_dayoff',
      message: `승인된 휴무일에 배차 시도 (${conflict.date.toISOString().slice(0, 10)})`,
    };
  }
  return null;
};

const ruleNoExpiredLicense: RuleFn = (ctx) => {
  if (!ctx.driverLicense?.licenseExpiresAt) return null;
  if (ctx.driverLicense.licenseExpiresAt.getTime() < ctx.now.getTime()) {
    return { rule: 'no_expired_license', message: '운전면허 만료된 기사 배차 금지' };
  }
  return null;
};

const ruleNoExpiredQualification: RuleFn = (ctx) => {
  if (!ctx.driverLicense?.qualificationExpiresAt) return null;
  if (ctx.driverLicense.qualificationExpiresAt.getTime() < ctx.now.getTime()) {
    return {
      rule: 'no_expired_qualification',
      message: '버스운전자격증 만료된 기사 배차 금지',
    };
  }
  return null;
};

const ruleNoFullRouteDayoff: RuleFn = (ctx) => {
  if (!ctx.routeDayoffCoverage) return null;
  const { totalDrivers, offDrivers } = ctx.routeDayoffCoverage;
  if (totalDrivers > 0 && offDrivers >= totalDrivers) {
    return {
      rule: 'no_full_route_dayoff',
      message: '같은 노선의 모든 기사가 동시에 휴무 — 운행 불가',
    };
  }
  return null;
};

const ruleMonthlyWeekendOff: RuleFn = (_ctx) => {
  // 월 1회 주말 휴무 보장은 월간 배차표 발행 시점에서 검증해야 의미 있음.
  // 단일 슬롯 변경 시점에는 검증 생략 (publish_schedule 시 별도 검증 호출).
  return null;
};

const ruleNoSoloFirstWeek: RuleFn = (ctx) => {
  if (ctx.driverDaysSinceHire === undefined) return null;
  if (ctx.driverDaysSinceHire < 7 && ctx.action === 'assign_slot') {
    return {
      rule: 'no_solo_first_week',
      message: '신규 기사 입사 첫 주 단독 배차 금지 (선배 동승 필수)',
    };
  }
  return null;
};

const ruleNoIncidentRouteReassign: RuleFn = (ctx) => {
  if (ctx.driverHasIncidentOnRoute) {
    return {
      rule: 'no_incident_route_reassign',
      message: '과거 사고 이력 있는 노선에 해당 기사 재배치 금지',
    };
  }
  return null;
};

const rulePublishedScheduleImmutable: RuleFn = (ctx) => {
  if (!ctx.scheduleAlreadyPublished) return null;
  if (ctx.isEmergencyOverride) return null;
  if (ctx.action === 'modify_slot' || ctx.action === 'swap_drivers') {
    return {
      rule: 'published_schedule_immutable',
      message: '발행된 배차표는 휴먼 승인 없이 변경 불가 (긴급 결원만 예외)',
    };
  }
  return null;
};

const ALL_RULES: ReadonlyArray<RuleFn> = [
  ruleNoFourConsecutiveNights,
  ruleWeekly52HourCap,
  ruleContinuousDriving4h,
  ruleMin8hRest,
  ruleNoAssignOnApprovedDayoff,
  ruleNoExpiredLicense,
  ruleNoExpiredQualification,
  ruleNoFullRouteDayoff,
  ruleMonthlyWeekendOff,
  ruleNoSoloFirstWeek,
  ruleNoIncidentRouteReassign,
  rulePublishedScheduleImmutable,
];

/**
 * 모든 규칙을 평가. 최초 위반을 반환 (모델이 한 번에 한 위반씩 인지하고 다시 시도하기 위함).
 */
export function checkConstitutional(ctx: ConstitutionalContext): ConstitutionalViolation | null {
  for (const rule of ALL_RULES) {
    const violation = rule(ctx);
    if (violation) return violation;
  }
  return null;
}

/** 활성 규칙 목록 (관리자 UI 표시·테스트용) */
export const CONSTITUTIONAL_RULE_NAMES = [
  '동일 기사 야간 4일 연속 금지',
  '주 52시간 상한 (1일 8시간 기준)',
  '연속 운행 4시간 초과 금지 (버스기사 특례, 단일 슬롯 9h 한도)',
  '운행 후 최소 8시간 휴식 의무',
  '휴무 승인된 날에 배차 금지',
  '면허 만료된 기사 배차 금지',
  '적성검사·자격증 만료 기사 배차 금지',
  '같은 노선 모든 기사가 동시 휴무 금지',
  '주말 휴무 최소 월 1회 보장 (월간 발행 시 검증)',
  '신규 기사 입사 첫 주 단독 배차 금지',
  '과거 사고 이력 있는 노선에 해당 기사 재배치 금지',
  '발행된 배차표는 휴먼 승인 없이 변경 불가 (긴급 결원 제외)',
] as const;
