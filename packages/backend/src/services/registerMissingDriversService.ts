import { ShiftType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import logger from '../utils/logger';

/**
 * 엑셀엔 있는데 기초 데이터엔 없는 기사를 일괄 등록하고,
 * 그 때문에 비어 있던 배차 칸을 곧바로 메운다.
 *
 * 왜 필요한가: 엔진은 모든 칸을 채우는데, 저장 단계에서 이름을 사람 계정에
 * 붙이지 못하면 그 칸이 빈다. 담당자 눈에는 '배차표가 30% 비어 있음'으로
 * 보이고, 그 상태로는 무엇을 보여줘도 미완성으로 읽힌다. 한 번에 해소한다.
 *
 * 계정은 만들되 **로그인 수단은 만들지 않는다** (email/password 없음).
 * 배차에 필요한 건 '사람 레코드'지 로그인이 아니고, 임의 계정을 열어두는 건
 * 위험하다. 앱을 쓸 사람만 관리자가 나중에 계정 정보를 넣으면 된다.
 */

export interface RegisterResult {
  created: { name: string; employeeId: string; driverType: string | null }[];
  skipped: string[];      // 이미 있던 이름
  filledCells: number;    // 새로 채워진 배차 칸
}

const SHIFT_MAP: Record<string, ShiftType> = {
  MORNING: ShiftType.MORNING,
  AFTERNOON: ShiftType.AFTERNOON,
  FULL_DAY: ShiftType.FULL_DAY,
};

/** 회사 안에서 겹치지 않는 사번을 만든다 (AI001, AI002 …) */
async function nextEmployeeIds(companyId: number, count: number): Promise<string[]> {
  const existing = await prisma.user.findMany({
    where: { companyId, employeeId: { startsWith: 'AI' } },
    select: { employeeId: true },
  });
  let max = 0;
  for (const e of existing) {
    const m = /^AI(\d+)$/.exec(e.employeeId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: count }, (_, i) => `AI${String(max + i + 1).padStart(3, '0')}`);
}

export async function registerMissingDrivers(
  companyId: number,
  scheduleId: number,
): Promise<RegisterResult> {
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, companyId },
    select: { id: true, notes: true },
  });
  if (!schedule) throw new Error('배차표를 찾을 수 없습니다.');

  let unmatchedCells: Record<string, string> = {};
  try {
    const meta = schedule.notes ? JSON.parse(schedule.notes) : null;
    unmatchedCells = meta?.unmatchedCells ?? {};
  } catch {
    throw new Error('이 배차표에는 미등록 기사 정보가 없습니다 (AI 엔진으로 생성한 배차표만 가능).');
  }
  const entries = Object.entries(unmatchedCells);
  if (entries.length === 0) {
    return { created: [], skipped: [], filledCells: 0 };
  }

  // ── 이름별로 어떤 차량을 몇 번 탔는지 집계 → 고정/예비 판별 ──
  const rideCount = new Map<string, Map<string, number>>();
  for (const [key, name] of entries) {
    const [, vehicle] = key.split('|');
    const m = rideCount.get(name) ?? new Map<string, number>();
    m.set(vehicle, (m.get(vehicle) ?? 0) + 1);
    rideCount.set(name, m);
  }

  const names = [...rideCount.keys()];
  const already = await prisma.user.findMany({
    where: { companyId, name: { in: names } },
    select: { name: true },
  });
  const alreadySet = new Set(already.map((u) => u.name));
  const toCreate = names.filter((n) => !alreadySet.has(n));

  const ids = await nextEmployeeIds(companyId, toCreate.length);
  const created: RegisterResult['created'] = [];

  for (let i = 0; i < toCreate.length; i++) {
    const name = toCreate[i];
    const rides = rideCount.get(name)!;
    let home: string | null = null, best = 0, total = 0;
    for (const [v, c] of rides) { total += c; if (c > best) { best = c; home = v; } }
    // 한 차량에 절반 이상 몰렸으면 고정, 여기저기 흩어졌으면 예비
    const driverType = total > 0 && best / total >= 0.5 ? 'MAIN' : 'SPARE';

    await prisma.user.create({
      data: {
        companyId, name, employeeId: ids[i], role: 'DRIVER',
        driverType: driverType as 'MAIN' | 'SPARE',
        assignedBusNumber: driverType === 'MAIN' ? home : null,
        isActive: true,
        // email/password 없음 — 로그인은 관리자가 나중에 열어준다
      },
    });
    created.push({ name, employeeId: ids[i], driverType });
  }

  // ── 비어 있던 칸 메우기 ──
  const [drivers, buses] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, name: { in: names } },
      select: { id: true, name: true },
    }),
    prisma.bus.findMany({
      where: { companyId },
      select: { id: true, busNumber: true, routeId: true },
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

  const rows: {
    scheduleId: number; driverId: number; routeId: number; busId: number;
    date: Date; shift: ShiftType;
  }[] = [];
  const stillUnmatched: Record<string, string> = {};

  for (const [key, name] of entries) {
    const [dateStr, vehicle, shiftRaw] = key.split('|');
    const driverId = driverByName.get(name);
    const bus = busByNumber.get(vehicle);
    const routeId = bus?.routeId ?? fallbackRouteId;
    if (!driverId || !bus || routeId == null) {
      stillUnmatched[key] = name;
      continue;
    }
    rows.push({
      scheduleId, driverId, routeId, busId: bus.id,
      date: new Date(`${dateStr}T00:00:00.000Z`),
      shift: SHIFT_MAP[shiftRaw] ?? ShiftType.FULL_DAY,
    });
  }

  await prisma.$transaction(async (tx) => {
    if (rows.length) {
      // 같은 칸에 이미 배정이 있으면 건드리지 않는다 (담당자 수정 보호)
      await tx.scheduleSlot.createMany({ data: rows, skipDuplicates: true });
    }
    const meta = schedule.notes ? JSON.parse(schedule.notes) : {};
    await tx.schedule.update({
      where: { id: scheduleId },
      data: { notes: JSON.stringify({ ...meta, unmatchedCells: stillUnmatched }) },
    });
  }, { timeout: 60_000 });

  logger.info(
    `[registerMissing] schedule=${scheduleId} 기사 ${created.length}명 등록, ` +
      `${rows.length}칸 채움 (남은 미매칭 ${Object.keys(stillUnmatched).length})`,
  );

  return { created, skipped: [...alreadySet], filledCells: rows.length };
}
