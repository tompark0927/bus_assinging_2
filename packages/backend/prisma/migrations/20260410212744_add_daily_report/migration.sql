-- DailyReport: DailyReportAgent 가 매일 09:00 KST 생성하는 회사별 운영 보고서.
-- 어제 활동 + 오늘 우선순위 + 공정성 추이 + 예정 알림 + 에이전트 건강 지표 요약.
CREATE TABLE "DailyReport" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "reportDate" DATE NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readById" INTEGER,
    "readAt" TIMESTAMP(3),
    "agentDecisionId" INTEGER,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- 같은 회사·같은 날짜 보고서 1개만 (재실행 방지)
CREATE UNIQUE INDEX "DailyReport_companyId_reportDate_key" ON "DailyReport"("companyId", "reportDate");
CREATE INDEX "DailyReport_companyId_generatedAt_idx" ON "DailyReport"("companyId", "generatedAt");
CREATE INDEX "DailyReport_severity_idx" ON "DailyReport"("severity");
CREATE INDEX "DailyReport_isRead_idx" ON "DailyReport"("isRead");

ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_readById_fkey" FOREIGN KEY ("readById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
