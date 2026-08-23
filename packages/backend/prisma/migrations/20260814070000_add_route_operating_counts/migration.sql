-- 노선별 요일 운행 대수 — 등록 대수 전부가 매일 나가지는 않는다.
-- (성민버스 실제: 노선당 등록 14대 중 평일 12 / 토 11 / 일·공휴일 10)
-- 전부 nullable — 값이 없으면 기존 동작(활성 차량 전부 운행)을 유지한다.
ALTER TABLE "Route" ADD COLUMN "weekdayBuses" INTEGER;
ALTER TABLE "Route" ADD COLUMN "saturdayBuses" INTEGER;
ALTER TABLE "Route" ADD COLUMN "holidayBuses" INTEGER;
