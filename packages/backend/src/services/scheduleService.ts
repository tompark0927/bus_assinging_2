import { prisma } from '../utils/prisma';
import { SlotStatus, ShiftType, ServiceType } from '@prisma/client';
import logger from '../utils/logger';
import { getHolidaysForMonth } from '../utils/holidays';
import { serviceTypeLabel, driverScopeFor, routeScopeFor } from '../utils/serviceType';

interface ScheduleSlotInput {
  scheduleId: number;
  driverId: number;
  routeId: number;
  busId?: number;
  date: Date;
  shift: ShiftType;
  status: SlotStatus;
  isRestDay: boolean;
  isManualOverride?: boolean;
  fairnessNote?: string;
  notes?: string;
}

// ─────────────────────────────────────────────────────
// 교대조 결정 (14일 사이클)
// ─────────────────────────────────────────────────────
function getShiftType(date: Date, shiftGroup: string | null): ShiftType {
  if (!shiftGroup) return 'FULL_DAY';
  const base = new Date(2000, 0, 1);
  const daySerial = Math.floor((date.getTime() - base.getTime()) / 86400000);
  const block = Math.floor(daySerial / 14) % 2;
  if (shiftGroup === '1조') {
    return block === 0 ? 'MORNING' : 'AFTERNOON';
  }
  return block === 0 ? 'AFTERNOON' : 'MORNING';
}

// ─────────────────────────────────────────────────────
// 공정성 점수 계산 (낮을수록 우선 배정)
// ─────────────────────────────────────────────────────
interface FairnessContext {
  recentFatigueTotal: number;  // 최근 7일 누적 피로도
  preferredRouteIds: number[]; // 선호 노선 ID (우선순위 순)
  consecutiveWorkDays: number; // 연속 근무일
  totalWorkDays: number;       // 이번 달 총 근무일
  totalRestDays: number;       // 이번 달 총 휴무일
}

// ─────────────────────────────────────────────────────
// 블랙리스트 충돌 체크
// ─────────────────────────────────────────────────────
interface BlacklistRule {
  driverId: number;
  targetDriverId: number | null;
  tag: string;
  isHardRule: boolean;
}

function hasBlacklistConflict(
  driverId: number,
  routeId: number,
  date: Date,
  dateDriverMap: Map<string, Set<number>>,
  blacklistRules: BlacklistRule[],
): { blocked: boolean; reason?: string } {
  const dateStr = date.toISOString().split('T')[0];
  const driversOnDate = dateDriverMap.get(dateStr) || new Set();

  for (const rule of blacklistRules) {
    if (!rule.isHardRule || !rule.targetDriverId) continue;
    if (rule.driverId === driverId && driversOnDate.has(rule.targetDriverId)) {
      return { blocked: true, reason: `${rule.tag} — 같은 날 배정 불가` };
    }
    if (rule.targetDriverId === driverId && driversOnDate.has(rule.driverId)) {
      return { blocked: true, reason: `${rule.tag} — 같은 날 배정 불가` };
    }
  }
  return { blocked: false };
}

// ─────────────────────────────────────────────────────
// 🔥 AI 배차 엔진 — 공정성 기반 자동 배차
// ─────────────────────────────────────────────────────
export async function generateMonthlySchedule(
  companyId: number,
  year: number,
  month: number,
  adminId: number,
  rules?: {
    workDays?: number;
    restDays?: number;
    customRules?: string;
    /** 간선/지선/광역 — 지정하면 그 종류의 노선·기사만으로 짠다. null = 구분 없음(전 노선) */
    serviceType?: ServiceType | null;
  }
): Promise<{ scheduleId: number; slotsCreated: number; warnings: string[]; fairnessReport: FairnessReportEntry[] }> {
  const workDays = rules?.workDays ?? 5;
  const restDays = rules?.restDays ?? 2;
  const cycleLength = workDays + restDays;
  const warnings: string[] = [];
  const serviceType = rules?.serviceType ?? null;
  // 종류를 지정하면 그 종류의 노선·기사만 배차 대상이다.
  // 구분 미지정 기사는 제외되며, 몇 명이 빠졌는지 아래에서 경고로 남긴다.
  const routeScope = routeScopeFor(serviceType);
  const driverScope = driverScopeFor(serviceType);

  // ── 커스텀 규칙 파싱 ────────────────────────────────
  let maxConsecutiveWork = 0; // 0 = 제한 없음
  const appliedRules: string[] = [];

  if (rules?.customRules) {
    // "연속 N일 근무 금지" / "연속 N일 이상 근무 금지" 패턴 감지
    const consecutiveMatch = rules.customRules.match(/연속\s*(\d+)\s*일?\s*(이상\s*)?(근무\s*)?(금지|제한|불가)/);
    if (consecutiveMatch) {
      maxConsecutiveWork = parseInt(consecutiveMatch[1], 10);
      appliedRules.push(`연속 ${maxConsecutiveWork}일 이상 근무 금지`);
    }

    // 적용된 규칙 요약을 경고에 포함
    if (appliedRules.length > 0) {
      warnings.push(`[적용 규칙] ${appliedRules.join(', ')}`);
    }
  }

  // ── 데이터 조회 ──────────────────────────────────────
  const prevScheduleIds = await resolveMonthScheduleIdsAllTypes(
    companyId,
    month === 1 ? year - 1 : year,
    month === 1 ? 12 : month - 1,
  );
  const [mainDrivers, spareDrivers, routes, blacklistRules, allPreferences, previousSlots] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, role: 'DRIVER', isActive: true, driverType: 'MAIN', ...driverScope },
      include: {
        routeAssignments: { where: { isActive: true }, include: { route: { include: { buses: { where: { isActive: true } } } } }, take: 1 },
        dayOffRequests: { where: { status: 'APPROVED', date: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) } } },
      },
    }) as Promise<(Awaited<ReturnType<typeof prisma.user.findMany>>[number] & { routeAssignments: any[]; dayOffRequests: any[]; licenseExpiresAt: Date | null; qualificationExpiresAt: Date | null })[]>,
    prisma.user.findMany({
      where: { companyId, role: 'DRIVER', isActive: true, driverType: 'SPARE', ...driverScope },
      include: {
        dayOffRequests: { where: { status: 'APPROVED', date: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) } } },
      },
    }) as Promise<(Awaited<ReturnType<typeof prisma.user.findMany>>[number] & { dayOffRequests: any[]; licenseExpiresAt: Date | null; qualificationExpiresAt: Date | null })[]>,
    prisma.route.findMany({
      where: { companyId, isActive: true, ...routeScope },
      include: { buses: { where: { isActive: true } } },
    }),
    // 블랙리스트 태그 (하드룰만)
    prisma.driverTag.findMany({
      where: { companyId, isHardRule: true },
      select: { driverId: true, targetDriverId: true, tag: true, isHardRule: true },
    }),
    // 기사 선호 노선
    prisma.driverPreference.findMany({
      where: { driver: { companyId } },
      orderBy: { priority: 'asc' },
    }),
    // 지난달 슬롯 (피로도 누적 계산용) — 종류별 대표 1개씩만.
    // 초안까지 긁으면 같은 기사가 여러 번 세어져 피로도가 부풀려진다.
    prisma.scheduleSlot.findMany({
      where: {
        scheduleId: { in: prevScheduleIds },
        date: {
          gte: new Date(year, month - 2, 1),
          lt: new Date(year, month - 1, 1),
        },
        isRestDay: false,
      },
      include: { route: { select: { fatigueScore: true } } },
    }),
  ]);

  // 구분 미지정 기사는 어느 종류 배차표에도 넣지 않는다 — 조용히 빠지면
  // "왜 이 사람이 배차표에 없지?" 가 되므로 반드시 드러낸다.
  if (serviceType) {
    const unassigned = await prisma.user.count({
      where: { companyId, role: 'DRIVER', isActive: true, serviceType: null },
    });
    if (unassigned > 0) {
      warnings.push(
        `[노선 구분] 구분 미지정 기사 ${unassigned}명은 ${serviceTypeLabel(serviceType)} 배차표에서 제외했습니다. ` +
        '기초 데이터 > 기사에서 노선 종류를 지정해주세요.',
      );
    }
  }

  if (routes.length === 0) {
    throw new Error(
      serviceType
        ? `${serviceTypeLabel(serviceType)} 노선이 없습니다. 기초 데이터 > 노선에서 종류를 지정해주세요.`
        : '등록된 노선이 없습니다. 먼저 노선을 등록해주세요.',
    );
  }
  if (mainDrivers.length === 0 && spareDrivers.length === 0) {
    throw new Error(
      serviceType
        ? `${serviceTypeLabel(serviceType)} 기사가 없습니다. 기초 데이터 > 기사에서 노선 종류를 지정해주세요.`
        : '등록된 활성 기사가 없습니다.',
    );
  }

  // ── 면허/자격증 만료 기사 필터링 ──────────────────────
  const monthEnd = new Date(year, month, 0); // 해당 월 마지막 날
  const filterExpired = <T extends { id: number; name: string; licenseExpiresAt: Date | null; qualificationExpiresAt: Date | null }>(
    drivers: T[], label: string
  ): T[] => {
    return drivers.filter(d => {
      if (d.licenseExpiresAt && d.licenseExpiresAt < monthEnd) {
        warnings.push(`[면허만료] ${d.name} 기사님 운전면허 ${d.licenseExpiresAt.toISOString().split('T')[0]} 만료 → ${label} 제외`);
        return false;
      }
      if (d.qualificationExpiresAt && d.qualificationExpiresAt < monthEnd) {
        warnings.push(`[자격만료] ${d.name} 기사님 버스자격증 ${d.qualificationExpiresAt.toISOString().split('T')[0]} 만료 → ${label} 제외`);
        return false;
      }
      return true;
    });
  };

  const validMainDrivers = filterExpired(mainDrivers, '배차');
  const validSpareDrivers = filterExpired(spareDrivers, '예비배차');

  // ── 지난달 피로도 누적 맵 ──────────────────────────────
  const lastMonthFatigueMap = new Map<number, number>();
  for (const slot of previousSlots) {
    const prev = lastMonthFatigueMap.get(slot.driverId) || 0;
    lastMonthFatigueMap.set(slot.driverId, prev + (slot.route?.fatigueScore || 3));
  }

  // ── 선호 노선 맵 ──────────────────────────────────────
  const preferenceMap = new Map<number, number[]>();
  for (const pref of allPreferences) {
    if (!preferenceMap.has(pref.driverId)) preferenceMap.set(pref.driverId, []);
    preferenceMap.get(pref.driverId)!.push(pref.routeId);
  }

  // ── 노선별 피로도 맵 ──────────────────────────────────
  const routeFatigueMap = new Map<number, number>();
  for (const route of routes) {
    routeFatigueMap.set(route.id, route.fatigueScore);
  }

  // ── 인력 검증 + 경고 ──────────────────────────────────
  const cycleRatio = cycleLength / workDays;
  for (const route of routes) {
    const busCount = route.buses.length;
    const minRequired = Math.ceil(busCount * cycleRatio);
    const assigned = validMainDrivers.filter(d => d.routeAssignments.some(ra => ra.routeId === route.id)).length;
    if (busCount > 0 && assigned < minRequired) {
      warnings.push(`[인력부족] ${route.routeNumber}번: 버스 ${busCount}대, 최소 ${minRequired}명 필요, 현재 ${assigned}명`);
    }
  }

  const unrouted = validMainDrivers.filter(d => d.routeAssignments.length === 0);
  for (const d of unrouted) {
    warnings.push(`${d.name} 기사님은 배정 노선 없어 제외`);
  }

  // ── 새 초안 생성 (멀티 초안 — 기존 초안은 유지, 월당 최대 5개) ───────
  const schedule = await prisma.$transaction(async (tx) => {
    const draftCount = await tx.schedule.count({
      where: { companyId, year, month, serviceType, status: 'DRAFT' },
    });
    if (draftCount >= 5) {
      throw new Error('이 달의 초안이 이미 5개입니다. 사용하지 않는 초안을 삭제한 후 다시 생성해주세요.');
    }
    return tx.schedule.create({
      data: { companyId, year, month, serviceType, status: 'DRAFT', createdBy: adminId, name: `초안 ${draftCount + 1}` },
    });
  });

  const daysInMonth = new Date(year, month, 0).getDate();
  const slots: ScheduleSlotInput[] = [];

  // ── 공휴일 맵 ──────────────────────────────────────
  const holidayMap = getHolidaysForMonth(year, month);
  if (holidayMap.size > 0) {
    const names = [...holidayMap.values()].join(', ');
    warnings.push(`[공휴일] 이번 달 공휴일: ${names}`);
  }

  // ── 노선별 MAIN 기사 그룹화 ──────────────────────────
  const routeDriverMap = new Map<number, typeof validMainDrivers>();
  for (const route of routes) {
    const group = validMainDrivers.filter(d => d.routeAssignments.some(ra => ra.routeId === route.id));
    group.sort((a, b) => {
      const sg = (s: string | null) => s === '1조' ? 0 : s === '2조' ? 1 : 2;
      return sg(a.shiftGroup) - sg(b.shiftGroup);
    });
    routeDriverMap.set(route.id, group);
  }

  // ── 오프셋 + 휴무 맵 ──────────────────────────────────
  const offsetMap = new Map<number, number>();
  for (const [, group] of routeDriverMap) {
    group.forEach((driver, i) => { offsetMap.set(driver.id, i % cycleLength); });
  }
  validSpareDrivers.forEach((driver, i) => { offsetMap.set(driver.id, i % cycleLength); });

  const dayOffMap = new Map<number, Set<string>>();
  for (const driver of [...validMainDrivers, ...validSpareDrivers]) {
    const offDates = new Set<string>();
    for (const req of driver.dayOffRequests) offDates.add(req.date.toISOString().split('T')[0]);
    dayOffMap.set(driver.id, offDates);
  }

  // ── 공정성 추적 ──────────────────────────────────────
  const fatigueTracker = new Map<number, number>(); // driverId → 이번 달 누적 피로도
  const workDayTracker = new Map<number, number>();  // driverId → 이번 달 근무일
  const restDayTracker = new Map<number, number>();  // driverId → 이번 달 휴무일
  const dateDriverMap = new Map<string, Set<number>>(); // dateStr → 해당 날 근무 기사 set

  // 초기값 (지난달 피로도 고려)
  for (const driver of [...validMainDrivers, ...validSpareDrivers]) {
    fatigueTracker.set(driver.id, lastMonthFatigueMap.get(driver.id) || 0);
    workDayTracker.set(driver.id, 0);
    restDayTracker.set(driver.id, 0);
  }

  // ── 빈자리 추적 ──────────────────────────────────────
  const vacancyMap = new Map<string, { routeId: number; busId?: number; fatigueScore: number }[]>();

  // ── MAIN 기사 슬롯 생성 ────────────────────────────────
  for (const driver of validMainDrivers) {
    if (driver.routeAssignments.length === 0) continue;
    const ra = driver.routeAssignments[0];
    const route = routes.find(r => r.id === ra.routeId);
    if (!route) continue;

    const routeGroup = routeDriverMap.get(route.id) || [];
    const idx = routeGroup.findIndex(d => d.id === driver.id);
    const bus = route.buses.length > 0 ? route.buses[idx % route.buses.length] : undefined;
    const driverOffDates = dayOffMap.get(driver.id) || new Set<string>();
    let cyclePosition = offsetMap.get(driver.id) ?? 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dateStr = date.toISOString().split('T')[0];
      const isApprovedOff = driverOffDates.has(dateStr);
      const posInCycle = cyclePosition % cycleLength;
      const isRestInCycle = posInCycle >= workDays;

      // 연속 근무 제한 규칙 적용: N일 연속 근무 후 강제 휴무
      let forceRest = false;
      if (maxConsecutiveWork > 0 && !isRestInCycle && !isApprovedOff) {
        let consecutive = 0;
        for (let prev = slots.length - 1; prev >= 0; prev--) {
          const s = slots[prev];
          if (s.driverId !== driver.id) continue;
          if (s.isRestDay) break;
          consecutive++;
        }
        if (consecutive >= maxConsecutiveWork) {
          forceRest = true;
        }
      }

      const isRestDay = isRestInCycle || isApprovedOff || forceRest;

      const shiftType = getShiftType(date, driver.shiftGroup);
      const fatigue = routeFatigueMap.get(ra.routeId) || 3;
      const preferred = preferenceMap.get(driver.id) || [];
      const isPreferred = preferred.includes(ra.routeId);

      // 공정성 메모 생성
      let fairnessNote = '';
      const holidayName = holidayMap.get(dateStr);
      const prevFatigue = lastMonthFatigueMap.get(driver.id) || 0;
      if (!isRestDay) {
        if (holidayName) {
          fairnessNote = `공휴일(${holidayName}) 근무`;
        } else if (prevFatigue > 80 && fatigue <= 2) {
          fairnessNote = `지난달 피로도 높음(${prevFatigue}점) → 이번달 꿀노선 우선 배정`;
        } else if (isPreferred) {
          fairnessNote = `선호 노선 배정 (${route.routeNumber}번)`;
        }
        fatigueTracker.set(driver.id, (fatigueTracker.get(driver.id) || 0) + fatigue);
        workDayTracker.set(driver.id, (workDayTracker.get(driver.id) || 0) + 1);

        if (!dateDriverMap.has(dateStr)) dateDriverMap.set(dateStr, new Set());
        dateDriverMap.get(dateStr)!.add(driver.id);
      } else {
        restDayTracker.set(driver.id, (restDayTracker.get(driver.id) || 0) + 1);
      }

      slots.push({
        scheduleId: schedule.id,
        driverId: driver.id,
        routeId: ra.routeId,
        busId: bus?.id,
        date,
        shift: shiftType,
        status: 'SCHEDULED',
        isRestDay,
        fairnessNote: fairnessNote || undefined,
        notes: forceRest ? `연속 ${maxConsecutiveWork}일 근무 → 강제 휴무` : isApprovedOff && !isRestInCycle ? '승인된 휴무' : undefined,
      });

      if (isRestDay) {
        if (!vacancyMap.has(dateStr)) vacancyMap.set(dateStr, []);
        vacancyMap.get(dateStr)!.push({ routeId: ra.routeId, busId: bus?.id, fatigueScore: fatigue });
      }

      if (!isApprovedOff) cyclePosition++;
    }
  }

  // ── SPARE 기사 배정 (공정성 + 선호 + 블랙리스트 고려) ──
  for (const driver of validSpareDrivers) {
    const driverOffDates = dayOffMap.get(driver.id) || new Set<string>();
    let cyclePosition = offsetMap.get(driver.id) ?? 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dateStr = date.toISOString().split('T')[0];
      const isApprovedOff = driverOffDates.has(dateStr);
      const posInCycle = cyclePosition % cycleLength;
      const isRestDay = posInCycle >= workDays || isApprovedOff;

      if (!isApprovedOff) cyclePosition++;
      if (isRestDay) continue;

      const dateVacancies = vacancyMap.get(dateStr);
      if (!dateVacancies || dateVacancies.length === 0) continue;

      // 블랙리스트 체크
      const conflict = hasBlacklistConflict(driver.id, 0, date, dateDriverMap, blacklistRules);
      if (conflict.blocked) {
        warnings.push(`${driver.name}: ${dateStr} 블랙리스트 충돌 — ${conflict.reason}`);
        continue;
      }

      // 선호 노선 우선 매칭
      const preferred = preferenceMap.get(driver.id) || [];
      let bestIdx = -1;
      let bestScore = Infinity;

      for (let i = 0; i < dateVacancies.length; i++) {
        const v = dateVacancies[i];
        const prefIdx = preferred.indexOf(v.routeId);
        // 점수: 선호면 -100 + 순위, 아니면 피로도 (낮을수록 좋음)
        const score = prefIdx >= 0 ? -100 + prefIdx : v.fatigueScore;
        if (score < bestScore) { bestScore = score; bestIdx = i; }
      }

      if (bestIdx === -1) bestIdx = 0;
      const vacancy = dateVacancies.splice(bestIdx, 1)[0];

      let fairnessNote = '예비기사 투입';
      if (preferred.includes(vacancy.routeId)) {
        fairnessNote += ` (선호 노선 ${routes.find(r => r.id === vacancy.routeId)?.routeNumber}번 매칭)`;
      }

      slots.push({
        scheduleId: schedule.id,
        driverId: driver.id,
        routeId: vacancy.routeId,
        busId: vacancy.busId,
        date,
        shift: getShiftType(date, driver.shiftGroup),
        status: 'SCHEDULED',
        isRestDay: false,
        fairnessNote,
      });

      fatigueTracker.set(driver.id, (fatigueTracker.get(driver.id) || 0) + vacancy.fatigueScore);
      workDayTracker.set(driver.id, (workDayTracker.get(driver.id) || 0) + 1);

      if (!dateDriverMap.has(dateStr)) dateDriverMap.set(dateStr, new Set());
      dateDriverMap.get(dateStr)!.add(driver.id);
    }
  }

  // ── 슬롯 저장 ──────────────────────────────────────────
  if (slots.length > 0) {
    await prisma.scheduleSlot.createMany({ data: slots });
  }

  // ── 공정성 보고서 생성 ─────────────────────────────────
  const fairnessReport: FairnessReportEntry[] = [];
  for (const driver of [...validMainDrivers, ...validSpareDrivers]) {
    const totalFatigue = fatigueTracker.get(driver.id) || 0;
    const work = workDayTracker.get(driver.id) || 0;
    const rest = restDayTracker.get(driver.id) || 0;
    const avgFatigue = work > 0 ? Math.round((totalFatigue / work) * 10) / 10 : 0;
    const preferred = preferenceMap.get(driver.id) || [];
    const driverSlots = slots.filter(s => s.driverId === driver.id && !s.isRestDay);
    const preferredCount = driverSlots.filter(s => preferred.includes(s.routeId)).length;

    let summary = `${driver.name}님: 근무 ${work}일, 휴무 ${rest}일, 평균 피로도 ${avgFatigue}점`;
    if (preferred.length > 0) {
      summary += `, 선호노선 배정 ${preferredCount}/${work}일`;
    }
    const prevFatigue = lastMonthFatigueMap.get(driver.id) || 0;
    if (prevFatigue > 60) {
      summary += ` (지난달 고피로 → 이번달 보상 배정)`;
    }

    fairnessReport.push({
      driverId: driver.id,
      driverName: driver.name,
      driverType: driver.driverType || 'MAIN',
      workDays: work,
      restDays: rest,
      totalFatigue,
      avgFatigue,
      preferredRouteCount: preferredCount,
      summary,
    });
  }

  // ── 커버리지 경고 ──────────────────────────────────────
  for (const route of routes) {
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const daySlots = slots.filter(s => s.routeId === route.id && s.date.getTime() === date.getTime() && !s.isRestDay);
      if (daySlots.length === 0) {
        warnings.push(`${route.routeNumber}번: ${month}/${day} 운행 기사 없음`);
      }
    }
  }

  let unfilled = 0;
  for (const [, vacancies] of vacancyMap) unfilled += vacancies.length;
  if (unfilled > 0) warnings.push(`[빈자리] ${unfilled}개 슬롯 예비기사 부족`);

  logger.info(`[schedule] ${year}년 ${month}월 AI 배차 완료: ${slots.length}슬롯, 경고 ${warnings.length}건`);

  return { scheduleId: schedule.id, slotsCreated: slots.length, warnings, fairnessReport };
}

// ─────────────────────────────────────────────────────
// 공정성 보고서 타입
// ─────────────────────────────────────────────────────
export interface FairnessReportEntry {
  driverId: number;
  driverName: string;
  driverType: string;
  workDays: number;
  restDays: number;
  totalFatigue: number;
  avgFatigue: number;
  preferredRouteCount: number;
  summary: string;
}

// ─────────────────────────────────────────────────────
// 배차표 조회
// ─────────────────────────────────────────────────────

/**
 * 월 배차표 해석 — 멀티 초안(프로필) 지원.
 *  - scheduleId 지정: 해당 배차표 (회사·연월 일치 검증)
 *  - 미지정: PUBLISHED 우선, 없으면 가장 최근 수정된 초안
 */
export async function resolveMonthScheduleId(
  companyId: number,
  year: number,
  month: number,
  scheduleId?: number,
  serviceType: ServiceType | null = null,
): Promise<number | null> {
  if (scheduleId) {
    // 명시된 배차표는 종류로 거르지 않는다 — 화면이 이미 그 배차표를 가리키고 있다.
    const s = await prisma.schedule.findFirst({
      where: { id: scheduleId, companyId, year, month },
      select: { id: true },
    });
    return s?.id ?? null;
  }
  const published = await prisma.schedule.findFirst({
    where: { companyId, year, month, serviceType, status: 'PUBLISHED' },
    select: { id: true },
  });
  if (published) return published.id;
  const latest = await prisma.schedule.findFirst({
    where: { companyId, year, month, serviceType },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  return latest?.id ?? null;
}

/**
 * 같은 달 안에서 겹치지 않는 프로필 이름을 만든다.
 *  - base 가 비어있지 않고 안 겹치면 그대로 반환
 *  - 겹치면 "base (2)", "base (3)" ... 로 증가
 * tx 가 주어지면 트랜잭션 클라이언트로 조회 (persist 중 원자성 유지)
 */
export async function uniqueScheduleName(
  companyId: number,
  year: number,
  month: number,
  base: string,
  tx: { schedule: { findMany: typeof prisma.schedule.findMany } } = prisma,
  excludeId?: number,
  serviceType: ServiceType | null = null,
): Promise<string> {
  // 이름은 같은 (월 × 노선 종류) 안에서만 겹치면 된다 — 간선·지선이 각각
  // "기본 초안" 을 가질 수 있어야 한다.
  const rows = await tx.schedule.findMany({
    where: { companyId, year, month, serviceType, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { name: true },
  });
  const taken = new Set(rows.map((r) => r.name));
  const trimmed = base.trim() || '초안';
  if (!taken.has(trimmed)) return trimmed;
  for (let i = 2; i < 100; i++) {
    const candidate = `${trimmed} (${i})`.slice(0, 50);
    if (!taken.has(candidate)) return candidate;
  }
  return `${trimmed} (${Date.now() % 10000})`.slice(0, 50);
}

/**
 * 그 달의 **모든 노선 종류**에서 대표 배차표 id 를 모은다 (종류당 1개).
 *
 * 간선·지선·광역이 따로 발행되면서 "그 달 배차표"가 최대 4개가 됐다. 회사 전체를
 * 보는 곳(대시보드·오늘 운행 현황·BIS 연동)은 종류를 나눌 이유가 없으므로 전부
 * 합쳐야 한다. 종류별로 발행본 우선 → 없으면 가장 최근 초안을 고른다.
 *
 * 종류당 1개로 좁히는 게 핵심이다 — 같은 종류의 초안 5개를 다 합치면 슬롯이
 * 5배로 뻥튀기돼 통계가 통째로 거짓이 된다.
 */
export async function resolveMonthScheduleIdsAllTypes(
  companyId: number,
  year: number,
  month: number,
  publishedOnly = false,
): Promise<number[]> {
  const all = await prisma.schedule.findMany({
    where: {
      companyId, year, month,
      ...(publishedOnly ? { status: 'PUBLISHED' as const } : {}),
    },
    select: { id: true, serviceType: true, status: true },
    orderBy: { updatedAt: 'desc' },
  });
  const pick = new Map<string, (typeof all)[number]>();
  for (const sch of all) {
    const key = sch.serviceType ?? '_ALL';
    const cur = pick.get(key);
    if (!cur) { pick.set(key, sch); continue; }
    if (cur.status !== 'PUBLISHED' && sch.status === 'PUBLISHED') pick.set(key, sch);
  }
  return [...pick.values()].map((s) => s.id);
}

export async function getScheduleWithSlots(
  companyId: number,
  year: number,
  month: number,
  scheduleId?: number,
  serviceType: ServiceType | null = null,
) {
  const id = await resolveMonthScheduleId(companyId, year, month, scheduleId, serviceType);
  if (id === null) return null;
  return prisma.schedule.findFirst({
    where: { id, companyId },
    include: {
      slots: {
        include: {
          driver: { select: { id: true, name: true, employeeId: true, driverType: true, phone: true } },
          route: true,
          bus: true,
          emergencyDrop: true,
        },
        orderBy: [{ date: 'asc' }, { driver: { name: 'asc' } }],
      },
    },
  });
}

// ─────────────────────────────────────────────────────
// 슬롯 수동 수정 (오버라이드)
// ─────────────────────────────────────────────────────
export async function updateSlot(slotId: number, data: {
  driverId?: number;
  routeId?: number;
  busId?: number;
  date?: Date;
  shift?: ShiftType;
  status?: SlotStatus;
  isRestDay?: boolean;
  isManualOverride?: boolean;
  overrideReason?: string;
  overrideBy?: number;
  notes?: string;
}) {
  return prisma.scheduleSlot.update({
    where: { id: slotId },
    data,
    include: {
      driver: { select: { id: true, name: true, employeeId: true } },
      route: true,
      bus: true,
    },
  });
}

// ─────────────────────────────────────────────────────
// 법적 휴식시간 검증 (수동 오버라이드 시)
// 연속 근무일 + 8시간 최소 휴식 체크
// ─────────────────────────────────────────────────────
export async function validateRestTime(
  driverId: number,
  targetDate: Date,
  scheduleId: number,
): Promise<{ valid: boolean; warnings: string[] }> {
  const warnings: string[] = [];

  // 전후 3일 슬롯 조회
  const startDate = new Date(targetDate);
  startDate.setDate(startDate.getDate() - 3);
  const endDate = new Date(targetDate);
  endDate.setDate(endDate.getDate() + 3);

  const nearbySlots = await prisma.scheduleSlot.findMany({
    where: {
      scheduleId,
      driverId,
      date: { gte: startDate, lte: endDate },
      isRestDay: false,
    },
    orderBy: { date: 'asc' },
  });

  // 연속 근무일 계산
  let consecutive = 0;
  for (const slot of nearbySlots) {
    const slotDate = new Date(slot.date);
    if (slotDate <= targetDate) consecutive++;
    else break;
  }

  if (consecutive >= 7) {
    warnings.push(`⚠️ 연속 ${consecutive}일 근무 — 법적 주 1회 휴일 보장 필요`);
  }
  if (consecutive >= 6) {
    warnings.push(`⚠️ ${consecutive}일 연속 근무 중 — 피로 누적 주의`);
  }

  return { valid: warnings.length === 0, warnings };
}
