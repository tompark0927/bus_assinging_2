/**
 * 백엔드의 `@db.Date` 컬럼(ScheduleSlot.date, DayOffRequest.date 등)은
 * UTC 자정 ISO 문자열로 직렬화된다. 예) "2026-05-23T00:00:00.000Z"
 *
 * 이를 `new Date(value)` 로 그대로 파싱하면 UTC 로 해석된 뒤 로컬 타임존
 * 오프셋이 적용되어, UTC 보다 뒤(서버/브라우저가 미국 등)인 환경에서는
 * 표시 날짜가 하루 밀린다. (5/23 → 5/22)
 *
 * 날짜 전용 값은 시간대 변환 없이 "그 날짜 그대로" 로컬 Date 로 만들어야 한다.
 */

/** "2026-05-23T00:00:00.000Z" | "2026-05-23" → 로컬 타임존 기준 그 날짜의 Date */
export function parseSlotDate(value: string | Date): Date {
  if (value instanceof Date) {
    // 이미 Date 인 경우에도 UTC 자정 기준 캘린더 일자를 로컬로 복원
    const iso = value.toISOString().split('T')[0];
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  const datePart = String(value).split('T')[0];
  const [y, m, d] = datePart.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
