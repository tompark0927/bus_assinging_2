/**
 * SolverDispatchService — DB ↔ monthly-grid-solver 브리지.
 *
 * 책임:
 *   1. DB (Prisma 모델) → SolverInput 매핑
 *   2. solveMonthlyGrid 실행
 *   3. SolverOutput → DB (Schedule + ScheduleSlot rows) 영속화
 *   4. 회사 정책 로딩 (회사별 override 지원, 디폴트 CITY_2SHIFT)
 *
 * legacy `scheduleService.generateMonthlySchedule` 와 차이:
 *   - 정책 외부화 (CompanyPolicy)
 *   - 일반화된 시프트/승무 모델 (SOLO/PAIR/TRIO, 1/2/3교대)
 *   - 헌법 룰 정책 기반 (ConstitutionalPolicy)
 *   - 명시적 메트릭 보고
 */

import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import type { ScheduleStatus, SlotStatus, ShiftType } from '@prisma/client';

import { solveMonthlyGrid } from '../agents/_solvers/monthly-grid-solver';
import {
  DEFAULT_POLICY,
  POLICY_PRESETS,
  type CompanyPolicy,
  type PolicyPreset,
  type ShiftSlot,
  type SolverCrew,
  type SolverDriver,
  type SolverInput,
  type SolverOutput,
} from '../agents/_solvers/types';

// ─────────────────────────────────────────────
// 순수 헬퍼 — 선호 노선 정렬
// ─────────────────────────────────────────────

/**
 * driverPreferences 배열을 priority 오름차순으로 정렬 후 routeId 만 추출.
 * (priority 낮을수록 = 더 선호)
 */
export function mapPreferredRouteIds(prefs: { routeId: number; priority: number }[]): number[] {
  return [...prefs].sort((a, b) => a.priority - b.priority).map((p) => p.routeId);
}

// ─────────────────────────────────────────────
// 정책 로딩
// ─────────────────────────────────────────────

/**
 * 회사 정책 로드 — 우선순위:
 *   1. Company.policy JSON 컬럼 (있고 valid 면 사용)
 *   2. 회사 코드별 prefix 자동 매핑 (VILLAGE/MARUNGI → VILLAGE_1SHIFT)
 *   3. DEFAULT_POLICY (CITY_2SHIFT)
 */
export async function loadCompanyPolicy(companyId: number): Promise<CompanyPolicy> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { code: true, name: true, policy: true },
  });
  if (!company) return DEFAULT_POLICY;

  // 1. DB 정책 우선
  if (company.policy && typeof company.policy === 'object') {
    const validated = validateCompanyPolicy(company.policy);
    if (validated) return validated;
    logger.warn('[SolverDispatch] Company.policy invalid — 디폴트 fallback', {
      companyId,
    });
  }

  // 2. 회사 코드별 prefix 매핑
  const code = (company.code ?? '').toUpperCase();
  if (code.startsWith('VILLAGE') || code.startsWith('MARUNGI')) {
    return POLICY_PRESETS.VILLAGE_1SHIFT;
  }
  return POLICY_PRESETS.CITY_2SHIFT;
}

/**
 * CompanyPolicy 런타임 검증 (Zod 없이 type guard).
 * 잘못된 JSON 이면 null 반환 → 호출자가 디폴트 사용.
 */
function validateCompanyPolicy(raw: unknown): CompanyPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // workdayBands 필수
  const wb = obj.workdayBands as Record<string, unknown> | undefined;
  if (!wb || typeof wb !== 'object') return null;
  const num = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);
  if (
    !num(wb.hardMin) ||
    !num(wb.hardMax) ||
    !num(wb.sweetMin) ||
    !num(wb.sweetMax) ||
    !num(wb.belowSweetPenalty) ||
    !num(wb.aboveSweetPenalty)
  )
    return null;
  if (wb.hardMin > wb.sweetMin || wb.sweetMax > wb.hardMax) return null;

  // restCycle 필수
  const rc = obj.restCycle as Record<string, unknown> | undefined;
  if (!rc || typeof rc !== 'object') return null;
  if (!num(rc.workDays) || !num(rc.restDays)) return null;
  if (typeof rc.consecutiveRest !== 'boolean') return null;

  // shiftSystem 필수
  const ss = obj.shiftSystem as Record<string, unknown> | undefined;
  if (!ss || typeof ss !== 'object') return null;
  if (typeof ss.kind !== 'string') return null;
  if (!Array.isArray(ss.slots) || ss.slots.length === 0) return null;
  if (!ss.slots.every((s) => typeof s === 'string')) return null;

  // crewModel 필수
  const cm = obj.crewModel as Record<string, unknown> | undefined;
  if (!cm || typeof cm !== 'object') return null;
  if (typeof cm.kind !== 'string') return null;
  if (!num(cm.size) || ![1, 2, 3].includes(cm.size)) return null;

  // constitutional 옵셔널 — 있으면 형식만 가볍게 체크
  const constitutional = obj.constitutional;
  if (constitutional !== undefined && typeof constitutional !== 'object') return null;

  return raw as CompanyPolicy;
}

// ─────────────────────────────────────────────
// DB → SolverInput
// ─────────────────────────────────────────────

interface BuildInputArgs {
  companyId: number;
  year: number;
  month: number;
  policy: CompanyPolicy;
  /** 운휴 차량 매핑 (없으면 매일 운행) */
  busOperatingDates?: Map<number, string[]>;
}

export async function buildSolverInputFromDb(
  args: BuildInputArgs,
): Promise<SolverInput> {
  const { companyId, year, month, policy, busOperatingDates } = args;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  // ── 운전자 (DRIVER 권한, 활성) ───
  const dbDrivers = await prisma.user.findMany({
    where: { companyId, role: 'DRIVER', isActive: true },
    select: {
      id: true,
      name: true,
      driverType: true,
      assignedBusNumber: true,
      licenseExpiresAt: true,
      qualificationExpiresAt: true,
      createdAt: true,
      routeAssignments: {
        where: { isActive: true },
        select: { routeId: true, startDate: true, endDate: true },
      },
      driverPreferences: {
        select: { routeId: true, priority: true },
      },
      dayOffRequests: {
        where: {
          companyId,
          status: 'APPROVED',
          date: { gte: monthStart, lte: monthEnd },
        },
        select: { date: true },
      },
    },
  });

  // ── 차량 ───
  const dbBuses = await prisma.bus.findMany({
    where: { companyId, isActive: true },
    select: { id: true, busNumber: true, routeId: true },
  });

  // ── 노선 → 노선별 차량의 기본 페어 매핑 (assignedBusNumber 로 매칭) ───
  const busByNumber = new Map(dbBuses.map((b) => [b.busNumber, b]));

  // ── SolverDriver 변환 ───
  const drivers: SolverDriver[] = [];
  const homeBusByDriverId = new Map<number, number>();

  for (const d of dbDrivers) {
    let homeBusId: number | undefined;
    let homeRouteId: number | undefined;

    // assignedBusNumber 로 home bus 찾기
    if (d.assignedBusNumber) {
      const bus = busByNumber.get(d.assignedBusNumber);
      if (bus) {
        homeBusId = bus.id;
        homeRouteId = bus.routeId ?? undefined;
      }
    }

    // route assignment 가 있으면 homeRoute 보정
    if (!homeRouteId && d.routeAssignments.length > 0) {
      const active = d.routeAssignments.find(
        (ra) =>
          ra.startDate <= monthEnd && (!ra.endDate || ra.endDate >= monthStart),
      );
      if (active) homeRouteId = active.routeId;
    }

    if (homeBusId !== undefined) homeBusByDriverId.set(d.id, homeBusId);

    // 신규 (입사 30일 이내)
    const isNewHire =
      d.createdAt && monthStart.getTime() - d.createdAt.getTime() < 30 * 24 * 60 * 60 * 1000;

    const preferredRouteIds = mapPreferredRouteIds(d.driverPreferences);
    drivers.push({
      id: d.id,
      name: d.name,
      homeBusId,
      homeRouteId,
      // SPARE 기사 (homeBus 없음) 또는 driverType=SPARE 는 노선 간 자유 투입 허용.
      // MAIN 기사는 homeBus 가 있는 한 자기 차/노선 우선 (canCrossRoute=false).
      canCrossRoute: homeBusId === undefined || d.driverType === 'SPARE',
      approvedDayOffs: d.dayOffRequests.map((r) =>
        r.date.toISOString().slice(0, 10),
      ),
      licenseExpiresAt: d.licenseExpiresAt ?? undefined,
      qualificationExpiresAt: d.qualificationExpiresAt ?? undefined,
      recentFatigueScore: 30, // placeholder; 향후 attendance·incident 기반 계산
      isNewHire: !!isNewHire,
      ...(preferredRouteIds.length > 0 ? { preferredRouteIds } : {}),
    });
  }

  // ── Crews — 같은 homeBusId 공유하는 운전자 그룹화 ───
  const crewsByBus = new Map<number, number[]>();
  for (const d of drivers) {
    if (d.homeBusId === undefined) continue;
    const arr = crewsByBus.get(d.homeBusId) ?? [];
    arr.push(d.id);
    crewsByBus.set(d.homeBusId, arr);
  }

  const crews: SolverCrew[] = [];
  for (const bus of dbBuses) {
    const driverIds = crewsByBus.get(bus.id) ?? [];
    if (driverIds.length === 0) continue; // 운전자 미배정 차량 skip
    if (bus.routeId === null) continue;
    crews.push({
      id: `BUS-${bus.id}`,
      driverIds: driverIds.slice(0, policy.crewModel.size),
      busId: bus.id,
      routeId: bus.routeId,
    });
  }

  // ── SolverBus ───
  const buses = dbBuses
    .filter((b) => b.routeId !== null)
    .map((b) => ({
      id: b.id,
      routeId: b.routeId as number,
      busNumber: b.busNumber,
      operatingDates: busOperatingDates?.get(b.id),
    }));

  return {
    year,
    month,
    drivers,
    buses,
    crews,
    policy,
    localSearchIterations: 2000,
  };
}

// ─────────────────────────────────────────────
// SolverOutput → DB 영속화
// ─────────────────────────────────────────────

/** ShiftSlot string → Prisma ShiftType enum 매핑 */
function toPrismaShift(shift: ShiftSlot): ShiftType {
  switch (shift) {
    case 'AM':
    case 'MORNING':
      return 'MORNING';
    case 'PM':
    case 'AFTERNOON':
      return 'AFTERNOON';
    case 'FULL_DAY':
    case 'ON_DUTY':
    case 'NIGHT':
      return 'FULL_DAY';
    default:
      return 'FULL_DAY';
  }
}

interface PersistArgs {
  companyId: number;
  year: number;
  month: number;
  adminId: number;
  policy: CompanyPolicy;
  output: SolverOutput;
  /** 기존 DRAFT 가 있으면 덮어쓰기 (true) 또는 에러 (false) */
  overwriteDraft?: boolean;
}

export async function persistSolverOutput(args: PersistArgs): Promise<{
  scheduleId: number;
  slotsCreated: number;
}> {
  const { companyId, year, month, adminId, policy, output, overwriteDraft = false } =
    args;

  // ── 트랜잭션: 기존 DRAFT 정리 → Schedule 생성 → Slots bulk insert ───
  return await prisma.$transaction(
    async (tx) => {
      const existing = await tx.schedule.findUnique({
        where: { companyId_year_month: { companyId, year, month } },
      });

      if (existing) {
        if (existing.status === 'PUBLISHED' || existing.status === 'ARCHIVED') {
          throw new Error(
            `이미 발행/아카이브된 ${year}년 ${month}월 배차표가 있습니다 (status=${existing.status}). 새 솔버 결과로 덮어쓸 수 없습니다.`,
          );
        }
        if (!overwriteDraft) {
          throw new Error(
            `${year}년 ${month}월 DRAFT 배차표가 이미 있습니다. overwriteDraft=true 로 덮어쓰세요.`,
          );
        }
        // 기존 DRAFT 슬롯 모두 삭제
        await tx.scheduleSlot.deleteMany({ where: { scheduleId: existing.id } });
        await tx.schedule.delete({ where: { id: existing.id } });
      }

      const schedule = await tx.schedule.create({
        data: {
          companyId,
          year,
          month,
          status: 'DRAFT' as ScheduleStatus,
          createdBy: adminId,
          notes: `Solver: ${policy.preset ?? 'CUSTOM'} | fairness ${output.metrics.fairnessScore}/100 | sweet ${(output.metrics.withinTargetRate * 100).toFixed(0)}% | hard 위반 ${output.metrics.hardViolationCount}`,
        },
      });

      // ── Slots bulk insert (createMany) ───
      const slotData = output.slots.map((s) => ({
        scheduleId: schedule.id,
        driverId: s.driverId,
        routeId: s.routeId,
        busId: s.busId,
        date: new Date(s.date + 'T00:00:00.000Z'),
        shift: toPrismaShift(s.shift),
        status: 'SCHEDULED' as SlotStatus,
        isRestDay: false,
        fairnessNote: `${s.familiarity}${s.isHomeBus ? '·HOME' : ''}`,
      }));

      await tx.scheduleSlot.createMany({
        data: slotData,
        skipDuplicates: true,
      });

      logger.info('[SolverDispatch] 영속화 완료', {
        companyId,
        scheduleId: schedule.id,
        slotsCreated: slotData.length,
        unfilled: output.unfilled.length,
        hardViolations: output.metrics.hardViolationCount,
      });

      return { scheduleId: schedule.id, slotsCreated: slotData.length };
    },
    { timeout: 60000 }, // 큰 회사는 수천 슬롯 → 60초 타임아웃
  );
}

// ─────────────────────────────────────────────
// 통합 진입점 — generateMonthlyScheduleV2
// ─────────────────────────────────────────────

export interface GenerateScheduleV2Result {
  scheduleId: number;
  slotsCreated: number;
  output: SolverOutput;
  policyUsed: PolicyPreset | 'CUSTOM';
  elapsedMs: number;
}

export async function generateMonthlyScheduleV2(args: {
  companyId: number;
  year: number;
  month: number;
  adminId: number;
  /** override policy (테스트·시뮬레이션용). 미지정 시 회사 정책 자동 로드 */
  policyOverride?: CompanyPolicy;
  overwriteDraft?: boolean;
}): Promise<GenerateScheduleV2Result> {
  const start = Date.now();
  const policy = args.policyOverride ?? (await loadCompanyPolicy(args.companyId));

  const input = await buildSolverInputFromDb({
    companyId: args.companyId,
    year: args.year,
    month: args.month,
    policy,
  });

  if (input.drivers.length === 0) {
    throw new Error(`회사 ${args.companyId} 에 활성 운전자가 없습니다.`);
  }
  if (input.buses.length === 0) {
    throw new Error(`회사 ${args.companyId} 에 노선 배정된 차량이 없습니다.`);
  }
  if (!input.crews || input.crews.length === 0) {
    throw new Error(
      `회사 ${args.companyId} 에 차량별 운전자 (assignedBusNumber) 매핑이 없습니다. 운전자 등록 시 차번을 입력하세요.`,
    );
  }

  const output = solveMonthlyGrid(input);

  const persisted = await persistSolverOutput({
    companyId: args.companyId,
    year: args.year,
    month: args.month,
    adminId: args.adminId,
    policy,
    output,
    overwriteDraft: args.overwriteDraft,
  });

  return {
    scheduleId: persisted.scheduleId,
    slotsCreated: persisted.slotsCreated,
    output,
    policyUsed: policy.preset ?? 'CUSTOM',
    elapsedMs: Date.now() - start,
  };
}
