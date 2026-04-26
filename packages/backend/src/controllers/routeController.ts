import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { getPagination, paginatedResponse } from '../utils/pagination';

export const getRoutes = async (req: AuthRequest, res: Response) => {
  try {
    const where = { companyId: req.user!.companyId };
    const pagination = getPagination(req);
    const [routes, total] = await Promise.all([
      prisma.route.findMany({
        where,
        include: {
          buses: { where: { isActive: true } },
          routeAssignments: {
            where: { isActive: true },
            include: {
              driver: {
                select: { id: true, name: true, employeeId: true, driverType: true },
              },
            },
          },
        },
        orderBy: { routeNumber: 'asc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.route.count({ where }),
    ]);
    return res.json({ success: true, ...paginatedResponse(routes, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const getRouteById = async (req: AuthRequest, res: Response) => {
  try {
    const route = await prisma.route.findFirst({
      where: { id: parseInt(req.params.id), companyId: req.user!.companyId },
      include: {
        buses: true,
        routeAssignments: {
          where: { isActive: true },
          include: { driver: { select: { id: true, name: true, employeeId: true, driverType: true } } },
        },
      },
    });
    if (!route) return res.status(404).json({ success: false, message: '노선을 찾을 수 없습니다.' });
    return res.json({ success: true, data: route });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const createRoute = async (req: AuthRequest, res: Response) => {
  try {
    const { routeNumber, name, description, startPoint, endPoint } = req.body;

    const route = await prisma.route.create({
      data: { companyId: req.user!.companyId, routeNumber, name, description, startPoint, endPoint },
    });

    return res.status(201).json({ success: true, data: route });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const updateRoute = async (req: AuthRequest, res: Response) => {
  try {
    const { routeNumber, name, description, startPoint, endPoint, isActive } = req.body;
    const routeId = parseInt(req.params.id);

    const existing = await prisma.route.findFirst({ where: { id: routeId, companyId: req.user!.companyId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '노선을 찾을 수 없습니다.' });
    }

    const route = await prisma.route.update({
      where: { id: routeId },
      data: { routeNumber, name, description, startPoint, endPoint, isActive },
    });

    return res.json({ success: true, data: route });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const deleteRoute = async (req: AuthRequest, res: Response) => {
  try {
    const routeId = parseInt(req.params.id);
    const existing = await prisma.route.findFirst({ where: { id: routeId, companyId: req.user!.companyId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '노선을 찾을 수 없습니다.' });
    }

    await prisma.route.update({
      where: { id: routeId },
      data: { isActive: false },
    });
    return res.json({ success: true, message: '노선이 비활성화되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const assignDriverToRoute = async (req: AuthRequest, res: Response) => {
  try {
    const routeId = parseInt(req.params.id);
    const { driverId, startDate } = req.body;

    const existingRoute = await prisma.route.findFirst({ where: { id: routeId, companyId: req.user!.companyId } });
    if (!existingRoute) {
       return res.status(404).json({ success: false, message: '노선을 찾을 수 없습니다.' });
    }

    // Verify driver belongs to same company
    const driver = await prisma.user.findFirst({ where: { id: driverId, companyId: req.user!.companyId } });
    if (!driver) {
      return res.status(404).json({ success: false, message: '기사를 찾을 수 없습니다.' });
    }

    // Deactivate any existing assignment for this driver
    await prisma.routeAssignment.updateMany({
      where: { driverId, isActive: true },
      data: { isActive: false, endDate: new Date() },
    });

    const assignment = await prisma.routeAssignment.create({
      data: {
        driverId,
        routeId,
        startDate: new Date(startDate),
        isActive: true,
      },
      include: {
        driver: { select: { id: true, name: true } },
        route: true,
      },
    });

    return res.status(201).json({ success: true, data: assignment });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const updateRouteFatigue = async (req: AuthRequest, res: Response) => {
  try {
    const routeId = parseInt(req.params.id);
    const { fatigueScore, fatigueReason } = req.body;

    if (!fatigueScore || fatigueScore < 1 || fatigueScore > 5) {
      return res.status(400).json({ success: false, message: '피로도 점수는 1~5 사이여야 합니다.' });
    }

    const existing = await prisma.route.findFirst({ where: { id: routeId, companyId: req.user!.companyId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '노선을 찾을 수 없습니다.' });
    }

    const route = await prisma.route.update({
      where: { id: routeId },
      data: { fatigueScore, fatigueReason: fatigueReason || null },
    });

    return res.json({ success: true, data: route });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const removeDriverFromRoute = async (req: AuthRequest, res: Response) => {
  try {
    const routeId = parseInt(req.params.id);
    const driverId = parseInt(req.params.driverId);

    const existingRoute = await prisma.route.findFirst({ where: { id: routeId, companyId: req.user!.companyId } });
    if (!existingRoute) {
       return res.status(404).json({ success: false, message: '노선을 찾을 수 없습니다.' });
    }

    // Verify driver belongs to same company
    const driver = await prisma.user.findFirst({ where: { id: driverId, companyId: req.user!.companyId } });
    if (!driver) {
      return res.status(404).json({ success: false, message: '기사를 찾을 수 없습니다.' });
    }

    await prisma.routeAssignment.updateMany({
      where: { routeId, driverId, isActive: true },
      data: { isActive: false, endDate: new Date() },
    });

    return res.json({ success: true, message: '기사님이 노선에서 해제되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
