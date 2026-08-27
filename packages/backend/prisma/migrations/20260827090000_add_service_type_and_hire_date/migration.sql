-- 노선 종류(간선/지선/광역) + 기사 입사일
--
-- 한 회사가 간선·지선·광역을 동시에 운영하는 경우가 있다. 노선·기사에 종류를
-- 붙이고, 배차표도 종류별로 따로 짜고 따로 발행한다.
--   · Schedule.serviceType = NULL  → 구분 없음(전체). 기존 배차표는 전부 여기에 남는다.
--   · 발행본 단일성은 (회사, 연, 월, 종류) 단위로 바뀐다.

-- 멱등: 이미 적용된 환경에서도 안전하게 재실행되도록 IF NOT EXISTS 를 쓴다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ServiceType') THEN
    CREATE TYPE "ServiceType" AS ENUM ('TRUNK', 'BRANCH', 'WIDE_AREA');
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "serviceType" "ServiceType";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hireDate" TIMESTAMP(3);
ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS "serviceType" "ServiceType";
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "serviceType" "ServiceType";

CREATE INDEX IF NOT EXISTS "User_companyId_serviceType_idx" ON "User"("companyId", "serviceType");
CREATE INDEX IF NOT EXISTS "Schedule_companyId_year_month_serviceType_idx"
  ON "Schedule"("companyId", "year", "month", "serviceType");

-- 발행본 단일성을 노선 종류별로 재정의.
-- enum→text 캐스트는 IMMUTABLE 이 아니라 식 인덱스에 못 쓴다. 대신 부분 인덱스를
-- 둘로 나눈다: 종류가 있는 배차표는 (회사,연,월,종류) 단위, 구분 없는(NULL) 배차표는
-- (회사,연,월) 단위 — NULL 은 UNIQUE 에서 서로 달라 취급되므로 별도 인덱스가 필요하다.
DROP INDEX IF EXISTS "Schedule_one_published_per_month";

CREATE UNIQUE INDEX IF NOT EXISTS "Schedule_one_published_per_month"
  ON "Schedule"("companyId", "year", "month", "serviceType")
  WHERE "status" = 'PUBLISHED' AND "serviceType" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Schedule_one_published_per_month_untyped"
  ON "Schedule"("companyId", "year", "month")
  WHERE "status" = 'PUBLISHED' AND "serviceType" IS NULL;
