-- 배차표 멀티 초안(프로필) 지원
--  - 같은 달에 여러 DRAFT 배차표를 만들어 비교·수정 후 하나를 골라 발행
--  - PUBLISHED 는 월당 1개만 허용 (부분 unique 인덱스)

ALTER TABLE "Schedule" ADD COLUMN "name" TEXT NOT NULL DEFAULT '기본 초안';

DROP INDEX "Schedule_companyId_year_month_key";

CREATE INDEX "Schedule_companyId_year_month_idx" ON "Schedule"("companyId", "year", "month");

-- 발행본 단일성: Prisma 스키마로 표현 불가한 부분 unique 인덱스
CREATE UNIQUE INDEX "Schedule_one_published_per_month"
  ON "Schedule"("companyId", "year", "month")
  WHERE "status" = 'PUBLISHED';
