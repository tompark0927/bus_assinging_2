import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { AuthRequest } from '../middleware/auth';
import logger from './logger';

export async function createAuditLog(params: {
  req: AuthRequest;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entityType: string;
  entityId: number;
  changes?: Record<string, { old: unknown; new: unknown }>;
}) {
  const user = params.req.user;
  if (!user) return;

  try {
    await prisma.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        changes: (params.changes as Prisma.InputJsonValue) || undefined,
        ipAddress: params.req.ip || params.req.headers['x-forwarded-for']?.toString(),
        userAgent: params.req.headers['user-agent'],
      },
    });
  } catch (error) {
    // Audit logging should never break the main flow
    logger.error('[auditLog] Failed to create audit log', error);
  }
}
