/**
 * Audit log retention service.
 *
 * 감사 로그(AuditLog)는 시간이 지날수록 무한히 적재되어 DB 성능 저하를 유발한다.
 * 운영 정책: 90 일 보존, 그 이상은 일괄 삭제.
 *
 * 호출 패턴:
 *   - 서버 시작 5 분 후 한 번 실행 (DB 안정화 대기)
 *   - 그 이후 24 시간마다 반복 실행
 *   - 한 번에 최대 BATCH_SIZE 행만 삭제 → 큰 lock 회피
 *
 * 환경변수:
 *   AUDIT_LOG_RETENTION_DAYS  보존 일수 (기본 90)
 *   AUDIT_LOG_RETENTION_DISABLED='true'  완전 비활성 (감사 요건상 보존 의무 있을 때)
 */

import { prisma } from '../utils/prisma';
import logger from './../utils/logger';

const DEFAULT_RETENTION_DAYS = 90;
const BATCH_SIZE = 5_000;
const MAX_BATCHES_PER_RUN = 20; // 한 번 실행 시 최대 100,000 행 삭제 (5,000 × 20)

function getRetentionDays(): number {
  const raw = process.env.AUDIT_LOG_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_RETENTION_DAYS;
  return n;
}

export function isAuditLogRetentionDisabled(): boolean {
  return process.env.AUDIT_LOG_RETENTION_DISABLED === 'true';
}

/**
 * 보존 기간 초과 감사 로그를 batch 로 삭제. 통계 객체 반환.
 */
export async function runAuditLogRetention(): Promise<{
  deleted: number;
  cutoff: Date;
  batches: number;
  durationMs: number;
}> {
  const start = Date.now();
  const days = getRetentionDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let totalDeleted = 0;
  let batches = 0;

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    // SQLite/MySQL/Postgres 모두에서 안전한 소량 batch delete:
    //   1. 오래된 ID 5K 개 select
    //   2. id IN (...) 로 delete
    const oldIds = await prisma.auditLog.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
    });
    if (oldIds.length === 0) break;

    const result = await prisma.auditLog.deleteMany({
      where: { id: { in: oldIds.map((r) => r.id) } },
    });
    totalDeleted += result.count;
    batches += 1;

    // 마지막 batch 가 BATCH_SIZE 미만이면 종료
    if (oldIds.length < BATCH_SIZE) break;
  }

  return {
    deleted: totalDeleted,
    cutoff,
    batches,
    durationMs: Date.now() - start,
  };
}

/**
 * 안전한 wrapper — 주기적 실행에서 호출. 예외가 메인 루프를 깨뜨리지 않도록 catch.
 */
export async function runAuditLogRetentionSafe(): Promise<void> {
  if (isAuditLogRetentionDisabled()) {
    logger.info('[auditLogRetention] AUDIT_LOG_RETENTION_DISABLED=true — skip');
    return;
  }
  try {
    const summary = await runAuditLogRetention();
    if (summary.deleted > 0) {
      logger.info(
        `[auditLogRetention] purged ${summary.deleted.toLocaleString()} rows ` +
          `(cutoff=${summary.cutoff.toISOString()}, batches=${summary.batches}, ` +
          `${summary.durationMs}ms)`,
      );
    }
  } catch (err) {
    logger.error('[auditLogRetention] failed', err);
  }
}
