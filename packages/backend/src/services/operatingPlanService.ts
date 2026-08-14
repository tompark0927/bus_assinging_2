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
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

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
  let totalCells = 0;

  // 노선별 감차 커서 — 쉰 대수만큼 앞으로 밀어 다음 날은 그다음 차량이 쉰다.
  // 날짜 인덱스로 회전시키면(offset = day % 14) 차량 수가 7의 배수일 때
  // 요일 주기와 맞물려 특정 차량만 계속 일요일에 쉬는 편향이 생긴다.
  const cursors = new Map<number, number>();

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

      // 쉴 차량을 커서에서부터 필요한 만큼 집고, 커서를 그만큼 전진시킨다
      const restCount = total - need;
      const cursor = cursors.get(rule.routeId) ?? 0;
      const resting: number[] = [];
      for (let i = 0; i < restCount; i++) resting.push(rule.busIds[(cursor + i) % total]);
      cursors.set(rule.routeId, restCount > 0 ? (cursor + restCount) % total : cursor);
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
