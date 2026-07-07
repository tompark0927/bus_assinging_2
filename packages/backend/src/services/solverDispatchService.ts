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
  type DriverWorkdayTarget,
  type PolicyPreset,
  type ShiftSlot,
  type SolverCrew,
  type SolverDriver,
  type SolverInput,
  type SolverOutput,
  type WorkdayBandsPolicy,
} from '../agents/_solvers/types';
import { uniqueScheduleName } from './scheduleService';

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
// 내부 헬퍼 — Prisma ShiftType → SolverShiftSlot 역매핑
// ─────────────────────────────────────────────

/**
 * DB ShiftType (MORNING/AFTERNOON/FULL_DAY) → solver ShiftSlot ('AM'/'PM'/'FULL_DAY').
 * toPrismaShift 의 역방향.
 *   MORNING    → 'AM'
 *   AFTERNOON  → 'PM'
 *   FULL_DAY   → 'FULL_DAY'
 */
function fromPrismaShift(shift: string): ShiftSlot {
  switch (shift) {
    case 'MORNING':
      return 'AM';
    case 'AFTERNOON':
      return 'PM';
    default:
      return 'FULL_DAY';
  }
}

// ─────────────────────────────────────────────
// 순수 헬퍼 — 전월 이월 패턴 계산
// ─────────────────────────────────────────────

/**
 * 전월 마지막 근무 패턴 → carryOverPattern.
 *
 * @param priorSlots 한 기사의 전월 슬롯 (정렬 불필요)
 *   - date: 'YYYY-MM-DD' (UTC)
 *   - shift: ShiftSlot ('AM'|'PM'|'FULL_DAY' 등, solver 레이블)
 *   - isRestDay: true 이면 휴무 (비근무)
 * @param prevMonthEnd 전월 마지막 날 ('YYYY-MM-DD')
 *
 * 반환 undefined: 전월 데이터 없음.
 *
 * 로직:
 *   - workedDates: isRestDay=false 인 슬롯의 날짜 집합
 *   - consecutiveWorkDays: prevMonthEnd 부터 역방향으로 연속 근무일 카운트
 *   - lastShift: 마지막 근무일의 슬롯 (같은 날 복수 슬롯이면 PM 우선, 없으면 null)
 *   - lastWeekDominantShift: prevMonthEnd 기준 최근 7일의 가장 많은 시프트 ('MIXED' if tie)
 */
export function computeCarryOverPattern(
  priorSlots: { date: string; shift: ShiftSlot; isRestDay: boolean }[],
  prevMonthEnd: string,
): {
  consecutiveWorkDays: number;
  lastShift: ShiftSlot | null;
  lastWeekDominantShift: ShiftSlot | 'MIXED';
} | undefined {
  if (priorSlots.length === 0) return undefined;

  // ── 날짜별 비휴무 슬롯 목록 구성 ──────────────────────────────
  // date → ShiftSlot[] (isRestDay=false 인 것만)
  const workedSlotsByDate = new Map<string, ShiftSlot[]>();
  for (const s of priorSlots) {
    if (s.isRestDay) continue;
    const arr = workedSlotsByDate.get(s.date) ?? [];
    arr.push(s.shift);
    workedSlotsByDate.set(s.date, arr);
  }

  // ── lastShift — 마지막 날짜(prevMonthEnd)의 근무 슬롯 ─────────
  // 같은 날에 복수 슬롯이면 PM 우선 (TWO_SHIFT 패턴 대응)
  const lastDaySlots = workedSlotsByDate.get(prevMonthEnd) ?? [];
  let lastShift: ShiftSlot | null = null;
  if (lastDaySlots.length > 0) {
    lastShift = lastDaySlots.includes('PM') ? 'PM' : lastDaySlots[0];
  }

  // ── consecutiveWorkDays — prevMonthEnd 부터 역방향 카운트 ──────
  let consecutiveWorkDays = 0;
  // prevMonthEnd를 Date로 변환 (UTC)
  const endParts = prevMonthEnd.split('-').map(Number);
  let curDate = new Date(Date.UTC(endParts[0], endParts[1] - 1, endParts[2]));

  while (true) {
    const dateStr = curDate.toISOString().slice(0, 10);
    if (!workedSlotsByDate.has(dateStr)) break; // 슬롯 없음 or 휴무 → 스트릭 종료
    consecutiveWorkDays++;
    curDate = new Date(curDate.getTime() - 86400000); // -1일 (ms)
  }

  // ── lastWeekDominantShift — 마지막 7일 (prevMonthEnd 포함) ─────
  const endMs = new Date(Date.UTC(endParts[0], endParts[1] - 1, endParts[2])).getTime();
  const weekStartMs = endMs - 6 * 86400000; // 7일 = prevMonthEnd - 6days ~ prevMonthEnd

  const shiftCount = new Map<ShiftSlot, number>();
  for (const [dateStr, shifts] of workedSlotsByDate) {
    const dateParts = dateStr.split('-').map(Number);
    const dateMs = Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]);
    if (dateMs < weekStartMs || dateMs > endMs) continue;
    for (const sh of shifts) {
      shiftCount.set(sh, (shiftCount.get(sh) ?? 0) + 1);
    }
  }

  let lastWeekDominantShift: ShiftSlot | 'MIXED';
  if (shiftCount.size === 0) {
    // 마지막 7일에 근무 없음 → 전체 슬롯 중 가장 최근 근무일 시프트로 폴백
    // (lastShift 는 prevMonthEnd 기준이므로, prevMonthEnd 에 슬롯 없을 때 null 이 될 수 있음)
    let mostRecentDateMs = -Infinity;
    let mostRecentShift: ShiftSlot | null = null;
    for (const [dateStr, shifts] of workedSlotsByDate) {
      const dateParts = dateStr.split('-').map(Number);
      const dateMs = Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]);
      if (dateMs > mostRecentDateMs) {
        mostRecentDateMs = dateMs;
        mostRecentShift = shifts.includes('PM') ? 'PM' : shifts[0];
      }
    }
    lastWeekDominantShift = mostRecentShift ?? 'MIXED';
  } else {
    // 가장 높은 빈도 찾기 (동점 → MIXED)
    let maxCount = 0;
    let dominant: ShiftSlot | null = null;
    let isTie = false;
    for (const [sh, cnt] of shiftCount) {
      if (cnt > maxCount) {
        maxCount = cnt;
        dominant = sh;
        isTie = false;
      } else if (cnt === maxCount) {
        isTie = true;
      }
    }
    lastWeekDominantShift = isTie || dominant === null ? 'MIXED' : dominant;
  }

  return { consecutiveWorkDays, lastShift, lastWeekDominantShift };
}

// ─────────────────────────────────────────────
// 순수 헬퍼 — 전월 피로도 계산
// ─────────────────────────────────────────────

/**
 * 전월 근무 슬롯의 노선 fatigueScore 합을 0~100 으로 정규화한 피로도.
 *
 * @param priorSlots 해당 기사의 전월 비휴무 슬롯 [{ routeId }]
 * @param routeFatigueById routeId → fatigueScore(1~5) 매핑
 *
 * 정규화 공식:
 *   1. avgRouteFatigue = 근무 슬롯의 평균 nolineFatigue (Map 에 없는 노선 → 3 처리)
 *   2. base = (avgRouteFatigue - 1) / 4 * 100   (1→0, 5→100 선형 매핑)
 *   3. intensity = min(1, slots.length / 22)     (22 ≈ 풀 월 근무일)
 *   4. score = round(clamp(base * intensity, 0, 100))
 *   5. 전월 슬롯 없음 → 30 (중립 기본값; 기존 placeholder 와 동일하므로 이력 없는 기사 안전)
 *
 * 단조성:
 *   - 노선 피로도가 높을수록 score ↑
 *   - 근무일수가 많을수록 score ↑ (22일 이상은 상한)
 *   - 결과: 0~100 정수, 항상 clamp 보장
 */
export function computeRecentFatigue(
  priorSlots: { routeId: number }[],
  routeFatigueById: Map<number, number>,
): number {
  if (priorSlots.length === 0) return 30;

  const DEFAULT_FATIGUE = 3; // 노선 정보 없을 때 중립값

  const total = priorSlots.reduce((sum, slot) => {
    const raw = routeFatigueById.get(slot.routeId);
    // Guard: ?? only catches undefined/null, not NaN. Explicit isNaN check is required
    // so that corrupt DB values (NaN) fall back to DEFAULT_FATIGUE instead of propagating.
    const fatigue = (raw === undefined || raw === null || Number.isNaN(raw)) ? DEFAULT_FATIGUE : raw;
    return sum + fatigue;
  }, 0);

  const avgRouteFatigue = total / priorSlots.length;          // 1..5
  const base = ((avgRouteFatigue - 1) / 4) * 100;            // 0..100
  const intensity = Math.min(1, priorSlots.length / 22);     // 0..1
  const score = Math.round(Math.min(100, Math.max(0, base * intensity)));

  return score;
}

// ─────────────────────────────────────────────
// 순수 헬퍼 — 신규 입사 근무일수 면제 타겟
// ─────────────────────────────────────────────

/**
 * 신규 입사자(isNewHire=true)에게 workDayTarget을 생성한다.
 *
 * 신규 기사는 월중 입사로 hardMin을 채우지 못하는 경우가 많으므로
 * UNDER_MIN 발생 시 hard violation이 아닌 EXEMPTED 처리가 되어야 한다.
 * evaluateWorkload는 이미 exemptReason을 지원하므로 여기서는 타겟만 생성.
 *
 * @param isNewHire 배차표 생성 시 관리자가 신규로 지정한 기사 여부
 * @param bands 회사 policy.workdayBands
 * @returns DriverWorkdayTarget (신규) 또는 undefined (일반)
 */
export function newHireWorkdayTarget(
  isNewHire: boolean,
  bands: WorkdayBandsPolicy,
): DriverWorkdayTarget | undefined {
  if (!isNewHire) return undefined;
  return {
    min: bands.hardMin,
    max: bands.hardMax,
    softMin: bands.sweetMin,
    softMax: bands.sweetMax,
    exemptReason: 'NEW_HIRE',
    exemptNote: '관리자 지정 신규 기사',
  };
}

/**
 * 예비(스페어) 기사 workDayTarget — 정규 배차 하한 면제.
 *
 * 스페어는 대타·휴가 충원이 본업이라 정규 배차가 적은 것이 정상 상태다.
 * 하한(UNDER_MIN)을 hard violation 으로 잡으면 공정성 점수가 왜곡되므로 면제 처리.
 * 상한(OVER_MAX)은 안전·노동법 사안이라 그대로 적용된다.
 */
export function spareWorkdayTarget(
  isSpare: boolean,
  bands: WorkdayBandsPolicy,
): DriverWorkdayTarget | undefined {
  if (!isSpare) return undefined;
  return {
    min: bands.hardMin,
    max: bands.hardMax,
    softMin: bands.sweetMin,
    softMax: bands.sweetMax,
    exemptReason: 'SPARE_DRIVER',
    exemptNote: '예비 기사 — 정규 배차 하한 미적용',
  };
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
  /** 배차표 생성 시 관리자가 직접 지정한 신규 기사 (자동 판정 없음) */
  newHireDriverIds?: Set<number>;
  /** 사고 등으로 특정 노선 배차를 금지할 기사 매핑 (driverId → 금지 routeId 목록) */
  blockedRouteIdsByDriver?: Map<number, number[]>;
}

export async function buildSolverInputFromDb(
  args: BuildInputArgs,
): Promise<SolverInput> {
  const { companyId, year, month, policy, busOperatingDates, newHireDriverIds, blockedRouteIdsByDriver } = args;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  // ── 전월 날짜 범위 (Jan → prev Dec 롤오버 처리) ───
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthStart = new Date(Date.UTC(prevYear, prevMonth - 1, 1));
  const prevMonthEnd = new Date(Date.UTC(prevYear, prevMonth, 0));

  // ── 전월 슬롯 + 노선 피로도 (recentFatigueScore + carryOverPattern 계산용) ───
  // NOTE: isRestDay 필터 제거 — carryOverPattern 은 휴무일도 포함해야 스트릭을 올바르게 계산.
  //       피로도 계산은 비휴무 슬롯만 쓰므로 아래 그룹화 시 isRestDay 기준으로 분리.
  const [prevSlots, dbRoutes] = await Promise.all([
    prisma.scheduleSlot.findMany({
      where: {
        schedule: { companyId },
        date: { gte: prevMonthStart, lte: prevMonthEnd },
      },
      select: {
        driverId: true,
        routeId: true,
        date: true,
        shift: true,
        isRestDay: true,
      },
    }),
    prisma.route.findMany({
      where: { companyId },
      select: { id: true, fatigueScore: true },
    }),
  ]);

  // routeId → fatigueScore 맵
  const routeFatigueById = new Map<number, number>(
    dbRoutes.map((r) => [r.id, r.fatigueScore]),
  );

  // 기사별 전월 슬롯 그룹화
  //   - fatigue 계산용: 비휴무 슬롯의 routeId
  //   - carryOver 계산용: 전체 슬롯 (date, shift, isRestDay)
  const prevFatigueSlotsByDriver = new Map<number, { routeId: number }[]>();
  const prevCarrySlotsByDriver = new Map<
    number,
    { date: string; shift: ShiftSlot; isRestDay: boolean }[]
  >();

  // prevMonthEnd string ('YYYY-MM-DD') for computeCarryOverPattern
  const prevMonthEndStr = prevMonthEnd.toISOString().slice(0, 10);

  for (const s of prevSlots) {
    // Fatigue: 비휴무 슬롯만
    if (!s.isRestDay) {
      const arr = prevFatigueSlotsByDriver.get(s.driverId) ?? [];
      arr.push({ routeId: s.routeId });
      prevFatigueSlotsByDriver.set(s.driverId, arr);
    }
    // CarryOver: 모든 슬롯
    const carryArr = prevCarrySlotsByDriver.get(s.driverId) ?? [];
    carryArr.push({
      date: s.date.toISOString().slice(0, 10),
      shift: fromPrismaShift(s.shift),
      isRestDay: s.isRestDay,
    });
    prevCarrySlotsByDriver.set(s.driverId, carryArr);
  }

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

    // 신규 = 배차표 생성 시 관리자가 직접 지정한 기사만 (자동 판정 제거)
    const isNewHire = !!newHireDriverIds?.has(d.id);

    // 사고 등으로 배차 금지된 노선 (driverId 기준)
    const blockedRouteIds = blockedRouteIdsByDriver?.get(d.id);

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
      recentFatigueScore: computeRecentFatigue(
        prevFatigueSlotsByDriver.get(d.id) ?? [],
        routeFatigueById,
      ),
      isNewHire,
      // 신규 지정이 우선, 아니면 스페어 기사 하한 면제 적용
      workDayTarget:
        newHireWorkdayTarget(isNewHire, policy.workdayBands) ??
        spareWorkdayTarget(d.driverType === 'SPARE', policy.workdayBands),
      ...(blockedRouteIds && blockedRouteIds.length > 0 ? { blockedRouteIds } : {}),
      ...(preferredRouteIds.length > 0 ? { preferredRouteIds } : {}),
      // 전월 이월 패턴 (5/2 룰 + 주간 시프트 교대 연속성)
      ...((() => {
        const carrySlots = prevCarrySlotsByDriver.get(d.id);
        if (!carrySlots) return {};
        const pattern = computeCarryOverPattern(carrySlots, prevMonthEndStr);
        return pattern ? { carryOverPattern: pattern } : {};
      })()),
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
  /** 초안 프로필 이름 — 미지정 시 "초안 N" 자동 부여 */
  name?: string;
  /** @deprecated 멀티 초안 도입으로 항상 새 초안을 생성한다 (무시됨) */
  overwriteDraft?: boolean;
}

export async function persistSolverOutput(args: PersistArgs): Promise<{
  scheduleId: number;
  slotsCreated: number;
}> {
  const { companyId, year, month, adminId, policy, output } = args;

  // ── 트랜잭션: 새 초안 생성 → Slots bulk insert ───
  // 멀티 초안: 기존 초안·발행본은 건드리지 않고 항상 새 DRAFT 를 추가한다 (월당 최대 5개).
  return await prisma.$transaction(
    async (tx) => {
      const draftCount = await tx.schedule.count({
        where: { companyId, year, month, status: 'DRAFT' },
      });
      if (draftCount >= 5) {
        throw new Error(
          `${year}년 ${month}월 초안이 이미 5개입니다. 사용하지 않는 초안을 삭제한 후 다시 생성해주세요.`,
        );
      }

      const name = await uniqueScheduleName(
        companyId,
        year,
        month,
        args.name?.trim() || `초안 ${draftCount + 1}`,
        tx,
      );
      const schedule = await tx.schedule.create({
        data: {
          companyId,
          year,
          month,
          name,
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
  /** @deprecated 멀티 초안 도입으로 항상 새 초안을 생성한다 (무시됨) */
  overwriteDraft?: boolean;
  /** 초안 프로필 이름 — 미지정 시 "초안 N" 자동 부여 */
  name?: string;
  /** 근무/휴무 사이클 오버라이드 (생성 모달의 근무 일수·휴무 일수 입력) */
  restCycleOverride?: { workDays: number; restDays: number };
  /** 생성 시 수동 지정 신규 기사 ID */
  newHireDriverIds?: number[];
  /** 노선별 사고(배차 금지) 기사 — 노선 id 기준 */
  blockedRoutes?: { routeId: number; driverIds: number[] }[];
}): Promise<GenerateScheduleV2Result> {
  const start = Date.now();
  const basePolicy = args.policyOverride ?? (await loadCompanyPolicy(args.companyId));
  // 생성 모달에서 입력한 근무/휴무 일수를 회사 정책 위에 덮어쓴다
  const policy = args.restCycleOverride
    ? {
        ...basePolicy,
        restCycle: {
          ...basePolicy.restCycle,
          workDays: args.restCycleOverride.workDays,
          restDays: args.restCycleOverride.restDays,
        },
      }
    : basePolicy;

  // 노선별 사고 기사 → driverId → 금지 routeId 목록 으로 변환
  const blockedRouteIdsByDriver = new Map<number, number[]>();
  for (const b of args.blockedRoutes ?? []) {
    for (const did of b.driverIds) {
      const arr = blockedRouteIdsByDriver.get(did) ?? [];
      if (!arr.includes(b.routeId)) arr.push(b.routeId);
      blockedRouteIdsByDriver.set(did, arr);
    }
  }

  const input = await buildSolverInputFromDb({
    companyId: args.companyId,
    year: args.year,
    month: args.month,
    policy,
    newHireDriverIds: args.newHireDriverIds ? new Set(args.newHireDriverIds) : undefined,
    blockedRouteIdsByDriver: blockedRouteIdsByDriver.size > 0 ? blockedRouteIdsByDriver : undefined,
  });

  if (input.drivers.length === 0) {
    throw new Error('등록된 활성 기사가 없습니다. 기본정보 관리에서 기사를 먼저 등록해주세요.');
  }
  if (input.buses.length === 0) {
    throw new Error('노선에 배정된 차량이 없습니다. 기본정보 관리에서 차량과 노선을 먼저 등록해주세요.');
  }
  if (!input.crews || input.crews.length === 0) {
    throw new Error('차량에 배정된 기사가 없습니다. 기사 등록 시 담당 차량(차번)을 입력해주세요.');
  }

  const output = solveMonthlyGrid(input);

  const persisted = await persistSolverOutput({
    companyId: args.companyId,
    year: args.year,
    month: args.month,
    adminId: args.adminId,
    policy,
    output,
    name: args.name,
  });

  return {
    scheduleId: persisted.scheduleId,
    slotsCreated: persisted.slotsCreated,
    output,
    policyUsed: policy.preset ?? 'CUSTOM',
    elapsedMs: Date.now() - start,
  };
}
