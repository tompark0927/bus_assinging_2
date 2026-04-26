import dotenv from 'dotenv';
import path from 'path';
// Load from monorepo root .env (../../.env relative to packages/backend/src)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { validateEnv } from './utils/validateEnv';
validateEnv();

import http from 'http';
import app from './app';
import logger from './utils/logger';
import { runEscalationCheck } from './services/escalationService';
import {
  runEmergencyAgentBatch,
  isEmergencyAgentEnabled,
} from './services/emergencyAgentRunner';
import {
  runDailyReportsForAllCompanies,
  isDailyReportAgentEnabled,
} from './services/dailyReportRunner';
import { initSocket } from './services/socketService';

const PORT = process.env.PORT || 4000;

const server = http.createServer(app);

// Socket.IO 초기화
initSocket(server);

server.listen(PORT, () => {
  logger.info(`Busync 배차 관리 시스템 서버 실행 중: http://localhost:${PORT}`);
  logger.info(`환경: ${process.env.NODE_ENV}`);

  // 결원 처리 엔진:
  //   - EMERGENCY_AGENT_ENABLED='true' → AI 에이전트가 모든 드랍을 자율 처리 (긴급도 인식)
  //   - off → 기존 결정론적 escalationService 가 처리 (안전한 폴백)
  // 두 경로 모두 동일 cron 주기로 호출. 에이전트가 활성이면 우선 실행되고, 처리 못한 드랍만
  // (skipped/failed) 폴백 escalation 이 시도하도록 하면 다중 책임 충돌이 나므로 — 둘 중 하나만 실행.
  const tickEmergencyEngine = async (): Promise<void> => {
    if (isEmergencyAgentEnabled()) {
      try {
        const summary = await runEmergencyAgentBatch();
        if (summary.processed > 0) {
          logger.info(
            `[EmergencyAgent] tick processed=${summary.processed} ok=${summary.succeeded} ` +
              `fail=${summary.failed} skipped=${summary.skipped}`
          );
        }
      } catch (err) {
        logger.error('[EmergencyAgent] batch failed:', err);
      }
    } else {
      try {
        await runEscalationCheck();
      } catch (err) {
        logger.error('Escalation loop error:', err);
      }
    }
  };

  setInterval(tickEmergencyEngine, 10 * 60 * 1000);
  setTimeout(tickEmergencyEngine, 60 * 1000); // DB 안정화 대기 후 첫 실행

  if (isEmergencyAgentEnabled()) {
    logger.info('🤖 EmergencyAgent 활성 (10분 주기, 긴급도 인식 자율 모드)');
  } else {
    logger.info('AI 에스컬레이션 엔진 시작 (10분 주기, 결정론적 폴백 모드)');
  }

  // 일일 보고서 엔진:
  //   - DAILY_REPORT_AGENT_ENABLED='true' 일 때만 활성
  //   - 매 시간 정각 ± 1분 주기로 체크
  //   - 09:00 KST 가 지났고 오늘 보고서 미발행 회사만 처리 (idempotent)
  //   - 회사 1개당 ~₩50-100, 100개 회사 = ~₩10K/일 = ~₩300K/월
  const tickDailyReportEngine = async (): Promise<void> => {
    try {
      const summary = await runDailyReportsForAllCompanies();
      if (summary.enabled && summary.reportTimeReached && summary.processed > 0) {
        logger.info(
          `[DailyReportAgent] tick processed=${summary.processed} ` +
            `generated=${summary.generated} skipped=${summary.skipped} failed=${summary.failed}`
        );
      }
    } catch (err) {
      logger.error('[DailyReportAgent] tick failed:', err);
    }
  };

  // 매시간 정각에 체크 (09:00 KST 직후 첫 호출 보장)
  setInterval(tickDailyReportEngine, 60 * 60 * 1000);
  setTimeout(tickDailyReportEngine, 90 * 1000); // 서버 시작 90초 후 첫 호출

  if (isDailyReportAgentEnabled()) {
    logger.info('📰 DailyReportAgent 활성 (매시간 체크, 09:00 KST 이후 미발행 회사 처리)');
  }

  logger.info('Socket.IO 실시간 통신 활성화');
});
