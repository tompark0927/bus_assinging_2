import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { getPagination, paginatedResponse } from '../utils/pagination';

export const getRules = async (req: AuthRequest, res: Response) => {
  try {
    const where = { companyId: req.user!.companyId };
    const pagination = getPagination(req);
    const [rules, total] = await Promise.all([
      prisma.companyRule.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.companyRule.count({ where }),
    ]);
    return res.json({ success: true, ...paginatedResponse(rules, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const createRule = async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, category } = req.body;

    const rule = await prisma.companyRule.create({
      data: { companyId: req.user!.companyId, title, content, category: category || 'general' },
    });

    return res.status(201).json({ success: true, data: rule });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const updateRule = async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, category, isActive } = req.body;

    const id = parseInt(req.params.id);
    const existing = await prisma.companyRule.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '규칙을 찾을 수 없습니다.' });
    }

    const rule = await prisma.companyRule.update({
      where: { id },
      data: { title, content, category, isActive },
    });

    return res.json({ success: true, data: rule });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const deleteRule = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.companyRule.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '규칙을 찾을 수 없습니다.' });
    }

    await prisma.companyRule.delete({
      where: { id },
    });
    return res.json({ success: true, message: '규칙이 삭제되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
