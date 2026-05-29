/**
 * 백엔드의 `@db.Date` 컬럼은 UTC 자정 ISO 문자열로 직렬화됩니다.
 * 예) "2026-05-01T00:00:00.000Z"
 *
 * 이를 `new Date(...)` 로 그대로 파싱하면 기기 시간대가 UTC 보다 뒤일 때
 * (예: 시뮬레이터가 미국 태평양 시간) 하루 전 날짜로 표시됩니다.
 * (그래서 5/1 → 4/30, 5/17 → 5/16 처럼 보이는 버그)
 *
 * 날짜 전용 값은 시간대 변환 없이 "그 날짜 그대로" 로컬 Date 로 만들어야 합니다.
 */

/** "2026-05-01T00:00:00.000Z" | "2026-05-01" → 로컬 타임존 기준 그 날짜의 Date */
export function parseSlotDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const datePart = String(value).split('T')[0]; // "2026-05-01"
  const [y, m, d] = datePart.split('-').map(Number);
  // 월은 0-base. 로컬 자정으로 생성 → 시간대 변환으로 인한 하루 밀림 방지
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 날짜 전용 비교를 위한 "yyyy-MM-dd" 문자열 */
export function slotDateKey(value: string | Date): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).split('T')[0];
}
