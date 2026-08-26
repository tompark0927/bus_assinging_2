/**
 * 한국 법정 공휴일 계산기
 * 양력 고정 공휴일 + 음력 변동 공휴일(설날·추석·부처님오신날) + **대체공휴일**
 *
 * 음력 변환은 정확한 천문 계산이 필요하므로,
 * 2024~2030년까지의 음력 공휴일을 미리 매핑합니다.
 *
 * 왜 대체공휴일까지 계산하는가: 감차(그날 몇 대를 세울지)가 "빨간날이냐"로
 * 갈리는데, 대체공휴일이 빠져 있으면 그날을 평일로 보고 평일 대수를 내보낸다.
 * 2026년만 해도 삼일절·부처님오신날·광복절·개천절 네 번이 주말과 겹쳐
 * 대체공휴일이 생긴다 — 네 번 다 감차를 놓치게 된다.
 *
 * 다만 "이 날 우리 회사가 감차를 하느냐"는 회사가 정한다. 이 파일은 후보
 * 목록(카탈로그)만 만들고, 실제 적용 여부는 holidayPolicyService 가 회사별
 * 선택과 합쳐 결정한다.
 */

export type HolidayKind =
  /** 양력 고정 법정공휴일 */
  | 'FIXED'
  /** 음력 기반 법정공휴일 (설날·추석·부처님오신날) */
  | 'LUNAR'
  /** 대체공휴일 */
  | 'SUBSTITUTE'
  /** 법정공휴일은 아니지만 쉬는 곳이 있는 날 (근로자의 날) */
  | 'PAID_LEAVE';

export interface HolidayEntry {
  /** YYYY-MM-DD */
  date: string;
  /** 신정, 삼일절, 삼일절 대체공휴일 … */
  name: string;
  kind: HolidayKind;
  /** 화면에 그대로 보여줄 한 줄 설명 — "왜 이 날이 빨간날인가" */
  reason: string;
  /** 월·화·수·목·금·토·일 */
  weekday: string;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 양력 고정 공휴일 (월은 1-indexed)
const FIXED_HOLIDAYS: { month: number; day: number; name: string; kind: HolidayKind }[] = [
  { month: 1, day: 1, name: '신정', kind: 'FIXED' },
  { month: 3, day: 1, name: '삼일절', kind: 'FIXED' },
  { month: 5, day: 1, name: '근로자의 날', kind: 'PAID_LEAVE' },
  { month: 5, day: 5, name: '어린이날', kind: 'FIXED' },
  { month: 6, day: 6, name: '현충일', kind: 'FIXED' },
  { month: 8, day: 15, name: '광복절', kind: 'FIXED' },
  { month: 10, day: 3, name: '개천절', kind: 'FIXED' },
  { month: 10, day: 9, name: '한글날', kind: 'FIXED' },
  { month: 12, day: 25, name: '크리스마스', kind: 'FIXED' },
];

/**
 * 대체공휴일 규칙 (관공서의 공휴일에 관한 규정 제3조)
 *   'WEEKEND'      — 토·일과 겹치면 대체
 *   'SUNDAY_OR_HOL'— 일요일 또는 다른 공휴일과 겹치면 대체 (설·추석 연휴)
 *   'WEEKEND_OR_HOL' — 토·일 또는 다른 공휴일과 겹치면 대체 (어린이날)
 * 신정·현충일·근로자의 날은 대체 대상이 아니다.
 */
type SubstituteRule = 'WEEKEND' | 'SUNDAY_OR_HOL' | 'WEEKEND_OR_HOL';

/**
 * `since` 는 그 공휴일에 대체공휴일이 적용되기 시작한 해다. 제도가 한 번에
 * 생긴 게 아니라 세 번에 걸쳐 넓어졌기 때문에 연도를 같이 봐야 한다:
 *   2014~ 설·추석 연휴, 어린이날
 *   2021~ 삼일절·광복절·개천절·한글날
 *   2023~ 부처님오신날·기독탄신일(성탄절)
 * 이걸 무시하면 과거 달을 재현할 때(백테스트) 있지도 않았던 휴일이 생겨
 * 그날 감차가 실제와 어긋난다.
 */
const SUBSTITUTE_RULES: Record<string, { rule: SubstituteRule; since: number }> = {
  삼일절: { rule: 'WEEKEND', since: 2021 },
  광복절: { rule: 'WEEKEND', since: 2021 },
  개천절: { rule: 'WEEKEND', since: 2021 },
  한글날: { rule: 'WEEKEND', since: 2021 },
  부처님오신날: { rule: 'WEEKEND', since: 2023 },
  크리스마스: { rule: 'WEEKEND', since: 2023 },
  어린이날: { rule: 'WEEKEND_OR_HOL', since: 2014 },
  '설날 전날': { rule: 'SUNDAY_OR_HOL', since: 2014 },
  설날: { rule: 'SUNDAY_OR_HOL', since: 2014 },
  '설날 다음날': { rule: 'SUNDAY_OR_HOL', since: 2014 },
  '추석 전날': { rule: 'SUNDAY_OR_HOL', since: 2014 },
  추석: { rule: 'SUNDAY_OR_HOL', since: 2014 },
  '추석 다음날': { rule: 'SUNDAY_OR_HOL', since: 2014 },
};

// 음력 기반 공휴일 (양력 변환값, 2024~2030)
// 설날 전날 + 설날 + 설날 다음날 / 부처님오신날 / 추석 전날 + 추석 + 추석 다음날
const LUNAR_HOLIDAYS: Record<number, { date: string; name: string }[]> = {
  2024: [
    { date: '2024-02-09', name: '설날 전날' },
    { date: '2024-02-10', name: '설날' },
    { date: '2024-02-11', name: '설날 다음날' },
    { date: '2024-05-15', name: '부처님오신날' },
    { date: '2024-09-16', name: '추석 전날' },
    { date: '2024-09-17', name: '추석' },
    { date: '2024-09-18', name: '추석 다음날' },
  ],
  2025: [
    { date: '2025-01-28', name: '설날 전날' },
    { date: '2025-01-29', name: '설날' },
    { date: '2025-01-30', name: '설날 다음날' },
    { date: '2025-05-05', name: '부처님오신날' },
    { date: '2025-10-05', name: '추석 전날' },
    { date: '2025-10-06', name: '추석' },
    { date: '2025-10-07', name: '추석 다음날' },
  ],
  2026: [
    { date: '2026-02-16', name: '설날 전날' },
    { date: '2026-02-17', name: '설날' },
    { date: '2026-02-18', name: '설날 다음날' },
    { date: '2026-05-24', name: '부처님오신날' },
    { date: '2026-09-24', name: '추석 전날' },
    { date: '2026-09-25', name: '추석' },
    { date: '2026-09-26', name: '추석 다음날' },
  ],
  2027: [
    { date: '2027-02-05', name: '설날 전날' },
    { date: '2027-02-06', name: '설날' },
    { date: '2027-02-07', name: '설날 다음날' },
    { date: '2027-05-13', name: '부처님오신날' },
    { date: '2027-09-14', name: '추석 전날' },
    { date: '2027-09-15', name: '추석' },
    { date: '2027-09-16', name: '추석 다음날' },
  ],
  2028: [
    { date: '2028-01-25', name: '설날 전날' },
    { date: '2028-01-26', name: '설날' },
    { date: '2028-01-27', name: '설날 다음날' },
    { date: '2028-05-02', name: '부처님오신날' },
    { date: '2028-10-02', name: '추석 전날' },
    { date: '2028-10-03', name: '추석' },
    { date: '2028-10-04', name: '추석 다음날' },
  ],
  2029: [
    { date: '2029-02-12', name: '설날 전날' },
    { date: '2029-02-13', name: '설날' },
    { date: '2029-02-14', name: '설날 다음날' },
    { date: '2029-05-20', name: '부처님오신날' },
    { date: '2029-09-21', name: '추석 전날' },
    { date: '2029-09-22', name: '추석' },
    { date: '2029-09-23', name: '추석 다음날' },
  ],
  2030: [
    { date: '2030-02-02', name: '설날 전날' },
    { date: '2030-02-03', name: '설날' },
    { date: '2030-02-04', name: '설날 다음날' },
    { date: '2030-05-09', name: '부처님오신날' },
    { date: '2030-09-11', name: '추석 전날' },
    { date: '2030-09-12', name: '추석' },
    { date: '2030-09-13', name: '추석 다음날' },
  ],
};

/** 음력 공휴일 데이터가 들어 있는 연도 — 밖에서 "이 해는 확인이 필요하다"를 알리는 데 쓴다 */
export const LUNAR_DATA_YEARS = Object.keys(LUNAR_HOLIDAYS)
  .map(Number)
  .sort((a, b) => a - b);

/** 이 연도의 음력 공휴일 데이터를 갖고 있는가 */
export function hasLunarData(year: number): boolean {
  return Boolean(LUNAR_HOLIDAYS[year]);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parse(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function weekdayOf(dateStr: string): string {
  return WEEKDAYS[parse(dateStr).getUTCDay()];
}

function isWeekend(dateStr: string): boolean {
  const d = parse(dateStr).getUTCDay();
  return d === 0 || d === 6;
}

function isSunday(dateStr: string): boolean {
  return parse(dateStr).getUTCDay() === 0;
}

/**
 * 그 해의 공휴일 후보 전부 — 양력 + 음력 + 대체공휴일, 날짜순.
 *
 * 화면이 "왜 이 날이 빨간날인가"를 그대로 읽어 줄 수 있도록 각 항목에
 * `reason` 을 붙인다. 담당자가 근거를 보고 체크를 풀 수 있어야 하기 때문이다.
 */
export function getHolidayCatalog(year: number): HolidayEntry[] {
  const base: HolidayEntry[] = [];

  for (const h of FIXED_HOLIDAYS) {
    const date = `${year}-${String(h.month).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
    base.push({
      date,
      name: h.name,
      kind: h.kind,
      weekday: weekdayOf(date),
      // 설명은 카드 한 줄에 들어가야 한다 — 길면 줄바꿈이 나서 목록이 세로로 늘어난다.
      reason:
        h.kind === 'PAID_LEAVE'
          ? '법정공휴일은 아님 — 회사마다 다릅니다'
          : `매년 ${h.month}월 ${h.day}일`,
    });
  }

  for (const h of LUNAR_HOLIDAYS[year] ?? []) {
    base.push({
      date: h.date,
      name: h.name,
      kind: 'LUNAR',
      weekday: weekdayOf(h.date),
      reason: '음력이라 해마다 날짜가 바뀝니다',
    });
  }

  base.sort((a, b) => a.date.localeCompare(b.date));

  // ── 대체공휴일 ───────────────────────────────────────────
  // "겹쳤는가" 판정은 원래 공휴일들만 보고 한다(대체공휴일끼리는 겹치지 않게
  // 이미 빈 날로 밀어 두므로). 밀어낼 자리는 주말도 공휴일도 아닌 첫날이고,
  // 앞서 만든 대체공휴일이 차지한 날도 피한다 — 연휴가 통째로 주말에 걸리면
  // 대체공휴일이 여러 개 생기기 때문이다.
  const statutory = new Set(base.filter((h) => h.kind !== 'PAID_LEAVE').map((h) => h.date));
  const taken = new Set(statutory);
  const substitutes: HolidayEntry[] = [];

  for (const h of base) {
    const spec = SUBSTITUTE_RULES[h.name];
    if (!spec || year < spec.since) continue;
    const rule = spec.rule;

    let triggered = false;
    let why = '';
    if (rule === 'WEEKEND' && isWeekend(h.date)) {
      triggered = true;
      why = `${h.name}(${h.date.slice(5).replace('-', '/')}) ${weekdayOf(h.date)}요일`;
    } else if (rule === 'WEEKEND_OR_HOL') {
      if (isWeekend(h.date)) {
        triggered = true;
        why = `${h.name} ${weekdayOf(h.date)}요일`;
      }
    } else if (rule === 'SUNDAY_OR_HOL') {
      if (isSunday(h.date)) {
        triggered = true;
        why = `${h.name} 일요일`;
      }
    }
    if (!triggered) continue;

    // 다음 첫 "주말도 공휴일도 아닌" 날
    const cursor = parse(h.date);
    for (let i = 0; i < 10; i++) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const next = iso(cursor);
      if (isWeekend(next) || taken.has(next)) continue;
      taken.add(next);
      substitutes.push({
        date: next,
        name: `${h.name} 대체공휴일`,
        kind: 'SUBSTITUTE',
        weekday: weekdayOf(next),
        reason: `${why} → 이날로 대체`,
      });
      break;
    }
  }

  return [...base, ...substitutes].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 특정 연도/월의 공휴일 맵 — **회사 선택이 반영되지 않은 기본값**.
 *
 * 회사가 고른 목록을 쓰려면 holidayPolicyService.getAppliedHolidaysForMonth 를
 * 쓸 것. 이 함수는 회사 설정이 없을 때의 기본값이자 하위호환 경로다.
 *
 * @returns Map<dateStr(YYYY-MM-DD), holidayName>
 */
export function getHolidaysForMonth(year: number, month: number): Map<string, string> {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const map = new Map<string, string>();
  for (const h of getHolidayCatalog(year)) {
    if (h.date.startsWith(prefix)) map.set(h.date, h.name);
  }
  return map;
}
