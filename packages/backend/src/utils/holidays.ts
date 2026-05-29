/**
 * 한국 법정 공휴일 계산기
 * 양력 고정 공휴일 + 음력 변동 공휴일 (설날, 추석, 부처님오신날)
 *
 * 음력 변환은 정확한 천문 계산이 필요하므로,
 * 2024~2030년까지의 음력 공휴일을 미리 매핑합니다.
 */

// 양력 고정 공휴일 (월은 0-indexed)
const FIXED_HOLIDAYS: { month: number; day: number; name: string }[] = [
  { month: 0, day: 1, name: '신정' },
  { month: 2, day: 1, name: '삼일절' },
  { month: 4, day: 1, name: '근로자의 날' },
  { month: 4, day: 5, name: '어린이날' },
  { month: 5, day: 6, name: '현충일' },
  { month: 7, day: 15, name: '광복절' },
  { month: 9, day: 3, name: '개천절' },
  { month: 9, day: 9, name: '한글날' },
  { month: 11, day: 25, name: '크리스마스' },
];

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

/**
 * 특정 연도/월의 공휴일 맵 반환
 * @returns Map<dateStr(YYYY-MM-DD), holidayName>
 */
export function getHolidaysForMonth(year: number, month: number): Map<string, string> {
  const holidays = new Map<string, string>();

  // 양력 고정 공휴일
  for (const h of FIXED_HOLIDAYS) {
    if (h.month === month - 1) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
      holidays.set(dateStr, h.name);
    }
  }

  // 음력 변동 공휴일
  const lunarList = LUNAR_HOLIDAYS[year];
  if (lunarList) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    for (const h of lunarList) {
      if (h.date.startsWith(prefix)) {
        holidays.set(h.date, h.name);
      }
    }
  }

  return holidays;
}
