import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { getPagination, paginatedResponse } from '../utils/pagination';

export const getAuditLogs = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const { entityType, userId, startDate, endDate, action, entityId } = req.query;

    const where: Record<string, unknown> = { companyId };

    if (entityType) where.entityType = entityType as string;
    if (userId) where.userId = Number(userId);
    if (action) where.action = action as string;
    if (entityId) where.entityId = Number(entityId);

    if (startDate || endDate) {
      const createdAt: Record<string, Date> = {};
      if (startDate) createdAt.gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      where.createdAt = createdAt;
    }

    const pagination = getPagination(req);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, employeeId: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(logs, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
