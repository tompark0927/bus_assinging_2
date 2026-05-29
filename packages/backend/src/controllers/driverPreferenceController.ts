import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

export const getMyPreferences = async (req: AuthRequest, res: Response) => {
  try {
    const preferences = await prisma.driverPreference.findMany({
      where: { driverId: req.user!.id },
      include: {
        route: { select: { id: true, routeNumber: true, name: true, fatigueScore: true } },
      },
      orderBy: { priority: 'asc' },
    });

    return res.json({ success: true, data: preferences });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const getAllPreferences = async (req: AuthRequest, res: Response) => {
  try {
    const preferences = await prisma.driverPreference.findMany({
      where: {
        driver: { companyId: req.user!.companyId },
      },
      include: {
        driver: { select: { id: true, name: true, employeeId: true } },
        route: { select: { id: true, routeNumber: true, name: true, fatigueScore: true } },
      },
      orderBy: [{ driverId: 'asc' }, { priority: 'asc' }],
    });

    return res.json({ success: true, data: preferences });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const setPreferences = async (req: AuthRequest, res: Response) => {
  try {
    const { routes } = req.body as { routes: { routeId: number; priority: number }[] };

    if (!routes || !Array.isArray(routes)) {
      return res.status(400).json({ success: false, message: '노선 선호 목록을 입력해주세요.' });
    }

    if (routes.length > 3) {
      return res.status(400).json({ success: false, message: '선호 노선은 최대 3개까지 설정할 수 있습니다.' });
    }

    // Validate priorities are 1-3 and unique
    const priorities = routes.map((r) => r.priority);
    const uniquePriorities = new Set(priorities);
    if (priorities.some((p) => p < 1 || p > 3) || uniquePriorities.size !== priorities.length) {
      return res.status(400).json({ success: false, message: '우선순위는 1~3 사이의 중복 없는 값이어야 합니다.' });
    }

    // Verify all routes belong to same company
    const routeIds = routes.map((r) => r.routeId);
    const validRoutes = await prisma.route.findMany({
      where: { id: { in: routeIds }, companyId: req.user!.companyId, isActive: true },
    });
    if (validRoutes.length !== routeIds.length) {
      return res.status(400).json({ success: false, message: '유효하지 않은 노선이 포함되어 있습니다.' });
    }

    // Delete existing preferences and create new ones in a transaction
    const preferences = await prisma.$transaction(async (tx) => {
      await tx.driverPreference.deleteMany({ where: { driverId: req.user!.id } });

      return Promise.all(
        routes.map((r) =>
          tx.driverPreference.create({
            data: {
              driverId: req.user!.id,
              routeId: r.routeId,
              priority: r.priority,
            },
            include: {
              route: { select: { id: true, routeNumber: true, name: true, fatigueScore: true } },
            },
          })
        )
      );
    });

    return res.json({ success: true, data: preferences });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
