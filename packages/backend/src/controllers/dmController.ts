import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { getPagination, paginatedResponse } from '../utils/pagination';
import { emitToUser } from '../services/socketService';

// 대화 목록 (상대방별 최근 메시지)
export const getConversations = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const companyId = req.user!.companyId;

    // Get all messages involving this user
    const messages = await prisma.directMessage.findMany({
      where: {
        companyId,
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        sender: { select: { id: true, name: true, role: true, employeeId: true } },
        receiver: { select: { id: true, name: true, role: true, employeeId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by conversation partner
    const conversationMap = new Map<number, {
      partner: { id: number; name: string; role: string; employeeId: string };
      lastMessage: string;
      lastMessageAt: Date;
      unreadCount: number;
    }>();

    for (const msg of messages) {
      const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      const partner = msg.senderId === userId ? msg.receiver : msg.sender;

      if (!conversationMap.has(partnerId)) {
        conversationMap.set(partnerId, {
          partner,
          lastMessage: msg.content,
          lastMessageAt: msg.createdAt,
          unreadCount: 0,
        });
      }

      // Count unread messages from this partner
      if (msg.receiverId === userId && !msg.isRead) {
        const conv = conversationMap.get(partnerId)!;
        conv.unreadCount++;
      }
    }

    const allConversations = Array.from(conversationMap.values())
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());

    const pagination = getPagination(req);
    const paginatedConversations = allConversations.slice(pagination.skip, pagination.skip + pagination.limit);

    return res.json({ success: true, ...paginatedResponse(paginatedConversations, allConversations.length, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 특정 상대와의 메시지 목록
export const getMessages = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const partnerId = Number(req.params.partnerId);
    const companyId = req.user!.companyId;
    const pagination = getPagination(req);

    const where = {
      companyId,
      OR: [
        { senderId: userId, receiverId: partnerId },
        { senderId: partnerId, receiverId: userId },
      ],
    };

    const [messages, total] = await Promise.all([
      prisma.directMessage.findMany({
        where,
        include: {
          sender: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.directMessage.count({ where }),
    ]);

    // Mark received messages as read
    await prisma.directMessage.updateMany({
      where: {
        companyId,
        senderId: partnerId,
        receiverId: userId,
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });

    return res.json({
      success: true,
      ...paginatedResponse(messages.reverse(), total, pagination), // chronological order
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 메시지 전송
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const companyId = req.user!.companyId;
    const { receiverId, content } = req.body;

    if (!receiverId || !content?.trim()) {
      return res.status(400).json({ success: false, message: '수신자와 내용을 입력해주세요.' });
    }

    // Verify receiver is in same company
    const receiver = await prisma.user.findFirst({
      where: { id: Number(receiverId), companyId, isActive: true },
    });

    if (!receiver) {
      return res.status(404).json({ success: false, message: '수신자를 찾을 수 없습니다.' });
    }

    const message = await prisma.directMessage.create({
      data: {
        companyId,
        senderId: userId,
        receiverId: Number(receiverId),
        content: content.trim(),
      },
      include: {
        sender: { select: { id: true, name: true } },
        receiver: { select: { id: true, name: true } },
      },
    });

    // (제거됨) DM 알림(NEW_MESSAGE) — 알림함 기록/푸시 모두 발송하지 않음.
    // 실시간 표시는 아래 Socket.IO(dm:new) 로만 처리한다.

    // Socket.IO: 수신자에게 실시간 DM 알림
    emitToUser(Number(receiverId), 'dm:new', {
      message,
      senderId: userId,
      senderName: req.user!.name,
    });

    return res.json({ success: true, data: message });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 읽지 않은 전체 메시지 수
export const getUnreadCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const count = await prisma.directMessage.count({
      where: { companyId: req.user!.companyId, receiverId: userId, isRead: false },
    });

    return res.json({ success: true, data: { unreadCount: count } });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 회사 내 유저 목록 (메시지 전송 대상)
export const getCompanyUsers = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const companyId = req.user!.companyId;

    const users = await prisma.user.findMany({
      where: { companyId, isActive: true, id: { not: userId } },
      select: { id: true, name: true, role: true, employeeId: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });

    return res.json({ success: true, data: users });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
