import { prisma } from '../utils/prisma';
import { getHolidaysForMonth } from '../utils/holidays';

/**
 * 운행 계획 — "그날 어느 차가 나가는가".
 *
 * 등록된 차량 전부가 매일 나가지는 않는다. 성민버스 실측(2020-10):
 *   노선당 등록 14대 중 평일 12 / 토 11 / 일·공휴일 10 — 예외 하루도 없음.
 * 이 사실을 모른 채 "전 차량 매일 운행"으로 배차하면 한 달에 400칸 넘게
 * 없는 근무를 만들어내고, 그만큼 사람이 모자란 것처럼 보인다(실제로는
 * 충분한데). 그래서 노선 설정의 요일별 대수를 배차 생성의 입력으로 쓴다.
 *
 * 쉬는 차량 선정은 **매일 돌아가며** 한다. 같은 차만 계속 쉬면 특정 차량에
 * 주행거리·정비주기가 쏠리고, 그 차 고정기사의 근무일수만 줄어든다.
 */

export interface RouteOperatingRule {
  routeId: number;
  routeNumber: string;
  /** 등록된 활성 차량 (차번 오름차순 = 로테이션 기준 순서) */
  busIds: number[];
  weekdayBuses: number | null;
  saturdayBuses: number | null;
  holidayBuses: number | null;
}

export interface OperatingPlan {
  /** busId → 운행하는 날짜(YYYY-MM-DD) 목록 */
  busOperatingDates: Map<number, string[]>;
  /** 날짜별 감차 차량 — SchedulePattern(operating:false) 로 저장할 대상 */
  restingByDate: Map<string, number[]>;
  /** 노선별 요약 (화면·로그용) */
  summary: {
    routeNumber: string;
    registered: number;
    weekday: number;
    saturday: number;
    holiday: number;
  }[];
  /** 한 달 총 운행 칸수 (= 필요 배정 수, 오전+오후) */
  totalCells: number;
  /** 요일별 대수를 하나도 설정하지 않았다면 true — 이때는 전 차량 운행 */
  unconfigured: boolean;
  /**
   * 노선별·날짜별 운행 **대수** (routeId → 'YYYY-MM-DD' → 대수).
   *
   * 대수는 노선 설정이 정하는 정책이고, **어느 차**를 세울지는 기사 휴무와
   * 맞물려야 하는 배차 결정이다. 여기서 미리 고른 차량 조합을 그대로 넘기면
   * 감차일이 짝꿍 휴무와 어긋나 휴무가 2일에서 3~4일로 늘어난다. 그래서
   * 솔버에는 대수만 넘기고 차량 선택은 맡긴다.
   */
  dailyCountsByRoute: Record<number, Record<string, number>>;
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

/** 감차는 며칠 붙여서 — 기사 휴무(2일)와 맞물리게 한다 */
const REST_BLOCK_DAYS = 2;

/** 그날 몇 대가 나가야 하는가 — 공휴일 > 토요일 > 평일 순으로 판정 */
export function countForDate(
  rule: Pick<RouteOperatingRule, 'weekdayBuses' | 'saturdayBuses' | 'holidayBuses' | 'busIds'>,
  date: Date,
  isHoliday: boolean,
): number {
  const dow = date.getUTCDay(); // 0=일
  const all = rule.busIds.length;
  // 공휴일이 평일에 걸려도 휴일 대수를 쓴다 (실측: 10/9 금요일 공휴일 → 10대)
  if (isHoliday || dow === 0) return rule.holidayBuses ?? all;
  if (dow === 6) return rule.saturdayBuses ?? all;
  return rule.weekdayBuses ?? all;
}

export async function getRouteOperatingRules(companyId: number): Promise<RouteOperatingRule[]> {
  const routes = await prisma.route.findMany({
    where: { companyId, isActive: true },
    select: {
      id: true, routeNumber: true,
      weekdayBuses: true, saturdayBuses: true, holidayBuses: true,
      buses: {
        where: { isActive: true },
        select: { id: true, busNumber: true },
      },
    },
  });
  return routes.map((r) => ({
    routeId: r.id,
    routeNumber: r.routeNumber,
    busIds: [...r.buses]
      .sort((a, b) => a.busNumber.localeCompare(b.busNumber, undefined, { numeric: true }))
      .map((b) => b.id),
    weekdayBuses: r.weekdayBuses,
    saturdayBuses: r.saturdayBuses,
    holidayBuses: r.holidayBuses,
  }));
}

/**
 * 그 달의 운행 계획을 만든다.
 *
 * 로테이션: 노선 안에서 차량을 차번순으로 세우고, 날짜 인덱스만큼 시작점을
 * 옮겨가며 앞에서부터 필요한 대수를 뽑는다. 뒤로 밀린 차량이 그날 감차다.
 * 이렇게 하면 감차가 모든 차량에 고르게 돌아간다.
 */
export async function buildOperatingPlan(
  companyId: number,
  year: number,
  month: number,
): Promise<OperatingPlan> {
  const rules = await getRouteOperatingRules(companyId);
  const holidays = getHolidaysForMonth(year, month);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const busOperatingDates = new Map<number, string[]>();
  const restingByDate = new Map<string, number[]>();
  const dailyCountsByRoute: Record<number, Record<string, number>> = {};
  let totalCells = 0;

  // 노선별 감차 커서 — 쉰 차량 수만큼 앞으로 밀어 다음엔 그다음 차가 쉰다.
  // 날짜 인덱스로 회전시키면(offset = day % 14) 차량 수가 7의 배수일 때
  // 요일 주기와 맞물려 특정 차량만 계속 일요일에 쉬는 편향이 생긴다.
  const cursors = new Map<number, number>();
  /** busId → 감차 블록이 끝나는 날(1-based day). 이틀 붙여 세우기 위함 */
  const restUntil = new Map<number, number>();

  const unconfigured = rules.every(
    (r) => r.weekdayBuses == null && r.saturdayBuses == null && r.holidayBuses == null,
  );

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const key = dateKey(date);
    const isHoliday = holidays.has(key);

    for (const rule of rules) {
      const total = rule.busIds.length;
      if (total === 0) continue;
      const need = Math.max(0, Math.min(total, countForDate(rule, date, isHoliday)));
      (dailyCountsByRoute[rule.routeId] ??= {})[key] = need;

      // 감차도 **연속 2일씩 묶어서** 돌린다.
      //
      // 하루씩 흩어 감차하면 그 차 기사들의 휴무도 하루씩 조각나서, 5일 근무
      // 블록이 3일+1일로 부서진다(실측 5일 블록 228→40개). 실물 배차표도
      // 한 번 세운 차는 이틀 붙여 세운다.
      const restCount = total - need;
      const resting: number[] = [];
      // ① 진행 중인 감차 블록은 계속
      for (const busId of rule.busIds) {
        if ((restUntil.get(busId) ?? -1) >= day) resting.push(busId);
      }
      // ② 모자라면 커서에서 새 블록을 시작
      let cursor = cursors.get(rule.routeId) ?? 0;
      let guard = 0;
      while (resting.length < restCount && guard++ < total * 2) {
        const busId = rule.busIds[cursor % total];
        cursor++;
        if (resting.includes(busId)) continue;
        restUntil.set(busId, day + REST_BLOCK_DAYS - 1);
        resting.push(busId);
      }
      cursors.set(rule.routeId, cursor % total);
      // ③ 남으면(주말→평일로 필요 대수가 늘 때) 오래 쉰 차부터 복귀시킨다
      while (resting.length > restCount) {
        let earliest = 0;
        for (let i = 1; i < resting.length; i++) {
          if ((restUntil.get(resting[i]) ?? 0) < (restUntil.get(resting[earliest]) ?? 0)) earliest = i;
        }
        restUntil.delete(resting[earliest]);
        resting.splice(earliest, 1);
      }
      const restSet = new Set(resting);
      const running = rule.busIds.filter((b) => !restSet.has(b));

      for (const busId of running) {
        const arr = busOperatingDates.get(busId) ?? [];
        arr.push(key);
        busOperatingDates.set(busId, arr);
      }
      if (resting.length) {
        restingByDate.set(key, [...(restingByDate.get(key) ?? []), ...resting]);
      }
      totalCells += need * 2; // 오전 + 오후
    }
  }

  return {
    busOperatingDates,
    restingByDate,
    summary: rules.map((r) => ({
      routeNumber: r.routeNumber,
      registered: r.busIds.length,
      weekday: r.weekdayBuses ?? r.busIds.length,
      saturday: r.saturdayBuses ?? r.busIds.length,
      holiday: r.holidayBuses ?? r.busIds.length,
    })),
    totalCells,
    unconfigured,
    dailyCountsByRoute,
  };
}

/**
 * 감차 차량을 SchedulePattern(operating:false)으로 저장한다.
 *
 * 이 행이 있어야 화면·인쇄물·발행 검사(E2)가 "그 차는 원래 안 나가는 날"임을
 * 알 수 있다. 없으면 빈 칸이 전부 공석으로 잡혀 발행이 막힌다.
 */
export async function persistRestingVehicles(
  scheduleId: number,
  restingByDate: Map<string, number[]>,
): Promise<number> {
  const rows: { scheduleId: number; busId: number; date: Date; operating: boolean; underlyingSlot: number; displaySlot: null }[] = [];
  for (const [dateStr, busIds] of restingByDate) {
    for (const busId of busIds) {
      rows.push({
        scheduleId,
        busId,
        date: new Date(`${dateStr}T00:00:00.000Z`),
        operating: false,
        underlyingSlot: 0,   // 순번 로테이션 정보 없음 (엔진 생성분이 아니므로)
        displaySlot: null,
      });
    }
  }
  if (rows.length === 0) return 0;
  const r = await prisma.schedulePattern.createMany({ data: rows, skipDuplicates: true });
  return r.count;
}

/**
 * 그날 운행해야 하는 (날짜×차량) 목록.
 *
 * 1순위는 SchedulePattern(엔진이 만든 운행 계획, 감차 = operating:false).
 * 패턴이 없는 배차표(솔버 생성분)는 "감차로 지정하지 않은 모든 차량은 매일
 * 오전·오후 각 1명씩 나간다"는 현장 규칙을 그대로 적용한다 — 활성 차량 ×
 * 그 달 전체 날짜. 이 기준이 없으면 솔버 배차표의 빈 칸이 검사를 통째로
 * 빠져나가 '버스가 못 나가는 배차표'가 그대로 발행된다.
 */
export async function operatingCells(
  scheduleId: number,
): Promise<{ date: Date; busId: number; busNumber: string }[]> {
  const patterns = await prisma.schedulePattern.findMany({
    where: { scheduleId, operating: true },
    select: { date: true, busId: true, bus: { select: { busNumber: true } } },
  });
  if (patterns.length > 0) {
    return patterns.map((p) => ({
      date: p.date,
      busId: p.busId,
      busNumber: p.bus?.busNumber ?? `#${p.busId}`,
    }));
  }

  // 패턴 없음 → 활성 차량 × 그 달 날짜에서, 명시적 감차만 제외
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: { companyId: true, year: true, month: true },
  });
  if (!schedule) return [];
  const [buses, off] = await Promise.all([
    prisma.bus.findMany({
      where: { companyId: schedule.companyId, isActive: true, NOT: { routeId: null } },
      select: { id: true, busNumber: true },
    }),
    prisma.schedulePattern.findMany({
      where: { scheduleId, operating: false },
      select: { date: true, busId: true },
    }),
  ]);
  const offSet = new Set(off.map((o) => `${dateKey(o.date)}|${o.busId}`));
  const daysInMonth = new Date(Date.UTC(schedule.year, schedule.month, 0)).getUTCDate();
  const out: { date: Date; busId: number; busNumber: string }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(Date.UTC(schedule.year, schedule.month - 1, d));
    for (const b of buses) {
      if (offSet.has(`${dateKey(date)}|${b.id}`)) continue;
      out.push({ date, busId: b.id, busNumber: b.busNumber });
    }
  }
  return out;
}
