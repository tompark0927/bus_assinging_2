import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest, isFullAccess } from '../middleware/auth';
import logger from '../utils/logger';
import { parseIdParam } from '../utils/helpers';
import { getPagination, paginatedResponse } from '../utils/pagination';
import { sendBulkPushNotifications } from '../services/notificationService';

// 게시글 목록 조회
export const getPosts = async (req: AuthRequest, res: Response) => {
  try {
    const { boardType, routeId } = req.query;
    const companyId = req.user!.companyId;
    const pagination = getPagination(req);

    const where: Record<string, unknown> = { companyId };
    if (boardType) where.boardType = boardType;
    if (routeId) where.routeId = parseInt(routeId as string);

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          author: { select: { id: true, name: true, role: true } },
          route: { select: { id: true, routeNumber: true, name: true } },
          reads: { where: { userId: req.user!.id }, select: { id: true } },
          _count: { select: { reads: true } },
        },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.post.count({ where }),
    ]);

    const data = posts.map(post => ({
      ...post,
      isRead: post.reads.length > 0,
      readCount: post._count.reads,
      author: post.isAnonymous && post.authorId !== req.user!.id
        ? { id: 0, name: '익명', role: 'DRIVER' }
        : post.author,
      reads: undefined,
      _count: undefined,
    }));

    return res.json({
      success: true,
      ...paginatedResponse(data, total, pagination),
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 게시글 상세 조회 + 읽음 처리
export const getPost = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '게시글 ID');
    if (id === null) return;

    const post = await prisma.post.findFirst({
      where: { id, companyId: req.user!.companyId },
      include: {
        author: { select: { id: true, name: true, role: true } },
        route: { select: { id: true, routeNumber: true, name: true } },
        _count: { select: { reads: true } },
      },
    });

    if (!post) {
      return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' });
    }

    // 읽음 처리
    await prisma.postRead.upsert({
      where: { postId_userId: { postId: id, userId: req.user!.id } },
      create: { postId: id, userId: req.user!.id },
      update: { readAt: new Date() },
    });

    const data = {
      ...post,
      readCount: post._count.reads + 1,
      author: post.isAnonymous && post.authorId !== req.user!.id
        ? { id: 0, name: '익명', role: 'DRIVER' }
        : post.author,
      _count: undefined,
    };

    return res.json({ success: true, data });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 게시글 작성
export const createPost = async (req: AuthRequest, res: Response) => {
  try {
    const { boardType, title, content, isAnonymous, isPinned, isUrgent, routeId } = req.body;

    if (!boardType || !title || !content) {
      return res.status(400).json({ success: false, message: '게시판 유형, 제목, 내용을 입력해주세요.' });
    }

    // 권한 체크: 공지사항/안전/노선 게시판은 ADMIN/MANAGER만
    const adminOnlyBoards = ['NOTICE', 'SAFETY', 'ROUTE'];
    if (adminOnlyBoards.includes(boardType) && req.user!.role === 'DRIVER') {
      return res.status(403).json({ success: false, message: '해당 게시판에 글을 작성할 권한이 없습니다.' });
    }

    // 익명은 건의함에서만
    if (isAnonymous && boardType !== 'SUGGESTION') {
      return res.status(400).json({ success: false, message: '익명 글은 건의함에서만 가능합니다.' });
    }

    const post = await prisma.post.create({
      data: {
        companyId: req.user!.companyId,
        boardType,
        title,
        content,
        authorId: req.user!.id,
        isAnonymous: isAnonymous || false,
        isPinned: isPinned || false,
        isUrgent: isUrgent || false,
        routeId: routeId ? parseInt(routeId) : undefined,
      },
      include: {
        author: { select: { id: true, name: true, role: true } },
      },
    });

    // 공지/안전/노선 게시판 글은 기사 전원에게 푸시 (긴급 글은 URGENT_POST 로 강조)
    if (adminOnlyBoards.includes(boardType)) {
      const drivers = await prisma.user.findMany({
        where: { companyId: req.user!.companyId, role: 'DRIVER', isActive: true },
        select: { id: true },
      });
      const boardLabel = boardType === 'NOTICE' ? '공지사항' : boardType === 'SAFETY' ? '안전 게시판' : '노선 게시판';
      sendBulkPushNotifications(
        drivers.map((d) => d.id),
        post.isUrgent ? `🚨 [긴급] ${boardLabel}` : `📢 새 ${boardLabel} 글`,
        title,
        post.isUrgent ? 'URGENT_POST' : 'NEW_POST',
        { postId: post.id, boardType },
      ).catch((e) => logger.error('[Post] 게시글 푸시 발송 실패:', e));
    }

    return res.status(201).json({ success: true, data: post });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 게시글 수정
export const updatePost = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '게시글 ID');
    if (id === null) return;

    const existing = await prisma.post.findFirst({
      where: { id, companyId: req.user!.companyId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' });
    }

    if (existing.authorId !== req.user!.id && !isFullAccess(req.user!.role)) {
      return res.status(403).json({ success: false, message: '본인 글만 수정할 수 있습니다.' });
    }

    const { title, content, isPinned, isUrgent } = req.body;

    const post = await prisma.post.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(content && { content }),
        ...(isPinned !== undefined && { isPinned }),
        ...(isUrgent !== undefined && { isUrgent }),
      },
      include: {
        author: { select: { id: true, name: true, role: true } },
      },
    });

    return res.json({ success: true, data: post });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 게시글 삭제
export const deletePost = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '게시글 ID');
    if (id === null) return;

    const existing = await prisma.post.findFirst({
      where: { id, companyId: req.user!.companyId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' });
    }

    if (existing.authorId !== req.user!.id && !isFullAccess(req.user!.role)) {
      return res.status(403).json({ success: false, message: '본인 글만 삭제할 수 있습니다.' });
    }

    await prisma.post.delete({ where: { id } });

    return res.json({ success: true, message: '게시글이 삭제되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오��가 발생했습니다.' });
  }
};

// 읽음 현황 (관리자용)
export const getPostReads = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '게시글 ID');
    if (id === null) return;

    // Verify the post belongs to user's company
    const post = await prisma.post.findFirst({
      where: { id, companyId: req.user!.companyId },
    });
    if (!post) {
      return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' });
    }

    const reads = await prisma.postRead.findMany({
      where: { postId: id },
      include: { user: { select: { id: true, name: true, employeeId: true } } },
      orderBy: { readAt: 'desc' },
    });

    const totalUsers = await prisma.user.count({
      where: { companyId: req.user!.companyId, isActive: true },
    });

    return res.json({
      success: true,
      data: { reads, readCount: reads.length, totalUsers, readRate: Math.round((reads.length / totalUsers) * 100) },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
