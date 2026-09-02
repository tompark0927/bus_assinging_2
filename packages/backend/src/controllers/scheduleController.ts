import { Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { generateMonthlySchedule, getScheduleWithSlots, resolveMonthScheduleId, resolveMonthScheduleIdsAllTypes, uniqueScheduleName, updateSlot, validateRestTime } from '../services/scheduleService';
import { generateScheduleExcel } from '../services/excelService';
import { sendBulkPushNotifications } from '../services/notificationService';
import { generateScheduleWithAI } from '../services/aiService';
import logger from '../utils/logger';
import { parseIdParam } from '../utils/helpers';
import { createAuditLog } from '../utils/auditLog';
import { getPagination, paginatedResponse } from '../utils/pagination';
import { emitToCompany } from '../services/socketService';
import { inspectScheduleForPublish } from '../services/publishInspectionService';
import { parseServiceType, serviceTypeLabel } from '../utils/serviceType';

export const getScheduleList = async (req: AuthRequest, res: Response) => {
  try {
    const where = { companyId: req.user!.companyId };
    const pagination = getPagination(req);
    const [schedules, total] = await Promise.all([
      prisma.schedule.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        select: {
          id: true, year: true, month: true, status: true, serviceType: true, createdAt: true,
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
      // 기사에게는 발행된 배차표만 노출 (초안 프로필은 관리자 전용).
      // 간선·지선·광역이 각각 따로 발행되므로 그 달 발행본은 여러 개일 수 있다.
      // 기사의 슬롯을 **전부 합쳐서** 돌려준다 — 하나만 골라 주면 월 중 종류를
      // 옮겼거나 옛 '전체' 발행본이 남아 있을 때 나머지 근무일이 앱에서 통째로
      // 사라진다(기사는 "그 뒤로 배차가 없네" 하고 출근하지 않는다).
      // getMyMonthlySummary 도 같은 기준으로 합산한다 — 두 화면의 숫자가
      // 어긋나지 않게 술어를 반드시 같이 유지할 것.
      const published = await prisma.schedule.findMany({
        where: { companyId: req.user!.companyId, year, month, status: 'PUBLISHED' },
        include: {
          slots: {
            where: { driverId: req.user!.id },
            include: { route: true, bus: true, emergencyDrop: true },
            orderBy: { date: 'asc' },
          },
        },
      });
      // 배차표 메타(id/status)는 내 슬롯이 있는 것을 대표로 쓴다. 기사 앱은
      // slots 만 보지만 응답 형태는 종전과 같게 유지한다.
      const base = published.find((p) => p.slots.length > 0) ?? published[0] ?? null;
      const mine = base
        ? {
            ...base,
            slots: published
              .flatMap((p) => p.slots)
              .sort((a, b) => a.date.getTime() - b.date.getTime()),
          }
        : null;
      return res.json({ success: true, data: mine });
    }

    // 관리자: ?scheduleId= 로 특정 초안 프로필 선택. 미지정 시 발행본 우선 → 최근 초안.
    // ?serviceType= 은 간선/지선/광역 탭 — 미지정이면 '전체'(구분 없음) 버킷.
    const scheduleIdParam = parseInt(String(req.query.scheduleId ?? ''), 10);
    const schedule = await getScheduleWithSlots(
      req.user!.companyId,
      year,
      month,
      Number.isFinite(scheduleIdParam) && scheduleIdParam > 0 ? scheduleIdParam : undefined,
      parseServiceType(req.query.serviceType),
    );
    return res.json({ success: true, data: schedule });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
};

// ─────────────────────────────────────────
// 월 배차표 통합 조회 — 노선 종류를 가로질러 합친다
// ─────────────────────────────────────────
/**
 * 대시보드·오늘 운행 현황처럼 "회사가 이번 달 어떻게 굴러가나"를 보는 화면용.
 *
 * 간선·지선·광역이 따로 발행되면서 그 달 배차표가 최대 4개가 됐다. 그런데 이
 * 화면들은 종류를 나눠 볼 이유가 없다 — 오늘 나가는 차는 다 나가는 차다.
 * 종류별 '대표' 배차표(발행본 우선 → 최근 초안)를 각각 고른 뒤 슬롯을 합쳐
 * 하나로 돌려준다.
 *
 * `?publishedOnly=1` 이면 발행본만 — 초안이 현장 화면에 새는 것을 막는다.
 *
 * 이게 없으면 두 화면은 '전체'(구분 없음) 버킷만 보게 되어, 간선·지선으로만
 * 발행한 회사에서 영원히 "배차표 없음"을 띄우거나 철 지난 옛 배차표를
 * 오늘 현황이라고 보여준다.
 */
export const getMergedMonthSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const publishedOnly = req.query.publishedOnly === '1';
    const companyId = req.user!.companyId;

    const ids = await resolveMonthScheduleIdsAllTypes(companyId, year, month, publishedOnly);
    const chosen = await prisma.schedule.findMany({
      where: { id: { in: ids }, companyId },
      select: {
        id: true, name: true, serviceType: true, status: true,
        createdAt: true, updatedAt: true,
      },
      orderBy: { serviceType: 'asc' },
    });

    if (chosen.length === 0) {
      return res.json({ success: true, data: { schedules: [], status: null, slots: [] } });
    }

    const slots = await prisma.scheduleSlot.findMany({
      where: { scheduleId: { in: chosen.map((c) => c.id) } },
      include: { route: true, bus: true, emergencyDrop: true },
      orderBy: [{ date: 'asc' }],
    });

    // 종류마다 상태가 다를 수 있다(간선 발행 + 지선 초안) → 'PARTIAL' 로 알린다.
    const statuses = new Set(chosen.map((c) => c.status));
    const status = statuses.size === 1 ? [...statuses][0] : 'PARTIAL';

    const countByScheduleId = new Map<number, number>();
    for (const sl of slots) {
      countByScheduleId.set(sl.scheduleId, (countByScheduleId.get(sl.scheduleId) ?? 0) + 1);
    }

    return res.json({
      success: true,
      data: {
        schedules: chosen.map((c) => ({
          id: c.id,
          name: c.name,
          serviceType: c.serviceType,
          status: c.status,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          slotCount: countByScheduleId.get(c.id) ?? 0,
        })),
        status,
        slots,
      },
    });
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
    // 간선·지선·광역이 따로 발행되면 그 달 발행본이 여러 개다 — 전부 합산한다.
    const schedules = await prisma.schedule.findMany({
      where: { companyId: req.user!.companyId, year, month, status: 'PUBLISHED' },
      include: {
        slots: {
          where: { driverId: req.user!.id },
          select: { isRestDay: true, status: true },
        },
      },
    });

    // 내 배차 화면과 동일한 병합 규칙: 드랍은 휴무로 집계
    const slots = schedules.flatMap((s) => s.slots);
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
    // 간선/지선/광역 — 지정하면 그 종류의 노선·기사만으로 짠다
    const serviceType = parseServiceType((req.body as { serviceType?: string }).serviceType);

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
      serviceType,
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
    // 셀 유니크 제약(scheduleId, date, busId, shift) 충돌 — 같은 칸에 이미 배정 존재
    if ((error as { code?: string })?.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: '그 차량의 해당 날짜·시프트 칸에는 이미 배정이 있습니다. 기존 배정을 수정하거나 지운 뒤 추가해주세요.',
      });
    }
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
    // 간선/지선/광역은 각각 따로 발행한다 — 미지정이면 '전체'(구분 없음) 버킷.
    const serviceType = parseServiceType((req.body as { serviceType?: string } | undefined)?.serviceType);
    const bodyScheduleId = Number((req.body as { scheduleId?: number } | undefined)?.scheduleId);
    const existing = bodyScheduleId > 0
      ? await prisma.schedule.findFirst({
          where: { id: bodyScheduleId, companyId: req.user!.companyId, year, month },
        })
      : await prisma.schedule.findFirst({
          where: { companyId: req.user!.companyId, year, month, serviceType, status: 'DRAFT' },
          orderBy: { updatedAt: 'desc' },
        });
    if (!existing) {
      return res.status(404).json({ success: false, message: '배차표를 찾을 수 없습니다.' });
    }
    if (existing.status === 'PUBLISHED') {
      return res.status(400).json({ success: false, message: '이미 발행된 배차표입니다.' });
    }

    // 발행본은 (월 × 노선 종류)당 1개만 — 같은 종류의 다른 초안이 이미
    // 발행되어 있으면 차단한다. 간선이 발행돼 있어도 지선은 따로 발행할 수 있다.
    const alreadyPublished = await prisma.schedule.findFirst({
      where: {
        companyId: req.user!.companyId, year, month,
        serviceType: existing.serviceType,
        status: 'PUBLISHED',
      },
      select: { id: true, name: true },
    });
    if (alreadyPublished) {
      const label = existing.serviceType ? `${serviceTypeLabel(existing.serviceType)} ` : '';
      return res.status(400).json({
        success: false,
        message: `이미 발행된 ${year}년 ${month}월 ${label}배차표가 있습니다. 기존 발행본을 삭제한 후 발행해주세요.`,
      });
    }

    // ── 발행 게이트: 같은 날 같은 기사 중복 배정 검사 ──
    // 발행되면 기사앱은 같은 날 슬롯 중 하나만 보여준다(달력 last-wins,
    // 홈 first-wins). 즉 중복은 발행 후엔 화면에서 보이지도 않는다 —
    // 여기서 못 막으면 아무도 못 막는다. 화면 배너(duplicateInfo)와
    // 술어를 동일하게 유지할 것: 휴무·드랍·결근 제외.
    const dupGroups = await prisma.scheduleSlot.groupBy({
      by: ['driverId', 'date'],
      where: {
        scheduleId: existing.id,
        isRestDay: false,
        status: { notIn: ['DROPPED', 'ABSENT'] },
      },
      having: { driverId: { _count: { gt: 1 } } },
    });
    // 법규·정책 검산 — 연속근무(E3)·면허 만료(E4)·승인 휴무 배정(E5) 등을
    // 저장된 최종본에 적용한다. AI 엔진은 면허·휴무를 보지 않으므로
    // (엔진에 그 개념이 없다) 발행이 마지막 방어선이다.
    const inspection = await inspectScheduleForPublish(existing.id);

    const forcePublish = (req.body as { force?: boolean } | undefined)?.force === true;
    if ((dupGroups.length > 0 || inspection.errors.length > 0) && !forcePublish) {
      const dupDrivers = await prisma.user.findMany({
        // companyId 를 반드시 함께 건다 — 멀티테넌시 가드(dev: throw)에 걸려
        // 발행 게이트의 409 응답이 500 으로 바뀌던 자리다.
        where: {
          companyId: req.user!.companyId,
          id: { in: [...new Set(dupGroups.map((g) => g.driverId))] },
        },
        select: { id: true, name: true },
      });
      const nameOf = new Map(dupDrivers.map((d) => [d.id, d.name]));
      const duplicates = dupGroups.map((g) => ({
        driverId: g.driverId,
        driverName: nameOf.get(g.driverId) ?? `기사#${g.driverId}`,
        date: g.date.toISOString().slice(0, 10),
      }));
      const c = inspection.counts;
      const parts = [
        dupGroups.length > 0 ? `같은 날 중복 배정 ${dupGroups.length}건` : null,
        c.vacant > 0 ? `공석 ${c.vacant}칸(버스가 나갈 수 없음)` : null,
        c.unregistered > 0 ? `미등록 기사 칸 ${c.unregistered}칸` : null,
        c.consecutive > 0 ? `연속근무 초과 ${c.consecutive}건` : null,
        c.expiredLicense > 0 ? `면허·자격 만료 배정 ${c.expiredLicense}건` : null,
        c.approvedOff > 0 ? `승인 휴무일 배정 ${c.approvedOff}건` : null,
        c.serviceTypeMismatch > 0 ? `다른 노선 종류 기사 배정 ${c.serviceTypeMismatch}건` : null,
      ].filter(Boolean);
      return res.status(409).json({
        success: false,
        message: `${parts.join(', ')} — 해소한 뒤 발행해주세요.`,
        data: {
          duplicates,
          violations: inspection.errors,
          warnings: inspection.warnings,
          counts: inspection.counts,
        },
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
        // 중복·법규 위반을 알고도 강제 발행한 경우 — 반드시 감사 기록에 남긴다
        ...(dupGroups.length > 0
          ? { forcedDuplicates: { old: null, new: dupGroups.length } }
          : {}),
        ...(inspection.errors.length > 0
          ? {
              forcedViolations: {
                old: null,
                new:
                  `공석${inspection.counts.vacant}/미등록${inspection.counts.unregistered}` +
                  `/연속근무${inspection.counts.consecutive}` +
                  `/면허만료${inspection.counts.expiredLicense}/승인휴무${inspection.counts.approvedOff}` +
                  `/노선종류불일치${inspection.counts.serviceTypeMismatch}`,
              },
            }
          : {}),
      },
    });

    // 알림 대상 — 종류가 지정된 배차표는 그 종류 기사에게만 보낸다.
    // (구분을 아직 안 넣은 기사(null)는 어느 표에 들어갈지 모르므로 함께 받는다)
    const drivers = await prisma.user.findMany({
      where: {
        role: 'DRIVER', isActive: true, companyId: req.user!.companyId,
        ...(existing.serviceType
          ? { OR: [{ serviceType: existing.serviceType }, { serviceType: null }] }
          : {}),
      },
      select: { id: true },
    });

    const typeLabel = existing.serviceType ? `${serviceTypeLabel(existing.serviceType)} ` : '';
    await sendBulkPushNotifications(
      drivers.map(d => d.id),
      '📅 배차표 발행',
      `${year}년 ${month}월 ${typeLabel}배차표가 발행되었습니다. 확인해주세요!`,
      'SCHEDULE_PUBLISHED',
      { year, month }
    );

    // Socket.IO: 회사 전체에 배차표 발행 알림
    emitToCompany(req.user!.companyId, 'schedule:published', {
      year,
      month,
      scheduleId: schedule.id,
      serviceType: existing.serviceType,
    });

    return res.json({
      success: true,
      data: schedule,
      // 경고(짧은 휴식 등)는 발행을 막지 않지만 담당자에게 보여준다
      warnings: inspection.warnings,
      message: `${year}년 ${month}월 ${typeLabel}배차표가 발행되었습니다.`,
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
      parseServiceType(req.query.serviceType),
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
      // 간선/지선/광역 탭별 목록. ?serviceType 미지정 = '전체'(구분 없음) 버킷
      where: { companyId: req.user!.companyId, year, month, serviceType: parseServiceType(req.query.serviceType) },
      select: {
        id: true,
        name: true,
        status: true,
        serviceType: true,
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
        serviceType: s.serviceType,
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
      where: {
        companyId: req.user!.companyId, year: src.year, month: src.month,
        serviceType: src.serviceType, status: 'DRAFT',
      },
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
        undefined,
        src.serviceType,
      );
      const created = await tx.schedule.create({
        data: {
          companyId: req.user!.companyId,
          year: src.year,
          month: src.month,
          name,
          // 사본은 원본과 같은 노선 종류 탭에 남는다
          serviceType: src.serviceType,
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
    const serviceType = parseServiceType(req.query.serviceType);
    const buffer = await generateScheduleExcel(
      req.user!.companyId,
      year,
      month,
      Number.isFinite(scheduleIdParam) && scheduleIdParam > 0 ? scheduleIdParam : undefined,
      serviceType,
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const company = await prisma.company.findUnique({ where: { id: req.user!.companyId }, select: { code: true } });
    const companyCode = (company?.code || 'schedule').toLowerCase();
    // 종류별로 파일명을 갈라 놓는다 — 셋이 같은 이름이면 받는 쪽에서 덮어쓴다
    const typeSuffix = serviceType ? `_${serviceType.toLowerCase()}` : '';
    res.setHeader('Content-Disposition', `attachment; filename="${companyCode}_schedule_${year}_${month}${typeSuffix}.xlsx"`);

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

    // 지자체 BIS 는 회사의 **전 노선**을 받아야 한다 — 간선·지선·광역을 따로
    // 발행하더라도 여기서는 합쳐서 내보낸다. 한 종류만 보내면 지자체 쪽에는
    // 나머지 노선이 아예 존재하지 않는 것으로 보이고, 대외 연동이라 틀린 걸
    // 알아채기도 어렵다. (종류별 대표 = 발행본 우선 → 최근 초안)
    const ids = await resolveMonthScheduleIdsAllTypes(req.user!.companyId, year, month);
    if (ids.length === 0) {
      return res.status(404).json({ success: false, message: '배차표를 찾을 수 없습니다.' });
    }
    const parts = await prisma.schedule.findMany({
      where: { id: { in: ids }, companyId: req.user!.companyId },
      select: { serviceType: true, status: true },
    });
    // 종류마다 상태가 다르면 'PARTIAL' — 지자체가 "다 확정된 것"으로 오해하지 않게
    const statuses = new Set(parts.map((p) => p.status));
    const scheduleStatus = statuses.size === 1 ? [...statuses][0] : 'PARTIAL';
    const slots = await prisma.scheduleSlot.findMany({
      where: { scheduleId: { in: ids }, isRestDay: false },
      include: {
        driver: { select: { id: true, employeeId: true, name: true, licenseNumber: true } },
        route: { select: { routeNumber: true, name: true, startPoint: true, endPoint: true } },
        bus: { select: { busNumber: true, plateNumber: true } },
      },
      orderBy: [{ date: 'asc' }, { route: { routeNumber: 'asc' } }],
    });
    const schedule = { slots };

    // Format for BIS standard (customizable per municipal contract)
    const bisPayload = {
      company: (await prisma.company.findUnique({ where: { id: req.user!.companyId }, select: { name: true } }))?.name || 'Unknown',
      exportedAt: new Date().toISOString(),
      period: { year, month },
      scheduleStatus,
      // 어떤 노선 종류가 포함됐는지 — 받는 쪽이 누락을 알아챌 수 있게 명시한다
      serviceTypes: parts.map((p) => p.serviceType ?? 'ALL'),
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

