import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { chatWithAI } from '../services/aiService';
import logger from '../utils/logger';

export const getSessions = async (req: AuthRequest, res: Response) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      where: { userId: req.user!.id, companyId: req.user!.companyId },
      include: { _count: { select: { messages: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    return res.json({ success: true, data: sessions });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const createSession = async (req: AuthRequest, res: Response) => {
  try {
    const { title } = req.body;

    const session = await prisma.chatSession.create({
      data: { companyId: req.user!.companyId, userId: req.user!.id, title: title || '새 대화' },
    });

    return res.status(201).json({ success: true, data: session });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const getSession = async (req: AuthRequest, res: Response) => {
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: parseInt(req.params.id), userId: req.user!.id, companyId: req.user!.companyId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!session) {
      return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });
    }

    return res.json({ success: true, data: session });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id);
    const { message, saveAsRule } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: '메시지를 입력해주세요.' });
    }

    // Verify session belongs to user's company
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, companyId: req.user!.companyId },
    });
    if (!session) {
      return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });
    }

    const result = await chatWithAI(sessionId, message);

    // If structured rules were detected and admin wants to save them
    if (saveAsRule && result.structuredRules) {
      const allowedRoles = ['OWNER', 'DIRECTOR', 'ADMIN', 'DISPATCH'];
      if (!allowedRoles.includes(req.user!.role)) {
        return res.status(403).json({ success: false, message: '규칙 저장 권한이 없습니다.' });
      }
      await prisma.companyRule.create({
        data: {
          companyId: req.user!.companyId,
          title: `AI 추출 규칙 - ${new Date().toLocaleDateString('ko-KR')}`,
          content: message,
          parsedData: result.structuredRules as any,
          category: 'ai-extracted',
        },
      });
    }

    return res.json({
      success: true,
      data: {
        reply: result.reply,
        structuredRules: result.structuredRules,
      },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: 'AI 서비스 오류가 발생했습니다.' });
  }
};

export const deleteSession = async (req: AuthRequest, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id);

    // Verify session belongs to user's company before deleting
    const sessionToDelete = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId: req.user!.id, companyId: req.user!.companyId },
    });
    if (!sessionToDelete) {
      return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });
    }

    await prisma.chatMessage.deleteMany({ where: { sessionId } });
    await prisma.chatSession.delete({
      where: { id: sessionId },
    });

    return res.json({ success: true, message: '대화가 삭제되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
