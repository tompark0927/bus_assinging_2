import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { getPagination, paginatedResponse } from '../utils/pagination';

// 표준 점검 항목 (도로교통법 기준)
export const INSPECTION_TEMPLATE = [
  { id: 'brake', name: '브레이크', category: '제동장치' },
  { id: 'tire', name: '타이어 상태/공기압', category: '주행장치' },
  { id: 'light_head', name: '전조등', category: '등화장치' },
  { id: 'light_signal', name: '방향지시등', category: '등화장치' },
  { id: 'light_brake', name: '제동등', category: '등화장치' },
  { id: 'wiper', name: '와이퍼', category: '시야확보' },
  { id: 'mirror', name: '사이드미러/후방카메라', category: '시야확보' },
  { id: 'engine_oil', name: '엔진오일', category: '오일류' },
  { id: 'coolant', name: '냉각수', category: '오일류' },
  { id: 'door', name: '승하차 도어 작동', category: '승객안전' },
  { id: 'fire_ext', name: '소화기', category: '안전장비' },
  { id: 'first_aid', name: '응급처치함', category: '안전장비' },
  { id: 'fuel', name: '연료량', category: '기타' },
  { id: 'cleanliness', name: '차량 청결', category: '기타' },
];

// 점검표 템플릿 반환
export const getTemplate = async (_req: AuthRequest, res: Response) => {
  return res.json({ success: true, data: INSPECTION_TEMPLATE });
};

// 점검 목록 조회
export const getInspections = async (req: AuthRequest, res: Response) => {
  try {
    const { date, busId, status } = req.query;
    const companyId = req.user!.companyId;

    const where: Record<string, unknown> = { companyId };
    if (date) where.date = new Date(date as string);
    if (busId) where.busId = Number(busId);
    if (status) where.status = status;

    const pagination = getPagination(req);
    const [inspections, total] = await Promise.all([
      prisma.dailyInspection.findMany({
        where,
        include: {
          bus: { select: { id: true, busNumber: true, plateNumber: true } },
          driver: { select: { id: true, name: true, employeeId: true } },
        },
        orderBy: { date: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.dailyInspection.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(inspections, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 점검 기록 제출 (upsert by busId+date)
export const submitInspection = async (req: AuthRequest, res: Response) => {
  try {
    const { busId, date, items, notes } = req.body;
    const companyId = req.user!.companyId;
    const driverId = req.user!.id;

    if (!busId || !date || !items) {
      return res.status(400).json({ success: false, message: '필수 항목을 입력해주세요.' });
    }

    // 버스 소속 확인
    const bus = await prisma.bus.findFirst({ where: { id: Number(busId), companyId } });
    if (!bus) return res.status(404).json({ success: false, message: '버스를 찾을 수 없습니다.' });

    // 불합격 항목 확인
    const itemList = items as Array<{ id: string; result: 'PASS' | 'FAIL' | 'N/A' }>;
    const hasFailed = itemList.some(i => i.result === 'FAIL');
    const status = hasFailed ? 'FAILED' : 'PASSED';

    const inspection = await prisma.dailyInspection.upsert({
      where: { busId_date: { busId: Number(busId), date: new Date(date) } },
      create: {
        companyId,
        busId: Number(busId),
        driverId: req.user!.role === 'DRIVER' ? driverId : Number(req.body.driverId || driverId),
        date: new Date(date),
        items,
        status,
        notes,
      },
      update: { items, status, notes },
      include: {
        bus: { select: { id: true, busNumber: true, plateNumber: true } },
        driver: { select: { id: true, name: true } },
      },
    });

    // (제거됨) 차량 점검 불합격 푸시 알림(INSPECTION_FAILED) — 발송하지 않음.

    return res.json({ success: true, data: inspection });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 점검 통계 (월별)
export const getInspectionStats = async (req: AuthRequest, res: Response) => {
  try {
    const { year, month } = req.query;
    const companyId = req.user!.companyId;

    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0);

    const [total, passed, failed, pending] = await Promise.all([
      prisma.dailyInspection.count({ where: { companyId, date: { gte: startDate, lte: endDate } } }),
      prisma.dailyInspection.count({ where: { companyId, date: { gte: startDate, lte: endDate }, status: 'PASSED' } }),
      prisma.dailyInspection.count({ where: { companyId, date: { gte: startDate, lte: endDate }, status: 'FAILED' } }),
      prisma.dailyInspection.count({ where: { companyId, date: { gte: startDate, lte: endDate }, status: 'PENDING' } }),
    ]);

    // 버스별 점검 현황
    const buses = await prisma.bus.findMany({
      where: { companyId, isActive: true },
      select: { id: true, busNumber: true },
    });

    const daysInMonth = new Date(Number(year), Number(month), 0).getDate();

    return res.json({
      success: true,
      data: {
        total, passed, failed, pending,
        passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
        expectedTotal: buses.length * daysInMonth,
        completionRate: buses.length > 0 ? Math.round((total / (buses.length * daysInMonth)) * 100) : 0,
      },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};
