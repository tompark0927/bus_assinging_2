import { Prisma, ShiftType } from '@prisma/client';
import type { ServiceType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';
import { requestEngineCells } from './baseFrameService';
import { isDriverName, type EngineCell } from './engineScheduleService';

/**
 * 초안의 **빈 칸만** 채운다 — 이미 채워진 칸은 한 칸도 건드리지 않는다.
 *
 * 예전에는 [스페어 자동 채우기]가 그 달 초안을 통째로 지우고 다시 만들었다.
 * 메인 배차는 결정론이라 같은 모양으로 재생산되지만, **담당자가 직접 고친
 * 칸과 수동 감차 표기는 그때 사라졌다** — "관리자가 연차 같은 건 직접 하나하나
 * 추가할 수 있어야 한다"(사장님 2026-09-01)는 규칙과 정면으로 부딪힌다.
 *
 * 그래서 이 서비스는 **삭제를 하지 않는다.** 엔진이 만들어 준 배차표를 답안지로
 * 쓰되, 지금 초안에서 비어 있는 칸에만 이름을 넣는다. 이미 누가 앉아 있는 칸,
 * 담당자가 감차로 세워 둔 차, 그날 이미 다른 차를 모는 기사는 전부 건너뛰고
 * 몇 칸을 왜 건너뛰었는지 돌려준다.
 */

export interface FillSpareSlotsResult {
  scheduleId: number;
  /** 새로 채운 칸 */
  filled: number;
  /** 이미 사람이 있어 그대로 둔 칸 */
  keptOccupied: number;
  /** 그날 이미 다른 자리에 배정돼 있어 못 넣은 칸 */
  skippedDoubleBooked: number;
  /** 담당자가 감차로 세워 둔 차라 넣지 않은 칸 */
  skippedVehicleOff: number;
  /** 기초 데이터에 없거나 동명이인이라 넣지 못한 이름 */
  unregisteredNames: string[];
  /** 채우고도 여전히 비어 있는 운행 칸 (결행 후보) */
  remainingEmpty: number;
}

type EngineCells = Record<string, Record<string, EngineCell>>;

/** 날짜를 DB 저장 형식(UTC 자정)으로 — 기존 슬롯과 같은 키여야 한다 */
function toDbDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fillSpareSlots(
  companyId: number,
  scheduleId: number,
): Promise<FillSpareSlotsResult> {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, companyId },
    select: { id: true, year: true, month: true, serviceType: true, status: true },
  });
  if (!schedule) throw new Error('배차표를 찾을 수 없습니다.');
  if (schedule.status !== 'DRAFT') {
    throw new Error('초안에서만 스페어를 채울 수 있습니다. 발행본은 수정하지 않습니다.');
  }
  const serviceType: ServiceType | null = schedule.serviceType;

  // 엔진에게 "스페어까지 채운 배차표"를 받아 온다 — 답안지로만 쓴다.
  // 메인은 엔진 안에서 기본 틀에 하드로 박혀 있으므로(frame_hard) 이 답안지의
  // 메인 배차는 지금 초안의 메인과 같다.
  const engine = await requestEngineCells(
    companyId, schedule.year, schedule.month, serviceType, /* mainsOnly */ false,
  );
  if ('error' in engine) throw new Error(engine.error);
  const cells = (engine.cells ?? {}) as EngineCells;

  // ── 지금 초안의 상태 ──
  const [slots, patterns] = await Promise.all([
    prisma.scheduleSlot.findMany({
      where: { scheduleId },
      select: { date: true, shift: true, busId: true, driverId: true, isRestDay: true },
    }),
    prisma.schedulePattern.findMany({
      where: { scheduleId },
      select: { date: true, busId: true, operating: true },
    }),
  ]);

  /** 이미 사람이 앉아 있는 칸 */
  const occupied = new Set<string>();
  /** 그날 이미 어딘가에 배정된 기사 — 이중 배정 방지 */
  const busyThatDay = new Set<string>();
  for (const s of slots) {
    const dk = dayKey(s.date);
    if (!s.isRestDay) occupied.add(`${dk}|${s.busId}|${s.shift}`);
    // 휴무·연차 칸도 '그날 그 사람은 못 쓴다'로 센다. 담당자가 직접 넣은
    // 연차가 여기 들어 있고, 그걸 덮어 근무를 꽂으면 안 된다.
    busyThatDay.add(`${dk}|${s.driverId}`);
  }
  /** 담당자가 세워 둔 차(감차) — 초안의 패턴이 진실이다 */
  const notOperating = new Set<string>();
  for (const p of patterns) {
    if (!p.operating) notOperating.add(`${dayKey(p.date)}|${p.busId}`);
  }

  // ── 이름·차번 → id ──
  const vehicleNumbers = new Set<string>();
  const driverNames = new Set<string>();
  for (const byVehicle of Object.values(cells)) {
    for (const [vehicle, cell] of Object.entries(byVehicle)) {
      vehicleNumbers.add(vehicle);
      if (isDriverName(cell.am)) driverNames.add(cell.am.trim());
      if (isDriverName(cell.pm)) driverNames.add(cell.pm.trim());
    }
  }
  const [buses, drivers] = await Promise.all([
    prisma.bus.findMany({
      where: { companyId, busNumber: { in: [...vehicleNumbers] } },
      select: { id: true, busNumber: true, routeId: true },
    }),
    prisma.user.findMany({
      where: { companyId, role: 'DRIVER', isActive: true, name: { in: [...driverNames] } },
      select: { id: true, name: true, serviceType: true },
    }),
  ]);
  const busByNumber = new Map(buses.map((b) => [b.busNumber, b]));

  // 배차는 기초 데이터에 등록된 사람으로만 짠다. 동명이인은 추측 배정하지
  // 않고 이름을 돌려준다 — 잘못 넣으면 한 사람은 과다 배차되고 다른 한 사람은
  // 배차표에서 사라지는데 둘 다 조용히 일어난다.
  const byName = new Map<string, { id: number }[]>();
  for (const d of drivers) {
    if (serviceType && d.serviceType && d.serviceType !== serviceType) continue;
    const list = byName.get(d.name) ?? [];
    list.push({ id: d.id });
    byName.set(d.name, list);
  }

  // 노선은 차량에 붙은 것을 쓴다 (ScheduleSlot.routeId 가 NOT NULL)
  let fallbackRouteId: number | null = null;
  if (buses.some((b) => b.routeId == null)) {
    const route = await prisma.route.findFirst({
      where: { companyId }, select: { id: true }, orderBy: { id: 'asc' },
    });
    fallbackRouteId = route?.id ?? null;
  }

  // ── 빈 칸에만 넣는다 ──
  const rows: Prisma.ScheduleSlotCreateManyInput[] = [];
  const unregistered = new Set<string>();
  let keptOccupied = 0;
  let skippedDoubleBooked = 0;
  let skippedVehicleOff = 0;

  for (const [dateStr, byVehicle] of Object.entries(cells)) {
    const date = toDbDate(dateStr);
    for (const [vehicle, cell] of Object.entries(byVehicle)) {
      const bus = busByNumber.get(vehicle);
      if (!bus) continue;
      const routeId = bus.routeId ?? fallbackRouteId;
      if (routeId == null) continue;

      for (const [raw, shift] of [
        [cell.am, ShiftType.MORNING],
        [cell.pm, ShiftType.AFTERNOON],
      ] as const) {
        if (!isDriverName(raw)) continue;
        const cellKey = `${dateStr}|${bus.id}|${shift}`;

        // 1) 이미 사람이 있는 칸 — 손대지 않는다. 이게 이 서비스의 존재 이유다.
        if (occupied.has(cellKey)) { keptOccupied++; continue; }
        // 2) 담당자가 세워 둔 차 — 엔진이 운행으로 봤어도 초안이 우선이다.
        if (notOperating.has(`${dateStr}|${bus.id}`)) { skippedVehicleOff++; continue; }

        const name = raw.trim();
        const matches = byName.get(name);
        if (!matches || matches.length !== 1) { unregistered.add(name); continue; }
        const driverId = matches[0].id;

        // 3) 그날 이미 다른 자리에 있는 기사 — 담당자가 직접 넣어 둔 배정과
        //    엔진의 답안지가 어긋나는 지점이다. 넣지 않고 세어서 알린다.
        const dayk = `${dateStr}|${driverId}`;
        if (busyThatDay.has(dayk)) { skippedDoubleBooked++; continue; }

        rows.push({ scheduleId, driverId, routeId, busId: bus.id, date, shift });
        occupied.add(cellKey);
        busyThatDay.add(dayk);
      }
    }
  }

  if (rows.length) {
    await prisma.scheduleSlot.createMany({ data: rows });
  }

  // 채우고도 남은 빈 칸 = 운행하는데 아무도 없는 칸 (결행 후보)
  let remainingEmpty = 0;
  for (const p of patterns) {
    if (!p.operating) continue;
    const dk = dayKey(p.date);
    for (const shift of [ShiftType.MORNING, ShiftType.AFTERNOON]) {
      if (!occupied.has(`${dk}|${p.busId}|${shift}`)) remainingEmpty++;
    }
  }

  logger.info(
    `[fillSpareSlots] schedule=${scheduleId} 채움 ${rows.length} · 유지 ${keptOccupied} · ` +
      `이중배정 회피 ${skippedDoubleBooked} · 감차 ${skippedVehicleOff} · 남은 빈칸 ${remainingEmpty}`,
  );

  return {
    scheduleId,
    filled: rows.length,
    keptOccupied,
    skippedDoubleBooked,
    skippedVehicleOff,
    unregisteredNames: [...unregistered].slice(0, 50),
    remainingEmpty,
  };
}
