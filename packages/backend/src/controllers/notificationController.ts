import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { getPagination, paginatedResponse } from '../utils/pagination';

export const getNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const pagination = getPagination(req);
    const where = { userId: req.user!.id, companyId: req.user!.companyId };
    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.user!.id, companyId: req.user!.companyId, isRead: false } }),
    ]);

    return res.json({ success: true, ...paginatedResponse(notifications, total, pagination), unreadCount });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const markAsRead = async (req: AuthRequest, res: Response) => {
  try {
    await prisma.notification.updateMany({
      where: { id: parseInt(req.params.id), userId: req.user!.id, companyId: req.user!.companyId },
      data: { isRead: true },
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const markAllAsRead = async (req: AuthRequest, res: Response) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, companyId: req.user!.companyId, isRead: false },
      data: { isRead: true },
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
