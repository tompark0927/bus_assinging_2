/**
 * Stage 3 — 일별 시프트 그리드 솔버 타입.
 *
 * 입력: 파트너십 매핑 + 기사 풀 + 휴무 신청 + 가중치
 * 출력: (날짜, 버스, AM/PM, 기사) 그리드 + 공정성 메트릭
 *
 * Prisma 의존성 없음 — 순수 데이터 in/out.
 * 백엔드 서비스에서 DB → SolverInput 매핑 후 호출.
 */

/**
 * 시프트 슬롯 식별자 — string 으로 일반화 (Stage 2).
 *
 * 회사 정책에서 정의:
 *   - TWO_SHIFT:  ['AM', 'PM']
 *   - ONE_SHIFT:  ['FULL_DAY']
 *   - THREE_SHIFT: ['MORNING', 'AFTERNOON', 'NIGHT']
 *   - ALTERNATING_DAY: ['ON_DUTY']
 *
 * 코드 내부에서는 string 으로 다루되, ShiftSystem 정책의 slots 배열 외 값은 사용하지 않음.
 */
export type ShiftSlot = string;

/** Stage 1 호환용 — 'AM' | 'PM' 만 쓰던 기존 코드용 alias */
export type TwoShiftSlot = 'AM' | 'PM';

/** 차량 친화도: ★★★ 본인 차, ★★ 같은 노선, ★ 다른 노선 (학습 필요) */
export type Familiarity = 'HOME' | 'SAME_ROUTE' | 'CROSS_ROUTE';

export interface SolverDriver {
  id: number;
  name: string;
  /** 본인 페어 차량 (홈 버스). 페어의 두 운전자가 동일한 homeBusId 를 공유 */
  homeBusId?: number;
  /** 본인 노선 (홈 노선) */
  homeRouteId?: number;
  /** 본인 페어의 상대방 운전자 ID */
  partnerId?: number;
  /** 다른 노선 운행 가능 여부 (요청·특수상황 시) */
  canCrossRoute?: boolean;
  /** 승인된 휴무일 (ISO date: YYYY-MM-DD) */
  approvedDayOffs: string[];
  /** 희망 휴무일 (소프트, 미승인) */
  preferredDayOffs?: string[];
  /** 선호 노선 IDs (우선순위 순, 가장 선호 먼저). 소프트 제약. */
  preferredRouteIds?: number[];
  licenseExpiresAt?: Date;
  qualificationExpiresAt?: Date;
  /** 직전 월 누적 fatigue 점수 (0~100, 높을수록 피로) */
  recentFatigueScore: number;
  /** 관리자가 배차 생성 시 신규로 지정 (헌법 룰 10) */
  isNewHire: boolean;
  /** 사고 이력이 있는 노선 IDs (헌법 룰 11) */
  blockedRouteIds?: number[];
  /**
   * 운전자별 근무일수 override (회사 정책 위에 덮어씀).
   * 기본은 회사 policy.workdayBands; 신규 입사자·장기휴직 복귀자 등 예외만 설정.
   * exemptReason 이 있으면 hardMin 미달 시 hard violation 으로 잡지 않고
   * EXEMPTED 로 처리 + 리포트에 reason/note 표시.
   * 단, hardMax 초과(OVER_MAX)는 reason 무관하게 항상 hard violation.
   */
  workDayTarget?: DriverWorkdayTarget;
  /** 직전 월 마지막 슬롯 패턴 (전월 이월용, 5/2 룰 검증에 사용) */
  carryOverPattern?: {
    /** 마지막 N일 연속 근무 */
    consecutiveWorkDays: number;
    /** 마지막 슬롯 ('AM' | 'PM' | null=휴무) */
    lastShift: ShiftSlot | null;
    /** 직전 주 주력 슬롯 ('AM' | 'PM' | 'MIXED') */
    lastWeekDominantShift: ShiftSlot | 'MIXED';
  };
}

/**
 * 한 차량의 주 운전자 그룹 (Stage 2 일반화).
 *
 * Stage 1 의 `SolverPartnership` 의 일반화 — 1, 2, 3명 모두 표현 가능.
 *
 *   - SOLO  → driverIds: [a]
 *   - PAIR  → driverIds: [a, b]
 *   - TRIO  → driverIds: [a, b, c]
 */
export interface SolverCrew {
  /** 식별자 (예: "C1", "C2") */
  id: string;
  /** 주 운전자 ID 배열 (정책의 crewModel.size 와 일치) */
  driverIds: number[];
  busId: number;
  routeId: number;
}

/** Stage 1 호환 — 페어 전용 alias. 솔버는 자동으로 SolverCrew 로 변환. */
export interface SolverPartnership {
  id: string;
  driverAId: number;
  driverBId: number;
  busId: number;
  routeId: number;
}

export interface SolverBus {
  id: number;
  routeId: number;
  busNumber?: string;
  /** 일별 운행 여부 (없으면 매일 운행). 평일 12 / 휴일 10대 같은 운휴 처리용 */
  operatingDates?: string[];
}

export interface SolverRoute {
  id: number;
  name: string;
  /** 'TRUNK' (간선·도심) | 'BRANCH' (지선·마을) */
  type?: 'TRUNK' | 'BRANCH';
}

export interface SolverWeights {
  /** 근무일수 편차 페널티 (Σ (days - 20.5)²) */
  workdayDeviation: number;
  /** 피로도 분산 페널티 */
  fatigueVariance: number;
  /** 휴무희망 미충족 페널티 */
  dayOffSatisfaction: number;
  /** 친화도 페널티 (HOME=0, SAME_ROUTE=중, CROSS_ROUTE=극대) */
  familiarityCost: number;
  /** 주간 슬롯 일관성 미달 페널티 (한 주에 AM/PM 섞임) */
  weeklyShiftConsistency: number;
  /** 주간 슬롯 교대 미달 페널티 (지난주 AM → 이번주 PM 위반) */
  weeklyShiftAlternation: number;
  /** 주말 휴무 불공정 페널티 */
  weekendFairness: number;
  /** 선호 노선 미충족 페널티 (선호 보유 기사가 비선호 노선 배정 시) */
  routePreference: number;
  /**
   * 미배정 슬롯당 페널티 — 커버리지를 최우선으로 달성하도록 높은 값.
   * 각 미배정 슬롯은 운행 공백(운영 사고)이므로 다른 soft penalty 보다 훨씬 무겁게.
   */
  unfilled: number;
}

export const DEFAULT_WEIGHTS: SolverWeights = {
  workdayDeviation: 10,
  fatigueVariance: 4,
  dayOffSatisfaction: 3,
  familiarityCost: 8,
  weeklyShiftConsistency: 3,
  weeklyShiftAlternation: 2,
  weekendFairness: 4,
  routePreference: 6,
  unfilled: 1000,
};

// ─────────────────────────────────────────────
// CompanyPolicy — Stage 1 (workdayBands + restCycle)
// ─────────────────────────────────────────────
//
// 회사별 정책을 외부화. 코드의 하드코딩 값을 정책으로 옮김.
// Stage 2+ 에서 shiftSystem / crewModel / familiarity / constitutional 추가.
//
// 사용:
//   const policy = POLICY_PRESETS.CITY_2SHIFT;
//   solveMonthlyGrid({ ..., policy });
//
// 또는 prefab 후 일부만 override:
//   const policy = { ...POLICY_PRESETS.CITY_2SHIFT, workdayBands: { ..., hardMax: 24 } };

/** 프리셋 식별자 — Stage 1 에선 2개 */
export type PolicyPreset = 'CITY_2SHIFT' | 'VILLAGE_1SHIFT';

/** 근무일수 밴드 — hard 범위 + sweet 범위 + edge 페널티 */
export interface WorkdayBandsPolicy {
  /** hard 위반 하한 (이 미만 = 면제 없으면 hard violation) */
  hardMin: number;
  /** hard 위반 상한 (이 초과 = 면제 무관 항상 hard violation) */
  hardMax: number;
  /** sweet spot 하한 (>= 이면 무페널티 시작) */
  sweetMin: number;
  /** sweet spot 상한 (<= 이면 무페널티 끝) */
  sweetMax: number;
  /** sweet spot 아래 1일당 페널티 (hardMin 까지 적용) */
  belowSweetPenalty: number;
  /** sweet spot 위 1일당 페널티 (hardMax 까지 적용) */
  aboveSweetPenalty: number;
}

/** 휴무 사이클 정책 — N일 근무 / M일 휴무 */
export interface RestCyclePolicy {
  /** 최대 연속 근무 일 수 */
  workDays: number;
  /** 휴무 블록 일수 */
  restDays: number;
  /** 휴무 블록이 연속이어야 하는가? (5/2 = true, 6/1 = false) */
  consecutiveRest: boolean;
}

/**
 * 시프트 시스템 정책 (Stage 2).
 *
 * 모든 variant 의 공통 필드:
 *   - slots: 일별 슬롯 ID 배열 (순서대로 솔버가 채움)
 *
 * variant 별 추가 필드:
 *   - TWO_SHIFT.weeklyAlternation: 한 주 AM 위주 → 다음 주 PM 위주 강제 여부
 *   - ALTERNATING_DAY.periodDays: 격일제 사이클 (보통 2)
 */
export type ShiftSystemPolicy =
  | { kind: 'TWO_SHIFT'; slots: ['AM', 'PM']; weeklyAlternation: boolean }
  | { kind: 'ONE_SHIFT'; slots: ['FULL_DAY'] }
  | { kind: 'THREE_SHIFT'; slots: ['MORNING', 'AFTERNOON', 'NIGHT'] }
  | { kind: 'ALTERNATING_DAY'; slots: ['ON_DUTY']; periodDays: number };

/**
 * 승무 모델 정책 (Stage 2).
 *
 *   - PAIR: 한 차량의 주 운전자 2명 (성민)
 *   - SOLO: 한 차량 한 운전자 (마을·격일제)
 *   - TRIO: 한 차량 3명 (24시간 운행 등)
 */
export interface CrewModelPolicy {
  kind: 'SOLO' | 'PAIR' | 'TRIO';
  /** 한 차량당 주 운전자 수 (kind 와 일치, 검증용) */
  size: 1 | 2 | 3;
}

/**
 * 헌법 룰 정책 (Stage 3).
 *
 * 회사·지역·단협별로 다른 안전·노동법 룰을 명명 키로 활성·파라미터화.
 * 각 룰은 enabled=false 로 끌 수 있고, 활성화 시 params 로 임계값 조정.
 *
 * 구조적 룰 (noSameDayDoubleAssign, noAssignOnApprovedOff) 은 디폴트 항상 활성.
 * 안전 룰 (license/qualification expired) 도 디폴트 항상 활성.
 * 시프트 의존 룰 (noNightStreak) 은 시프트 시스템에 따라 자동 비활성 가능.
 */
export interface ConstitutionalPolicy {
  /** 야간 시프트 연속 근무 제한 (구 R1) */
  noNightStreak?: {
    enabled: boolean;
    /** 최대 연속 일수 (예: 3 = 4일째부터 위반) */
    maxConsecutive: number;
    /** 야간으로 간주할 시프트 ID 목록 (예: ['PM'] 또는 ['NIGHT']) */
    nightShifts: string[];
  };
  /** 주간 최대 근무일 (구 R2 — 주 52시간 ≈ 6일) */
  weeklyMaxWorkDays?: {
    enabled: boolean;
    maxDays: number;
  };
  /** 같은 날 중복 배정 금지 (구 R3 — 구조적 룰, 항상 활성 권장) */
  noSameDayDoubleAssign?: {
    enabled: boolean;
  };
  /** 운행 후 최소 휴식 시간 (구 R4 — 시간 추적 필요, 디폴트 비활성) */
  minRestBetweenShifts?: {
    enabled: boolean;
    minHours: number;
  };
  /** 휴무 승인일 배정 금지 (구 R5 — 구조적, 항상 활성 권장) */
  noAssignOnApprovedOff?: {
    enabled: boolean;
  };
  /** 면허 만료 운전자 배정 금지 (구 R6) */
  noExpiredLicense?: {
    enabled: boolean;
  };
  /** 적성검사 만료 운전자 배정 금지 (구 R7) */
  noExpiredQualification?: {
    enabled: boolean;
  };
  /** 월 최소 주말 휴무 보장 (구 R9) */
  guaranteedWeekendOff?: {
    enabled: boolean;
    /** 월 최소 주말 휴무 일수 (1 = 한 달 1번 이상 주말 휴무) */
    minPerMonth: number;
  };
  /** 신규 기사 단독 배정 금지 (구 R10 — 호출자가 처리) */
  noNewHireSolo?: {
    enabled: boolean;
    newHirePeriodDays: number;
  };
  /** 사고 이력 노선 재배치 금지 (구 R11) */
  noBlockedRoute?: {
    enabled: boolean;
  };
}

/** 디폴트 헌법 룰 — 한국 시내버스 표준 (CITY_2SHIFT 가정) */
export const DEFAULT_CONSTITUTIONAL: ConstitutionalPolicy = {
  noNightStreak: { enabled: true, maxConsecutive: 3, nightShifts: ['PM'] },
  weeklyMaxWorkDays: { enabled: true, maxDays: 6 },
  noSameDayDoubleAssign: { enabled: true },
  minRestBetweenShifts: { enabled: false, minHours: 8 },
  noAssignOnApprovedOff: { enabled: true },
  noExpiredLicense: { enabled: true },
  noExpiredQualification: { enabled: true },
  guaranteedWeekendOff: { enabled: true, minPerMonth: 1 },
  noNewHireSolo: { enabled: true, newHirePeriodDays: 7 },
  noBlockedRoute: { enabled: true },
};

/** 회사 정책 — Stage 3: constitutional 추가 */
export interface CompanyPolicy {
  /** 프리셋 이름 (디버그·로깅용) */
  preset?: PolicyPreset;
  workdayBands: WorkdayBandsPolicy;
  restCycle: RestCyclePolicy;
  /** 시프트 시스템 (1교대/2교대/3교대/격일제) — Stage 2 */
  shiftSystem: ShiftSystemPolicy;
  /** 승무 모델 (단독/페어/트리오) — Stage 2 */
  crewModel: CrewModelPolicy;
  /** 헌법 룰 정책 — Stage 3. 미지정 시 DEFAULT_CONSTITUTIONAL */
  constitutional?: ConstitutionalPolicy;
}

/** Stage 2 프리셋 — 시내 2교대 (성민) + 마을 1교대 */
export const POLICY_PRESETS: Record<PolicyPreset, CompanyPolicy> = {
  // 시내버스 2교대 + 페어 + 5/2 (성민버스 패턴)
  CITY_2SHIFT: {
    preset: 'CITY_2SHIFT',
    workdayBands: {
      hardMin: 18,
      hardMax: 23,
      sweetMin: 19,
      sweetMax: 22,
      belowSweetPenalty: 5,
      aboveSweetPenalty: 8,
    },
    restCycle: {
      workDays: 5,
      restDays: 2,
      consecutiveRest: true,
    },
    shiftSystem: { kind: 'TWO_SHIFT', slots: ['AM', 'PM'], weeklyAlternation: true },
    crewModel: { kind: 'PAIR', size: 2 },
    constitutional: {
      ...DEFAULT_CONSTITUTIONAL,
      // 시내버스 2교대 = PM 이 야간 (실질적으로 저녁 시간대)
      noNightStreak: { enabled: true, maxConsecutive: 3, nightShifts: ['PM'] },
    },
  },
  // 마을버스 1교대 + 단독 + 6/1
  VILLAGE_1SHIFT: {
    preset: 'VILLAGE_1SHIFT',
    workdayBands: {
      hardMin: 22,
      hardMax: 27,
      sweetMin: 23,
      sweetMax: 26,
      belowSweetPenalty: 3,
      aboveSweetPenalty: 8,
    },
    restCycle: {
      workDays: 6,
      restDays: 1,
      consecutiveRest: false,
    },
    shiftSystem: { kind: 'ONE_SHIFT', slots: ['FULL_DAY'] },
    crewModel: { kind: 'SOLO', size: 1 },
    constitutional: {
      ...DEFAULT_CONSTITUTIONAL,
      // 1교대 = 야간 슬롯 없음
      noNightStreak: { enabled: false, maxConsecutive: 0, nightShifts: [] },
      // 마을버스는 6/1 → 주 6일 근무 정상
      weeklyMaxWorkDays: { enabled: true, maxDays: 6 },
    },
  },
};

/** 디폴트 = CITY_2SHIFT (성민 동작과 동일) */
export const DEFAULT_POLICY: CompanyPolicy = POLICY_PRESETS.CITY_2SHIFT;

// ─────────────────────────────────────────────
// 근무일수 평가 — Tiered constraint (정책 기반)
// ─────────────────────────────────────────────
//
// 회사 정책 (policy.workdayBands) + 운전자 override (driver.workDayTarget)
// 운전자 override 가 있으면 우선; 없으면 회사 정책 사용.
//
// tier 분류:
//   SWEET_SPOT     — [sweetMin, sweetMax]
//   ACCEPTABLE_LOW — [hardMin, sweetMin-1]
//   ACCEPTABLE_HIGH — [sweetMax+1, hardMax]
//   UNDER_MIN      — < hardMin
//   OVER_MAX       — > hardMax
//
// hard violation:
//   UNDER_MIN  — exemptReason 없으면 hard, 있으면 exempt
//   OVER_MAX   — 항상 hard (면제 불가)

export type WorkloadExemptionReason =
  | 'NEW_HIRE' // 신규 입사 (월중 입사로 hardMin 못 채움)
  | 'RETURNING' // 장기휴직 복귀
  | 'PARTIAL_MONTH' // 월중 퇴사·전배
  | 'MEDICAL_LEAVE' // 병가·산재
  | 'SPARE_DRIVER' // 예비(스페어) 기사 — 대타 충원용이라 정규 배차 하한 미적용
  | 'OTHER'; // 기타 (note 권장)

export type WorkloadTier =
  | 'SWEET_SPOT'
  | 'ACCEPTABLE_LOW'
  | 'ACCEPTABLE_HIGH'
  | 'UNDER_MIN'
  | 'OVER_MAX';

/**
 * 운전자별 근무일수 override.
 *
 * 정상 운전자는 이 필드를 비워둠 (회사 정책 그대로 적용).
 * NEW_HIRE / MEDICAL_LEAVE 등 예외 운전자만 설정.
 *
 * 예 — 4/15 입사한 신규:
 *   { min: 0, max: 23, softMin: 19, softMax: 22,
 *     exemptReason: 'NEW_HIRE', exemptNote: '2026-04-15 입사' }
 *
 * 예 — 정상 운전자가 본인 의사로 part-time (회사 정책과 다른 타겟):
 *   { min: 12, max: 16, softMin: 13, softMax: 15 }  (exemptReason 없음)
 */
export interface DriverWorkdayTarget {
  /** hard 하한 — 이 미만이면 UNDER_MIN (exemptReason 없으면 hard violation) */
  min: number;
  /** hard 상한 — 이 초과면 OVER_MAX (항상 hard violation) */
  max: number;
  /** sweet spot 하한 */
  softMin: number;
  /** sweet spot 상한 */
  softMax: number;
  /** 면제 사유 (있으면 UNDER_MIN 일 때 exempt 처리 + 리포트 표시) */
  exemptReason?: WorkloadExemptionReason;
  /** 면제 메모 (예: "2026-04-15 입사") */
  exemptNote?: string;
}

/** 근무일수 평가 결과 — solver 내부 + 워크로드 리포트에서 공유 */
export interface WorkloadEvaluation {
  tier: WorkloadTier;
  /** hard 위반 발생 (objective 에서 거대 페널티). exempt 면 false. */
  hardViolation: boolean;
  /** soft 페널티 값 (objective 에 가산) */
  softPenalty: number;
  /** 면제 적용 여부 (UNDER_MIN + exemptReason 있을 때만 true) */
  exempted: boolean;
  /** 면제 사유 (있을 때) — 리포트 표시용 */
  exemptionReason?: WorkloadExemptionReason;
  /** 면제 메모 (있을 때) — 리포트 표시용 */
  exemptionNote?: string;
  /** 적용된 hard 범위 (운전자 override 또는 회사 정책) */
  appliedRange: { min: number; max: number };
  /** 적용된 sweet 범위 */
  appliedSweetRange: { min: number; max: number };
}

export interface SolverInput {
  year: number;
  /** 1~12 */
  month: number;
  drivers: SolverDriver[];
  buses: SolverBus[];
  /**
   * 한 차량의 주 운전자 그룹 (Stage 2). SOLO/PAIR/TRIO 통합.
   * `partnerships` 가 제공되면 자동으로 SolverCrew[] 로 변환됨 (백워드 호환).
   */
  crews?: SolverCrew[];
  /** Stage 1 호환 — 페어 전용. 솔버 내부에서 SolverCrew 로 변환. */
  partnerships?: SolverPartnership[];
  routes?: SolverRoute[];
  weights?: SolverWeights;
  /**
   * 회사 정책 — workdayBands + restCycle.
   * 미지정 시 DEFAULT_POLICY (CITY_2SHIFT) 사용.
   */
  policy?: CompanyPolicy;
  /** 휴리스틱 반복 횟수 (Phase C) */
  localSearchIterations?: number;
  /** 로컬 서치 RNG 시드. 지정 시 동일 입력 → 동일 결과(재현·감사 가능). 미지정 시 고정 기본 시드 사용. */
  randomSeed?: number;
}

export interface AssignedSlot {
  /** ISO date (YYYY-MM-DD, UTC 기준) */
  date: string;
  busId: number;
  routeId: number;
  shift: ShiftSlot;
  driverId: number;
  /** 차량 친화도 */
  familiarity: Familiarity;
  /** 본인 페어 차량 배정 여부 (HOME 과 동일하나 페어 통계용) */
  isHomeBus: boolean;
}

export interface UnfilledSlot {
  date: string;
  busId: number;
  routeId: number;
  shift: ShiftSlot;
  reason: string;
}

/** 헌법 룰 식별 키 (ConstitutionalPolicy 의 키와 동일) */
export type ConstitutionalRuleKey =
  | 'noNightStreak'
  | 'weeklyMaxWorkDays'
  | 'noSameDayDoubleAssign'
  | 'minRestBetweenShifts'
  | 'noAssignOnApprovedOff'
  | 'noExpiredLicense'
  | 'noExpiredQualification'
  | 'guaranteedWeekendOff'
  | 'noNewHireSolo'
  | 'noBlockedRoute';

export interface ConstitutionalViolation {
  /** 명명된 룰 키 (Stage 3) */
  ruleKey: ConstitutionalRuleKey;
  /** Stage 1 호환 — 구 R1~R11 번호 (없으면 0) */
  ruleId: number;
  ruleName: string;
  driverId: number;
  date?: string;
  detail: string;
}

export interface DriverWorkload {
  driverId: number;
  driverName: string;
  workDays: number;
  weekendShifts: number;
  /** Stage 1 호환 — 2교대 AM 근무일 (다른 시프트 시스템에선 0) */
  amShifts: number;
  /** Stage 1 호환 — 2교대 PM 근무일 (다른 시프트 시스템에선 0) */
  pmShifts: number;
  /** Stage 2 — 모든 시프트 카운트 (TWO_SHIFT 외 시스템도 표현 가능) */
  shiftCounts: Record<string, number>;
  /** 본인 차량 운행 일수 */
  homeBusDays: number;
  /** 다른 노선 운행 일수 (CROSS_ROUTE) */
  crossRouteDays: number;
  /** 가장 긴 연속 근무 일수 (휴무 사이클 검증용) */
  longestStreak: number;
  /** sweet spot 안에 들어왔는지 (정책 sweet 범위) */
  withinTarget: boolean;
  /** acceptable 범위 안에 들어왔는지 (정책 hard 범위, 면제자 포함) */
  withinAcceptable: boolean;
  /** 휴무 사이클 룰 위반 여부 (5/2, 6/1 등) */
  violatesRestCycle: boolean;
  /** 근무일수 평가 결과 (tier, hard violation, exemption) */
  workloadEval: WorkloadEvaluation;
}

export interface SolverMetrics {
  /** 0~100, 100=완전 공정 */
  fairnessScore: number;
  /** 근무일수 표준편차 (목표 < 0.8) */
  workDayStdev: number;
  /** 근무일수 평균 */
  workDayMean: number;
  /** 19~22일 sweet spot 충족 비율 */
  withinTargetRate: number;
  /** 18~23일 acceptable 충족 비율 (면제자 포함) */
  withinAcceptableRate: number;
  /** Hard violation 발생 운전자 수 (UNDER_MIN + OVER_MAX, 면제자 제외) */
  hardViolationCount: number;
  /** 면제 적용 운전자 수 */
  exemptedCount: number;
  /** 본인 차량 배정 비율 (목표 ≥ 80%) */
  homeBusRate: number;
  /** 다른 노선 투입 비율 (목표 < 5%) */
  crossRouteRate: number;
  /** 휴무 사이클 룰 충족률 (위반 0 = 1.0) */
  restCycleCompliance: number;
  /** 주간 슬롯 일관성 (한 주 내 단일 슬롯 비율) */
  weeklyShiftConsistencyRate: number;
  /** 주말 근무 표준편차 */
  weekendStdev: number;
  /** 휴무 희망 충족률 (preferredDayOffs 기준, 0~1) */
  dayOffSatisfactionRate: number;
  /** 헌법 룰 위반 (있으면 안됨) */
  constitutionalViolations: ConstitutionalViolation[];
  /** 채우지 못한 슬롯 수 */
  unfilledCount: number;
  /** Phase C 로컬 서치에서 개선된 swap 횟수 */
  localSearchSwaps: number;
}

export interface SolverOutput {
  slots: AssignedSlot[];
  unfilled: UnfilledSlot[];
  workloads: DriverWorkload[];
  metrics: SolverMetrics;
  /** 사람이 읽을 요약 (DispatchAgent 가 그대로 채팅에 전달 가능) */
  summary: string;
}
