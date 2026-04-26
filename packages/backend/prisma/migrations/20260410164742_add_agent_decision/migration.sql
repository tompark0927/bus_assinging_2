-- AI 에이전트 결정 추적 테이블 (Decision Provenance)
-- 모든 에이전트의 도구 호출·추론·최종 결정·인간 오버라이드를 영구 기록.
-- PHASE 4 자율 모드 진입 조건 검증과 인간 거부 패턴 학습에 사용.
CREATE TABLE "AgentDecision" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "agentName" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerRefId" INTEGER,
    "toolCalls" JSONB NOT NULL,
    "finalAction" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "errorMessage" TEXT,
    "humanOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overriddenById" INTEGER,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costKrw" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "isSimulation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentDecision_companyId_agentName_createdAt_idx" ON "AgentDecision"("companyId", "agentName", "createdAt");
CREATE INDEX "AgentDecision_sessionId_idx" ON "AgentDecision"("sessionId");
CREATE INDEX "AgentDecision_status_idx" ON "AgentDecision"("status");
CREATE INDEX "AgentDecision_isSimulation_idx" ON "AgentDecision"("isSimulation");

ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
