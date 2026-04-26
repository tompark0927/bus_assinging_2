import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';

/**
 * GET /api/v1/search?q=검색어
 * 기사, 버스, 노선을 병렬로 검색하여 카테고리별 결과 반환
 */
export async function globalSearch(req: Request, res: Response) {
  try {
    const q = (req.query.q as string || '').trim();

    if (!q || q.length < 1) {
      return res.json({
        data: { drivers: [], buses: [], routes: [] },
      });
    }

    const companyId = (req as any).user?.companyId || 1;
    const searchTerm = `%${q}%`;

    // 병렬 검색: 기사, 버스, 노선
    const [drivers, buses, routes] = await Promise.all([
      prisma.user.findMany({
        where: {
          companyId,
          role: 'DRIVER',
          isActive: true,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { employeeId: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          name: true,
          employeeId: true,
          phone: true,
          driverType: true,
          isActive: true,
        },
        take: 8,
        orderBy: { name: 'asc' },
      }),

      prisma.bus.findMany({
        where: {
          companyId,
          isActive: true,
          OR: [
            { busNumber: { contains: q, mode: 'insensitive' } },
            { plateNumber: { contains: q, mode: 'insensitive' } },
            { model: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          busNumber: true,
          plateNumber: true,
          model: true,
          routeId: true,
          route: { select: { routeNumber: true, name: true } },
        },
        take: 8,
        orderBy: { busNumber: 'asc' },
      }),

      prisma.route.findMany({
        where: {
          companyId,
          isActive: true,
          OR: [
            { routeNumber: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          routeNumber: true,
          name: true,
          startPoint: true,
          endPoint: true,
        },
        take: 8,
        orderBy: { routeNumber: 'asc' },
      }),
    ]);

    return res.json({
      data: { drivers, buses, routes },
    });
  } catch (error) {
    logger.error('[search] 검색 오류:', error);
    return res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
  }
}
