import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

export const getDriverTags = async (req: AuthRequest, res: Response) => {
  try {
    const tags = await prisma.driverTag.findMany({
      where: { companyId: req.user!.companyId },
      include: {
        driver: { select: { id: true, name: true, employeeId: true } },
        targetDriver: { select: { id: true, name: true, employeeId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, data: tags });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const createDriverTag = async (req: AuthRequest, res: Response) => {
  try {
    const { driverId, tag, isHardRule, targetDriverId } = req.body;

    if (!driverId || !tag) {
      return res.status(400).json({ success: false, message: '기사 ID와 태그를 입력해주세요.' });
    }

    // Verify driver belongs to same company
    const driver = await prisma.user.findFirst({
      where: { id: driverId, companyId: req.user!.companyId },
    });
    if (!driver) {
      return res.status(404).json({ success: false, message: '기사를 찾을 수 없습니다.' });
    }

    // Verify target driver if provided
    if (targetDriverId) {
      const targetDriver = await prisma.user.findFirst({
        where: { id: targetDriverId, companyId: req.user!.companyId },
      });
      if (!targetDriver) {
        return res.status(404).json({ success: false, message: '대상 기사를 찾을 수 없습니다.' });
      }
    }

    const driverTag = await prisma.driverTag.create({
      data: {
        companyId: req.user!.companyId,
        driverId,
        tag,
        isHardRule: isHardRule || false,
        targetDriverId: targetDriverId || null,
        createdBy: req.user!.id,
      },
      include: {
        driver: { select: { id: true, name: true, employeeId: true } },
        targetDriver: { select: { id: true, name: true, employeeId: true } },
      },
    });

    return res.status(201).json({ success: true, data: driverTag });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const deleteDriverTag = async (req: AuthRequest, res: Response) => {
  try {
    const tagId = parseInt(req.params.id);
    if (isNaN(tagId) || tagId <= 0) {
      return res.status(400).json({ success: false, message: '유효하지 않은 태그 ID입니다.' });
    }

    const existing = await prisma.driverTag.findFirst({
      where: { id: tagId, companyId: req.user!.companyId },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: '태그를 찾을 수 없습니다.' });
    }

    await prisma.driverTag.delete({ where: { id: tagId } });

    return res.json({ success: true, message: '태그가 삭제되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
