import { prisma } from '../utils/prisma';
import { driverScopeFor } from '../utils/serviceType';
import { ShiftType } from '@prisma/client';
import { operatingCells } from './operatingPlanService';
import logger from '../utils/logger';

/**
 * 공석 채우기 — 운행하는 차량인데 기사가 없는 칸을 남은 인력으로 메운다.
 *
 * 솔버는 대부분을 채우지만 특정 하루에서 막히는 일이 있다(성민 7월 실측:
 * 31일 중 30일은 완벽, 7/26 하루만 27칸 공백). 그런데 그날 쉬는 기사가
 * 70명 넘게 남아 있었다 — 인력이 없어서가 아니라 솔버가 못 찾은 것이다.
 * 공석은 곧 "그 버스가 안 나간다"는 뜻이라 그대로 두면 안 된다.
 *
 * 채울 때도 안전 규칙은 그대로 지킨다. 규칙을 어겨야만 채울 수 있는 칸은
 * 비워둔 채 보고한다 — 억지로 채우면 과로 배차를 시스템이 만들어내는 셈이다.
 *   · 같은 날 이미 근무 중인 기사는 제외 (이중 배정 금지)
 *   · 최대 연속 근무일(6일) 초과 금지
 *   · 오후 근무 다음날 오전 금지 (법 제44조의6 연속 휴식 8시간)
 * 후보가 여럿이면 그달 근무일수가 가장 적은 기사를 고른다 — 공석 메우기가
 * 특정인에게 몰리지 않게 하기 위함이다.
 */

const MAX_CONSECUTIVE_DAYS = 6;

export interface VacancyFillResult {
  /** 채운 칸 수 */
  filled: number;
  /** 규칙상 채울 수 없어 남은 칸 */
  stillVacant: { date: string; busNumber: string; shift: string }[];
  /** 투입된 기사별 추가 근무 수 */
  usedDrivers: { driverId: number; name: string; added: number }[];
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const shiftDay = (key: string, delta: number) => {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return dateKey(d);
};

/** newDay 를 넣었을 때 만들어지는 연속 근무일 길이 */
function runLengthWith(days: Set<string>, newDay: string): number {
  let len = 1;
  for (let k = shiftDay(newDay, -1); days.has(k); k = shiftDay(k, -1)) len++;
  for (let k = shiftDay(newDay, 1); days.has(k); k = shiftDay(k, 1)) len++;
  return len;
}

export async function fillVacancies(
  companyId: number,
  scheduleId: number,
): Promise<VacancyFillResult> {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, companyId },
    select: { id: true, status: true, serviceType: true },
  });
  if (!schedule) throw new Error('배차표를 찾을 수 없습니다.');
  if (schedule.status !== 'DRAFT') {
    throw new Error('초안 상태에서만 공석을 채울 수 있습니다.');
  }

  const [cells, slots, drivers, buses] = await Promise.all([
    operatingCells(scheduleId),
    prisma.scheduleSlot.findMany({
      where: { scheduleId, isRestDay: false, status: { notIn: ['DROPPED', 'ABSENT'] } },
      select: { driverId: true, date: true, shift: true, busId: true },
    }),
    prisma.user.findMany({
      // 공석은 이 배차표 종류의 기사로만 메운다 — 급하다고 지선 기사를
      // 간선 칸에 넣으면 배차표가 조용히 뒤섞인다
      where: { companyId, role: 'DRIVER', isActive: true, ...driverScopeFor(schedule.serviceType) },
      select: { id: true, name: true },
    }),
    prisma.bus.findMany({
      where: { companyId, isActive: true },
      select: { id: true, busNumber: true, routeId: true },
    }),
  ]);

  // 현재 상태를 메모리에 올린다 — 한 칸 채울 때마다 즉시 반영해야
  // 같은 사람을 같은 날 두 번 넣는 실수가 없다.
  const filledCell = new Set<string>();          // date|busId|shift
  const workDays = new Map<number, Set<string>>(); // driverId → 근무일
  const shiftsOn = new Map<string, Set<string>>(); // driverId|date → shifts
  for (const s of slots) {
    const dk = dateKey(s.date);
    const shifts = s.shift === 'FULL_DAY' ? ['MORNING', 'AFTERNOON'] : [s.shift];
    if (!workDays.has(s.driverId)) workDays.set(s.driverId, new Set());
    workDays.get(s.driverId)!.add(dk);
    const key = `${s.driverId}|${dk}`;
    if (!shiftsOn.has(key)) shiftsOn.set(key, new Set());
    for (const sh of shifts) {
      shiftsOn.get(key)!.add(sh);
      if (s.busId != null) filledCell.add(`${dk}|${s.busId}|${sh}`);
    }
  }

  const busById = new Map(buses.map((b) => [b.id, b]));
  const nameOf = new Map(drivers.map((d) => [d.id, d.name]));
  let fallbackRouteId: number | null = null;

  const toCreate: {
    scheduleId: number; driverId: number; routeId: number; busId: number;
    date: Date; shift: ShiftType;
  }[] = [];
  const stillVacant: VacancyFillResult['stillVacant'] = [];
  const added = new Map<number, number>();

  // 날짜순으로 처리 — 연속근무 판정이 앞선 배정에 의존하므로 순서가 결정적이어야 한다
  const sorted = [...cells].sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));

  for (const cell of sorted) {
    const dk = dateKey(cell.date);
    for (const shift of ['MORNING', 'AFTERNOON'] as const) {
      if (filledCell.has(`${dk}|${cell.busId}|${shift}`)) continue;

      const candidates = drivers.filter((d) => {
        const days = workDays.get(d.id) ?? new Set<string>();
        if (days.has(dk)) return false;                                  // 같은 날 중복 금지
        if (runLengthWith(days, dk) > MAX_CONSECUTIVE_DAYS) return false; // 연속근무 초과 금지
        if (shift === 'MORNING' && shiftsOn.get(`${d.id}|${shiftDay(dk, -1)}`)?.has('AFTERNOON')) {
          return false;                                                  // 전날 오후 → 오늘 오전 금지
        }
        if (shift === 'AFTERNOON' && shiftsOn.get(`${d.id}|${shiftDay(dk, 1)}`)?.has('MORNING')) {
          return false;                                                  // 오늘 오후 → 내일 오전 금지
        }
        return true;
      });

      if (candidates.length === 0) {
        stillVacant.push({ date: dk, busNumber: cell.busNumber, shift });
        continue;
      }

      // ① 연속 근무 블록의 시프트를 지키는 사람 먼저 (전날 같은 시프트로 근무)
      //    현장은 한 블록을 같은 시프트로 간다 — 공석을 메운다고 그 리듬을
      //    깨면 기사 입장에서는 갑자기 근무 시간대가 뒤집히는 셈이다.
      // ② 그다음 근무일수가 적은 사람 (쏠림 방지)
      const keepsBlock = (id: number) => {
        const prev = shiftsOn.get(`${id}|${shiftDay(dk, -1)}`);
        if (!prev) return 1;                    // 전날 휴무 → 새 블록 시작, 자유
        return prev.has(shift) ? 0 : 2;         // 같은 시프트 유지 0 · 바뀜 2
      };
      candidates.sort((a, b) => {
        const ka = keepsBlock(a.id), kb = keepsBlock(b.id);
        if (ka !== kb) return ka - kb;
        const na = workDays.get(a.id)?.size ?? 0;
        const nb = workDays.get(b.id)?.size ?? 0;
        return na !== nb ? na - nb : a.id - b.id;
      });
      const picked = candidates[0];

      const bus = busById.get(cell.busId);
      let routeId = bus?.routeId ?? null;
      if (routeId == null) {
        if (fallbackRouteId == null) {
          const r = await prisma.route.findFirst({ where: { companyId }, select: { id: true } });
          if (!r) throw new Error('노선이 등록되어 있지 않습니다.');
          fallbackRouteId = r.id;
        }
        routeId = fallbackRouteId;
      }

      toCreate.push({
        scheduleId, driverId: picked.id, routeId, busId: cell.busId,
        date: new Date(`${dk}T00:00:00.000Z`),
        shift: shift === 'MORNING' ? ShiftType.MORNING : ShiftType.AFTERNOON,
      });

      // 즉시 반영
      filledCell.add(`${dk}|${cell.busId}|${shift}`);
      if (!workDays.has(picked.id)) workDays.set(picked.id, new Set());
      workDays.get(picked.id)!.add(dk);
      const k = `${picked.id}|${dk}`;
      if (!shiftsOn.has(k)) shiftsOn.set(k, new Set());
      shiftsOn.get(k)!.add(shift);
      added.set(picked.id, (added.get(picked.id) ?? 0) + 1);
    }
  }

  if (toCreate.length > 0) {
    await prisma.scheduleSlot.createMany({ data: toCreate, skipDuplicates: true });
  }
  logger.info(
    `[vacancyFill] schedule=${scheduleId} ${toCreate.length}칸 채움, ` +
      `${stillVacant.length}칸은 규칙상 채울 수 없음`,
  );

  return {
    filled: toCreate.length,
    stillVacant,
    usedDrivers: [...added.entries()]
      .map(([driverId, n]) => ({ driverId, name: nameOf.get(driverId) ?? `#${driverId}`, added: n }))
      .sort((a, b) => b.added - a.added),
  };
}
