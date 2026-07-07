import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { generateMonthlySchedule, getScheduleWithSlots, resolveMonthScheduleId, uniqueScheduleName, updateSlot, validateRestTime } from '../services/scheduleService';
import { generateScheduleExcel } from '../services/excelService';
import { sendBulkPushNotifications } from '../services/notificationService';
import { generateScheduleWithAI } from '../services/aiService';
import logger from '../utils/logger';
import { parseIdParam } from '../utils/helpers';
import { createAuditLog } from '../utils/auditLog';
import { getPagination, paginatedResponse } from '../utils/pagination';
import { emitToCompany } from '../services/socketService';

export const getScheduleList = async (req: AuthRequest, res: Response) => {
  try {
    const where = { companyId: req.user!.companyId };
    const pagination = getPagination(req);
    const [schedules, total] = await Promise.all([
      prisma.schedule.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        select: {
          id: true, year: true, month: true, status: true, createdAt: true,
          _count: { select: { slots: true } },
        },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.schedule.count({ where }),
    ]);
    return res.json({ success: true, ...paginatedResponse(schedules, total, pagination) });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const getSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    // 기사 앱은 ?mine=1 을 항상 보냄 → 역할과 무관하게 "본인 슬롯"만 반환.
    // (DRIVER 가 아닌 계정으로 기사 앱에 로그인해도 회사 전체 배차표가 노출되지 않도록 방어)
    const mineOnly = req.query.mine === '1' || req.user!.role === 'DRIVER';
    if (mineOnly) {
      // 기사에게는 발행된 배차표만 노출 (초안 프로필은 관리자 전용)
      const schedule = await prisma.schedule.findFirst({
        where: { companyId: req.user!.companyId, year, month, status: 'PUBLISHED' },
        include: {
          slots: {
            where: { driverId: req.user!.id },
            include: { route: true, bus: true, emergencyDrop: true },
            orderBy: { date: 'asc' },
          },
        },
      });
      return res.json({ success: true, data: schedule });
    }

    // 관리자: ?scheduleId= 로 특정 초안 프로필 선택. 미지정 시 발행본 우선 → 최근 초안.
    const scheduleIdParam = parseInt(String(req.query.scheduleId ?? ''), 10);
    const schedule = await getScheduleWithSlots(
      req.user!.companyId,
      year,
      month,
      Number.isFinite(scheduleIdParam) && scheduleIdParam > 0 ? scheduleIdParam : undefined,
    );
    return res.json({ success: true, data: schedule });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 기사 본인의 월간 활동 요약 (운행일 / 휴무일 / 대타 수락)
// ─────────────────────────────────────────
export const getMyMonthlySummary = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    // 본인 슬롯만 조회 (status/isRestDay 만 필요) — 발행된 배차표 기준
    const schedule = await prisma.schedule.findFirst({
      where: { companyId: req.user!.companyId, year, month, status: 'PUBLISHED' },
      include: {
        slots: {
          where: { driverId: req.user!.id },
          select: { isRestDay: true, status: true },
        },
      },
    });

    // 내 배차 화면과 동일한 병합 규칙: 드랍은 휴무로 집계
    const slots = schedule?.slots ?? [];
    const isRest = (s: { isRestDay: boolean; status: string }) =>
      s.isRestDay || s.status === 'DROPPED';
    const workDays = slots.filter((s) => !isRest(s)).length;
    const restDays = slots.filter((s) => isRest(s)).length;

    // @db.Date 는 UTC 자정으로 저장 → UTC 기준 월 범위로 비교
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1)); // 다음 달 1일

    const acceptedSubstitutes = await prisma.emergencyDrop.count({
      where: {
        filledBy: req.user!.id,
        status: 'FILLED',
        slot: { date: { gte: monthStart, lt: monthEnd } },
      },
    });

    return res.json({
      success: true,
      data: { year, month, workDays, restDays, acceptedSubstitutes },
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const generateSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const { year, month, workDays, restDays } = req.body;

    if (!year || !month) {
      return res.status(400).json({ success: false, message: '연도와 월을 입력해주세요.' });
    }

    // ── DB에서 활성 CompanyRule 자동 로드 ──
    const companyRules = await prisma.companyRule.findMany({
      where: { companyId: req.user!.companyId, isActive: true },
    });

    // work-pattern 카테고리에서 workDays/restDays 추출 (요청 body 우선)
    let ruleWorkDays = workDays;
    let ruleRestDays = restDays;
    const customRuleTexts: string[] = [];

    for (const rule of companyRules) {
      const parsed = rule.parsedData as Record<string, unknown> | null;
      if (parsed) {
        if (!ruleWorkDays && parsed.workDays) ruleWorkDays = Number(parsed.workDays);
        if (!ruleRestDays && parsed.restDays) ruleRestDays = Number(parsed.restDays);
      }
      customRuleTexts.push(`[${rule.category}] ${rule.title}: ${rule.content}`);
    }

    const result = await generateMonthlySchedule(req.user!.companyId, year, month, req.user!.id, {
      workDays: ruleWorkDays || 5,
      restDays: ruleRestDays || 2,
      customRules: customRuleTexts.length > 0 ? customRuleTexts.join('\n') : undefined,
    });

    return res.status(201).json({
      success: true,
      data: {
        scheduleId: result.scheduleId,
        slotsCreated: result.slotsCreated,
        warnings: result.warnings,
        fairnessReport: result.fairnessReport,
      },
      message: `${year}년 ${month}월 배차표가 생성되었습니다. (${result.slotsCreated}개 슬롯)`,
    });
  } catch (error) {
    logger.error(error);
    // 내부 오류 문구(영문/기술 상세)는 사용자에게 그대로 노출하지 않음
    if (error instanceof Error && /[가-힣]/.test(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const updateScheduleSlot = async (req: AuthRequest, res: Response) => {
  try {
    const slotId = parseIdParam(req.params.slotId, res, '슬롯 ID');
    if (slotId === null) return;
    const { driverId, routeId, busId, shift, status, isRestDay, notes, expectedUpdatedAt } = req.body;

    const existingSlot = await prisma.scheduleSlot.findUnique({
        where: { id: slotId },
        include: { schedule: { select: { companyId: true, status: true } } }
    });
    if (!existingSlot || existingSlot.schedule.companyId !== req.user!.companyId) {
      return res.status(404).json({ success: false, message: '슬롯을 찾을 수 없습니다.' });
    }
    if (existingSlot.schedule.status === 'PUBLISHED') {
      return res.status(400).json({
        success: false,
        message: '발행된 배차표의 슬롯은 수정할 수 없습니다. 먼저 배차표를 초안으로 되돌려주세요.',
      });
    }

    // Optimistic locking: 다른 사람이 이미 수정했으면 충돌 알림
    if (expectedUpdatedAt) {
      const expectedTime = new Date(expectedUpdatedAt).getTime();
      const actualTime = existingSlot.updatedAt.getTime();
      if (Math.abs(expectedTime - actualTime) > 1000) {
        return res.status(409).json({
          success: false,
          message: '다른 사용자가 이 슬롯을 이미 수정했습니다. 새로고침 후 다시 시도해주세요.',
          conflict: true,
          serverUpdatedAt: existingSlot.updatedAt,
        });
      }
    }

    // Build changes diff for audit
    const auditChanges: Record<string, { old: unknown; new: unknown }> = {};
    if (driverId !== undefined) auditChanges.driverId = { old: existingSlot.driverId, new: driverId };
    if (routeId !== undefined) auditChanges.routeId = { old: existingSlot.routeId, new: routeId };
    if (busId !== undefined) auditChanges.busId = { old: existingSlot.busId, new: busId };
    if (shift !== undefined) auditChanges.shift = { old: existingSlot.shift, new: shift };
    if (status !== undefined) auditChanges.status = { old: existingSlot.status, new: status };
    if (isRestDay !== undefined) auditChanges.isRestDay = { old: existingSlot.isRestDay, new: isRestDay };
    if (notes !== undefined) auditChanges.notes = { old: existingSlot.notes, new: notes };

    const slot = await updateSlot(slotId, { driverId, routeId, busId, shift, status, isRestDay, notes });

    await createAuditLog({
      req: req as any,
      action: 'UPDATE',
      entityType: 'ScheduleSlot',
      entityId: slotId,
      changes: auditChanges,
    });

    return res.json({ success: true, data: slot });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

/**
 * 빈 셀에 배차(슬롯) 수동 추가 — 초안(DRAFT) 배차표 한정.
 * POST /api/schedules/slots
 */
export const createScheduleSlot = async (req: AuthRequest, res: Response) => {
  try {
    const { scheduleId, driverId, date, routeId, busId, shift, isRestDay, notes } = req.body;
    if (!scheduleId || !driverId || !date || !routeId) {
      return res.status(400).json({ success: false, message: '배차표, 기사, 날짜, 노선은 필수입니다.' });
    }

    const schedule = await prisma.schedule.findFirst({
      where: { id: Number(scheduleId), companyId: req.user!.companyId },
      select: { id: true, status: true },
    });
    if (!schedule) {
      return res.status(404).json({ success: false, message: '배차표를 찾을 수 없습니다.' });
    }
    if (schedule.status === 'PUBLISHED') {
      return res.status(400).json({ success: false, message: '발행된 배차표에는 배차를 추가할 수 없습니다. 먼저 초안으로 되돌려주세요.' });
    }

    const slotDate = new Date(date);
    // 셀당 1개 — 같은 기사·날짜에 이미 슬롯이 있으면 거부 (ScheduleSlot 은 테넌트 모델 아님 → findFirst 안전)
    const dup = await prisma.scheduleSlot.findFirst({
      where: { scheduleId: schedule.id, driverId: Number(driverId), date: slotDate },
      select: { id: true },
    });
    if (dup) {
      return res.status(409).json({ success: false, message: '해당 기사의 그 날짜에는 이미 배차가 있습니다.' });
    }

    const slot = await prisma.scheduleSlot.create({
      data: {
        scheduleId: schedule.id,
        driverId: Number(driverId),
        routeId: Number(routeId),
        busId: busId ? Number(busId) : null,
        date: slotDate,
        shift: shift || 'FULL_DAY',
        isRestDay: !!isRestDay,
        status: 'SCHEDULED',
        isManualOverride: true,
        overrideBy: req.user!.id,
        notes: notes || null,
      },
    });

    await createAuditLog({
      req: req as any,
      action: 'CREATE',
      entityType: 'ScheduleSlot',
      entityId: slot.id,
      changes: {
        driverId: { old: null, new: driverId },
        routeId: { old: null, new: routeId },
        date: { old: null, new: date },
      },
    });

    return res.status(201).json({ success: true, data: slot });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

/**
 * 수동 오버라이드 — 법적 휴식시간 검증 포함
 * PUT /api/schedules/slots/:slotId/override
 */
export const manualOverrideSlot = async (req: AuthRequest, res: Response) => {
  try {
    const slotId = parseIdParam(req.params.slotId, res, '슬롯 ID');
    if (slotId === null) return;
    const { driverId, routeId, busId, shift, overrideReason, forceApprove, expectedUpdatedAt } = req.body;

    const existingSlot = await prisma.scheduleSlot.findUnique({
      where: { id: slotId },
      include: { schedule: { select: { id: true, companyId: true, status: true } } },
    });
    if (!existingSlot || existingSlot.schedule.companyId !== req.user!.companyId) {
      return res.status(404).json({ success: false, message: '슬롯을 찾을 수 없습니다.' });
    }
    if (existingSlot.schedule.status === 'PUBLISHED') {
      return res.status(400).json({ success: false, message: '발행된 배차표는 수정할 수 없습니다.' });
    }

    // Optimistic locking: 동시 편집 충돌 감지
    if (expectedUpdatedAt) {
      const expectedTime = new Date(expectedUpdatedAt).getTime();
      const actualTime = existingSlot.updatedAt.getTime();
      if (Math.abs(expectedTime - actualTime) > 1000) {
        return res.status(409).json({
          success: false,
          message: '다른 사용자가 이 슬롯을 이미 수정했습니다. 새로고침 후 다시 시도해주세요.',
          conflict: true,
          serverUpdatedAt: existingSlot.updatedAt,
        });
      }
    }

    const targetDriverId = driverId || existingSlot.driverId;

    // 법적 휴식시간 검증
    const restCheck = await validateRestTime(targetDriverId, new Date(existingSlot.date), existingSlot.schedule.id);

    if (!restCheck.valid && !forceApprove) {
      return res.status(409).json({
        success: false,
        message: '법적 휴식시간 위반 가능성이 있습니다.',
        restWarnings: restCheck.warnings,
        requireForceApprove: true,
      });
    }

    const updateData: Record<string, unknown> = {
      isManualOverride: true,
      overrideBy: req.user!.id,
      overrideReason: overrideReason || null,
    };
    if (driverId !== undefined) updateData.driverId = driverId;
    if (routeId !== undefined) updateData.routeId = routeId;
    if (busId !== undefined) updateData.busId = busId;
    if (shift !== undefined) updateData.shift = shift;

    if (forceApprove && !restCheck.valid) {
      updateData.fairnessNote = `⚠️ 강제 승인: ${restCheck.warnings.join(', ')} — 사유: ${overrideReason || '미입력'}`;
    }

    const slot = await updateSlot(slotId, updateData);

    await createAuditLog({
      req: req as any,
      action: 'UPDATE',
      entityType: 'ScheduleSlot',
      entityId: slotId,
      changes: {
        manualOverride: { old: false, new: true },
        forceApprove: { old: null, new: forceApprove || false },
        restWarnings: { old: null, new: restCheck.warnings },
        overrideReason: { old: null, new: overrideReason },
      },
    });

    return res.json({ success: true, data: slot, restWarnings: restCheck.warnings });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const publishSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    // 멀티 초안: body.scheduleId 로 발행할 초안 프로필을 지정. 미지정 시 최근 초안.
    const bodyScheduleId = Number((req.body as { scheduleId?: number } | undefined)?.scheduleId);
    const existing = bodyScheduleId > 0
      ? await prisma.schedule.findFirst({
          where: { id: bodyScheduleId, companyId: req.user!.companyId, year, month },
        })
      : await prisma.schedule.findFirst({
          where: { companyId: req.user!.companyId, year, month, status: 'DRAFT' },
          orderBy: { updatedAt: 'desc' },
        });
    if (!existing) {
      return res.status(404).json({ success: false, message: '배차표를 찾을 수 없습니다.' });
    }
    if (existing.status === 'PUBLISHED') {
      return res.status(400).json({ success: false, message: '이미 발행된 배차표입니다.' });
    }

    // 발행본은 월당 1개만 — 다른 초안이 이미 발행되어 있으면 차단
    const alreadyPublished = await prisma.schedule.findFirst({
      where: { companyId: req.user!.companyId, year, month, status: 'PUBLISHED' },
      select: { id: true, name: true },
    });
    if (alreadyPublished) {
      return res.status(400).json({
        success: false,
        message: `이미 발행된 ${year}년 ${month}월 배차표가 있습니다. 기존 발행본을 삭제한 후 발행해주세요.`,
      });
    }

    const schedule = await prisma.schedule.update({
      where: { id: existing.id },
      data: { status: 'PUBLISHED' },
    });

    await createAuditLog({
      req: req as any,
      action: 'UPDATE',
      entityType: 'Schedule',
      entityId: schedule.id,
      changes: {
        status: { old: existing.status, new: 'PUBLISHED' },
        year: { old: null, new: year },
        month: { old: null, new: month },
      },
    });

    // Notify all drivers
    const drivers = await prisma.user.findMany({
      where: { role: 'DRIVER', isActive: true, companyId: req.user!.companyId },
      select: { id: true },
    });

    await sendBulkPushNotifications(
      drivers.map(d => d.id),
      '📅 배차표 발행',
      `${year}년 ${month}월 배차표가 발행되었습니다. 확인해주세요!`,
      'SCHEDULE_PUBLISHED',
      { year, month }
    );

    // Socket.IO: 회사 전체에 배차표 발행 알림
    emitToCompany(req.user!.companyId, 'schedule:published', {
      year,
      month,
      scheduleId: schedule.id,
    });

    return res.json({
      success: true,
      data: schedule,
      message: `${year}년 ${month}월 배차표가 발행되었습니다.`,
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const deleteSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    // 멀티 초안: ?scheduleId= 로 삭제할 배차표(초안/발행본)를 지정. 미지정 시 발행본 우선 → 최근 초안.
    const scheduleIdParam = parseInt(String(req.query.scheduleId ?? ''), 10);
    const resolvedId = await resolveMonthScheduleId(
      req.user!.companyId,
      year,
      month,
      Number.isFinite(scheduleIdParam) && scheduleIdParam > 0 ? scheduleIdParam : undefined,
    );
    const schedule = resolvedId
      ? await prisma.schedule.findFirst({ where: { id: resolvedId, companyId: req.user!.companyId } })
      : null;

    if (!schedule) {
      return res.status(404).json({ success: false, message: '배차표를 찾을 수 없습니다.' });
    }

    if (schedule.status === 'ARCHIVED') {
      return res.status(400).json({ success: false, message: '보관된 배차표는 삭제할 수 없습니다.' });
    }

    // 슬롯에 연결된 대타 요청부터 정리 (FK 제약) 후 슬롯·배차표 삭제
    await prisma.$transaction([
      prisma.emergencyDrop.deleteMany({ where: { slot: { scheduleId: schedule.id } } }),
      prisma.scheduleSlot.deleteMany({ where: { scheduleId: schedule.id } }),
      prisma.schedule.delete({ where: { id: schedule.id } }),
    ]);

    await createAuditLog({
      req: req as any,
      action: 'DELETE',
      entityType: 'Schedule',
      entityId: schedule.id,
      changes: {
        status: { old: schedule.status, new: null },
        year: { old: year, new: null },
        month: { old: month, new: null },
      },
    });

    return res.json({ success: true, message: '배차표가 삭제되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 월의 모든 배차표(초안 프로필 + 발행본) 목록 — 발행본 먼저, 이후 최근 수정순
export const listMonthSchedules = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    const schedules = await prisma.schedule.findMany({
      where: { companyId: req.user!.companyId, year, month },
      select: {
        id: true,
        name: true,
        status: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { slots: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const sorted = [
      ...schedules.filter((s) => s.status === 'PUBLISHED'),
      ...schedules.filter((s) => s.status !== 'PUBLISHED'),
    ];

    return res.json({
      success: true,
      data: sorted.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        notes: s.notes,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        slotCount: s._count.slots,
      })),
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 배차표 프로필 이름 변경
export const renameSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '배차표 ID');
    if (id === null) return;

    const name = String((req.body as { name?: string } | undefined)?.name ?? '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: '이름을 입력해주세요.' });
    }

    const existing = await prisma.schedule.findFirst({
      where: { id, companyId: req.user!.companyId },
      select: { id: true, name: true, year: true, month: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: '배차표를 찾을 수 없습니다.' });
    }

    // 같은 달 안에서 이름 중복 방지
    const dup = await prisma.schedule.findFirst({
      where: {
        companyId: req.user!.companyId,
        year: existing.year,
        month: existing.month,
        name: name.slice(0, 50),
        id: { not: existing.id },
      },
      select: { id: true },
    });
    if (dup) {
      return res.status(409).json({ success: false, message: '같은 달에 이미 같은 이름의 배차표가 있습니다. 다른 이름을 사용해주세요.' });
    }

    const updated = await prisma.schedule.update({
      where: { id: existing.id },
      data: { name: name.slice(0, 50) },
    });

    await createAuditLog({
      req: req as any,
      action: 'UPDATE',
      entityType: 'Schedule',
      entityId: existing.id,
      changes: { name: { old: existing.name, new: updated.name } },
    });

    return res.json({ success: true, data: updated, message: '이름이 변경되었습니다.' });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// 배차표 복제 — 초안 프로필 사본 생성 (슬롯 포함, 상태는 SCHEDULED 로 초기화)
export const duplicateSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdParam(req.params.id, res, '배차표 ID');
    if (id === null) return;

    const src = await prisma.schedule.findFirst({
      where: { id, companyId: req.user!.companyId },
      include: { slots: true },
    });
    if (!src) {
      return res.status(404).json({ success: false, message: '배차표를 찾을 수 없습니다.' });
    }

    const draftCount = await prisma.schedule.count({
      where: { companyId: req.user!.companyId, year: src.year, month: src.month, status: 'DRAFT' },
    });
    if (draftCount >= 5) {
      return res.status(400).json({
        success: false,
        message: '이 달의 초안이 이미 5개입니다. 사용하지 않는 초안을 삭제한 후 복제해주세요.',
      });
    }

    const copy = await prisma.$transaction(async (tx) => {
      const name = await uniqueScheduleName(
        req.user!.companyId,
        src.year,
        src.month,
        `${src.name} (사본)`,
        tx,
      );
      const created = await tx.schedule.create({
        data: {
          companyId: req.user!.companyId,
          year: src.year,
          month: src.month,
          name,
          status: 'DRAFT',
          createdBy: req.user!.id,
          notes: src.notes,
        },
      });
      if (src.slots.length > 0) {
        await tx.scheduleSlot.createMany({
          data: src.slots.map((s) => ({
            scheduleId: created.id,
            driverId: s.driverId,
            routeId: s.routeId,
            busId: s.busId,
            date: s.date,
            shift: s.shift,
            // 운영 상태(드랍/충원/완료)는 원본 슬롯의 이력이므로 사본은 예정 상태로 초기화
            status: 'SCHEDULED' as const,
            isRestDay: s.isRestDay,
            isManualOverride: s.isManualOverride,
            overrideReason: s.overrideReason,
            overrideBy: s.overrideBy,
            fairnessNote: s.fairnessNote,
            notes: s.notes,
          })),
        });
      }
      return created;
    });

    await createAuditLog({
      req: req as any,
      action: 'CREATE',
      entityType: 'Schedule',
      entityId: copy.id,
      changes: {
        duplicatedFrom: { old: null, new: src.id },
        name: { old: null, new: copy.name },
      },
    });

    return res.status(201).json({
      success: true,
      data: copy,
      message: `'${src.name}' 초안이 복제되었습니다.`,
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const exportScheduleExcel = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    const scheduleIdParam = parseInt(String(req.query.scheduleId ?? ''), 10);
    const buffer = await generateScheduleExcel(
      req.user!.companyId,
      year,
      month,
      Number.isFinite(scheduleIdParam) && scheduleIdParam > 0 ? scheduleIdParam : undefined,
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const company = await prisma.company.findUnique({ where: { id: req.user!.companyId }, select: { code: true } });
    const companyCode = (company?.code || 'schedule').toLowerCase();
    res.setHeader('Content-Disposition', `attachment; filename="${companyCode}_schedule_${year}_${month}.xlsx"`);

    return res.send(buffer);
  } catch (error) {
    logger.error(error);
    // 내부 오류 문구(영문/기술 상세)는 사용자에게 그대로 노출하지 않음
    if (error instanceof Error && /[가-힣]/.test(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

export const getAIRecommendations = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const { notes } = req.body;

    const result = await generateScheduleWithAI(req.user!.companyId, year, month, notes || '');

    return res.json({ success: true, data: result });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: 'AI 서비스 오류가 발생했습니다.' });
  }
};

/**
 * GET /api/schedules/:year/:month/bis-export
 * 지자체 BIS (버스정보시스템) 연동을 위한 표준화된 배차표 JSON 반환
 * 실제 지자체 연동 시 해당 기관의 API 규격에 맞게 수정 필요
 */
export const bisExport = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    // 발행본 우선 → 최근 초안 (멀티 초안 지원)
    const resolvedId = await resolveMonthScheduleId(req.user!.companyId, year, month);
    const schedule = resolvedId
      ? await prisma.schedule.findFirst({
          where: { id: resolvedId, companyId: req.user!.companyId },
          include: {
            slots: {
              where: { isRestDay: false },
              include: {
                driver: { select: { id: true, employeeId: true, name: true, licenseNumber: true } },
                route: { select: { routeNumber: true, name: true, startPoint: true, endPoint: true } },
                bus: { select: { busNumber: true, plateNumber: true } },
              },
              orderBy: [{ date: 'asc' }, { route: { routeNumber: 'asc' } }],
            },
          },
        })
      : null;

    if (!schedule) {
      return res.status(404).json({ success: false, message: '배차표를 찾을 수 없습니다.' });
    }

    // Format for BIS standard (customizable per municipal contract)
    const bisPayload = {
      company: (await prisma.company.findUnique({ where: { id: req.user!.companyId }, select: { name: true } }))?.name || 'Unknown',
      exportedAt: new Date().toISOString(),
      period: { year, month },
      scheduleStatus: schedule.status,
      slotCount: schedule.slots.length,
      slots: schedule.slots.map(slot => ({
        date: slot.date,
        routeNumber: slot.route.routeNumber,
        routeName: slot.route.name,
        startPoint: slot.route.startPoint,
        endPoint: slot.route.endPoint,
        driverEmployeeId: slot.driver.employeeId,
        driverName: slot.driver.name,
        driverLicense: slot.driver.licenseNumber,
        busNumber: slot.bus?.busNumber,
        busPlate: slot.bus?.plateNumber,
      })),
    };

    return res.json({ success: true, data: bisPayload });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: 'BIS 내보내기 실패' });
  }
};

