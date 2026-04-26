import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { dispatchImmediateEmergency } from '../services/emergencyAgentRunner';
import logger from '../utils/logger';

const TICKET_EXPIRY_DAYS = 60;

/**
 * 골든 티켓 발급 (내부 함수 — 긴급 대타 수락 시 자동 호출)
 */
export const issueTicket = async (companyId: number, driverId: number, emergencyDropId: number) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TICKET_EXPIRY_DAYS);

  return prisma.goldenTicket.create({
    data: {
      companyId,
      driverId,
      earnedFrom: emergencyDropId,
      expiresAt,
    },
  });
};

export const getGoldenTickets = async (req: AuthRequest, res: Response) => {
  try {
    const isAdmin = ['OWNER', 'DIRECTOR', 'ADMIN', 'DISPATCH'].includes(req.user!.role);

    const where = isAdmin
      ? { companyId: req.user!.companyId }
      : { companyId: req.user!.companyId, driverId: req.user!.id };

    const tickets = await prisma.goldenTicket.findMany({
      where,
      include: {
        driver: { select: { id: true, name: true, employeeId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, data: tickets });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const useGoldenTicket = async (req: AuthRequest, res: Response) => {
  try {
    const ticketId = parseInt(req.params.id);
    if (isNaN(ticketId) || ticketId <= 0) {
      return res.status(400).json({ success: false, message: '유효하지 않은 티켓 ID입니다.' });
    }

    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ success: false, message: '사용할 날짜를 입력해주세요.' });
    }

    const ticket = await prisma.goldenTicket.findFirst({
      where: { id: ticketId, companyId: req.user!.companyId, driverId: req.user!.id },
    });

    if (!ticket) {
      return res.status(404).json({ success: false, message: '티켓을 찾을 수 없습니다.' });
    }

    if (ticket.isUsed) {
      return res.status(400).json({ success: false, message: '이미 사용된 티켓입니다.' });
    }

    if (new Date() > ticket.expiresAt) {
      return res.status(400).json({ success: false, message: '만료된 티켓입니다.' });
    }

    const useDate = new Date(date + 'T00:00:00');
    const year = useDate.getFullYear();
    const month = useDate.getMonth() + 1;
    const companyId = req.user!.companyId;
    const driverId = req.user!.id;

    // 트랜잭션으로 티켓 사용 + DayOffRequest 생성 + 슬롯 처리를 원자적으로
    let escalationInfo: { dropId: number; slotDate: Date; shift: string; routeId: number } | null = null;

    await prisma.$transaction(async (tx) => {
      // 1. 티켓 사용 처리
      await tx.goldenTicket.update({
        where: { id: ticketId },
        data: { isUsed: true, usedForDate: useDate },
      });

      // 2. DayOffRequest 자동 승인 생성
      await tx.dayOffRequest.create({
        data: {
          companyId,
          driverId,
          date: useDate,
          reason: `골든 티켓 사용 (티켓 #${ticketId})`,
          status: 'APPROVED',
          reviewNote: '골든 티켓으로 자동 승인',
        },
      });

      // 3. 해당 날짜에 배차 슬롯이 있으면 → EmergencyDrop 생성
      const schedule = await tx.schedule.findUnique({
        where: { companyId_year_month: { companyId, year, month } },
      });

      if (schedule) {
        const slot = await tx.scheduleSlot.findFirst({
          where: {
            scheduleId: schedule.id,
            driverId,
            date: useDate,
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
                driverId,
                reason: `골든 티켓 사용 (티켓 #${ticketId})`,
                status: 'OPEN',
              },
            });

            await tx.scheduleSlot.update({
              where: { id: slot.id },
              data: { status: 'DROPPED', isRestDay: true },
            });

            escalationInfo = { dropId: drop.id, slotDate: slot.date, shift: slot.shift, routeId: slot.routeId };
          }
        }
      }
    });

    // 트랜잭션 성공 후 결원 처리 (fire-and-forget — 에이전트 또는 폴백)
    if (escalationInfo !== null) {
      const info = escalationInfo as { dropId: number; slotDate: Date; shift: string; routeId: number };
      dispatchImmediateEmergency({
        dropId: info.dropId,
        slotDate: info.slotDate,
        shift: info.shift,
        companyId,
        routeId: info.routeId,
      });
    }

    return res.json({ success: true, message: '골든 티켓이 사용되었습니다. 해당 날짜 휴무가 자동 처리됩니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
