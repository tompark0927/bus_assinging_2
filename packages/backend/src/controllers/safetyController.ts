import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { getPagination, paginatedResponse } from '../utils/pagination';

// ─────────────────────────────────────────
// 사고/위반 이력
// ─────────────────────────────────────────

export const getIncidents = async (req: AuthRequest, res: Response) => {
  try {
    const { driverId, type, resolved } = req.query;
    const companyId = req.user!.companyId;

    const where: Record<string, unknown> = { companyId };
    if (driverId) where.driverId = Number(driverId);
    if (type) where.type = type;
    if (resolved !== undefined) where.isResolved = resolved === 'true';

    const pagination = getPagination(req);
    const [incidents, total] = await Promise.all([
      prisma.incidentRecord.findMany({
        where,
        include: { driver: { select: { id: true, name: true, employeeId: true } } },
        orderBy: { date: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.incidentRecord.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(incidents, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const createIncident = async (req: AuthRequest, res: Response) => {
  try {
    const { driverId, date, type, description, penalty, notes } = req.body;
    const companyId = req.user!.companyId;

    // Verify driver belongs to same company
    const driver = await prisma.user.findFirst({ where: { id: Number(driverId), companyId } });
    if (!driver) {
      return res.status(404).json({ success: false, message: '기사를 찾을 수 없습니다.' });
    }

    const incident = await prisma.incidentRecord.create({
      data: {
        companyId,
        driverId: Number(driverId),
        date: new Date(date),
        type,
        description,
        penalty: penalty ? Number(penalty) : null,
        notes,
      },
      include: { driver: { select: { id: true, name: true, employeeId: true } } },
    });

    return res.status(201).json({ success: true, data: incident });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const resolveIncident = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const companyId = req.user!.companyId;

    const incident = await prisma.incidentRecord.findFirst({ where: { id, companyId } });
    if (!incident) return res.status(404).json({ success: false, message: '이력을 찾을 수 없습니다.' });

    const updated = await prisma.incidentRecord.update({
      where: { id },
      data: { isResolved: true, resolvedAt: new Date(), notes: req.body.notes || incident.notes },
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const deleteIncident = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const incident = await prisma.incidentRecord.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!incident) return res.status(404).json({ success: false, message: '이력을 찾을 수 없습니다.' });

    await prisma.incidentRecord.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 교육 이수
// ─────────────────────────────────────────

export const getTrainings = async (req: AuthRequest, res: Response) => {
  try {
    const { driverId } = req.query;
    const companyId = req.user!.companyId;

    const where: Record<string, unknown> = { companyId };
    if (driverId) where.driverId = Number(driverId);

    const pagination = getPagination(req);
    const [records, total] = await Promise.all([
      prisma.trainingRecord.findMany({
        where,
        include: { driver: { select: { id: true, name: true, employeeId: true } } },
        orderBy: { completedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.trainingRecord.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(records, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const createTraining = async (req: AuthRequest, res: Response) => {
  try {
    const { driverId, type, completedAt, expiresAt, institution, notes } = req.body;
    const companyId = req.user!.companyId;

    // Verify driver belongs to same company
    const driver = await prisma.user.findFirst({ where: { id: Number(driverId), companyId } });
    if (!driver) {
      return res.status(404).json({ success: false, message: '기사를 찾을 수 없습니다.' });
    }

    const record = await prisma.trainingRecord.create({
      data: {
        companyId,
        driverId: Number(driverId),
        type,
        completedAt: new Date(completedAt),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        institution,
        notes,
      },
      include: { driver: { select: { id: true, name: true, employeeId: true } } },
    });

    return res.status(201).json({ success: true, data: record });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 면허/자격 만료 알림 대상자 조회
// ─────────────────────────────────────────

export const getLicenseExpiryAlerts = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const now = new Date();
    const in60days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const drivers = await prisma.user.findMany({
      where: {
        companyId,
        isActive: true,
        role: 'DRIVER',
        OR: [
          { licenseExpiresAt: { lte: in60days } },
          { qualificationExpiresAt: { lte: in60days } },
        ],
      },
      select: {
        id: true, name: true, employeeId: true, phone: true,
        licenseExpiresAt: true, qualificationExpiresAt: true,
      },
      orderBy: { licenseExpiresAt: 'asc' },
    });

    // 교육 만료 대상자
    const trainingExpiring = await prisma.trainingRecord.findMany({
      where: {
        companyId,
        expiresAt: { lte: in60days, gte: now },
      },
      include: { driver: { select: { id: true, name: true, employeeId: true } } },
      orderBy: { expiresAt: 'asc' },
    });

    const alerts = drivers.map(d => {
      const licenseExpiring = d.licenseExpiresAt && d.licenseExpiresAt <= in60days;
      const qualExpiring = d.qualificationExpiresAt && d.qualificationExpiresAt <= in60days;
      const licenseExpired = d.licenseExpiresAt && d.licenseExpiresAt < now;
      const qualExpired = d.qualificationExpiresAt && d.qualificationExpiresAt < now;

      return {
        ...d,
        licenseExpiring,
        qualExpiring,
        licenseExpired,
        qualExpired,
        isUrgent: licenseExpired || qualExpired,
      };
    });

    return res.json({
      success: true,
      data: {
        licenseAlerts: alerts,
        trainingAlerts: trainingExpiring,
        urgentCount: alerts.filter(a => a.isUrgent).length,
        warningCount: alerts.filter(a => !a.isUrgent).length,
      },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 기사 면허 정보 업데이트
export const updateDriverLicense = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.driverId);
    const { licenseNumber, licenseExpiresAt, qualificationExpiresAt } = req.body;
    const companyId = req.user!.companyId;

    const driver = await prisma.user.findFirst({ where: { id, companyId } });
    if (!driver) return res.status(404).json({ success: false, message: '기사를 찾을 수 없습니다.' });

    const updated = await prisma.user.update({
      where: { id },
      data: {
        licenseNumber,
        licenseExpiresAt: licenseExpiresAt ? new Date(licenseExpiresAt) : null,
        qualificationExpiresAt: qualificationExpiresAt ? new Date(qualificationExpiresAt) : null,
      },
      select: { id: true, name: true, licenseNumber: true, licenseExpiresAt: true, qualificationExpiresAt: true },
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 안전 대시보드 통계
export const getSafetyStats = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.user!.companyId;
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth();

    const [
      totalIncidents,
      unresolvedIncidents,
      thisMonthIncidents,
      totalPenalty,
      licenseExpiredCount,
    ] = await Promise.all([
      prisma.incidentRecord.count({ where: { companyId } }),
      prisma.incidentRecord.count({ where: { companyId, isResolved: false } }),
      prisma.incidentRecord.count({
        where: {
          companyId,
          date: {
            gte: new Date(thisYear, thisMonth, 1),
            lte: new Date(thisYear, thisMonth + 1, 0),
          },
        },
      }),
      prisma.incidentRecord.aggregate({
        where: { companyId },
        _sum: { penalty: true },
      }),
      prisma.user.count({
        where: {
          companyId,
          isActive: true,
          role: 'DRIVER',
          OR: [
            { licenseExpiresAt: { lt: now } },
            { qualificationExpiresAt: { lt: now } },
          ],
        },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        totalIncidents,
        unresolvedIncidents,
        thisMonthIncidents,
        totalPenalty: totalPenalty._sum.penalty || 0,
        licenseExpiredCount,
      },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
