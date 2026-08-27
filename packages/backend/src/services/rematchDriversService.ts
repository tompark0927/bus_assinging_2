import { ShiftType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { driverScopeFor } from '../utils/serviceType';
import logger from '../utils/logger';

/**
 * 기초 데이터와 다시 맞추기 — 엑셀에만 있던 이름 중 **지금은 기초 데이터에
 * 등록된** 기사의 칸만 채운다.
 *
 * 기사 계정은 절대 만들지 않는다. 배차는 회사가 등록한 사람으로만 짜야 한다.
 * 엑셀에 적힌 이름을 근거로 사람을 만들어내면, 등록한 적 없는 기사가 배차표에
 * 들어가고 그 사람 앞으로 근무·급여·기사앱 계정이 생긴다 — 오타 하나가 새
 * 직원이 되기도 한다. 시스템에는 그럴 권한이 없다.
 *
 * 그래서 흐름은 이렇게 된다:
 *   1) 배차표를 저장하면 매칭 안 된 이름이 주황색으로 남고 발행이 막힌다
 *   2) 담당자가 기초 데이터에서 그 기사를 정식으로 등록한다(사번·형태 직접 입력)
 *   3) 이 함수를 호출하면 이제 매칭되는 칸만 채워진다
 */

export interface RegisterResult {
  /** 기초 데이터에 등록되어 이번에 배정된 이름 */
  matched: string[];
  /** 아직 기초 데이터에 없어 채우지 못한 이름 (동명이인 포함) */
  unmatchedNames: string[];
  filledCells: number;    // 새로 채워진 배차 칸
  /** 이미 배정이 있거나(수기 수정 보호) 그 기사가 같은 날 다른 칸에 있어 건너뛴 칸 수 */
  skippedCells: number;
}

const SHIFT_MAP: Record<string, ShiftType> = {
  MORNING: ShiftType.MORNING,
  AFTERNOON: ShiftType.AFTERNOON,
  FULL_DAY: ShiftType.FULL_DAY,
};

export async function rematchUnmatchedCells(
  companyId: number,
  scheduleId: number,
): Promise<RegisterResult> {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, companyId },
    select: { id: true, notes: true, status: true, serviceType: true },
  });
  if (!schedule) throw new Error('배차표를 찾을 수 없습니다.');
  // 발행본에 슬롯을 끼워 넣으면 기사가 이미 본 배차가 알림 없이 바뀐다
  if (schedule.status !== 'DRAFT') {
    throw new Error('발행된 배차표는 수정할 수 없습니다. 먼저 초안으로 되돌려주세요.');
  }

  let unmatchedCells: Record<string, string> = {};
  try {
    const meta = schedule.notes ? JSON.parse(schedule.notes) : null;
    unmatchedCells = meta?.unmatchedCells ?? {};
  } catch {
    throw new Error('이 배차표에는 미등록 기사 정보가 없습니다 (엑셀에서 만든 배차표만 가능).');
  }
  const entries = Object.entries(unmatchedCells);
  if (entries.length === 0) {
    return { matched: [], unmatchedNames: [], filledCells: 0, skippedCells: 0 };
  }

  const names = [...new Set(entries.map(([, name]) => name))];
  // 기초 데이터 조회 — 여기서 만들지 않는다. 지금 등록되어 있는 사람만 쓴다.
  // 이 배차표 종류의 기사만 — 간선표의 빈 칸을 지선 기사로 메우지 않는다
  const driverScope = driverScopeFor(schedule.serviceType);
  const already = await prisma.user.findMany({
    where: { companyId, name: { in: names }, role: 'DRIVER', isActive: true, ...driverScope },
    select: { name: true },
  });
  // 동명이인 — 어느 계정인지 추측할 수 없으므로 배정하지 않는다.
  // (첫 계정으로 채우면 한 명은 과다 배차, 다른 한 명은 배차표에서 소멸)
  const nameCount = new Map<string, number>();
  for (const u of already) nameCount.set(u.name, (nameCount.get(u.name) ?? 0) + 1);
  const ambiguousSet = new Set([...nameCount.entries()].filter(([, c]) => c > 1).map(([n]) => n));

  // ── 비어 있던 칸 메우기 ──
  const [drivers, buses, existingSlots] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, name: { in: names }, role: 'DRIVER', isActive: true, ...driverScope },
      select: { id: true, name: true },
    }),
    prisma.bus.findMany({
      where: { companyId },
      select: { id: true, busNumber: true, routeId: true },
    }),
    // 이미 있는 배정 — 재실행 멱등성과 이중 배정 방지의 기준선.
    // ScheduleSlot 에는 유니크 제약이 없어 createMany 의 skipDuplicates 가
    // 아무것도 걸러주지 못한다 → 응용 레벨에서 직접 거른다.
    prisma.scheduleSlot.findMany({
      where: { scheduleId },
      select: { date: true, busId: true, shift: true, driverId: true },
    }),
  ]);
  const driverByName = new Map<string, number>();
  for (const d of drivers) if (!driverByName.has(d.name)) driverByName.set(d.name, d.id);
  const busByNumber = new Map(buses.map((b) => [b.busNumber, b]));

  let fallbackRouteId: number | null = null;
  if (buses.some((b) => b.routeId == null)) {
    const r = await prisma.route.findFirst({ where: { companyId }, select: { id: true } });
    fallbackRouteId = r?.id ?? null;
  }

  // 충돌 기준선: 이미 찬 칸(수기 수정 보호)과 그날 이미 근무하는 기사(이중 배정 방지).
  // 배치 안에서 새로 넣는 행도 즉시 등록해 같은 실행 내 충돌까지 막는다.
  const dateKeyOf = (d: Date) => d.toISOString().slice(0, 10);
  const occupiedCell = new Set<string>();  // "date|busId|shift"
  const driverBusy = new Set<string>();    // "date|driverId"
  for (const s of existingSlots) {
    const dk = dateKeyOf(s.date);
    if (s.busId != null) occupiedCell.add(`${dk}|${s.busId}|${s.shift}`);
    driverBusy.add(`${dk}|${s.driverId}`);
  }

  const rows: {
    scheduleId: number; driverId: number; routeId: number; busId: number;
    date: Date; shift: ShiftType;
  }[] = [];
  const stillUnmatched: Record<string, string> = {};
  let skippedCells = 0;

  for (const [key, name] of entries) {
    const [dateStr, vehicle, shiftRaw] = key.split('|');
    const driverId = driverByName.get(name);
    const bus = busByNumber.get(vehicle);
    const routeId = bus?.routeId ?? fallbackRouteId;
    if (!driverId || !bus || routeId == null || ambiguousSet.has(name)) {
      stillUnmatched[key] = name;
      continue;
    }
    const shift = SHIFT_MAP[shiftRaw] ?? ShiftType.FULL_DAY;
    // 이미 찬 칸이거나(재실행·수기 수정) 그 기사가 같은 날 다른 칸에 있으면
    // 절대 밀어넣지 않는다 — 조용한 이중 배정이 최악의 결과다.
    if (occupiedCell.has(`${dateStr}|${bus.id}|${shift}`) || driverBusy.has(`${dateStr}|${driverId}`)) {
      skippedCells += 1;
      continue;
    }
    occupiedCell.add(`${dateStr}|${bus.id}|${shift}`);
    driverBusy.add(`${dateStr}|${driverId}`);
    rows.push({
      scheduleId, driverId, routeId, busId: bus.id,
      date: new Date(`${dateStr}T00:00:00.000Z`),
      shift,
    });
  }

  await prisma.$transaction(async (tx) => {
    if (rows.length) {
      await tx.scheduleSlot.createMany({ data: rows });
    }
    // notes 는 트랜잭션 안에서 다시 읽는다 — 바깥에서 읽은 값을 쓰면
    // 그 사이 다른 쓰기(감차 표기 등)가 유실된다.
    const fresh = await tx.schedule.findUnique({
      where: { id: scheduleId },
      select: { notes: true },
    });
    let meta: Record<string, unknown> = {};
    try {
      const parsed = fresh?.notes ? JSON.parse(fresh.notes) : {};
      meta = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { /* 평문 notes — unmatchedCells만 새로 쓴다 */ }
    await tx.schedule.update({
      where: { id: scheduleId },
      data: { notes: JSON.stringify({ ...meta, unmatchedCells: stillUnmatched }) },
    });
  }, { timeout: 60_000 });

  const stillNames = [...new Set(Object.values(stillUnmatched))];
  logger.info(
    `[rematch] schedule=${scheduleId} ${rows.length}칸 채움, ` +
      `${skippedCells}칸 건너뜀, 아직 기초 데이터에 없는 이름 ${stillNames.length}명`,
  );

  return {
    matched: names.filter((n) => !stillNames.includes(n)),
    unmatchedNames: stillNames,
    filledCells: rows.length,
    skippedCells,
  };
}
