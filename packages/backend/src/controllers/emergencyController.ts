import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { sendPushNotification, sendBulkPushNotifications, notifyAvailableDriversForEmergency, notifyAdminsUrgentEmergency, notifyAdminsNewDrop } from '../services/notificationService';
import { dispatchImmediateEmergency, isEmergencyAgentEnabled } from '../services/emergencyAgentRunner';
import logger from '../utils/logger';
import { parseIdParam } from '../utils/helpers';
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

    // agentEnabled: AI 충원 에이전트 활성 여부 — 웹에서 상태 배지를 정확히 표시하기 위함
    return res.json({
      success: true,
      agentEnabled: isEmergencyAgentEnabled(),
      ...paginatedResponse(drops, total, pagination),
    });
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
      include: { route: true, driver: { select: { name: true } }, schedule: { select: { companyId: true } } },
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

    // 과거 슬롯 차단 — 슬롯은 UTC 자정에 저장되어 캘린더 일자를 표현.
    // 서버 로컬 TZ 기준 "오늘"과 비교 (운영 환경에서는 서버를 KST 로 두면 그대로 동작).
    const slotDateStr = new Date(slot.date).toISOString().slice(0, 10);
    const now = new Date();
    const localTodayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (slotDateStr < localTodayStr) {
      return res.status(400).json({
        success: false,
        message: '이미 지난 날짜는 드랍할 수 없습니다.',
      });
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

    const dateFormatted = `${slot.date.getUTCMonth() + 1}월 ${slot.date.getUTCDate()}일`;

    // 드랍 시점에 운행일이 이미 D-2 이내면 "긴급" 단계로 즉시 알림 (푸시 + 알림톡 stub),
    // 그렇지 않으면 푸시만 발송. 긴급으로 보낸 경우 escalationLevel=1 로 락 → cron 이 다시 발송하지 않도록.
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
    const isUrgent = slot.date.getTime() - Date.now() <= TWO_DAYS_MS;
    await notifyAvailableDriversForEmergency(
      drop.id,
      slot.date,
      slot.routeId,
      req.user!.companyId,
      isUrgent,
    );
    if (isUrgent) {
      await prisma.emergencyDrop.update({
        where: { id: drop.id },
        data: { escalationLevel: 1, lastEscalatedAt: new Date() },
      });
      // 운행 2일 이내 미충원 — 관리자 웹에 강한 알림(직접 조치 필요)
      await notifyAdminsUrgentEmergency({
        companyId: req.user!.companyId,
        dropId: drop.id,
        slotDate: slot.date,
        routeNumber: slot.route.routeNumber,
        shift: slot.shift,
      });
    } else {
      // 일반(비긴급) 대타 발생 — 관리자 알림함에 기록
      await notifyAdminsNewDrop({
        companyId: req.user!.companyId,
        dropId: drop.id,
        slotDate: slot.date,
        routeNumber: slot.route.routeNumber,
        shift: slot.shift,
        driverName: slot.driver?.name ?? '기사',
      });
    }

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

    const dateFormatted = `${drop.slot.date.getUTCMonth() + 1}월 ${drop.slot.date.getUTCDate()}일`;

    // Notify original driver and admin
    await sendPushNotification(
      drop.driverId,
      '✅ 대타 충원 완료!',
      `${dateFormatted} ${drop.slot.route.routeNumber}번 노선 운행이 대체되었습니다.`,
      'EMERGENCY_FILLED',
      { dropId }
    );

    const admins = await prisma.user.findMany({
      where: { role: { not: 'DRIVER' }, isActive: true, companyId: req.user!.companyId },
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

/**
 * PUT /api/v1/emergency/:id/manual-fill
 * 관리자가 OPEN 인 대타 슬롯에 직접 기사를 지정해 충원.
 * Body: { driverId }
 */
// 이 드랍에 대해 대타 요청 알림을 받은 기사 목록 — Notification 기록 기반
export const getNotifiedDrivers = async (req: AuthRequest, res: Response) => {
  try {
    const dropId = parseIdParam(req.params.id, res, '드랍 ID');
    if (dropId === null) return;

    const drop = await prisma.emergencyDrop.findUnique({
      where: { id: dropId },
      include: { driver: { select: { companyId: true } } },
    });
    if (!drop || drop.driver.companyId !== req.user!.companyId) {
      return res.status(404).json({ success: false, message: '긴급 슬롯을 찾을 수 없습니다.' });
    }

    // 발송 시점에 data.emergencyDropId 로 기록된 알림을 역추적
    const notifications = await prisma.notification.findMany({
      where: {
        type: 'EMERGENCY_SLOT',
        data: { path: ['emergencyDropId'], equals: dropId },
        user: { companyId: req.user!.companyId, role: 'DRIVER' },
      },
      select: {
        userId: true,
        createdAt: true,
        user: { select: { name: true, employeeId: true, driverType: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 같은 기사에게 여러 번 발송된 경우 최초 발송 1건만 (발송 횟수는 count 로 제공)
    const byDriver = new Map<number, { id: number; name: string; employeeId: string; driverType: string | null; firstNotifiedAt: Date; count: number }>();
    for (const n of notifications) {
      const existing = byDriver.get(n.userId);
      if (existing) {
        existing.count += 1;
      } else {
        byDriver.set(n.userId, {
          id: n.userId,
          name: n.user.name,
          employeeId: n.user.employeeId,
          driverType: n.user.driverType,
          firstNotifiedAt: n.createdAt,
          count: 1,
        });
      }
    }

    return res.json({ success: true, data: Array.from(byDriver.values()) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 수동 충원 후보 기사 목록 — 해당 날짜에 이미 근무가 있는 기사는 제외
export const getManualFillCandidates = async (req: AuthRequest, res: Response) => {
  try {
    const dropId = parseIdParam(req.params.id, res, '드랍 ID');
    if (dropId === null) return;

    const drop = await prisma.emergencyDrop.findUnique({
      where: { id: dropId },
      include: {
        slot: { select: { id: true, date: true } },
        driver: { select: { id: true, companyId: true } },
      },
    });
    if (!drop || drop.driver.companyId !== req.user!.companyId) {
      return res.status(404).json({ success: false, message: '긴급 슬롯을 찾을 수 없습니다.' });
    }

    // 같은 날짜에 이미 다른 슬롯에 배정된 기사 (manualFillEmergency 의 noSameDayDoubleAssign 과 동일 기준)
    const busySlots = await prisma.scheduleSlot.findMany({
      where: {
        date: drop.slot.date,
        isRestDay: false,
        id: { not: drop.slotId },
        status: { in: ['SCHEDULED', 'FILLED'] },
        schedule: { companyId: req.user!.companyId },
      },
      select: { driverId: true },
    });
    const excludedIds = new Set<number>(busySlots.map((s) => s.driverId));
    excludedIds.add(drop.driverId);

    const drivers = await prisma.user.findMany({
      where: {
        companyId: req.user!.companyId,
        role: 'DRIVER',
        isActive: true,
        id: { notIn: Array.from(excludedIds) },
      },
      select: { id: true, name: true, employeeId: true, driverType: true, isActive: true },
      orderBy: { name: 'asc' },
    });

    return res.json({ success: true, data: drivers });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const manualFillEmergency = async (req: AuthRequest, res: Response) => {
  try {
    const dropId = parseIdParam(req.params.id, res, '드랍 ID');
    if (dropId === null) return;
    const { driverId } = req.body as { driverId?: number };
    if (!driverId || typeof driverId !== 'number') {
      return res.status(400).json({ success: false, message: '기사 ID가 필요합니다.' });
    }

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

    // 지정 기사 검증 — 같은 회사, 활성, DRIVER 권한
    const candidate = await prisma.user.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, companyId: true, role: true, isActive: true },
    });
    if (!candidate || candidate.companyId !== req.user!.companyId || candidate.role !== 'DRIVER' || !candidate.isActive) {
      return res.status(400).json({ success: false, message: '유효하지 않은 기사입니다.' });
    }
    if (candidate.id === drop.driverId) {
      return res.status(400).json({ success: false, message: '같은 기사를 다시 배정할 수 없습니다.' });
    }

    // 같은 날 같은 기사가 이미 다른 슬롯에 배정됐는지 — noSameDayDoubleAssign
    const sameDay = await prisma.scheduleSlot.findFirst({
      where: {
        driverId: candidate.id,
        date: drop.slot.date,
        isRestDay: false,
        id: { not: drop.slotId },
        status: { in: ['SCHEDULED', 'FILLED'] },
      },
    });
    if (sameDay) {
      return res.status(409).json({
        success: false,
        message: `${candidate.name} 기사님은 해당 날짜에 이미 다른 슬롯에 배정되어 있습니다.`,
      });
    }

    // 트랜잭션: drop FILLED + slot driver/status 업데이트
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.emergencyDrop.updateMany({
        where: { id: dropId, status: 'OPEN' },
        data: {
          status: 'FILLED',
          filledBy: candidate.id,
          filledAt: new Date(),
        },
      });
      if (claimed.count === 0) throw new Error('ALREADY_FILLED');
      await tx.scheduleSlot.update({
        where: { id: drop.slotId },
        data: { driverId: candidate.id, status: 'FILLED' },
      });
      return claimed;
    });
    if (!result || result.count === 0) {
      return res.status(409).json({ success: false, message: '이미 다른 기사님이 수락한 슬롯입니다.' });
    }

    const dateFormatted = `${drop.slot.date.getUTCMonth() + 1}월 ${drop.slot.date.getUTCDate()}일`;

    // 지정된 기사에게 통보
    await sendPushNotification(
      candidate.id,
      '📋 대타 배정',
      `${dateFormatted} ${drop.slot.route.routeNumber}번 노선에 배정되었습니다.`,
      'EMERGENCY_FILLED',
      { dropId, manualAssign: true },
    );

    // 원래 기사에게도 통보
    await sendPushNotification(
      drop.driverId,
      '✅ 대타 충원 완료!',
      `${dateFormatted} ${drop.slot.route.routeNumber}번 노선 운행이 대체되었습니다.`,
      'EMERGENCY_FILLED',
      { dropId },
    );

    // Socket.IO 회사 전체 알림
    emitToCompany(req.user!.companyId, 'emergency:filled', {
      dropId,
      filledByUserId: candidate.id,
      filledByName: candidate.name,
      slotId: drop.slotId,
      routeNumber: drop.slot.route.routeNumber,
      date: dateFormatted,
      manualAssign: true,
    });

    logger.info(`[Emergency] 관리자 수동 충원 — drop=${dropId}, driver=${candidate.id} by admin=${req.user!.id}`);

    return res.json({
      success: true,
      message: `${candidate.name} 기사님으로 배정 완료`,
      data: { dropId, driverId: candidate.id, driverName: candidate.name },
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
