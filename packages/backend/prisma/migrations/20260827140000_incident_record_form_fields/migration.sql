-- 노무 관리 — 사고·지적사항 이력을 현장 양식 그대로 담는다
--
-- 회사가 실제로 쓰던 장부:
--   · 가해/피해현황(월별 시트) — 사건번호·장소·대물/대인 건수·보험·징계·보상금액
--   · 승무원 근태현황(기사별)  — 좌측 '사고내용' + 우측 '지적사항'
-- 전부 nullable — 담당자가 아는 칸만 채우고 나머지는 비워 둔다(기존 행도 그대로 유효).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FaultType') THEN
    CREATE TYPE "FaultType" AS ENUM ('AT_FAULT', 'VICTIM');
  END IF;
END $$;

ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "faultType" "FaultType";
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "caseNumber" TEXT;
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "vehicleNumber" TEXT;
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "propertySelf" INTEGER;
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "propertyOther" INTEGER;
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "injurySelf" INTEGER;
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "injuryOther" INTEGER;
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "insurer" TEXT;
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "insuranceNote" TEXT;
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "discipline" TEXT;
ALTER TABLE "IncidentRecord" ADD COLUMN IF NOT EXISTS "compensation" INTEGER;

CREATE INDEX IF NOT EXISTS "IncidentRecord_companyId_date_idx" ON "IncidentRecord"("companyId", "date");
CREATE INDEX IF NOT EXISTS "IncidentRecord_companyId_faultType_idx" ON "IncidentRecord"("companyId", "faultType");
