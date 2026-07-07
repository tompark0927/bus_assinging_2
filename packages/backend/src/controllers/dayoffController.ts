import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { sendPushNotification, notifyAdminsNewDayoffRequest } from '../services/notificationService';
import { dispatchImmediateEmergency } from '../services/emergencyAgentRunner';
import logger from '../utils/logger';
import { parseIdParam } from '../utils/helpers';
import { getPagination, paginatedResponse } from '../utils/pagination';
import { emitToUser } from '../services/socketService';

export const getDayOffRequests = async (req: AuthRequest, res: Response) => {
  try {
    const { status, driverId, month } = req.query;

    const where: Record<string, unknown> = { companyId: req.user!.companyId };

    // 월별 필터 (YYYY-MM) — 관리자 휴무 페이지가 달마다 목록을 새로 불러올 때 사용.
    // @db.Date 는 UTC 자정 저장 → UTC 기준 [월초, 다음 달 1일) 범위로 비교.
    if (typeof month === 'string') {
      const m = /^(\d{4})-(\d{2})$/.exec(month);
      if (m) {
        const y = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10);
        where.date = {
          gte: new Date(Date.UTC(y, mo - 1, 1)),
          lt: new Date(Date.UTC(y, mo, 1)),
        };
      }
    }

    // Drivers only see their own requests
    if (req.user!.role === 'DRIVER') {
      where.driverId = req.user!.id;
    } else if (driverId) {
      // 멀티테넌시: 다른 회사 기사 조회 방지
      const targetDriver = await prisma.user.findFirst({
        where: { id: parseInt(driverId as string), companyId: req.user!.companyId },
      });
      if (!targetDriver) {
        return res.status(403).json({ success: false, message: '해당 기사를 조회할 수 없습니다.' });
      }
      where.driverId = parseInt(driverId as string);
    }

    if (status) where.status = status;

    const pagination = getPagination(req);
    const [requests, total] = await Promise.all([
      prisma.dayOffRequest.findMany({
        where,
        include: {
          driver: { select: { id: true, name: true, employeeId: true } },
        },
        orderBy: { date: 'asc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.dayOffRequest.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(requests, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 기사 본인의 휴가 잔액 — 잔여 = 보유(vacationDays) - 올해 비반려 휴무요청 수.
// PENDING 도 사용으로 집계 → 신청 즉시 줄어들고, 반려/취소되면 자동 복원된다.
export const getVacationBalance = async (req: AuthRequest, res: Response) => {
  try {
    const me = await prisma.user.findFirst({
      where: { id: req.user!.id, companyId: req.user!.companyId },
      select: { vacationDays: true },
    });
    if (!me) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }

    const year = new Date().getFullYear();
    const used = await prisma.dayOffRequest.count({
      where: {
        companyId: req.user!.companyId,
        driverId: req.user!.id,
        status: { not: 'REJECTED' },
        date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
    });

    return res.json({
      success: true,
      data: { total: me.vacationDays, used, remaining: me.vacationDays - used },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const createDayOffRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { date, reason } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, message: '날짜를 입력해주세요.' });
    }

    const requestDate = new Date(date);

    // 과거 날짜 검증
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (requestDate < today) {
      return res.status(400).json({ success: false, message: '과거 날짜는 휴무 신청할 수 없습니다.' });
    }

    // Check if already requested
    const existing = await prisma.dayOffRequest.findFirst({
      where: {
        companyId: req.user!.companyId,
        driverId: req.user!.id,
        date: requestDate,
        status: { not: 'REJECTED' },
      },
    });

    if (existing) {
      return res.status(409).json({ success: false, message: '해당 날짜에 이미 휴무 요청이 있습니다.' });
    }

    const request = await prisma.dayOffRequest.create({
      data: {
        companyId: req.user!.companyId,
        driverId: req.user!.id,
        date: requestDate,
        reason,
      },
      include: {
        driver: { select: { id: true, name: true, employeeId: true } },
      },
    });

    // 관리자 알림함에 '새 휴무 요청' 기록 (배차/인사 관리자 대상)
    await notifyAdminsNewDayoffRequest({
      companyId: request.companyId,
      requestId: request.id,
      driverName: request.driver.name,
      date: request.date,
    });

    return res.status(201).json({ success: true, data: request });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const reviewDayOffRequest = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '요청 ID');
    if (id === null) return;
    const { status, reviewNote } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: '유효하지 않은 상태입니다.' });
    }

    const existing = await prisma.dayOffRequest.findFirst({ where: { id, companyId: req.user!.companyId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: '요청을 찾을 수 없습니다.' });
    }
    if (existing.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: '이미 처리된 요청입니다.' });
    }

    const isApproved = status === 'APPROVED';

    // 승인 시: 트랜잭션으로 요청 업데이트 + 슬롯 드랍을 원자적으로 처리
    let slotNotified = false;
    let dropForEscalation: { id: number; slotDate: Date; shift: string; routeId: number } | undefined;

    const request = await prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.dayOffRequest.update({
        where: { id },
        data: { status, reviewedBy: req.user!.id, reviewNote },
        include: { driver: { select: { id: true, name: true } } },
      });

      if (isApproved) {
        const year = updatedRequest.date.getFullYear();
        const month = updatedRequest.date.getMonth() + 1;

        // 드랍/대타는 운영 중인(발행된) 배차표에만 적용 — 초안 프로필에는 만들지 않음
        const schedule = await tx.schedule.findFirst({
          where: { companyId: req.user!.companyId, year, month, status: 'PUBLISHED' },
        });

        if (schedule) {
          const slot = await tx.scheduleSlot.findFirst({
            where: {
              scheduleId: schedule.id,
              driverId: updatedRequest.driverId,
              date: updatedRequest.date,
              isRestDay: false,
              status: 'SCHEDULED',
            },
          });

          if (slot) {
            const existingDrop = await tx.emergencyDrop.findUnique({ where: { slotId: slot.id } });
            if (!existingDrop) {
              const drop = await tx.emergencyDrop.create({
                data: {
                  slotId: slot.id,
                  driverId: updatedRequest.driverId,
                  reason: `휴무 승인 - ${updatedRequest.reason || '개인 사정'}`,
                  status: 'OPEN',
                },
              });

              await tx.scheduleSlot.update({
                where: { id: slot.id },
                data: { status: 'DROPPED' },
              });

              dropForEscalation = { id: drop.id, slotDate: slot.date, shift: slot.shift, routeId: slot.routeId };
              slotNotified = true;
            }
          }
        }
      }

      return updatedRequest;
    });

    // 트랜잭션 커밋 후 결원 처리 (fire-and-forget — 에이전트 또는 폴백)
    if (dropForEscalation) {
      const d = dropForEscalation;
      dispatchImmediateEmergency({
        dropId: d.id,
        slotDate: d.slotDate,
        shift: d.shift,
        companyId: req.user!.companyId,
        routeId: d.routeId,
      });
    }

    const dateFormatted = `${request.date.getMonth() + 1}월 ${request.date.getDate()}일`;

    // 기사에게 결과 알림
    await sendPushNotification(
      request.driver.id,
      isApproved ? '✅ 휴무 요청 승인' : '❌ 휴무 요청 거절',
      isApproved
        ? `${dateFormatted} 휴무가 승인되었습니다.${slotNotified ? ' 빈 슬롯이 다른 기사님들에게 공지됩니다.' : ''}`
        : `${dateFormatted} 휴무 요청이 거절되었습니다. 사유: ${reviewNote || '없음'}`,
      isApproved ? 'DAY_OFF_APPROVED' : 'DAY_OFF_REJECTED',
      { requestId: id }
    );

    // Socket.IO: 요청자에게 심사 결과 실시간 알림
    emitToUser(request.driver.id, 'dayoff:reviewed', {
      requestId: id,
      status,
      date: dateFormatted,
      reviewNote,
    });

    return res.json({ success: true, data: request, slotNotified });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const cancelDayOffRequest = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '요청 ID');
    if (id === null) return;

    const request = await prisma.dayOffRequest.findFirst({ where: { id, companyId: req.user!.companyId } });

    if (!request) {
      return res.status(404).json({ success: false, message: '요청을 찾을 수 없습니다.' });
    }

    // Drivers can only cancel their own requests
    if (req.user!.role === 'DRIVER' && request.driverId !== req.user!.id) {
      return res.status(403).json({ success: false, message: '권한이 없습니다.' });
    }

    if (request.status === 'APPROVED') {
      return res.status(400).json({ success: false, message: '승인된 요청은 취소할 수 없습니다. 관리자에게 문의하세요.' });
    }

    await prisma.dayOffRequest.delete({ where: { id } });

    return res.json({ success: true, message: '휴무 요청이 취소되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
