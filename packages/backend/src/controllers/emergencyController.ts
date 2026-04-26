import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { sendPushNotification, sendBulkPushNotifications } from '../services/notificationService';
import { dispatchImmediateEmergency } from '../services/emergencyAgentRunner';
import logger from '../utils/logger';
import { parseIdParam } from '../utils/helpers';
import { issueTicket } from './goldenTicketController';
import { getPagination, paginatedResponse } from '../utils/pagination';
import { emitToCompany } from '../services/socketService';

export const getEmergencyDrops = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;

    const statusFilter = (status as string) || 'OPEN';

    const where = {
      status: statusFilter as 'OPEN' | 'FILLED' | 'CANCELLED',
      slot: { schedule: { companyId: req.user!.companyId } },
    };
    const pagination = getPagination(req);
    const [drops, total] = await Promise.all([
      prisma.emergencyDrop.findMany({
        where,
        include: {
          slot: {
            include: { route: true, bus: true },
          },
          driver: { select: { id: true, name: true, phone: true } },
          filledUser: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.emergencyDrop.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(drops, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const createEmergencyDrop = async (req: AuthRequest, res: Response) => {
  try {
    const { slotId, reason } = req.body;

    if (!slotId || !reason) {
      return res.status(400).json({ success: false, message: '슬롯 ID와 사유를 입력해주세요.' });
    }

    // Verify the slot belongs to this driver
    const slot = await prisma.scheduleSlot.findUnique({
      where: { id: slotId },
      include: { route: true, schedule: { select: { companyId: true } } },
    });

    if (!slot || slot.schedule.companyId !== req.user!.companyId) {
      return res.status(404).json({ success: false, message: '배차 슬롯을 찾을 수 없습니다.' });
    }

    // Drivers can only drop their own slots (admin can drop any)
    if (req.user!.role === 'DRIVER' && slot.driverId !== req.user!.id) {
      return res.status(403).json({ success: false, message: '권한이 없습니다.' });
    }

    if (slot.isRestDay) {
      return res.status(400).json({ success: false, message: '휴무일은 드랍할 수 없습니다.' });
    }

    // Check if already dropped
    const existing = await prisma.emergencyDrop.findUnique({ where: { slotId } });
    if (existing) {
      return res.status(409).json({ success: false, message: '이미 드랍된 슬롯입니다.' });
    }

    // 드랍 생성 + 슬롯 상태 변경을 원자적으로 처리
    const [drop] = await prisma.$transaction([
      prisma.emergencyDrop.create({
        data: {
          slotId,
          driverId: req.user!.id,
          reason,
          status: 'OPEN',
        },
      }),
      prisma.scheduleSlot.update({
        where: { id: slotId },
        data: { status: 'DROPPED' },
      }),
    ]);

    // 결원 즉시 처리 — feature flag 에 따라 EmergencyAgent 또는 결정론적 escalation.
    // fire-and-forget: 에이전트 도구 루프가 수 초 걸릴 수 있어 컨트롤러 응답을 막지 않음.
    dispatchImmediateEmergency({
      dropId: drop.id,
      slotDate: slot.date,
      shift: slot.shift,
      companyId: req.user!.companyId,
      routeId: slot.routeId,
    });

    // Notify admins
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true, companyId: req.user!.companyId },
      select: { id: true },
    });

    const dateFormatted = `${slot.date.getMonth() + 1}월 ${slot.date.getDate()}일`;
    await sendBulkPushNotifications(
      admins.map(a => a.id),
      '🚨 긴급 슬롯 드랍',
      `${slot.date.toLocaleDateString('ko-KR')} ${slot.route.routeNumber}번 노선 운행 기사님이 슬롯을 드랍했습니다.`,
      'EMERGENCY_SLOT',
      { dropId: drop.id }
    );

    // Socket.IO: 회사 전체에 긴급 슬롯 알림
    emitToCompany(req.user!.companyId, 'emergency:new', {
      drop,
      slotDate: dateFormatted,
      routeNumber: slot.route.routeNumber,
    });

    return res.status(201).json({
      success: true,
      data: drop,
      message: `슬롯이 드랍되었습니다. ${dateFormatted} 쉬는 기사님들에게 알림이 발송되었습니다.`,
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const acceptEmergencySlot = async (req: AuthRequest, res: Response) => {
  try {
    const dropId = parseIdParam(req.params.id, res, '드랍 ID');
    if (dropId === null) return;

    const drop = await prisma.emergencyDrop.findUnique({
      where: { id: dropId },
      include: {
        slot: { include: { route: true } },
        driver: { select: { id: true, name: true, companyId: true } },
      },
    });

    if (!drop || drop.driver.companyId !== req.user!.companyId) {
      return res.status(404).json({ success: false, message: '긴급 슬롯을 찾을 수 없습니다.' });
    }

    if (drop.status !== 'OPEN') {
      return res.status(400).json({ success: false, message: '이미 처리된 슬롯입니다.' });
    }

    // Update drop + slot atomically with optimistic lock on status
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.emergencyDrop.updateMany({
        where: { id: dropId, status: 'OPEN' },
        data: {
          status: 'FILLED',
          filledBy: req.user!.id,
          filledAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new Error('ALREADY_FILLED');
      }
      await tx.scheduleSlot.update({
        where: { id: drop.slotId },
        data: {
          driverId: req.user!.id,
          status: 'FILLED',
        },
      });
      return claimed;
    });

    if (!result || result.count === 0) {
      return res.status(409).json({ success: false, message: '이미 다른 기사님이 수락한 슬롯입니다.' });
    }

    // 대타 수락 보상: 골든 티켓 자동 발급
    try {
      await issueTicket(req.user!.companyId, req.user!.id, dropId);
      logger.info(`골든 티켓 발급: 기사 ${req.user!.id}, 긴급드랍 ${dropId}`);
    } catch (ticketError) {
      logger.error('골든 티켓 발급 실패:', ticketError);
    }

    const dateFormatted = `${drop.slot.date.getMonth() + 1}월 ${drop.slot.date.getDate()}일`;

    // Notify original driver and admin
    await sendPushNotification(
      drop.driverId,
      '✅ 긴급 슬롯 대체 완료',
      `${dateFormatted} ${drop.slot.route.routeNumber}번 노선 운행이 대체되었습니다.`,
      'EMERGENCY_FILLED',
      { dropId }
    );

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true, companyId: req.user!.companyId },
      select: { id: true },
    });

    await sendBulkPushNotifications(
      admins.map(a => a.id),
      '✅ 긴급 슬롯 해결',
      `${dateFormatted} ${drop.slot.route.routeNumber}번 노선이 대체되었습니다.`,
      'EMERGENCY_FILLED',
      { dropId }
    );

    // Socket.IO: 회사 전체에 슬롯 충원 알림 (다른 기사들에게 실시간으로 표시)
    emitToCompany(req.user!.companyId, 'emergency:filled', {
      dropId,
      filledByUserId: req.user!.id,
      filledByName: req.user!.name,
      slotId: drop.slotId,
      routeNumber: drop.slot.route.routeNumber,
      date: dateFormatted,
    });

    return res.json({
      success: true,
      message: '긴급 슬롯이 수락되었습니다.',
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'ALREADY_FILLED') {
      return res.status(409).json({ success: false, message: '이미 다른 기사님이 수락한 슬롯입니다.' });
    }
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const cancelEmergencyDrop = async (req: AuthRequest, res: Response) => {
  try {
    const dropId = parseIdParam(req.params.id, res, '드랍 ID');
    if (dropId === null) return;

    const drop = await prisma.emergencyDrop.findUnique({
      where: { id: dropId },
      include: { driver: { select: { companyId: true } } }
    });

    if (!drop || drop.driver.companyId !== req.user!.companyId) {
      return res.status(404).json({ success: false, message: '긴급 슬롯을 찾을 수 없습니다.' });
    }

    // 취소 + 슬롯 복원을 원자적으로 처리
    await prisma.$transaction([
      prisma.emergencyDrop.update({
        where: { id: dropId },
        data: { status: 'CANCELLED' },
      }),
      prisma.scheduleSlot.update({
        where: { id: drop.slotId },
        data: { status: 'SCHEDULED' },
      }),
    ]);

    return res.json({ success: true, message: '긴급 슬롯이 취소되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
