/**
 * 자연어 노조·회사 규칙 → 검증 함수 컴파일러.
 *
 * 한국 버스 회사 노조 규칙은 자연어로 작성된다 — 예: "연속 4일 근무 금지", "주말 휴무 보장",
 * "야간 월 8회 이내". 이 모듈은 자연어 패턴을 매칭해 검증 함수(ValidationFn)로 변환한다.
 *
 * 작동 방식:
 *   1) `compileRule(text)` — 한 줄 자연어 규칙 → CompiledRule (또는 null)
 *   2) `compileRules(texts)` — 여러 규칙 일괄 컴파일
 *   3) `runRules(slots, rules)` — 슬롯 배열을 모든 규칙으로 검증 → 위반 목록
 *
 * 패턴 매칭은 의도적으로 단순:
 *   - LLM 호출 없음 (결정론적, 빠름, 무료)
 *   - 한국어 정규식 패턴 (CompanyRule.content 가 사람이 작성한 문장이라 가정)
 *   - 미인식 규칙은 null 반환 → 호출 측이 fallback 처리 (수동 검토 등)
 *
 * 지원 패턴 (PHASE 2 v1):
 *   - "연속 N일 근무 금지" / "연속 N일 이상 근무 불가"
 *   - "야간 월 N회 이내" / "월 야간 N회 초과 금지"
 *   - "주말 휴무 보장" / "주말 월 N회 휴무"
 *   - "1일 N시간 초과 금지" (단일 슬롯 길이)
 *   - "주 N시간 초과 금지"
 */

import type { SlotForFairness } from './fairness';

// ─────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────

export type RuleKind =
  | 'no_consecutive_work'
  | 'monthly_night_cap'
  | 'weekend_rest_guarantee'
  | 'daily_hour_cap'
  | 'weekly_hour_cap';

export interface CompiledRule {
  kind: RuleKind;
  /** 원본 자연어 텍스트 */
  source: string;
  /** 추출된 파라미터 (예: { maxConsecutiveDays: 4 }) */
  params: Record<string, number>;
  /** 검증 함수 — 슬롯 배열과 검증 컨텍스트를 받아 위반 목록 반환 */
  validate: ValidationFn;
}

export interface ValidationContext {
  /** 한 슬롯의 표준 근무 시간 (기본 8) */
  standardHoursPerSlot?: number;
}

export interface RuleViolation {
  rule: RuleKind;
  source: string;
  driverId?: number;
  message: string;
  /** 위반 슬롯 ID 또는 날짜 */
  context?: Record<string, unknown>;
}

export type ValidationFn = (
  slots: SlotForFairness[],
  ctx?: ValidationContext
) => RuleViolation[];

// ─────────────────────────────────────────────
// 헬퍼: 슬롯 그룹화·시간 계산
// ─────────────────────────────────────────────

function groupByDriver(slots: SlotForFairness[]): Map<number, SlotForFairness[]> {
  const map = new Map<number, SlotForFairness[]>();
  for (const s of slots) {
    const arr = map.get(s.driverId) ?? [];
    arr.push(s);
    map.set(s.driverId, arr);
  }
  return map;
}

function isNightShift(shift: string): boolean {
  return shift === 'AFTERNOON' || shift === 'NIGHT';
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function isWorkSlot(s: SlotForFairness): boolean {
  return !s.isRestDay && s.status !== 'ABSENT';
}

function dateOnlyMs(d: Date): number {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy.getTime();
}

const MS_PER_DAY = 24 * 3600 * 1000;

/**
 * 한국 노동법 기준 ISO 주 키 (월요일 시작).
 *
 * 1970-01-01 = Thursday (day 0). Monday = day 4.
 * `floor((daysFromEpoch - 4) / 7)` 로 월요일 시작 주 인덱스 산출.
 */
function isoWeekKey(d: Date): number {
  const days = Math.floor(dateOnlyMs(d) / MS_PER_DAY);
  return Math.floor((days - 4) / 7);
}

// ─────────────────────────────────────────────
// 패턴 매처
// ─────────────────────────────────────────────

interface PatternHandler {
  pattern: RegExp;
  build: (match: RegExpMatchArray, source: string) => CompiledRule;
}

// ── R1: 연속 N일 근무 금지 ──
const consecutiveWorkPattern: PatternHandler = {
  pattern: /연속\s*(\d+)\s*일?\s*(이상\s*)?(근무\s*)?(금지|제한|불가)/,
  build: (match, source) => {
    const maxDays = parseInt(match[1], 10);
    return {
      kind: 'no_consecutive_work',
      source,
      params: { maxConsecutiveDays: maxDays },
      validate: (slots) => {
        const violations: RuleViolation[] = [];
        const byDriver = groupByDriver(slots);

        for (const [driverId, driverSlots] of byDriver) {
          const workDates = driverSlots
            .filter(isWorkSlot)
            .map((s) => dateOnlyMs(s.date))
            .sort((a, b) => a - b);

          let streak = 1;
          for (let i = 1; i < workDates.length; i++) {
            const diffDays = (workDates[i] - workDates[i - 1]) / (24 * 3600 * 1000);
            if (diffDays === 1) {
              streak++;
              if (streak > maxDays) {
                violations.push({
                  rule: 'no_consecutive_work',
                  source,
                  driverId,
                  message: `${maxDays + 1}일 연속 근무 (한도 ${maxDays}일)`,
                  context: {
                    streakStart: new Date(workDates[i - streak + 1]).toISOString().slice(0, 10),
                    streakEnd: new Date(workDates[i]).toISOString().slice(0, 10),
                    streakLength: streak,
                  },
                });
                break; // 같은 기사 중복 위반 방지
              }
            } else {
              streak = 1;
            }
          }
        }

        return violations;
      },
    };
  },
};

// ── R2: 야간 월 N회 이내 ──
const monthlyNightCapPattern: PatternHandler = {
  pattern: /야간\s*(?:월\s*)?(\d+)\s*회\s*(이내|초과\s*금지|이상\s*금지|초과\s*불가)/,
  build: (match, source) => {
    const cap = parseInt(match[1], 10);
    return {
      kind: 'monthly_night_cap',
      source,
      params: { maxMonthlyNights: cap },
      validate: (slots) => {
        const violations: RuleViolation[] = [];
        const byDriver = groupByDriver(slots);

        for (const [driverId, driverSlots] of byDriver) {
          const nights = driverSlots.filter((s) => isWorkSlot(s) && isNightShift(s.shift));
          if (nights.length > cap) {
            violations.push({
              rule: 'monthly_night_cap',
              source,
              driverId,
              message: `야간 ${nights.length}회 (한도 ${cap}회)`,
              context: { count: nights.length, cap },
            });
          }
        }

        return violations;
      },
    };
  },
};

// ── R3: 주말 휴무 보장 (월 N회) ──
const weekendRestPattern: PatternHandler = {
  pattern: /주말\s*(?:월\s*)?(?:최소\s*)?(\d+)?\s*회?\s*휴무\s*(?:보장|의무)?/,
  build: (match, source) => {
    const minCount = match[1] ? parseInt(match[1], 10) : 1;
    return {
      kind: 'weekend_rest_guarantee',
      source,
      params: { minWeekendRestDays: minCount },
      validate: (slots) => {
        const violations: RuleViolation[] = [];
        const byDriver = groupByDriver(slots);

        for (const [driverId, driverSlots] of byDriver) {
          const weekendRests = driverSlots.filter(
            (s) => s.isRestDay && isWeekend(s.date)
          );
          if (weekendRests.length < minCount) {
            violations.push({
              rule: 'weekend_rest_guarantee',
              source,
              driverId,
              message: `주말 휴무 ${weekendRests.length}회 < 최소 ${minCount}회`,
              context: { actual: weekendRests.length, required: minCount },
            });
          }
        }

        return violations;
      },
    };
  },
};

// ── R4: 1일 N시간 초과 금지 (단일 슬롯) ──
const dailyHourPattern: PatternHandler = {
  pattern: /1\s*일\s*(\d+)\s*시간\s*(?:이상\s*|초과\s*)?(?:금지|불가|제한)/,
  build: (match, source) => {
    const cap = parseInt(match[1], 10);
    return {
      kind: 'daily_hour_cap',
      source,
      params: { maxDailyHours: cap },
      validate: (slots, ctx) => {
        // SlotForFairness 에 시간 정보가 없으므로 표준 시간으로 추정
        const standardHours = ctx?.standardHoursPerSlot ?? 8;
        if (standardHours <= cap) return [];

        // 표준 슬롯이 한도를 초과하는 비정상 케이스 → 시스템 설정 점검 권고
        return [
          {
            rule: 'daily_hour_cap',
            source,
            message: `시스템 표준 슬롯 ${standardHours}h > 규칙 한도 ${cap}h — 설정 점검 필요`,
            context: { standardHours, cap },
          },
        ];
      },
    };
  },
};

// ── R5: 주 N시간 초과 금지 ──
const weeklyHourPattern: PatternHandler = {
  pattern: /주\s*(\d+)\s*시간\s*(?:이상\s*|초과\s*)?(?:금지|불가|제한)/,
  build: (match, source) => {
    const cap = parseInt(match[1], 10);
    return {
      kind: 'weekly_hour_cap',
      source,
      params: { maxWeeklyHours: cap },
      validate: (slots, ctx) => {
        const violations: RuleViolation[] = [];
        const standardHours = ctx?.standardHoursPerSlot ?? 8;
        const byDriver = groupByDriver(slots);

        for (const [driverId, driverSlots] of byDriver) {
          const workSlots = driverSlots.filter(isWorkSlot);
          // ISO 주 단위 그룹 (월요일 시작) — 한국 노동법 기준
          const byWeek = new Map<number, number>();
          for (const s of workSlots) {
            const week = isoWeekKey(s.date);
            byWeek.set(week, (byWeek.get(week) ?? 0) + standardHours);
          }
          for (const [week, hours] of byWeek) {
            if (hours > cap) {
              violations.push({
                rule: 'weekly_hour_cap',
                source,
                driverId,
                message: `주 ${hours}h > 한도 ${cap}h`,
                context: { weekKey: week, hours, cap },
              });
            }
          }
        }

        return violations;
      },
    };
  },
};

const ALL_PATTERNS: ReadonlyArray<PatternHandler> = [
  consecutiveWorkPattern,
  monthlyNightCapPattern,
  weekendRestPattern,
  dailyHourPattern,
  weeklyHourPattern,
];

// ─────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────

/**
 * 단일 자연어 규칙을 컴파일.
 * 매칭되는 패턴이 없으면 null (호출 측이 수동 검토 등으로 처리).
 */
export function compileRule(text: string): CompiledRule | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  for (const handler of ALL_PATTERNS) {
    const match = trimmed.match(handler.pattern);
    if (match) {
      return handler.build(match, trimmed);
    }
  }
  return null;
}

/**
 * 여러 규칙을 컴파일. 각 항목에 매칭 결과 포함.
 */
export interface CompileResult {
  source: string;
  compiled: CompiledRule | null;
}

export function compileRules(texts: string[]): CompileResult[] {
  return texts.map((source) => ({
    source,
    compiled: compileRule(source),
  }));
}

/**
 * 컴파일된 규칙들로 슬롯 배열을 검증.
 * 모든 규칙의 모든 위반을 평탄화하여 반환.
 */
export function runRules(
  slots: SlotForFairness[],
  rules: CompiledRule[],
  ctx?: ValidationContext
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  for (const rule of rules) {
    violations.push(...rule.validate(slots, ctx));
  }
  return violations;
}

/**
 * 컴파일 + 검증을 한 번에. 미인식 규칙은 보고서에 별도 표시.
 */
export interface ValidationReport {
  totalRules: number;
  compiledRules: number;
  unrecognizedRules: string[];
  violations: RuleViolation[];
  hasViolations: boolean;
}

export function compileAndValidate(
  ruleTexts: string[],
  slots: SlotForFairness[],
  ctx?: ValidationContext
): ValidationReport {
  const compiled = compileRules(ruleTexts);
  const validRules = compiled.filter((r) => r.compiled !== null).map((r) => r.compiled!);
  const unrecognized = compiled.filter((r) => r.compiled === null).map((r) => r.source);

  const violations = runRules(slots, validRules, ctx);

  return {
    totalRules: ruleTexts.length,
    compiledRules: validRules.length,
    unrecognizedRules: unrecognized,
    violations,
    hasViolations: violations.length > 0,
  };
}
