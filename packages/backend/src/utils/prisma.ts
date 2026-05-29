import { PrismaClient } from '@prisma/client';
import logger from './logger';
import { getCurrentCompanyId, getCurrentUserId, TENANT_MODELS } from './tenantContext';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// findUnique는 고유 키(id)로 조회하므로 cross-tenant 위험 없음 → 검증 제외
const READ_OPS = new Set(['findMany', 'findFirst', 'count', 'aggregate', 'groupBy']);

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  /**
   * 멀티테넌시 격리 미들웨어:
   * 인증된 요청 컨텍스트에서 테넌트 모델을 companyId 없이 읽으면 경고/에러.
   * - dev: throw (조기 발견)
   * - prod: warn (서비스 중단 방지)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$use(async (params: any, next: any) => {
    const currentCompanyId = getCurrentCompanyId();

    if (
      currentCompanyId !== undefined &&
      params.model &&
      TENANT_MODELS.has(params.model) &&
      READ_OPS.has(params.action)
    ) {
      const whereStr = JSON.stringify(params.args?.where ?? {});
      if (!whereStr.includes('"companyId"')) {
        const msg = `[멀티테넌시 경고] ${params.model}.${params.action} — companyId 필터 누락 (requestCompanyId=${currentCompanyId})`;
        if (process.env.NODE_ENV === 'production') {
          logger.warn(msg);
        } else {
          logger.error(msg);
          throw new Error(msg);
        }
      }
    }

    return next(params);
  });

  /**
   * 자동 감사 로깅 미들웨어:
   * 민감 모델의 create/update/delete 시 자동으로 AuditLog 생성.
   * 이미 수동으로 auditLog 호출하는 컨트롤러와 중복 방지를 위해
   * AuditLog 자체에 대한 작업은 제외.
   */
  const AUDIT_MODELS = new Set([
    'User', 'Schedule', 'ScheduleSlot', 'DayOffRequest', 'EmergencyDrop',
    'PayrollRecord', 'Approval', 'ApprovalStep', 'CompanyRule', 'GoldenTicket',
  ]);
  const WRITE_OPS = new Set(['create', 'update', 'delete', 'updateMany', 'deleteMany']);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).$use(async (params: any, next: any) => {
    const result = await next(params);

    const currentCompanyId = getCurrentCompanyId();
    const currentUserId = getCurrentUserId();
    // userId가 컨텍스트에 없으면 (인증 전 요청·시스템 잡·시드 등) FK 제약을 피하려 자동 감사 로깅을 생략한다.
    // 컨트롤러에서 명시적으로 auditLog.create()를 호출하는 케이스는 영향 없음.
    if (
      currentCompanyId !== undefined &&
      currentUserId !== undefined &&
      params.model &&
      AUDIT_MODELS.has(params.model) &&
      WRITE_OPS.has(params.action)
    ) {
      try {
        const action = params.action.startsWith('delete') ? 'DELETE'
          : params.action === 'create' ? 'CREATE' : 'UPDATE';
        const entityId = result?.id || params.args?.where?.id || 0;

        // Fire-and-forget: 감사 로그 실패가 메인 플로우를 막지 않음
        client.auditLog.create({
          data: {
            companyId: currentCompanyId,
            userId: currentUserId,
            action,
            entityType: params.model,
            entityId: typeof entityId === 'number' ? entityId : 0,
          },
        }).catch((err: unknown) => {
          logger.error('[AutoAudit] Failed:', err);
        });
      } catch {
        // Never break main flow
      }
    }

    return result;
  });

  return client;
}

export const prisma = global.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
