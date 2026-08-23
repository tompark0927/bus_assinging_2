-- 한 배차표에서 (날짜×차량×시프트) 칸은 한 행뿐.
-- 같은 칸에 배정이 두 번 쌓이는 구조적 오류를 DB 레벨에서 차단한다.
-- (2026-08-12 프로덕션 검사: 기존 중복 0건 / 총 16,568 슬롯 — 안전하게 적용 가능)
-- busId 가 NULL 인 휴무 슬롯은 Postgres NULL 비교 규칙상 제약에서 제외된다.
CREATE UNIQUE INDEX "ScheduleSlot_scheduleId_date_busId_shift_key"
  ON "ScheduleSlot"("scheduleId", "date", "busId", "shift");
