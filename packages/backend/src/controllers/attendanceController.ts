import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { getPagination, paginatedResponse } from '../utils/pagination';

// 시프트별 근무시간 (시간)
const SHIFT_HOURS: Record<string, number> = {
  FULL_DAY: 8,
  MORNING: 4,
  AFTERNOON: 4,
};

// 월별 근태 목록
export const getAttendance = async (req: AuthRequest, res: Response) => {
  try {
    const { year, month, driverId } = req.query;
    const companyId = req.user!.companyId;

    if (!year || !month || isNaN(Number(year)) || isNaN(Number(month))) {
      return res.status(400).json({ success: false, message: 'year, month 파라미터가 필요합니다.' });
    }

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0);

    const where: Record<string, unknown> = {
      companyId,
      date: { gte: startDate, lte: endDate },
    };
    if (driverId) {
      // 멀티테넌시: 다른 회사 기사 조회 방지
      const targetDriver = await prisma.user.findFirst({
        where: { id: Number(driverId), companyId },
      });
      if (!targetDriver) {
        return res.status(403).json({ success: false, message: '해당 기사를 조회할 수 없습니다.' });
      }
      where.driverId = Number(driverId);
    }

    const pagination = getPagination(req);
    const [records, total] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where,
        include: { driver: { select: { id: true, name: true, employeeId: true } } },
        orderBy: [{ date: 'asc' }, { driverId: 'asc' }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.attendanceRecord.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(records, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 근태 기록 생성/수정 (upsert)
export const upsertAttendance = async (req: AuthRequest, res: Response) => {
  try {
    const { driverId, date, checkIn, checkOut, status, notes } = req.body;
    const companyId = req.user!.companyId;

    // Verify driver belongs to same company
    const driver = await prisma.user.findFirst({ where: { id: Number(driverId), companyId } });
    if (!driver) {
      return res.status(404).json({ success: false, message: '기사를 찾을 수 없습니다.' });
    }

    const record = await prisma.attendanceRecord.upsert({
      where: { driverId_date: { driverId: Number(driverId), date: new Date(date) } },
      create: {
        companyId,
        driverId: Number(driverId),
        date: new Date(date),
        checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null,
        status: status || 'PRESENT',
        notes,
      },
      update: {
        checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null,
        status: status || 'PRESENT',
        notes,
      },
      include: { driver: { select: { id: true, name: true, employeeId: true } } },
    });

    return res.json({ success: true, data: record });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 주 52시간 현황 분석
export const getWeeklyHoursAnalysis = async (req: AuthRequest, res: Response) => {
  try {
    const { year, month } = req.query;
    const companyId = req.user!.companyId;

    if (!year || !month || isNaN(Number(year)) || isNaN(Number(month))) {
      return res.status(400).json({ success: false, message: 'year, month 파라미터가 필요합니다.' });
    }

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0);

    const slots = await prisma.scheduleSlot.findMany({
      where: {
        schedule: { companyId },
        date: { gte: startDate, lte: endDate },
        isRestDay: false,
      },
      include: {
        driver: { select: { id: true, name: true, employeeId: true } },
      },
    });

    // 기사별 주별 근무시간 계산
    const driverWeekMap: Record<number, Record<number, { hours: number; days: number; driverName: string; employeeId: string }>> = {};

    for (const slot of slots) {
      const d = new Date(slot.date);
      const weekNum = getWeekNumber(d);
      const dId = slot.driverId;

      if (!driverWeekMap[dId]) driverWeekMap[dId] = {};
      if (!driverWeekMap[dId][weekNum]) {
        driverWeekMap[dId][weekNum] = {
          hours: 0,
          days: 0,
          driverName: slot.driver.name,
          employeeId: slot.driver.employeeId,
        };
      }

      driverWeekMap[dId][weekNum].hours += SHIFT_HOURS[slot.shift] || 8;
      driverWeekMap[dId][weekNum].days += 1;
    }

    // 52시간 초과 경고 목록
    const warnings: Array<{
      driverId: number;
      driverName: string;
      employeeId: string;
      week: number;
      hours: number;
      days: number;
    }> = [];

    for (const [dId, weekMap] of Object.entries(driverWeekMap)) {
      for (const [week, data] of Object.entries(weekMap)) {
        if (data.hours > 52) {
          warnings.push({
            driverId: Number(dId),
            driverName: data.driverName,
            employeeId: data.employeeId,
            week: Number(week),
            hours: data.hours,
            days: data.days,
          });
        }
      }
    }

    // 드라이버별 월 합계
    const driverSummary = Object.entries(driverWeekMap).map(([dId, weekMap]) => {
      const weeks = Object.entries(weekMap).map(([w, d]) => ({ week: Number(w), ...d }));
      const totalHours = weeks.reduce((s, w) => s + w.hours, 0);
      const maxWeekHours = Math.max(...weeks.map(w => w.hours));
      const { driverName, employeeId } = weeks[0];
      return {
        driverId: Number(dId),
        driverName,
        employeeId,
        totalHours,
        maxWeekHours,
        isOver52h: maxWeekHours > 52,
        weeks,
      };
    });

    return res.json({
      success: true,
      data: {
        summary: driverSummary,
        warnings,
        warningCount: warnings.length,
      },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// GPS 출근 체크인
export const gpsCheckIn = async (req: AuthRequest, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user!.id;
    const companyId = req.user!.companyId;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 트랜잭션으로 이중 체크인 방지
    const record = await prisma.$transaction(async (tx) => {
      const existing = await tx.attendanceRecord.findFirst({
        where: { driverId: userId, date: today, companyId },
      });

      if (existing?.checkIn) {
        throw new Error('ALREADY_CHECKED_IN');
      }

      return tx.attendanceRecord.upsert({
        where: { driverId_date: { driverId: userId, date: today } },
        create: {
          companyId,
          driverId: userId,
          date: today,
          checkIn: now,
          checkInLat: latitude,
          checkInLng: longitude,
          checkInMethod: 'GPS',
          status: 'PRESENT',
        },
        update: {
          checkIn: now,
          checkInLat: latitude,
          checkInLng: longitude,
          checkInMethod: 'GPS',
          status: 'PRESENT',
        },
      });
    });

    return res.json({ success: true, data: record });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'ALREADY_CHECKED_IN') {
      return res.status(400).json({ success: false, message: '이미 출근 처리되었습니다.' });
    }
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// GPS 퇴근 체크아웃
export const gpsCheckOut = async (req: AuthRequest, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user!.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.attendanceRecord.findFirst({
      where: { driverId: userId, date: today, companyId: req.user!.companyId },
    });

    if (!existing?.checkIn) {
      return res.status(400).json({ success: false, message: '출근 기록이 없습니다. 먼저 출근해주세요.' });
    }

    if (existing.checkOut) {
      return res.status(400).json({ success: false, message: '이미 퇴근 처리되었습니다.' });
    }

    const record = await prisma.attendanceRecord.update({
      where: { driverId_date: { driverId: userId, date: today } },
      data: {
        checkOut: new Date(),
        checkOutLat: latitude,
        checkOutLng: longitude,
        checkOutMethod: 'GPS',
      },
    });

    return res.json({ success: true, data: record });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 오늘 내 출퇴근 상태 조회
export const getMyTodayStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const record = await prisma.attendanceRecord.findFirst({
      where: { driverId: userId, date: today, companyId: req.user!.companyId },
    });

    return res.json({
      success: true,
      data: record || { checkIn: null, checkOut: null, status: null },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
