/**
 * DailyReportAgent 실행 어댑터.
 *
 * 책임:
 *   - 모든 활성 회사에 대해 어제 날짜 보고서가 없으면 생성
 *   - 멀티 인스턴스 환경에서도 안전 (DB unique 제약 + try/catch)
 *   - 환경 변수 DAILY_REPORT_AGENT_ENABLED='true' 일 때만 활성
 *   - 09:00 KST 가 지났는지 확인 후 실행 (인덱스 페이지에서 한 시간마다 호출)
 *
 * 호출 패턴:
 *   - cron: 매시간 정각, runDailyReportsForAllCompanies()
 *   - 특정 시각 (09:00 KST) 이후이고 오늘 보고서가 없는 회사만 처리
 *   - 한 회사 실패가 다른 회사를 막지 않음
 */

import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import { DailyReportAgent } from '../agents/daily-report.agent';
import type { AgentRunResult } from '../agents/_core/types';

let cachedAgent: DailyReportAgent | null = null;

function getAgent(): DailyReportAgent {
  if (!cachedAgent) cachedAgent = new DailyReportAgent();
  return cachedAgent;
}

export function isDailyReportAgentEnabled(): boolean {
  return process.env.DAILY_REPORT_AGENT_ENABLED === 'true';
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** KST 기준 보고서 발행 시각 (09시) */
const REPORT_HOUR_KST = 9;

/**
 * 주어진 시각이 KST 기준 09:00 이후인지 (오늘 보고서 발행 시각이 도래했는지).
 */
export function isReportTimeReached(now: Date): boolean {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  return kstNow.getUTCHours() >= REPORT_HOUR_KST;
}

/** 오늘의 KST 자정 (UTC Date) */
export function todayKstStart(now: Date): Date {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const dateStr = kstNow.toISOString().slice(0, 10);
  return new Date(`${dateStr}T00:00:00Z`);
}

/** 어제의 KST 자정 (UTC Date) */
export function yesterdayKstStart(now: Date): Date {
  const today = todayKstStart(now);
  return new Date(today.getTime() - 24 * 3600 * 1000);
}

export interface RunOptions {
  /** 시뮬레이션 모드 */
  isSimulation?: boolean;
  /** 가상 현재 시각 (테스트·시뮬용) */
  virtualNow?: Date;
  /**
   * 보고서가 이미 있어도 강제로 다시 생성 (덮어쓰기).
   * 운영에서는 사용 금지 — 디버깅·재실행용.
   */
  force?: boolean;
}

/**
 * 단일 회사에 대해 어제 날짜 보고서를 생성.
 *
 * - 이미 어제 보고서가 있으면 noop (force=false 일 때)
 * - 회사 코드 BT prefix (백테스트 회사) 는 자동 제외 — 운영 cron 에서 백테스트 회사 보고서 안 만듦
 */
export async function runDailyReportForCompany(
  companyId: number,
  options: RunOptions = {}
): Promise<AgentRunResult | { skipped: true; reason: string }> {
  const now = options.virtualNow ?? new Date();
  const reportDate = yesterdayKstStart(now);

  // 회사 검증 + 백테스트 회사 제외
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, code: true, isActive: true },
  });
  if (!company || !company.isActive) {
    return { skipped: true, reason: '회사 없음 또는 비활성' };
  }
  if (company.code.startsWith('BT')) {
    return { skipped: true, reason: '백테스트 회사 (BT prefix)' };
  }

  // 이미 보고서 존재?
  if (!options.force) {
    const existing = await prisma.dailyReport.findUnique({
      where: {
        companyId_reportDate: {
          companyId,
          reportDate,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return { skipped: true, reason: `오늘 보고서 이미 존재 (id=${existing.id})` };
    }
  }

  // 에이전트 실행
  try {
    const result = await getAgent().run({
      companyId,
      triggerType: 'cron',
      task: [
        `[일일 보고서 작성 — ${reportDate.toISOString().slice(0, 10)}]`,
        '',
        '시스템 프롬프트의 작업 흐름을 따라:',
        '1. 5개 조회 도구로 데이터 수집',
        '2. 우선순위 결정 (URGENT/ATTENTION/INFO)',
        '3. 600~1200자 한국어 마크다운 본문 작성',
        `4. save_daily_report 로 reportDate=${reportDate.toISOString().slice(0, 10)} 으로 저장`,
      ].join('\n'),
      isSimulation: options.isSimulation ?? false,
      virtualNow: now,
      sessionId: `daily-report-${companyId}-${reportDate.toISOString().slice(0, 10)}`,
    });

    logger.info(
      `[DailyReportAgent] company=${companyId} (${company.code}) reportDate=${reportDate.toISOString().slice(0, 10)} ` +
        `status=${result.status} tools=${result.toolCalls.length} cost=₩${result.costKrw.toFixed(2)}`
    );
    return result;
  } catch (err) {
    logger.error(`[DailyReportAgent] company=${companyId} 실행 실패`, err);
    throw err;
  }
}

/**
 * 모든 활성 회사에 대해 어제 보고서 생성.
 * cron 진입점.
 */
export async function runDailyReportsForAllCompanies(): Promise<{
  enabled: boolean;
  reportTimeReached: boolean;
  processed: number;
  generated: number;
  skipped: number;
  failed: number;
}> {
  if (!isDailyReportAgentEnabled()) {
    return {
      enabled: false,
      reportTimeReached: false,
      processed: 0,
      generated: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const now = new Date();
  if (!isReportTimeReached(now)) {
    return {
      enabled: true,
      reportTimeReached: false,
      processed: 0,
      generated: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const companies = await prisma.company.findMany({
    where: {
      isActive: true,
      // BT prefix 백테스트 회사 제외
      NOT: { code: { startsWith: 'BT' } },
    },
    select: { id: true },
  });

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of companies) {
    try {
      const result = await runDailyReportForCompany(c.id);
      if ('skipped' in result) skipped++;
      else if (result.status === 'COMPLETED') generated++;
      else failed++;
    } catch {
      failed++;
    }
  }

  if (generated > 0 || failed > 0) {
    logger.info(
      `[DailyReportAgent] tick processed=${companies.length} generated=${generated} skipped=${skipped} failed=${failed}`
    );
  }

  return {
    enabled: true,
    reportTimeReached: true,
    processed: companies.length,
    generated,
    skipped,
    failed,
  };
}
