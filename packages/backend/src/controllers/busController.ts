import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { getPagination, paginatedResponse } from '../utils/pagination';

export const getBuses = async (req: AuthRequest, res: Response) => {
  try {
    const where = { companyId: req.user!.companyId };
    const pagination = getPagination(req);
    const [buses, total] = await Promise.all([
      prisma.bus.findMany({
        where,
        include: { route: true },
        orderBy: { busNumber: 'asc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.bus.count({ where }),
    ]);
    return res.json({ success: true, ...paginatedResponse(buses, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const getBusById = async (req: AuthRequest, res: Response) => {
  try {
    const bus = await prisma.bus.findFirst({
      where: { id: parseInt(req.params.id), companyId: req.user!.companyId },
      include: { route: true },
    });
    if (!bus) {
      return res.status(404).json({ success: false, message: '버스를 찾을 수 없습니다.' });
    }
    return res.json({ success: true, data: bus });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const createBus = async (req: AuthRequest, res: Response) => {
  try {
    const { busNumber, plateNumber, model, year, capacity, routeId } = req.body;

    const bus = await prisma.bus.create({
      data: { 
        companyId: req.user!.companyId,
        busNumber, plateNumber, model, year, capacity, routeId 
      },
      include: { route: true },
    });

    return res.status(201).json({ success: true, data: bus });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const updateBus = async (req: AuthRequest, res: Response) => {
  try {
    const { busNumber, plateNumber, model, year, capacity, routeId, isActive } = req.body;
    const busId = parseInt(req.params.id);

    const existingBus = await prisma.bus.findFirst({ where: { id: busId, companyId: req.user!.companyId } });
    if (!existingBus) {
      return res.status(404).json({ success: false, message: '권한이 없거나 버스를 찾을 수 없습니다.' });
    }

    const bus = await prisma.bus.update({
      where: { id: busId },
      data: { busNumber, plateNumber, model, year, capacity, routeId, isActive },
      include: { route: true },
    });

    return res.json({ success: true, data: bus });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const deleteBus = async (req: AuthRequest, res: Response) => {
  try {
    const busId = parseInt(req.params.id);
    const existingBus = await prisma.bus.findFirst({ where: { id: busId, companyId: req.user!.companyId } });
    if (!existingBus) {
      return res.status(404).json({ success: false, message: '권한이 없거나 버스를 찾을 수 없습니다.' });
    }

    await prisma.bus.update({
      where: { id: busId },
      data: { isActive: false },
    });
    return res.json({ success: true, message: '버스가 비활성화되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// POST /api/buses/:id/location — GPS ping from driver app
export const updateLocation = async (req: AuthRequest, res: Response) => {
  try {
    const busId = parseInt(req.params.id);
    const { latitude, longitude, mileageDelta } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'latitude와 longitude가 필요합니다.' });
    }

    const bus = await prisma.bus.findFirst({ where: { id: busId, companyId: req.user!.companyId } });
    if (!bus) {
      return res.status(404).json({ success: false, message: '권한이 없거나 버스를 찾을 수 없습니다.' });
    }

    const updated = await prisma.bus.update({
      where: { id: busId },
      data: {
        lastLatitude: parseFloat(latitude),
        lastLongitude: parseFloat(longitude),
        lastLocationAt: new Date(),
        // Accumulate mileage if reported
        ...(mileageDelta ? { totalMileage: (bus.totalMileage || 0) + parseInt(mileageDelta) } : {}),
      },
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '위치 업데이트 실패' });
  }
};

// GET /api/buses/live-locations — all active buses with last GPS position
export const liveLocations = async (req: AuthRequest, res: Response) => {
  try {
    const buses = await prisma.bus.findMany({
      where: { companyId: req.user!.companyId, isActive: true, NOT: { lastLatitude: null } },
      select: {
        id: true,
        busNumber: true,
        plateNumber: true,
        lastLatitude: true,
        lastLongitude: true,
        lastLocationAt: true,
        totalMileage: true,
        route: { select: { routeNumber: true, name: true } },
      },
      orderBy: { lastLocationAt: 'desc' },
    });
    return res.json({ success: true, data: buses });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '위치 데이터 조회 실패' });
  }
};

