/**
 * DispatchAgent v1 — 10개 시작 도구 (PHASE 2 PoC).
 *
 * 도구 카테고리:
 *   조회 (6): get_drivers, get_routes, get_active_schedule, get_dayoff_requests,
 *            get_company_rules, get_driver_history
 *   분석 (1): score_fairness
 *   생성·수정 (3): draft_monthly_schedule, modify_slot, publish_schedule
 *
 * 핵심 안전 장치:
 *   - 모든 도구는 ToolContext.companyId 로 멀티테넌시 자동 격리
 *   - modify_slot 은 Constitutional 검증 통과 후에만 실행
 *   - publish_schedule 은 휴먼 게이트 — 이 도구는 발행 "요청" 만 기록하고 실제 발행은 안 함
 *     (관리자가 어드민웹에서 명시 승인 시 PUBLISHED 로 전환)
 *   - 시뮬레이션 모드에서 modify_slot, publish_schedule 은 stub
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { generateMonthlySchedule } from '../../services/scheduleService';
import { generateMonthlyScheduleV2 } from '../../services/solverDispatchService';
import { checkConstitutional } from '../_core/constitutional';
import { calculateFairness, type SlotForFairness } from './fairness';
import { compileAndValidate } from './rule-compiler';
import type { AgentTool, ToolContext } from '../_core/types';

// ─────────────────────────────────────────────
// 입력 타입
// ─────────────────────────────────────────────

interface GetRoutesInput {
  includeInactive?: boolean;
}

interface GetActiveScheduleInput {
  year: number;
  month: number;
  /**
   * 어떤 데이터를 반환할지 결정 — 회사 사이즈에 무관하게 안전한 응답 보장.
   * - summary       : 통계만 (기본, 모든 사이즈 안전)
   * - for_date      : 특정 날짜의 슬롯들만 (해당 일자만 분석할 때)
   * - for_driver    : 특정 기사의 한 달 슬롯 (개별 기사 점검·swap 대상 식별)
   * - for_outliers  : fairness outliers 기사들의 한 달 슬롯 (재배치 작업)
   */
  mode?: 'summary' | 'for_date' | 'for_driver' | 'for_outliers';
  /** mode='for_date' 일 때 필수 (YYYY-MM-DD) */
  date?: string;
  /** mode='for_driver' 일 때 필수 */
  driverId?: number;
  /** mode='for_outliers' 일 때 평균 대비 절대 편차 임계값 (기본 1.5일) */
  outlierThreshold?: number;
}

interface GetDriversInputExtended {
  driverType?: 'MAIN' | 'SPARE';
  includeInactive?: boolean;
  /** 결과 1페이지 크기 (1~100, 기본 50) */
  limit?: number;
  /** 페이지네이션 커서 — 직전 응답의 nextCursor 값 */
  cursor?: number;
  /** 특정 노선에 배정된 기사만 */
  routeId?: number;
  /** 이름·사원번호 부분 일치 검색 */
  search?: string;
}

interface GetDayoffRequestsInput {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;
}

interface GetCompanyRulesInput {
  category?: string;
}

interface GetDriverHistoryInput {
  driverId: number;
  days?: number; // 기본 30
}

interface ScoreFairnessInput {
  scheduleId: number;
}

interface DraftMonthlyScheduleInput {
  year: number;
  month: number;
  workDays?: number;
  restDays?: number;
  customRules?: string;
}

interface DraftScheduleV2Input {
  year: number;
  month: number;
  /** 기존 DRAFT 가 있으면 덮어쓸지 (디폴트 false) */
  overwriteDraft?: boolean;
}

interface ModifySlotInput {
  slotId: number;
  newDriverId?: number;
  newShift?: 'MORNING' | 'AFTERNOON' | 'FULL_DAY';
  newRouteId?: number;
  reason: string;
}

interface PublishScheduleInput {
  scheduleId: number;
  summary: string;
}

interface SwapDriversInput {
  slotAId: number;
  slotBId: number;
  reason: string;
}

interface ApproveDayoffInput {
  requestId: number;
  reviewNote?: string;
}

interface RejectDayoffInput {
  requestId: number;
  reviewNote: string;
}

interface DetectConstraintViolationInput {
  scheduleId: number;
}

interface RequestHumanReviewInput {
  scheduleId?: number;
  reason: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// 1. get_drivers
// ─────────────────────────────────────────────

const getDrivers: AgentTool<GetDriversInputExtended, unknown> = {
  name: 'get_drivers',
  description:
    '회사의 기사 목록을 페이지네이션 + 필터로 반환합니다. **회사 사이즈 무관 안전** — 600명 회사도 ' +
    'limit=50 이면 50명씩 12 페이지로 나눠 받음. 응답에 totalCount + nextCursor 포함.\n\n' +
    '필터 옵션:\n' +
    '- driverType: MAIN(정규) / SPARE(예비)\n' +
    '- routeId: 특정 노선에 활성 배정된 기사만\n' +
    '- search: 이름 또는 사원번호 부분 일치\n' +
    '- includeInactive: 퇴사·휴직 포함 (기본 false)\n\n' +
    '면허·자격증 만료일 + 입사 후 일수 함께 반환 (Constitutional 검증에 사용).\n' +
    '대형 회사에서는 먼저 limit=10 으로 샘플링 → totalCount 확인 → 필요한 페이지만 호출 권장.',
  inputSchema: {
    type: 'object',
    properties: {
      driverType: {
        type: 'string',
        enum: ['MAIN', 'SPARE'],
        description: 'MAIN=정규 노선 고정, SPARE=결원 대체용 (옵셔널)',
      },
      includeInactive: {
        type: 'boolean',
        description: '퇴사·휴직 기사 포함 (기본 false)',
      },
      limit: {
        type: 'integer',
        description: '페이지 크기 1~100 (기본 50)',
      },
      cursor: {
        type: 'integer',
        description: '직전 응답의 nextCursor 값 — 다음 페이지 조회',
      },
      routeId: {
        type: 'integer',
        description: '특정 노선에 활성 배정된 기사만',
      },
      search: {
        type: 'string',
        description: '이름 또는 사원번호 부분 일치 검색',
      },
    },
  },
  handler: async (input, ctx: ToolContext) => {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));

    const where: Prisma.UserWhereInput = {
      companyId: ctx.companyId,
      role: 'DRIVER',
    };
    if (input.driverType) where.driverType = input.driverType;
    if (!input.includeInactive) where.isActive = true;
    if (input.routeId !== undefined) {
      where.routeAssignments = {
        some: { routeId: input.routeId, isActive: true },
      };
    }
    if (input.search && input.search.trim().length > 0) {
      const term = input.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { employeeId: { contains: term, mode: 'insensitive' } },
      ];
    }

    // 총 개수 (필터 적용 후) — 모델이 페이지네이션 결정에 사용
    const totalCount = await prisma.user.count({ where });

    const drivers = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        employeeId: true,
        driverType: true,
        shiftGroup: true,
        assignedBusNumber: true,
        licenseExpiresAt: true,
        qualificationExpiresAt: true,
        isActive: true,
        createdAt: true,
      },
      // cursor pagination — id 오름차순
      take: limit + 1, // +1 로 다음 페이지 존재 여부 확인
      ...(input.cursor !== undefined
        ? { cursor: { id: input.cursor }, skip: 1 }
        : {}),
      orderBy: { id: 'asc' },
    });

    const hasMore = drivers.length > limit;
    const page = hasMore ? drivers.slice(0, limit) : drivers;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      totalCount,
      returnedCount: page.length,
      hasMore,
      nextCursor,
      filters: {
        driverType: input.driverType ?? null,
        includeInactive: input.includeInactive ?? false,
        routeId: input.routeId ?? null,
        search: input.search ?? null,
      },
      drivers: page.map((d) => ({
        id: d.id,
        name: d.name,
        employeeId: d.employeeId,
        driverType: d.driverType,
        shiftGroup: d.shiftGroup,
        assignedBus: d.assignedBusNumber,
        licenseExpiresAt: d.licenseExpiresAt?.toISOString().slice(0, 10) ?? null,
        qualificationExpiresAt: d.qualificationExpiresAt?.toISOString().slice(0, 10) ?? null,
        isActive: d.isActive,
        daysSinceHire: Math.floor(
          (ctx.virtualNow.getTime() - d.createdAt.getTime()) / (24 * 3600 * 1000)
        ),
      })),
      hint: hasMore
        ? `${totalCount}명 중 ${page.length}명 반환. 다음 페이지: cursor=${nextCursor}`
        : `${totalCount}명 전체 반환됨.`,
    };
  },
};

// ─────────────────────────────────────────────
// 2. get_routes
// ─────────────────────────────────────────────

const getRoutes: AgentTool<GetRoutesInput, unknown> = {
  name: 'get_routes',
  description:
    '회사의 운행 노선 목록을 반환합니다. 각 노선의 routeNumber·name·시점·종점·할당 차량 수 포함.',
  inputSchema: {
    type: 'object',
    properties: {
      includeInactive: { type: 'boolean', description: '비활성 노선 포함 (기본 false)' },
    },
  },
  handler: async (input, ctx: ToolContext) => {
    const routes = await prisma.route.findMany({
      where: {
        companyId: ctx.companyId,
        ...(input.includeInactive ? {} : { isActive: true }),
      },
      include: {
        buses: { where: { isActive: true }, select: { id: true } },
        routeAssignments: { where: { isActive: true }, select: { driverId: true } },
      },
      orderBy: { routeNumber: 'asc' },
    });

    return {
      total: routes.length,
      routes: routes.map((r) => ({
        id: r.id,
        routeNumber: r.routeNumber,
        name: r.name,
        startPoint: r.startPoint,
        endPoint: r.endPoint,
        busesCount: r.buses.length,
        assignedDriversCount: r.routeAssignments.length,
        isActive: r.isActive,
      })),
    };
  },
};

// ─────────────────────────────────────────────
// 3. get_active_schedule
// ─────────────────────────────────────────────

const getActiveSchedule: AgentTool<GetActiveScheduleInput, unknown> = {
  name: 'get_active_schedule',
  description:
    '특정 연·월의 배차표를 4가지 모드로 조회합니다. 회사 사이즈와 상관없이 항상 안전한 응답.\n' +
    '- mode="summary" (기본): 통계만 (슬롯 수, 결근, override 수, outlier 후보) — 항상 작음.\n' +
    '- mode="for_date": 특정 날짜 슬롯들만 (date 필수). 결원·일일 조정용.\n' +
    '- mode="for_driver": 특정 기사의 한 달 슬롯 (driverId 필수). 개별 분석·swap 대상 식별용.\n' +
    '- mode="for_outliers": fairness outliers 기사들의 슬롯만 (대형 회사 재배치 작업).\n\n' +
    '**모든 사이즈 안전 — 600명 회사도 한 번에 절대 다 받지 않음.** 대형 회사라도 mode 를 ' +
    '바꿔가며 필요한 부분만 호출하세요. 작은 회사(기사 5~50명)도 같은 도구로 동일하게 동작합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      year: { type: 'integer', description: '연도 (예: 2026)' },
      month: { type: 'integer', description: '월 (1-12)' },
      mode: {
        type: 'string',
        enum: ['summary', 'for_date', 'for_driver', 'for_outliers'],
        description: '응답 범위 (기본 summary)',
      },
      date: {
        type: 'string',
        description: 'mode=for_date 일 때 필수, YYYY-MM-DD',
      },
      driverId: {
        type: 'integer',
        description: 'mode=for_driver 일 때 필수',
      },
      outlierThreshold: {
        type: 'number',
        description: 'mode=for_outliers 일 때 평균 대비 절대 편차 임계값 (기본 1.5)',
      },
    },
    required: ['year', 'month'],
  },
  handler: async (input, ctx: ToolContext) => {
    const mode = input.mode ?? 'summary';

    // 1. 배차표 헤더 조회 (slots 미포함 — 항상 가벼움)
    const schedule = await prisma.schedule.findUnique({
      where: {
        companyId_year_month: {
          companyId: ctx.companyId,
          year: input.year,
          month: input.month,
        },
      },
      select: {
        id: true,
        year: true,
        month: true,
        status: true,
        notes: true,
      },
    });

    if (!schedule) {
      return { exists: false, year: input.year, month: input.month, mode };
    }

    // 공통 통계 — 집계 쿼리로 슬롯 자체를 가져오지 않음
    const [totalSlots, workSlots, restSlots, droppedSlots, manualOverrides, distinctDrivers] = await Promise.all([
      prisma.scheduleSlot.count({ where: { scheduleId: schedule.id } }),
      prisma.scheduleSlot.count({ where: { scheduleId: schedule.id, isRestDay: false } }),
      prisma.scheduleSlot.count({ where: { scheduleId: schedule.id, isRestDay: true } }),
      prisma.scheduleSlot.count({ where: { scheduleId: schedule.id, status: 'DROPPED' } }),
      prisma.scheduleSlot.count({ where: { scheduleId: schedule.id, isManualOverride: true } }),
      prisma.scheduleSlot.findMany({
        where: { scheduleId: schedule.id },
        select: { driverId: true },
        distinct: ['driverId'],
      }),
    ]);

    const baseSummary = {
      totalSlots,
      workSlots,
      restSlots,
      droppedSlots,
      manualOverrides,
      distinctDrivers: distinctDrivers.length,
    };

    // ── mode: summary ──────────────────────────────
    if (mode === 'summary') {
      // outliers 미리 계산해서 모델에게 다음 호출 힌트 제공 (사이즈 무관)
      const slots = await prisma.scheduleSlot.findMany({
        where: { scheduleId: schedule.id },
        select: {
          driverId: true,
          shift: true,
          isRestDay: true,
          date: true,
          status: true,
          routeId: true,
        },
      });
      const slotsForCalc: SlotForFairness[] = slots.map((s) => ({
        driverId: s.driverId,
        routeId: s.routeId,
        shift: s.shift as 'MORNING' | 'AFTERNOON' | 'FULL_DAY',
        date: s.date,
        isRestDay: s.isRestDay,
        status: s.status,
      }));
      const fairness = calculateFairness(slotsForCalc);

      return {
        exists: true,
        mode: 'summary',
        scheduleId: schedule.id,
        year: schedule.year,
        month: schedule.month,
        status: schedule.status,
        notes: schedule.notes,
        summary: baseSummary,
        fairness: {
          score: fairness.fairnessScore,
          workStdev: fairness.stdev.work,
          outlierCount: fairness.outliers.length,
          meetsTarget: fairness.meetsTarget,
        },
        // 모델이 다음 호출로 넘어갈 힌트
        hint:
          fairness.outliers.length > 0
            ? `outliers ${fairness.outliers.length}명 발견 — mode="for_outliers" 로 재호출하여 해당 기사들의 슬롯만 분석하세요.`
            : droppedSlots > 0
            ? `DROPPED 슬롯 ${droppedSlots}개 — 결원 처리 필요. mode="for_date" 로 해당 날짜만 조회.`
            : '이상 신호 없음. score_fairness 또는 detect_constraint_violation 으로 검증.',
      };
    }

    // ── mode: for_date ─────────────────────────────
    if (mode === 'for_date') {
      if (!input.date) {
        throw new Error('mode="for_date" 는 date 인자 필수 (YYYY-MM-DD).');
      }
      const date = parseYmd(input.date);
      const slots = await prisma.scheduleSlot.findMany({
        where: { scheduleId: schedule.id, date },
        select: {
          id: true,
          driverId: true,
          routeId: true,
          shift: true,
          status: true,
          isRestDay: true,
          isManualOverride: true,
        },
        orderBy: [{ shift: 'asc' }, { driverId: 'asc' }],
      });

      return {
        exists: true,
        mode: 'for_date',
        scheduleId: schedule.id,
        year: schedule.year,
        month: schedule.month,
        status: schedule.status,
        date: input.date,
        summary: baseSummary,
        slotCount: slots.length,
        slots: slots.map((s) => ({
          id: s.id,
          driverId: s.driverId,
          routeId: s.routeId,
          shift: s.shift,
          status: s.status,
          isRestDay: s.isRestDay,
          isOverride: s.isManualOverride,
        })),
      };
    }

    // ── mode: for_driver ───────────────────────────
    if (mode === 'for_driver') {
      if (input.driverId === undefined) {
        throw new Error('mode="for_driver" 는 driverId 인자 필수.');
      }
      // 회사 격리: 기사가 같은 회사인지 확인
      const driver = await prisma.user.findFirst({
        where: { id: input.driverId, companyId: ctx.companyId, role: 'DRIVER' },
        select: { id: true, name: true, employeeId: true, driverType: true },
      });
      if (!driver) {
        throw new Error(`기사 ${input.driverId} 가 회사 소속이 아닙니다.`);
      }

      const slots = await prisma.scheduleSlot.findMany({
        where: { scheduleId: schedule.id, driverId: input.driverId },
        select: {
          id: true,
          routeId: true,
          date: true,
          shift: true,
          status: true,
          isRestDay: true,
          isManualOverride: true,
        },
        orderBy: { date: 'asc' },
      });

      const workCount = slots.filter((s) => !s.isRestDay && s.status !== 'ABSENT').length;
      const restCount = slots.filter((s) => s.isRestDay).length;
      const nightCount = slots.filter((s) => s.shift === 'AFTERNOON' && !s.isRestDay).length;

      return {
        exists: true,
        mode: 'for_driver',
        scheduleId: schedule.id,
        driver,
        summary: baseSummary,
        driverStats: {
          totalSlots: slots.length,
          workDays: workCount,
          restDays: restCount,
          nightShifts: nightCount,
        },
        slots: slots.map((s) => ({
          id: s.id,
          routeId: s.routeId,
          date: dateOnly(s.date),
          shift: s.shift,
          status: s.status,
          isRestDay: s.isRestDay,
          isOverride: s.isManualOverride,
        })),
      };
    }

    // ── mode: for_outliers ─────────────────────────
    if (mode === 'for_outliers') {
      const threshold = input.outlierThreshold ?? 1.5;
      // 전체 슬롯 → calculateFairness → outlier driverId 만 추출
      const allSlots = await prisma.scheduleSlot.findMany({
        where: { scheduleId: schedule.id },
        select: {
          driverId: true,
          routeId: true,
          shift: true,
          isRestDay: true,
          date: true,
          status: true,
        },
      });
      const slotsForCalc: SlotForFairness[] = allSlots.map((s) => ({
        driverId: s.driverId,
        routeId: s.routeId,
        shift: s.shift as 'MORNING' | 'AFTERNOON' | 'FULL_DAY',
        date: s.date,
        isRestDay: s.isRestDay,
        status: s.status,
      }));
      const fairness = calculateFairness(slotsForCalc);
      const outlierIds = fairness.outliers
        .filter((o) => Math.abs(o.deviationFromMean) >= threshold)
        .slice(0, 20) // 최대 20명만 (너무 많으면 분리 호출 권장)
        .map((o) => o.driverId);

      if (outlierIds.length === 0) {
        return {
          exists: true,
          mode: 'for_outliers',
          scheduleId: schedule.id,
          summary: baseSummary,
          fairness: {
            score: fairness.fairnessScore,
            outlierCount: 0,
          },
          outlierDriverIds: [],
          slotsByDriver: {},
          hint: '편차 ≥ ' + threshold + '일 outlier 없음. 배차표가 충분히 공정합니다.',
        };
      }

      // outlier 기사들의 슬롯만 추출
      const outlierSet = new Set(outlierIds);
      const slotsByDriver: Record<number, Array<{
        id: number;
        date: string;
        shift: string;
        isRestDay: boolean;
        status: string;
      }>> = {};
      for (const id of outlierIds) {
        slotsByDriver[id] = [];
      }
      // 슬롯 id 가 select 에 없어서 다시 조회 (outlier 만)
      const outlierSlots = await prisma.scheduleSlot.findMany({
        where: {
          scheduleId: schedule.id,
          driverId: { in: outlierIds },
        },
        select: {
          id: true,
          driverId: true,
          date: true,
          shift: true,
          isRestDay: true,
          status: true,
        },
        orderBy: [{ driverId: 'asc' }, { date: 'asc' }],
      });
      for (const s of outlierSlots) {
        if (outlierSet.has(s.driverId)) {
          slotsByDriver[s.driverId].push({
            id: s.id,
            date: dateOnly(s.date),
            shift: s.shift,
            isRestDay: s.isRestDay,
            status: s.status,
          });
        }
      }

      return {
        exists: true,
        mode: 'for_outliers',
        scheduleId: schedule.id,
        summary: baseSummary,
        fairness: {
          score: fairness.fairnessScore,
          workStdev: fairness.stdev.work,
          outlierCount: fairness.outliers.length,
        },
        threshold,
        outlierDriverIds: outlierIds,
        outlierStats: fairness.outliers
          .filter((o) => Math.abs(o.deviationFromMean) >= threshold)
          .slice(0, 20),
        slotsByDriver,
      };
    }

    throw new Error(`알 수 없는 mode: ${mode}`);
  },
};

// ─────────────────────────────────────────────
// 4. get_dayoff_requests
// ─────────────────────────────────────────────

const getDayoffRequests: AgentTool<GetDayoffRequestsInput, unknown> = {
  name: 'get_dayoff_requests',
  description:
    '휴무 신청 목록을 반환합니다. status 로 PENDING/APPROVED/REJECTED 필터, ' +
    'fromDate/toDate 로 날짜 범위 필터. 배차 생성 전 PENDING 을 먼저 처리해야 합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
      },
      fromDate: { type: 'string', description: 'YYYY-MM-DD (옵셔널)' },
      toDate: { type: 'string', description: 'YYYY-MM-DD (옵셔널)' },
    },
  },
  handler: async (input, ctx: ToolContext) => {
    const where: Prisma.DayOffRequestWhereInput = {
      companyId: ctx.companyId,
    };
    if (input.status) where.status = input.status;
    if (input.fromDate || input.toDate) {
      where.date = {};
      if (input.fromDate) (where.date as Prisma.DateTimeFilter).gte = parseYmd(input.fromDate);
      if (input.toDate) (where.date as Prisma.DateTimeFilter).lte = parseYmd(input.toDate);
    }

    const requests = await prisma.dayOffRequest.findMany({
      where,
      include: {
        driver: { select: { id: true, name: true, employeeId: true } },
      },
      orderBy: { date: 'asc' },
      take: 200,
    });

    return {
      total: requests.length,
      requests: requests.map((r) => ({
        id: r.id,
        driver: r.driver,
        date: dateOnly(r.date),
        reason: r.reason,
        status: r.status,
        reviewNote: r.reviewNote,
      })),
    };
  },
};

// ─────────────────────────────────────────────
// 5. get_company_rules
// ─────────────────────────────────────────────

const getCompanyRules: AgentTool<GetCompanyRulesInput, unknown> = {
  name: 'get_company_rules',
  description:
    '회사가 등록한 배차 규칙 목록을 반환합니다 (자연어 + 구조화 데이터). ' +
    'category 로 필터: safety, driver-type, schedule, payroll 등. ' +
    '배차 생성 전 반드시 호출하여 회사·노조 규칙을 인지해야 합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      category: { type: 'string', description: '카테고리 필터 (옵셔널)' },
    },
  },
  handler: async (input, ctx: ToolContext) => {
    const rules = await prisma.companyRule.findMany({
      where: {
        companyId: ctx.companyId,
        isActive: true,
        ...(input.category ? { category: input.category } : {}),
      },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        parsedData: true,
      },
      orderBy: { id: 'asc' },
    });

    return { total: rules.length, rules };
  },
};

// ─────────────────────────────────────────────
// 6. get_driver_history
// ─────────────────────────────────────────────

const getDriverHistory: AgentTool<GetDriverHistoryInput, unknown> = {
  name: 'get_driver_history',
  description:
    '특정 기사의 최근 N일 (기본 30) 배차 이력 + 휴무 이력 + 피로도 지표를 반환합니다. ' +
    '해당 기사에게 추가 배차할지 판단할 때 사용합니다. ' +
    '반환 항목: 야간 횟수, 주말 횟수, 연속 근무일, 마지막 휴무일, 누적 근무 시간.',
  inputSchema: {
    type: 'object',
    properties: {
      driverId: { type: 'integer', description: '기사 ID' },
      days: { type: 'integer', description: '조회 일수 (기본 30)' },
    },
    required: ['driverId'],
  },
  handler: async (input, ctx: ToolContext) => {
    const days = input.days ?? 30;
    const since = new Date(ctx.virtualNow.getTime() - days * 24 * 3600 * 1000);

    // 회사 격리 검증
    const driver = await prisma.user.findFirst({
      where: { id: input.driverId, companyId: ctx.companyId, role: 'DRIVER' },
      select: { id: true, name: true, employeeId: true, driverType: true },
    });
    if (!driver) {
      throw new Error(`기사 ${input.driverId} 가 회사 소속이 아닙니다.`);
    }

    const slots = await prisma.scheduleSlot.findMany({
      where: {
        driverId: input.driverId,
        date: { gte: since, lte: ctx.virtualNow },
      },
      select: {
        date: true,
        shift: true,
        status: true,
        isRestDay: true,
      },
      orderBy: { date: 'asc' },
    });

    const dayoffs = await prisma.dayOffRequest.findMany({
      where: {
        driverId: input.driverId,
        date: { gte: since, lte: ctx.virtualNow },
        status: 'APPROVED',
      },
      select: { date: true },
    });

    // 메트릭 계산
    const workSlots = slots.filter((s) => !s.isRestDay && s.status !== 'ABSENT');
    const nightShifts = workSlots.filter((s) => s.shift === 'AFTERNOON').length; // 오후 = 야간 근접
    const weekendShifts = workSlots.filter((s) => {
      const day = s.date.getDay();
      return day === 0 || day === 6;
    }).length;

    // 마지막 휴무일
    const restDates = slots.filter((s) => s.isRestDay).map((s) => s.date.getTime());
    const lastRestDay = restDates.length > 0 ? new Date(Math.max(...restDates)) : null;

    // 연속 근무일 (마지막 휴무 이후)
    const sortedWorkDates = workSlots.map((s) => s.date.getTime()).sort((a, b) => b - a);
    let consecutiveWorkDays = 0;
    if (lastRestDay) {
      consecutiveWorkDays = sortedWorkDates.filter((t) => t > lastRestDay.getTime()).length;
    } else {
      consecutiveWorkDays = sortedWorkDates.length;
    }

    return {
      driver,
      windowDays: days,
      totalWorkDays: workSlots.length,
      totalRestDays: slots.filter((s) => s.isRestDay).length,
      nightShifts,
      weekendShifts,
      consecutiveWorkDays,
      lastRestDay: lastRestDay ? dateOnly(lastRestDay) : null,
      approvedDayoffsInWindow: dayoffs.map((d) => dateOnly(d.date)),
      // 피로도 신호 (모델이 빠르게 판단하도록)
      fatigueSignals: {
        highWorkload: workSlots.length > days * 0.7,
        manyNightShifts: nightShifts > days * 0.4,
        longConsecutiveStreak: consecutiveWorkDays >= 5,
      },
    };
  },
};

// ─────────────────────────────────────────────
// 7. score_fairness
// ─────────────────────────────────────────────

const scoreFairness: AgentTool<ScoreFairnessInput, unknown> = {
  name: 'score_fairness',
  description:
    '특정 배차표의 공정성 지수를 계산합니다. 기사별 (근무일수, 야간 근무, 주말 근무) 의 ' +
    '표준편차를 합산해 0~100 점 (100=완전 공정) 으로 환산. ' +
    '공정성 미달 기사 (편차 ≥ 1일) 목록도 함께 반환합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      scheduleId: { type: 'integer', description: '배차표 ID' },
    },
    required: ['scheduleId'],
  },
  handler: async (input, ctx: ToolContext) => {
    const schedule = await prisma.schedule.findFirst({
      where: { id: input.scheduleId, companyId: ctx.companyId },
      include: {
        slots: {
          select: {
            driverId: true,
            routeId: true,
            shift: true,
            isRestDay: true,
            date: true,
            status: true,
          },
        },
      },
    });

    if (!schedule) {
      throw new Error(`배차표 ${input.scheduleId} 를 찾을 수 없거나 회사 격리 위반.`);
    }

    if (schedule.slots.length === 0) {
      return { scheduleId: input.scheduleId, fairnessScore: 100, message: '슬롯 없음' };
    }

    // 순수 함수 모듈에 위임 (단위 테스트 가능 + 시뮬레이션 재사용)
    const slotsForCalc: SlotForFairness[] = schedule.slots.map((s) => ({
      driverId: s.driverId,
      routeId: s.routeId,
      shift: s.shift as 'MORNING' | 'AFTERNOON' | 'FULL_DAY',
      date: s.date,
      isRestDay: s.isRestDay,
      status: s.status,
    }));
    const report = calculateFairness(slotsForCalc);

    return {
      scheduleId: input.scheduleId,
      fairnessScore: report.fairnessScore,
      meanWorkDays: report.meanWorkDays,
      stdev: report.stdev,
      driversCount: report.driversCount,
      outliers: report.outliers,
      meetsTarget: report.meetsTarget,
    };
  },
};

// ─────────────────────────────────────────────
// 8. draft_monthly_schedule
// ─────────────────────────────────────────────

const draftMonthlySchedule: AgentTool<DraftMonthlyScheduleInput, unknown> = {
  name: 'draft_monthly_schedule',
  description:
    '월간 배차표 초안을 생성합니다. 기존 결정론적 배차 알고리즘 (5/2 사이클 + 노선 균형) 을 사용. ' +
    'workDays/restDays/customRules 로 사이클을 조정할 수 있습니다. ' +
    '생성된 배차표는 DRAFT 상태이며, score_fairness 로 검증 후 publish_schedule 로 발행 요청해야 합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      year: { type: 'integer', description: '연도' },
      month: { type: 'integer', description: '월 (1-12)' },
      workDays: { type: 'integer', description: '근무일수 (기본 5)' },
      restDays: { type: 'integer', description: '휴무일수 (기본 2)' },
      customRules: {
        type: 'string',
        description: '자연어 추가 규칙 (예: "연속 4일 근무 금지")',
      },
    },
    required: ['year', 'month'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({
    simulated: true,
    year: input.year,
    month: input.month,
    message: '시뮬레이션 모드 — 배차표 생성 stub',
  }),
  handler: async (input, ctx: ToolContext) => {
    // adminId 는 에이전트가 시스템 사용자로 표시되도록 첫 번째 ADMIN 을 사용
    const admin = await prisma.user.findFirst({
      where: { companyId: ctx.companyId, role: 'ADMIN', isActive: true },
      select: { id: true },
    });
    if (!admin) {
      throw new Error('회사에 활성 ADMIN 이 없어 배차표를 생성할 수 없습니다.');
    }

    const result = await generateMonthlySchedule(ctx.companyId, input.year, input.month, admin.id, {
      workDays: input.workDays,
      restDays: input.restDays,
      customRules: input.customRules,
    });

    return {
      scheduleId: result.scheduleId,
      slotsCreated: result.slotsCreated,
      warnings: result.warnings,
      fairnessReport: result.fairnessReport.slice(0, 20), // 상위 20명만 (컨텍스트 절약)
    };
  },
};

// ─────────────────────────────────────────────
// 8b. draft_schedule_v2 — 정책 기반 솔버 (CompanyPolicy 외부화)
// ─────────────────────────────────────────────

const draftScheduleV2: AgentTool<DraftScheduleV2Input, unknown> = {
  name: 'draft_schedule_v2',
  description:
    '🆕 정책 기반 월간 배차표 생성 (CompanyPolicy + monthly-grid-solver). ' +
    '회사 정책 (workdayBands / restCycle / shiftSystem / crewModel / constitutional) 자동 로드. ' +
    'PAIR/SOLO/TRIO 모델 + 1/2/3교대 + 격일제 모두 지원. ' +
    'draft_monthly_schedule 보다 일반화·튜닝 가능. 기존 DRAFT 가 있으면 overwriteDraft=true 명시 필요.',
  inputSchema: {
    type: 'object',
    properties: {
      year: { type: 'integer', description: '연도' },
      month: { type: 'integer', description: '월 (1-12)' },
      overwriteDraft: {
        type: 'boolean',
        description: '기존 DRAFT 덮어쓰기 (디폴트 false). PUBLISHED 는 절대 덮어쓰지 않음.',
      },
    },
    required: ['year', 'month'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({
    simulated: true,
    year: input.year,
    month: input.month,
    message: '시뮬레이션 모드 — 솔버 v2 stub',
  }),
  handler: async (input, ctx: ToolContext) => {
    const admin = await prisma.user.findFirst({
      where: { companyId: ctx.companyId, role: 'ADMIN', isActive: true },
      select: { id: true },
    });
    if (!admin) {
      throw new Error('회사에 활성 ADMIN 이 없어 배차표를 생성할 수 없습니다.');
    }

    const result = await generateMonthlyScheduleV2({
      companyId: ctx.companyId,
      year: input.year,
      month: input.month,
      adminId: admin.id,
      overwriteDraft: input.overwriteDraft ?? false,
    });

    // 에이전트 컨텍스트 절약을 위해 핵심 메트릭만 반환
    return {
      scheduleId: result.scheduleId,
      slotsCreated: result.slotsCreated,
      policyUsed: result.policyUsed,
      elapsedMs: result.elapsedMs,
      summary: result.output.summary,
      metrics: {
        fairnessScore: result.output.metrics.fairnessScore,
        workDayMean: result.output.metrics.workDayMean,
        workDayStdev: result.output.metrics.workDayStdev,
        withinTargetRate: result.output.metrics.withinTargetRate,
        withinAcceptableRate: result.output.metrics.withinAcceptableRate,
        hardViolationCount: result.output.metrics.hardViolationCount,
        exemptedCount: result.output.metrics.exemptedCount,
        restCycleCompliance: result.output.metrics.restCycleCompliance,
        homeBusRate: result.output.metrics.homeBusRate,
        crossRouteRate: result.output.metrics.crossRouteRate,
        unfilledCount: result.output.metrics.unfilledCount,
        constitutionalViolationCount: result.output.metrics.constitutionalViolations.length,
      },
      // 위반 목록은 상위 10건만 (컨텍스트 절약)
      hardViolators: result.output.workloads
        .filter((w) => w.workloadEval.hardViolation)
        .slice(0, 10)
        .map((w) => ({
          driverId: w.driverId,
          driverName: w.driverName,
          workDays: w.workDays,
          tier: w.workloadEval.tier,
        })),
      exempted: result.output.workloads
        .filter((w) => w.workloadEval.exempted)
        .slice(0, 10)
        .map((w) => ({
          driverId: w.driverId,
          driverName: w.driverName,
          workDays: w.workDays,
          reason: w.workloadEval.exemptionReason,
          note: w.workloadEval.exemptionNote,
        })),
      unfilled: result.output.unfilled.slice(0, 10),
    };
  },
};

// ─────────────────────────────────────────────
// 9. modify_slot  (Constitutional 검증 필수)
// ─────────────────────────────────────────────

const modifySlot: AgentTool<ModifySlotInput, unknown> = {
  name: 'modify_slot',
  description:
    '단일 배차 슬롯을 수정합니다 (기사 교체, shift 변경, 노선 변경). ' +
    '시스템이 자동으로 Constitutional Rules 12개를 검증합니다 — 위반 시 거부 + 사유 반환. ' +
    '발행된 배차표 (PUBLISHED) 의 슬롯은 긴급 결원이 아닌 한 수정 불가.',
  inputSchema: {
    type: 'object',
    properties: {
      slotId: { type: 'integer', description: 'ScheduleSlot.id' },
      newDriverId: { type: 'integer', description: '새 기사 ID (옵셔널)' },
      newShift: {
        type: 'string',
        enum: ['MORNING', 'AFTERNOON', 'FULL_DAY'],
        description: '새 shift (옵셔널)',
      },
      newRouteId: { type: 'integer', description: '새 노선 ID (옵셔널)' },
      reason: { type: 'string', description: '수정 사유 (감사 추적)' },
    },
    required: ['slotId', 'reason'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({
    simulated: true,
    slotId: input.slotId,
    reason: input.reason,
  }),
  handler: async (input, ctx: ToolContext) => {
    // 격리: 슬롯이 같은 회사인지 확인
    const slot = await prisma.scheduleSlot.findFirst({
      where: {
        id: input.slotId,
        schedule: { companyId: ctx.companyId },
      },
      include: {
        schedule: { select: { status: true } },
      },
    });
    if (!slot) {
      throw new Error(`Slot ${input.slotId} 를 찾을 수 없거나 회사 격리 위반.`);
    }

    const isPublished = slot.schedule.status === 'PUBLISHED';

    // Constitutional 검증: 발행된 배차표는 수정 불가 (긴급 오버라이드 제외)
    const violation = checkConstitutional({
      action: 'modify_slot',
      now: ctx.virtualNow,
      scheduleAlreadyPublished: isPublished,
      isEmergencyOverride: false, // DispatchAgent 에서는 긴급 오버라이드 없음
    });
    if (violation) {
      throw new Error(`Constitutional 위반: ${violation.message} (rule=${violation.rule})`);
    }

    // 새 기사 격리 검증
    if (input.newDriverId !== undefined) {
      const newDriver = await prisma.user.findFirst({
        where: {
          id: input.newDriverId,
          companyId: ctx.companyId,
          role: 'DRIVER',
          isActive: true,
        },
        select: { id: true, licenseExpiresAt: true, qualificationExpiresAt: true },
      });
      if (!newDriver) {
        throw new Error(`기사 ${input.newDriverId} 가 회사 소속 활성 기사가 아닙니다.`);
      }
      // 자격 검증
      const licViolation = checkConstitutional({
        action: 'assign_slot',
        now: ctx.virtualNow,
        driverLicense: {
          licenseExpiresAt: newDriver.licenseExpiresAt,
          qualificationExpiresAt: newDriver.qualificationExpiresAt,
        },
      });
      if (licViolation) {
        throw new Error(`Constitutional 위반: ${licViolation.message} (rule=${licViolation.rule})`);
      }
    }

    const updated = await prisma.scheduleSlot.update({
      where: { id: input.slotId },
      data: {
        ...(input.newDriverId !== undefined && { driverId: input.newDriverId }),
        ...(input.newShift !== undefined && { shift: input.newShift }),
        ...(input.newRouteId !== undefined && { routeId: input.newRouteId }),
        isManualOverride: true,
        overrideReason: input.reason,
      },
      select: {
        id: true,
        driverId: true,
        routeId: true,
        date: true,
        shift: true,
        status: true,
      },
    });

    return {
      slotId: updated.id,
      newState: {
        driverId: updated.driverId,
        routeId: updated.routeId,
        date: dateOnly(updated.date),
        shift: updated.shift,
      },
      reason: input.reason,
    };
  },
};

// ─────────────────────────────────────────────
// 10. publish_schedule  (휴먼 게이트)
// ─────────────────────────────────────────────

const publishSchedule: AgentTool<PublishScheduleInput, unknown> = {
  name: 'publish_schedule',
  description:
    '월간 배차표 발행을 "요청" 합니다. **자동 발행되지 않습니다** — Schedule 의 notes 필드에 ' +
    '에이전트 요약을 기록하고 관리자 검토 대기 상태로 둡니다. ' +
    '관리자가 어드민웹에서 명시 승인 시에만 PUBLISHED 상태로 전환됩니다 (휴먼 게이트). ' +
    '에이전트는 publish_schedule 호출 후 최종 텍스트 응답에 "관리자 승인 필요" 를 명시해야 합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      scheduleId: { type: 'integer', description: 'Schedule.id' },
      summary: { type: 'string', description: '관리자에게 보일 에이전트 요약 (한국어)' },
    },
    required: ['scheduleId', 'summary'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({
    simulated: true,
    scheduleId: input.scheduleId,
    requestedReview: true,
  }),
  handler: async (input, ctx: ToolContext) => {
    const schedule = await prisma.schedule.findFirst({
      where: { id: input.scheduleId, companyId: ctx.companyId },
      select: { id: true, status: true },
    });
    if (!schedule) {
      throw new Error(`배차표 ${input.scheduleId} 를 찾을 수 없거나 회사 격리 위반.`);
    }

    // 발행 자체는 안 함 — notes 에 요약 기록 + 상태는 DRAFT 유지
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: {
        notes: `[에이전트 발행 요청 ${ctx.sessionId}]\n${input.summary}`,
      },
    });

    return {
      scheduleId: schedule.id,
      currentStatus: schedule.status,
      reviewRequested: true,
      message: '관리자 검토 대기 중. 어드민웹에서 명시 승인 시에만 발행됩니다.',
    };
  },
};

// ─────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 11. swap_drivers (Constitutional 검증 필수, 두 슬롯 원자 교환)
// ─────────────────────────────────────────────

const swapDrivers: AgentTool<SwapDriversInput, unknown> = {
  name: 'swap_drivers',
  description:
    '두 슬롯의 기사를 원자적으로 교환합니다. modify_slot 두 번보다 안전한 swap 전용 도구. ' +
    '예: "기사 A의 4월 15일 슬롯" 과 "기사 B의 4월 17일 슬롯" 의 driverId 를 서로 교환. ' +
    '시스템이 양쪽 슬롯에 대해 Constitutional Rule 을 자동 검증. ' +
    '발행된 배차표는 긴급 결원이 아닌 한 swap 불가.',
  inputSchema: {
    type: 'object',
    properties: {
      slotAId: { type: 'integer', description: '교환할 슬롯 A의 ID' },
      slotBId: { type: 'integer', description: '교환할 슬롯 B의 ID' },
      reason: { type: 'string', description: '교환 사유 (감사 추적)' },
    },
    required: ['slotAId', 'slotBId', 'reason'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({ simulated: true, slotAId: input.slotAId, slotBId: input.slotBId }),
  handler: async (input, ctx: ToolContext) => {
    if (input.slotAId === input.slotBId) {
      throw new Error('동일한 슬롯끼리는 swap 불가.');
    }

    // 두 슬롯 모두 회사 격리 검증 + 발행 상태 확인
    const slots = await prisma.scheduleSlot.findMany({
      where: {
        id: { in: [input.slotAId, input.slotBId] },
        schedule: { companyId: ctx.companyId },
      },
      include: { schedule: { select: { status: true } } },
    });

    if (slots.length !== 2) {
      throw new Error(
        `Swap 대상 슬롯 ${input.slotAId}, ${input.slotBId} 중 일부를 찾을 수 없거나 회사 격리 위반.`
      );
    }

    const slotA = slots.find((s) => s.id === input.slotAId)!;
    const slotB = slots.find((s) => s.id === input.slotBId)!;

    // Constitutional: 발행된 배차표는 swap 불가
    for (const slot of [slotA, slotB]) {
      const violation = checkConstitutional({
        action: 'swap_drivers',
        now: ctx.virtualNow,
        scheduleAlreadyPublished: slot.schedule.status === 'PUBLISHED',
        isEmergencyOverride: false,
      });
      if (violation) {
        throw new Error(`Constitutional 위반 (slot=${slot.id}): ${violation.message}`);
      }
    }

    // 원자적 swap (트랜잭션)
    await prisma.$transaction([
      prisma.scheduleSlot.update({
        where: { id: slotA.id },
        data: {
          driverId: slotB.driverId,
          isManualOverride: true,
          overrideReason: `swap_with_${slotB.id}: ${input.reason}`,
        },
      }),
      prisma.scheduleSlot.update({
        where: { id: slotB.id },
        data: {
          driverId: slotA.driverId,
          isManualOverride: true,
          overrideReason: `swap_with_${slotA.id}: ${input.reason}`,
        },
      }),
    ]);

    return {
      slotAId: slotA.id,
      slotBId: slotB.id,
      slotANewDriverId: slotB.driverId,
      slotBNewDriverId: slotA.driverId,
      reason: input.reason,
    };
  },
};

// ─────────────────────────────────────────────
// 12. approve_dayoff
// ─────────────────────────────────────────────

const approveDayoff: AgentTool<ApproveDayoffInput, unknown> = {
  name: 'approve_dayoff',
  description:
    '휴무 신청을 승인합니다. 승인된 휴무는 Constitutional Rule "휴무일에 배차 금지" 를 ' +
    '발효시키므로 그 날짜에 해당 기사가 배차되어 있다면 별도로 modify_slot 으로 빼야 합니다. ' +
    '에이전트는 승인 전에 영향 받는 슬롯을 분석해야 합니다.',
  inputSchema: {
    type: 'object',
    properties: {
      requestId: { type: 'integer', description: 'DayOffRequest.id' },
      reviewNote: { type: 'string', description: '검토 메모 (옵셔널)' },
    },
    required: ['requestId'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({ simulated: true, requestId: input.requestId, status: 'APPROVED' }),
  handler: async (input, ctx: ToolContext) => {
    const request = await prisma.dayOffRequest.findFirst({
      where: { id: input.requestId, companyId: ctx.companyId },
      select: { id: true, status: true, driverId: true, date: true },
    });
    if (!request) {
      throw new Error(`휴무 신청 ${input.requestId} 를 찾을 수 없거나 회사 격리 위반.`);
    }
    if (request.status !== 'PENDING') {
      throw new Error(`휴무 신청 ${input.requestId} 가 이미 처리됨 (status=${request.status}).`);
    }

    // 영향 받는 배차 슬롯 식별 (해당 기사·해당 날짜)
    const conflictSlots = await prisma.scheduleSlot.findMany({
      where: {
        driverId: request.driverId,
        date: request.date,
        isRestDay: false,
        status: { in: ['SCHEDULED', 'FILLED'] },
      },
      select: { id: true, scheduleId: true },
    });

    await prisma.dayOffRequest.update({
      where: { id: request.id },
      data: {
        status: 'APPROVED',
        reviewNote: input.reviewNote ?? null,
      },
    });

    return {
      requestId: request.id,
      driverId: request.driverId,
      date: dateOnly(request.date),
      newStatus: 'APPROVED',
      conflictingSlotIds: conflictSlots.map((s) => s.id),
      followUpRequired: conflictSlots.length > 0
        ? `${conflictSlots.length}개 슬롯이 휴무일과 충돌 — modify_slot 으로 다른 기사 배정 필요`
        : null,
    };
  },
};

// ─────────────────────────────────────────────
// 13. reject_dayoff
// ─────────────────────────────────────────────

const rejectDayoff: AgentTool<RejectDayoffInput, unknown> = {
  name: 'reject_dayoff',
  description:
    '휴무 신청을 거절합니다. 거절 사유는 기사에게 알림 발송에 사용되므로 명확한 한국어로 작성. ' +
    '거절은 신중히 — 휴무 신청 거절률이 높으면 노조 분쟁 사유.',
  inputSchema: {
    type: 'object',
    properties: {
      requestId: { type: 'integer', description: 'DayOffRequest.id' },
      reviewNote: {
        type: 'string',
        description: '거절 사유 (한국어, 필수, 5자 이상)',
      },
    },
    required: ['requestId', 'reviewNote'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({ simulated: true, requestId: input.requestId, status: 'REJECTED' }),
  handler: async (input, ctx: ToolContext) => {
    if (!input.reviewNote || input.reviewNote.trim().length < 5) {
      throw new Error('거절 사유는 5자 이상 필수.');
    }

    const request = await prisma.dayOffRequest.findFirst({
      where: { id: input.requestId, companyId: ctx.companyId },
      select: { id: true, status: true, driverId: true, date: true },
    });
    if (!request) {
      throw new Error(`휴무 신청 ${input.requestId} 를 찾을 수 없거나 회사 격리 위반.`);
    }
    if (request.status !== 'PENDING') {
      throw new Error(`휴무 신청 ${input.requestId} 가 이미 처리됨.`);
    }

    await prisma.dayOffRequest.update({
      where: { id: request.id },
      data: {
        status: 'REJECTED',
        reviewNote: input.reviewNote.trim(),
      },
    });

    return {
      requestId: request.id,
      driverId: request.driverId,
      date: dateOnly(request.date),
      newStatus: 'REJECTED',
      reason: input.reviewNote.trim(),
    };
  },
};

// ─────────────────────────────────────────────
// 14. detect_constraint_violation (rule-compiler 활용)
// ─────────────────────────────────────────────

const detectConstraintViolation: AgentTool<DetectConstraintViolationInput, unknown> = {
  name: 'detect_constraint_violation',
  description:
    '특정 배차표의 회사·노조 규칙 위반을 자동 탐지합니다. ' +
    'CompanyRule 을 모두 가져와 자연어 → 검증 함수로 컴파일 후 모든 슬롯을 검증. ' +
    '인식 안 된 규칙은 unrecognizedRules 로 별도 표시 (수동 검토 필요). ' +
    'PHASE 2 출시 기준의 핵심 도구 — 노조 규칙 위반 0건 달성에 필수.',
  inputSchema: {
    type: 'object',
    properties: {
      scheduleId: { type: 'integer', description: '검증할 Schedule.id' },
    },
    required: ['scheduleId'],
  },
  handler: async (input, ctx: ToolContext) => {
    const schedule = await prisma.schedule.findFirst({
      where: { id: input.scheduleId, companyId: ctx.companyId },
      include: {
        slots: {
          select: {
            driverId: true,
            routeId: true,
            shift: true,
            isRestDay: true,
            date: true,
            status: true,
          },
        },
      },
    });
    if (!schedule) {
      throw new Error(`배차표 ${input.scheduleId} 를 찾을 수 없거나 회사 격리 위반.`);
    }

    const rules = await prisma.companyRule.findMany({
      where: { companyId: ctx.companyId, isActive: true },
      select: { content: true },
    });

    const slotsForValidation: SlotForFairness[] = schedule.slots.map((s) => ({
      driverId: s.driverId,
      routeId: s.routeId,
      shift: s.shift as 'MORNING' | 'AFTERNOON' | 'FULL_DAY',
      date: s.date,
      isRestDay: s.isRestDay,
      status: s.status,
    }));

    const report = compileAndValidate(
      rules.map((r) => r.content),
      slotsForValidation
    );

    return {
      scheduleId: input.scheduleId,
      totalRules: report.totalRules,
      compiledRules: report.compiledRules,
      unrecognizedRules: report.unrecognizedRules,
      violationCount: report.violations.length,
      violations: report.violations.slice(0, 30), // 최대 30건 (컨텍스트 절약)
      hasViolations: report.hasViolations,
      cleanForPublish: !report.hasViolations,
    };
  },
};

// ─────────────────────────────────────────────
// 15. request_human_review (명시적 휴먼 게이트)
// ─────────────────────────────────────────────

const requestHumanReview: AgentTool<RequestHumanReviewInput, unknown> = {
  name: 'request_human_review',
  description:
    '에이전트가 자율 결정으로는 처리할 수 없는 상황이 발생했을 때 명시적으로 관리자 검토를 요청. ' +
    '예: Constitutional 위반이 반복되어 해결 불가, 노조 규칙이 자가 모순, 데이터 이상 발견. ' +
    '이 도구 호출 후 에이전트는 작업을 종료해야 합니다 (진행 금지). ' +
    '관리자에게 푸시 + DB 알림 발송.',
  inputSchema: {
    type: 'object',
    properties: {
      scheduleId: { type: 'integer', description: '관련 배차표 ID (옵셔널)' },
      reason: {
        type: 'string',
        description: '검토 요청 사유 (한국어, 무엇을 시도했고 왜 실패했는지)',
      },
      severity: {
        type: 'string',
        enum: ['INFO', 'WARNING', 'CRITICAL'],
        description: '심각도',
      },
    },
    required: ['reason', 'severity'],
  },
  blockedInSimulation: true,
  simulationStub: (input) => ({
    simulated: true,
    severity: input.severity,
    reason: input.reason,
  }),
  handler: async (input, ctx: ToolContext) => {
    const admins = await prisma.user.findMany({
      where: {
        companyId: ctx.companyId,
        role: { in: ['ADMIN', 'DISPATCH', 'OWNER', 'DIRECTOR'] },
        isActive: true,
      },
      select: { id: true },
    });

    if (admins.length === 0) {
      return {
        notified: 0,
        warning: '활성 관리자가 없어 검토 요청 불가.',
      };
    }

    // (제거됨) DispatchAgent 관리자 알림(SCHEDULE_CHANGE) — 알림함 기록/푸시 모두 발송하지 않음.

    return {
      notified: 0,
      severity: input.severity,
      scheduleId: input.scheduleId ?? null,
      message: '관리자 알림은 비활성화되었습니다. 에이전트는 작업을 종료해야 합니다.',
    };
  },
};

export const DISPATCH_TOOLS_V1: AgentTool[] = [
  getDrivers as AgentTool,
  getRoutes as AgentTool,
  getActiveSchedule as AgentTool,
  getDayoffRequests as AgentTool,
  getCompanyRules as AgentTool,
  getDriverHistory as AgentTool,
  scoreFairness as AgentTool,
  draftMonthlySchedule as AgentTool,
  draftScheduleV2 as AgentTool,
  modifySlot as AgentTool,
  publishSchedule as AgentTool,
  swapDrivers as AgentTool,
  approveDayoff as AgentTool,
  rejectDayoff as AgentTool,
  detectConstraintViolation as AgentTool,
  requestHumanReview as AgentTool,
];
